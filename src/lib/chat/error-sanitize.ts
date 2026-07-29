/**
 * UX03 — User-facing error copy for Home / Normal.
 * Toast + recoverable message; never raw disconnect / stack in bubble body.
 */

const RAW_DISCONNECT_RE =
  /\[?\s*连接中断\s*[:：]?|HTTP\s*\d{3}|ECONNRESET|ETIMEDOUT|fetch failed|NetworkError|Failed to fetch|SSE|AbortError/i;

const TECH_LEAK_RE =
  /stack|TypeError|at\s+\S+\s+\(|node_modules|Orchestrator HTTP|Desktop agent error|JSON\.parse/i;

/** Friendly toast primary line (Chinese). */
export function friendlyErrorToast(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err || '');
  if (!raw.trim()) return '网络异常，请稍后重试';
  if (RAW_DISCONNECT_RE.test(raw) || TECH_LEAK_RE.test(raw)) {
    return '网络异常，请稍后重试';
  }
  // Keep short natural messages; strip bracketed tech tags
  const cleaned = raw
    .replace(/\[连接中断[^\]]*\]/g, '')
    .replace(/HTTP\s*\d{3}/gi, '')
    .trim();
  if (!cleaned || cleaned.length > 80 || TECH_LEAK_RE.test(cleaned)) {
    return '暂时无法完成，请再试一次';
  }
  // If looks like a plain Chinese product message, allow
  if (/[\u4e00-\u9fff]/.test(cleaned) && !RAW_DISCONNECT_RE.test(cleaned)) {
    return cleaned.length > 48 ? `${cleaned.slice(0, 47)}…` : cleaned;
  }
  return '网络异常，请稍后重试';
}

/**
 * Message-body text when a turn fails.
 * Never appends `[连接中断: …]`; offers retry-friendly copy.
 */
export function friendlyErrorMessageBody(
  err: unknown,
  opts?: { hadPartialContent?: boolean },
): string {
  if (opts?.hadPartialContent) {
    return '刚才没传完，可以点重试。';
  }
  return '刚才出了点问题，可以点重试。';
}

/** True if content still contains forbidden raw disconnect patterns. */
export function containsRawDisconnectText(text: string): boolean {
  return /\[连接中断[^\]]*\]/.test(text) || /连接中断\s*[:：]\s*HTTP/i.test(text);
}

/**
 * Sanitize any residual assistant content that may have been polluted with
 * raw error fragments (defensive for retries / partial streams).
 */
export function stripRawErrorFragments(content: string): string {
  return content
    .replace(/\n*\s*\[连接中断[^\]]*\]\s*/g, '\n')
    .replace(/\n*\s*⚠️\s*发送失败:.*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
