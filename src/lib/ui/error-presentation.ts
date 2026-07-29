/**
 * UX07 — Recoverable error presentation helpers.
 * Primary: friendly Chinese; technical details behind「查看详情」.
 */

import {
  friendlyErrorMessageBody,
  friendlyErrorToast,
  containsRawDisconnectText,
  stripRawErrorFragments,
} from '@/lib/chat/error-sanitize';

export {
  friendlyErrorMessageBody,
  friendlyErrorToast,
  containsRawDisconnectText,
  stripRawErrorFragments,
};

export const ERROR_UI = {
  viewDetails: '查看详情',
  hideDetails: '收起详情',
  retry: '重试',
  toastNetwork: '网络异常，请稍后重试',
  toastGeneric: '暂时无法完成，请再试一次',
  bodyPartial: '刚才没传完，可以点重试。',
  bodyGeneric: '刚才出了点问题，可以点重试。',
} as const;

/**
 * Split user-facing message from optional technical detail.
 * Never puts raw disconnect text into primary body.
 */
export function presentRecoverableError(err: unknown): {
  primary: string;
  technicalDetail: string | null;
  toast: string;
} {
  const toast = friendlyErrorToast(err);
  const primary = friendlyErrorMessageBody(err);
  const raw = err instanceof Error ? err.message : String(err || '');
  const cleaned = stripRawErrorFragments(raw).trim();
  const technicalDetail =
    cleaned &&
    cleaned !== primary &&
    !containsRawDisconnectText(cleaned) &&
    cleaned.length <= 400
      ? cleaned
      : cleaned && cleaned.length > 0
        ? cleaned.slice(0, 400)
        : null;

  // Prefer hiding raw HTTP noise from technical too if it's pure disconnect
  const tech =
    technicalDetail && containsRawDisconnectText(technicalDetail)
      ? null
      : technicalDetail && technicalDetail !== primary
        ? technicalDetail
        : raw && raw !== primary && raw.length < 300
          ? raw
          : null;

  return {
    primary,
    technicalDetail: tech,
    toast,
  };
}
