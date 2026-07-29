import { describe, it, expect } from 'vitest';
import { getProvider } from '../providers';

/** C) Unknown provider must throw — never fall back to OpenAI */
describe('getProvider unknown provider (security)', () => {
  it('throws for completely unknown id', () => {
    expect(() => getProvider('totally-unknown-xyz')).toThrow(/Unknown provider/);
  });

  it('error message forbids OpenAI fallback', () => {
    expect(() => getProvider('hacked')).toThrow(/No fallback to OpenAI/);
  });

  it('does not silently return OpenAI for garbage ids', () => {
    try {
      getProvider('not-a-real-provider');
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect((e as Error).message).not.toMatch(/^OpenAI$/);
      const openai = getProvider('openai');
      // Ensure known providers still work after a failed lookup
      expect(openai.id).toBe('openai');
    }
  });
});
