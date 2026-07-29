import { NextRequest, NextResponse } from 'next/server';
import {
  appendAiMemories,
  confirmMemoryItem,
  deleteMemoryItem,
  isGreetingOnlyTranscript,
  MEMORY_EXTRACT_SYSTEM,
  postFilterExtractedTexts,
  readLearnerMemory,
  rejectMemoryItem,
  saveExternalDoc,
  saveLearnerPreferences,
  upsertMemoryItem,
  type AiMemoryCandidate,
  type MemoryKind,
  type MemoryPersona,
  type MemoryStrength,
  type MemoryStylePref,
} from '@/lib/memory';
import { callLLM } from '@/lib/llm/client';
import { resolveProviderConfig, missingApiKeyError } from '@/lib/config/server-env';

export const runtime = 'nodejs';

type Action =
  | 'get'
  | 'savePreferences'
  | 'saveExternal'
  | 'upsertMemory'
  | 'deleteMemory'
  | 'confirmMemory'
  | 'rejectMemory'
  | 'extractFromChat';

function isAction(v: unknown): v is Action {
  switch (v) {
    case 'get':
    case 'savePreferences':
    case 'saveExternal':
    case 'upsertMemory':
    case 'deleteMemory':
    case 'confirmMemory':
    case 'rejectMemory':
    case 'extractFromChat':
      return true;
    default:
      return false;
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  let body: { action?: string; payload?: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const action = body.action;
  const payload = body.payload || {};

  if (!isAction(action)) {
    return NextResponse.json({ success: false, error: 'Unknown action' }, { status: 400 });
  }

  try {
    switch (action) {
      case 'get': {
        const data = await readLearnerMemory();
        return NextResponse.json({ success: true, data });
      }
      case 'savePreferences': {
        const data = await saveLearnerPreferences({
          persona: (payload.persona as MemoryPersona) || '',
          strengths: (payload.strengths as MemoryStrength[]) || [],
          stylePrefs: (payload.stylePrefs as MemoryStylePref[]) || [],
        });
        return NextResponse.json({ success: true, data });
      }
      case 'saveExternal': {
        const data = await saveExternalDoc(String(payload.externalDoc || ''));
        return NextResponse.json({ success: true, data });
      }
      case 'upsertMemory': {
        const data = await upsertMemoryItem({
          id: payload.id ? String(payload.id) : undefined,
          text: String(payload.text || ''),
          kind: payload.kind as MemoryKind | undefined,
          source: payload.source as 'ai' | 'manual' | undefined,
          status: payload.status as 'proposed' | 'confirmed' | undefined,
          confidence:
            typeof payload.confidence === 'number' ? payload.confidence : undefined,
          sensitive: payload.sensitive === true,
        });
        return NextResponse.json({ success: true, data });
      }
      case 'deleteMemory': {
        const id = String(payload.id || '');
        if (!id) {
          return NextResponse.json({ success: false, error: 'id required' }, { status: 400 });
        }
        const data = await deleteMemoryItem(id);
        return NextResponse.json({ success: true, data });
      }
      case 'confirmMemory': {
        const id = String(payload.id || '');
        if (!id) {
          return NextResponse.json({ success: false, error: 'id required' }, { status: 400 });
        }
        const data = await confirmMemoryItem(id);
        return NextResponse.json({ success: true, data });
      }
      case 'rejectMemory': {
        const id = String(payload.id || '');
        if (!id) {
          return NextResponse.json({ success: false, error: 'id required' }, { status: 400 });
        }
        const hardDelete = payload.hardDelete === true;
        const data = await rejectMemoryItem(id, hardDelete);
        return NextResponse.json({ success: true, data });
      }
      case 'extractFromChat': {
        const messages = Array.isArray(payload.messages)
          ? (payload.messages as Array<{ role: string; content: string }>)
          : [];

        // Greetings / trivia-only → zero items (B02)
        if (isGreetingOnlyTranscript(messages)) {
          const data = await readLearnerMemory();
          return NextResponse.json({
            success: true,
            data,
            extracted: [],
            skipped: 'greeting_or_trivia',
          });
        }

        const providerId = String(payload.providerId || 'openai');
        let resolved;
        try {
          resolved = resolveProviderConfig(providerId);
        } catch (e) {
          console.warn('[memory/extractFromChat] bad provider:', e);
          return NextResponse.json(
            { success: false, error: e instanceof Error ? e.message : 'Bad provider' },
            { status: 400 },
          );
        }
        if (!resolved.apiKey) {
          console.warn('[memory/extractFromChat] missing API key for', resolved.providerId);
          return NextResponse.json(
            { success: false, error: missingApiKeyError(resolved.providerId) },
            { status: 400 },
          );
        }
        const transcript = messages
          .slice(-20)
          .map((m) => `${m.role}: ${m.content}`)
          .join('\n')
          .slice(0, 6000);
        const response = await callLLM(
          [
            {
              role: 'system',
              content: MEMORY_EXTRACT_SYSTEM,
            },
            { role: 'user', content: transcript || '（空对话）' },
          ],
          [],
          {
            apiKey: resolved.apiKey,
            baseUrl: resolved.baseUrl,
            model: resolved.model,
            temperature: 0.2,
            maxTokens: 512,
            providerId: resolved.providerId,
          },
        );

        let candidates: AiMemoryCandidate[] = [];
        try {
          const raw = (response.content || '').replace(/```json|```/g, '').trim();
          const parsed = JSON.parse(raw) as {
            items?: Array<string | {
              text?: string;
              kind?: MemoryKind;
              confidence?: number;
              quote?: string;
              sensitive?: boolean;
            }>;
          };
          const items = Array.isArray(parsed.items) ? parsed.items : [];
          candidates = items
            .map((item) => {
              if (typeof item === 'string') {
                return { text: item, kind: 'preference' as const, confidence: 0.7 };
              }
              const text = String(item.text || '').trim();
              const quote = item.quote ? String(item.quote).slice(0, 200) : undefined;
              return {
                text,
                kind: item.kind,
                confidence: item.confidence,
                sensitive: item.sensitive === true,
                evidence: quote
                  ? [{ quote }]
                  : [],
              };
            })
            .filter((c) => c.text);
        } catch (parseErr) {
          console.warn(
            '[memory/extractFromChat] JSON parse failed:',
            parseErr instanceof Error ? parseErr.message : parseErr,
          );
          candidates = [];
        }

        // Post-filter greetings / trivia
        const filteredTexts = postFilterExtractedTexts(candidates.map((c) => c.text));
        const allowed = new Set(filteredTexts.map((t) => t.toLowerCase()));
        candidates = candidates.filter((c) => allowed.has(c.text.trim().toLowerCase()));

        const data = await appendAiMemories(candidates);
        const extracted = candidates.map((c) => c.text);
        return NextResponse.json({
          success: true,
          data,
          extracted,
          proposedCount: data.memories.filter((m) => m.status === 'proposed').length,
        });
      }
      default: {
        const _exhaustive: never = action;
        return NextResponse.json(
          { success: false, error: `Unknown action: ${_exhaustive}` },
          { status: 400 },
        );
      }
    }
  } catch (error) {
    console.error('[memory API]', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Memory API error',
      },
      { status: 500 },
    );
  }
}
