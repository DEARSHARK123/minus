export type ModelFailureCode =
  | 'MODEL_NETWORK_ERROR'
  | 'MODEL_AUTH_ERROR'
  | 'MODEL_RATE_LIMIT'
  | 'MODEL_UNAVAILABLE'
  | 'MODEL_INVALID_RESPONSE';

export type ModelFailure = {
  code: ModelFailureCode;
  status: number;
  message: string;
};

/** A model replied, but its content could not satisfy the required protocol. */
export class ModelResponseFormatError extends Error {
  readonly code = 'MODEL_INVALID_RESPONSE' as const;

  constructor(cause?: unknown) {
    super('Model response did not match the required format', { cause });
    this.name = 'ModelResponseFormatError';
  }
}

const NETWORK_ERROR_RE =
  /fetch failed|failed to fetch|networkerror|econnrefused|econnreset|etimedout|enotfound|eai_again|socket/i;

function upstreamStatus(message: string): number | null {
  const match = message.match(/API error\s*\((\d{3})\)/i);
  if (!match) return null;
  const status = Number(match[1]);
  return Number.isInteger(status) ? status : null;
}

/** Convert provider/internal errors into stable, non-sensitive API failures. */
export function classifyModelFailure(error: unknown): ModelFailure {
  if (error instanceof ModelResponseFormatError) {
    return {
      code: 'MODEL_INVALID_RESPONSE',
      status: 502,
      message: '模型返回格式不符合要求，请重试或切换模型。',
    };
  }

  const raw = error instanceof Error ? error.message : String(error ?? '');
  const status = upstreamStatus(raw);

  if (status === 401 || status === 403) {
    return {
      code: 'MODEL_AUTH_ERROR',
      status: 503,
      message: '模型认证失败，请检查设置中的 API Key。',
    };
  }
  if (status === 429) {
    return {
      code: 'MODEL_RATE_LIMIT',
      status: 429,
      message: '模型请求过多或额度暂不可用，请稍后重试或切换模型。',
    };
  }
  if (NETWORK_ERROR_RE.test(raw)) {
    return {
      code: 'MODEL_NETWORK_ERROR',
      status: 503,
      message: '暂时无法连接模型服务，请检查网络或代理后重试。',
    };
  }

  return {
    code: 'MODEL_UNAVAILABLE',
    status: 503,
    message: '模型服务暂时不可用，请稍后重试或切换模型。',
  };
}
