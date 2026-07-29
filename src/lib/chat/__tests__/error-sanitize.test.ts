import { describe, expect, it } from 'vitest';
import {
  containsRawDisconnectText,
  friendlyErrorMessageBody,
  friendlyErrorToast,
  stripRawErrorFragments,
} from '../error-sanitize';

describe('error-sanitize (UX03)', () => {
  it('maps raw disconnect / HTTP errors to friendly toast', () => {
    expect(friendlyErrorToast(new Error('[连接中断: HTTP 500]'))).toMatch(
      /网络异常|请稍后重试|再试一次/,
    );
    expect(friendlyErrorToast(new Error('Failed to fetch'))).toMatch(/网络异常|重试/);
    expect(friendlyErrorToast(new Error('HTTP Error 502'))).toMatch(/网络异常|重试|暂时无法/);
  });

  it('message body never embeds raw disconnect text', () => {
    const body = friendlyErrorMessageBody(new Error('[连接中断: HTTP 500]'));
    expect(containsRawDisconnectText(body)).toBe(false);
    expect(body).not.toMatch(/连接中断|HTTP 500/);
    expect(body).toMatch(/重试/);
  });

  it('partial content uses recoverable copy', () => {
    expect(friendlyErrorMessageBody(new Error('x'), { hadPartialContent: true })).toMatch(
      /没传完|重试/,
    );
  });

  it('strips residual fragments from content', () => {
    const cleaned = stripRawErrorFragments(
      '一段回答\n\n[连接中断: HTTP 500 Internal]\n⚠️ 发送失败: boom',
    );
    expect(containsRawDisconnectText(cleaned)).toBe(false);
    expect(cleaned).toContain('一段回答');
  });
});
