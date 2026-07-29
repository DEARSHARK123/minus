import type { LLMMessage } from './types';
import {
  resolveProviderConfig,
  missingApiKeyError,
} from '@/lib/config/server-env';

export interface StreamChatOptions {
  providerId: string;
  messages: LLMMessage[];
  signal?: AbortSignal;
}

const SUPPORTED_STREAMING_PROVIDERS = new Set(['openai', 'deepseek']);

function getChatCompletionsUrl(providerId: string, baseUrl: string): string {
  const normalized = baseUrl.replace(/\/$/, '');
  return `${normalized}/chat/completions`;
}

function buildRequestBody(
  providerId: string,
  model: string,
  messages: LLMMessage[],
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    messages,
    stream: true,
    temperature: 0.7,
    max_tokens: 4096,
  };

  // DeepSeek supports a sensible default top_p but we keep the body minimal.
  // OpenAI-compatible endpoints accept the same shape.
  if (providerId === 'deepseek') {
    // DeepSeek streaming is OpenAI-compatible; no extra fields needed.
  }

  return body;
}

async function throwOnError(response: Response): Promise<void> {
  if (response.ok) return;
  let detail: string;
  try {
    detail = await response.text();
  } catch {
    detail = 'Unable to read error response';
  }
  throw new Error(`LLM API error (${response.status}): ${detail}`);
}

async function* readOpenAICompatibleStream(
  response: Response,
  signal?: AbortSignal,
): AsyncIterable<string> {
  if (!response.body) {
    throw new Error('No response body from LLM stream');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;

        const data = trimmed.slice('data:'.length).trim();
        if (data === '[DONE]') return;

        let parsed: Record<string, unknown> | undefined;
        try {
          parsed = JSON.parse(data) as Record<string, unknown>;
        } catch {
          // Ignore malformed SSE lines and continue streaming.
          continue;
        }

        if (parsed.error) {
          const errorMessage =
            typeof parsed.error === 'string'
              ? parsed.error
              : (parsed.error as { message?: string })?.message ??
                JSON.stringify(parsed.error);
          throw new Error(`LLM stream error: ${errorMessage}`);
        }

        const choices = parsed.choices as
          | Array<{
              delta?: { content?: string | null; role?: string };
              finish_reason?: string | null;
            }>
          | undefined;
        const deltaContent = choices?.[0]?.delta?.content;
        if (typeof deltaContent === 'string' && deltaContent.length > 0) {
          yield deltaContent;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Stream text deltas from an OpenAI-compatible /chat/completions endpoint.
 *
 * Supported providers this batch: openai, deepseek.
 * Anthropic and Gemini return a clear unsupported error; callers can fall back
 * to the non-streaming `callLLM` path if they need broader provider support.
 */
export async function* streamChatCompletions(
  options: StreamChatOptions,
): AsyncIterable<string> {
  const { providerId, messages, signal } = options;

  if (!SUPPORTED_STREAMING_PROVIDERS.has(providerId)) {
    throw new Error(
      `Streaming is not supported for provider "${providerId}" in this batch. Supported providers: ${Array.from(
        SUPPORTED_STREAMING_PROVIDERS,
      ).join(', ')}.`,
    );
  }

  const resolved = resolveProviderConfig(providerId);
  if (!resolved.apiKey) {
    throw new Error(missingApiKeyError(resolved.providerId));
  }

  const url = getChatCompletionsUrl(resolved.providerId, resolved.baseUrl);
  const body = buildRequestBody(
    resolved.providerId,
    resolved.model,
    messages,
  );

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${resolved.apiKey}`,
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(body),
    signal,
  });

  await throwOnError(response);

  yield* readOpenAICompatibleStream(response, signal);
}
