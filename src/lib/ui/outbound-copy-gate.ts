/**
 * Batch-07 — Runtime outbound copy gate for user-visible strings.
 * Covers orchestrator artifacts, desktop events, midFlowHint, and settings surfaces.
 */

import {
  hasForbiddenPrimaryCopy,
  sanitizePrimaryCopy,
  UX07_FORBIDDEN_PRIMARY_TERMS,
} from '@/lib/ui/natural-copy';

/** Extra engineering terms stripped from outbound copy (batch-07). */
const BATCH07_EXTRA_FORBIDDEN = [
  'propose ≠ commit',
  'propose≠commit',
  'propose != commit',
  'sandbox',
  'trust',
  'LLM 建议',
  'LLM建议',
  'Local Trust Mode',
  'Sandbox Mode',
] as const;

const ALL_FORBIDDEN = [...UX07_FORBIDDEN_PRIMARY_TERMS, ...BATCH07_EXTRA_FORBIDDEN];

export function hasOutboundCopyLeak(text: string): boolean {
  if (!text) return false;
  if (hasForbiddenPrimaryCopy(text)) return true;
  for (const term of BATCH07_EXTRA_FORBIDDEN) {
    if (term.toLowerCase() !== term) {
      if (text.includes(term)) return true;
    } else if (text.toLowerCase().includes(term.toLowerCase())) {
      return true;
    }
  }
  return false;
}

/** Sanitize a single outbound string; empty after strip becomes fallback. */
export function gateOutboundCopy(
  text: string,
  fallback = '',
): string {
  if (!text) return fallback;
  let out = sanitizePrimaryCopy(text);
  for (const term of BATCH07_EXTRA_FORBIDDEN) {
    const re =
      term.toLowerCase() === term
        ? new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
        : new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    out = out.replace(re, '');
  }
  out = out.replace(/\s{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (!out || hasOutboundCopyLeak(out)) return fallback || '正在处理…';
  return out;
}

export type GatableArtifact = {
  kind: string;
  content?: string;
  title?: string;
  options?: string[];
};

export function gateArtifactCopy<T extends GatableArtifact>(artifact: T): T {
  const next = { ...artifact };
  if (typeof next.content === 'string') {
    next.content = gateOutboundCopy(next.content, next.content);
  }
  if (typeof next.title === 'string') {
    next.title = gateOutboundCopy(next.title, next.title);
  }
  if (Array.isArray(next.options)) {
    next.options = next.options.map((o) => gateOutboundCopy(o, o));
  }
  return next;
}

export function gateArtifactsCopy<T extends GatableArtifact>(artifacts: T[]): T[] {
  return artifacts.map((a) => gateArtifactCopy(a));
}

export function gateDesktopEventCopy(event: {
  type?: string;
  message?: string;
  detail?: string;
}): typeof event {
  return {
    ...event,
    message: event.message
      ? gateOutboundCopy(event.message, '正在处理…')
      : event.message,
    detail: event.detail ? gateOutboundCopy(event.detail, '') : event.detail,
  };
}

/** Settings / audit surfaces — natural Chinese only. */
export const SETTINGS_LEARNING_WRITE_COPY =
  '学习写入（课程 / 日历 / 进度）需要你明确确认后才会保存，与自主级别无关。';

export { ALL_FORBIDDEN };