import { describe, expect, it } from 'vitest';
import { loadSkill } from '@/lib/agents/load-skill';

describe('loadSkill', () => {
  it('loads a known repository skill by basename or markdown filename', () => {
    const byName = loadSkill('plain-conversation');
    const byFilename = loadSkill('plain-conversation.md');

    expect(byName.length).toBeGreaterThan(0);
    expect(byFilename).toBe(byName);
  });

  it('rejects path traversal and non-basename input', () => {
    expect(loadSkill('../plain-conversation')).toBe('');
    expect(loadSkill('skills/plain-conversation')).toBe('');
    expect(loadSkill('plain conversation')).toBe('');
  });
});
