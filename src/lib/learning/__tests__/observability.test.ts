import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  loadCounters,
  recordLlmCall,
  recordCitationReject,
  recordScheduleChange,
  resetCounters,
} from '../observability';

async function tempCountersPath(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'minus-observability-'));
  return path.join(dir, 'observability.json');
}

describe('observability counters', () => {
  let countersPath: string;
  let countersDir: string;

  beforeEach(async () => {
    countersPath = await tempCountersPath();
    countersDir = path.dirname(countersPath);
  });

  afterEach(async () => {
    await fs.rm(countersDir, { recursive: true, force: true });
  });

  it('returns default counters when file is missing', async () => {
    const counters = await loadCounters(countersPath);
    expect(counters.llmCalls).toBe(0);
    expect(counters.citationRejects).toBe(0);
    expect(counters.scheduleChanges).toBe(0);
    expect(counters.updatedAt).toBeTruthy();
  });

  it('records LLM calls', async () => {
    const counters = await recordLlmCall(countersPath);
    expect(counters.llmCalls).toBe(1);
    expect(counters.citationRejects).toBe(0);
    expect(counters.scheduleChanges).toBe(0);

    const loaded = await loadCounters(countersPath);
    expect(loaded.llmCalls).toBe(1);
  });

  it('records citation rejects', async () => {
    const counters = await recordCitationReject(countersPath);
    expect(counters.citationRejects).toBe(1);
  });

  it('records schedule changes', async () => {
    const counters = await recordScheduleChange(countersPath);
    expect(counters.scheduleChanges).toBe(1);
  });

  it('increments independently across counters', async () => {
    await recordLlmCall(countersPath);
    await recordLlmCall(countersPath);
    await recordCitationReject(countersPath);
    await recordScheduleChange(countersPath);
    await recordScheduleChange(countersPath);

    const counters = await loadCounters(countersPath);
    expect(counters.llmCalls).toBe(2);
    expect(counters.citationRejects).toBe(1);
    expect(counters.scheduleChanges).toBe(2);
  });

  it('resets all counters', async () => {
    await recordLlmCall(countersPath);
    await recordScheduleChange(countersPath);
    const counters = await resetCounters(countersPath);
    expect(counters.llmCalls).toBe(0);
    expect(counters.citationRejects).toBe(0);
    expect(counters.scheduleChanges).toBe(0);
  });
});
