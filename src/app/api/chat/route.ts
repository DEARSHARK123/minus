import { NextRequest } from 'next/server';
import type { LLMMessage } from '@/lib/llm/client';
import { streamChatCompletions } from '@/lib/llm/stream';
import {
  resolveProviderConfig,
  missingApiKeyError,
} from '@/lib/config/server-env';
import type { ResolvedProviderConfig } from '@/lib/config/server-env';
import {
  LEARN_CONTENT_SYSTEM_HINT,
  hasLearnContentMarkup,
  toPublicTeachPayload,
} from '@/lib/chat/learn-content';
import {
  buildSkillPlan,
  reviewOutput,
  type SceneContext,
  type SceneId,
} from '@/lib/agents/control-plane';
import { injectContextPack } from '@/lib/memory/context-pack';
import { loadLearnerContextPack } from '@/lib/memory/context-pack-server';

export const runtime = 'nodejs';
export const maxDuration = 300;

interface ChatRequestBody {
  messages?: Array<{ role: string; content: string }>;
  providerId?: string;
  systemPrompt?: string;
  /**
   * Explicit teach path only. When true, inject adaptive teaching guidance.
   * Do NOT infer from system message text (B01).
   */
  learnMode?: boolean;
  /** Optional scene for output review when learnMode is false. */
  scene?: string;
}

function jsonErrorResponse(
  error: string,
  status: number,
): Response {
  return new Response(JSON.stringify({ success: false, error }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** learnMode === true only — never infer from hint text in messages. */
function isLearnOriented(learnMode?: boolean): boolean {
  return learnMode === true;
}

function resolveScene(body: ChatRequestBody): SceneContext {
  const raw = body.scene;
  const allowed: SceneId[] = [
    'chat',
    'planning',
    'outline',
    'session_teach',
    'session_recall',
    'session_assess',
    'session_remediate',
    'desktop',
    'memory',
    'settings',
  ];
  const scene: SceneId =
    raw && (allowed as string[]).includes(raw)
      ? (raw as SceneId)
      : body.learnMode === true
        ? 'session_teach'
        : 'chat';
  return {
    scene,
    intent: body.learnMode === true ? 'learn' : 'chat',
    stage: 'idle',
  };
}

export async function POST(request: NextRequest): Promise<Response> {
  let body: ChatRequestBody;
  try {
    body = await request.json();
  } catch {
    return jsonErrorResponse('Invalid JSON body', 400);
  }

  const { messages: rawMessages, providerId, learnMode } = body;

  if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
    return jsonErrorResponse('Messages array is required', 400);
  }

  let resolved: ResolvedProviderConfig;
  try {
    resolved = resolveProviderConfig(providerId || 'openai');
  } catch (error) {
    return jsonErrorResponse(
      error instanceof Error ? error.message : 'Unsupported provider',
      400,
    );
  }

  if (!resolved.apiKey) {
    return jsonErrorResponse(
      missingApiKeyError(resolved.providerId),
      400,
    );
  }

  let messages: LLMMessage[] = rawMessages.map((m) => ({
    role: (m.role as 'system' | 'user' | 'assistant' | 'tool') ?? 'user',
    content: m.content ?? '',
  }));

  if (body.systemPrompt?.trim()) {
    messages = [
      {
        role: 'system',
        content: `User instructions (apply unless they conflict with security or data-integrity rules):\n${body.systemPrompt.trim()}`,
      },
      ...messages,
    ];
  }

  // Explicit flag only — never infer from system-hint text in messages (B01).
  const learnOriented = isLearnOriented(learnMode);
  const sceneCtx = resolveScene(body);
  // When learnMode is true, force teach scene policy even if client scene lags.
  const skillPlan = buildSkillPlan(
    learnOriented
      ? {
          scene: 'session_teach',
          intent: 'teach',
          stage: sceneCtx.stage,
          topic: sceneCtx.topic,
        }
      : sceneCtx,
  );

  if (learnOriented) {
    const enriched = LEARN_CONTENT_SYSTEM_HINT;
    const hasSystem = messages.some((m) => m.role === 'system');
    if (hasSystem) {
      messages = messages.map((m) =>
        m.role === 'system' &&
        typeof m.content === 'string' &&
        (m.content.includes('Learning content format') || m.content.includes('Teaching quality'))
          ? { ...m, content: enriched }
          : m,
      );
    } else {
      messages = [{ role: 'system', content: enriched }, ...messages];
    }
  }

  // B02: inject LearnerContextPack for chat / teach when useful (non-blocking).
  try {
    const pack = await loadLearnerContextPack(learnOriented ? 'session' : 'chat');
    if (!pack.empty) {
      const hasSystem = messages.some((m) => m.role === 'system');
      if (hasSystem) {
        messages = messages.map((m, i) => {
          if (m.role !== 'system') return m;
          // Prepend pack to first system message only
          const firstSys = messages.findIndex((x) => x.role === 'system');
          if (i !== firstSys) return m;
          return {
            ...m,
            content: injectContextPack(
              typeof m.content === 'string' ? m.content : '',
              pack,
            ),
          };
        });
      } else {
        messages = [
          { role: 'system', content: pack.labeledBlock },
          ...messages,
        ];
      }
    }
  } catch (packErr) {
    console.warn(
      '[api/chat] LearnerContextPack inject failed:',
      packErr instanceof Error ? packErr.message : packErr,
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      let accumulated = '';
      try {
        for await (const delta of streamChatCompletions({
          providerId: resolved.providerId,
          messages,
          signal: request.signal,
        })) {
          accumulated += delta;
          send({ delta });
        }

        // Legacy teach fences are parsed for old/custom prompts, but never generated or repaired.
        if (learnOriented && hasLearnContentMarkup(accumulated)) {
          const pub = toPublicTeachPayload(accumulated);
          send({
            replace: pub.content,
            contentBlocks: pub.contentBlocks,
          });
        } else {
          // Strip legacy display markers without truncating otherwise valid output.
          const reviewed = reviewOutput({
            scene: sceneCtx,
            skillPlan,
            text: accumulated,
          });
          if (
            (reviewed.modified || reviewed.stripped) &&
            reviewed.text !== accumulated
          ) {
            send({ replace: reviewed.text, contentBlocks: [] });
          } else if (hasLearnContentMarkup(accumulated)) {
            // Fail closed if gate missed markers
            const pub = toPublicTeachPayload(reviewed.text);
            send({
              replace: pub.content,
              contentBlocks: [],
            });
          }
        }

        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      } catch (error) {
        const isCancelled =
          error instanceof DOMException && error.name === 'AbortError';
        send({
          error: isCancelled
            ? 'Cancelled'
            : error instanceof Error
              ? error.message
              : 'Unknown server error',
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
