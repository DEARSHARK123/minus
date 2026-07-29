import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

export type ObservabilityCounters = {
  llmCalls: number;
  citationRejects: number;
  scheduleChanges: number;
  updatedAt: string;
};

export type CounterKind = 'llmCall' | 'citationReject' | 'scheduleChange';

const DEFAULT_COUNTERS: ObservabilityCounters = {
  llmCalls: 0,
  citationRejects: 0,
  scheduleChanges: 0,
  updatedAt: new Date().toISOString(),
};

function defaultCountersPath(): string {
  if (process.env.LEARNING_DATA_PATH) {
    return path.join(path.dirname(process.env.LEARNING_DATA_PATH), 'observability.json');
  }
  return path.join(os.homedir(), '.minus', 'data', 'observability.json');
}

export function getCountersPath(): string {
  return defaultCountersPath();
}

async function ensureDir(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

export async function loadCounters(filePath = defaultCountersPath()): Promise<ObservabilityCounters> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<ObservabilityCounters>;
    return {
      ...DEFAULT_COUNTERS,
      ...parsed,
      updatedAt: new Date().toISOString(),
    };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return { ...DEFAULT_COUNTERS };
    }
    throw new Error(
      `Failed to load observability counters: ${(err as Error).message}`,
      { cause: err },
    );
  }
}

async function saveCounters(
  counters: ObservabilityCounters,
  filePath: string,
): Promise<void> {
  await ensureDir(filePath);
  counters.updatedAt = new Date().toISOString();
  await fs.writeFile(
    filePath,
    `${JSON.stringify(counters, null, 2)}\n`,
    'utf-8',
  );
}

export async function recordCounter(
  kind: CounterKind,
  filePath = defaultCountersPath(),
): Promise<ObservabilityCounters> {
  const counters = await loadCounters(filePath);
  if (kind === 'llmCall') counters.llmCalls += 1;
  else if (kind === 'citationReject') counters.citationRejects += 1;
  else if (kind === 'scheduleChange') counters.scheduleChanges += 1;
  await saveCounters(counters, filePath);
  return counters;
}

export async function recordLlmCall(filePath?: string): Promise<ObservabilityCounters> {
  return recordCounter('llmCall', filePath);
}

export async function recordCitationReject(filePath?: string): Promise<ObservabilityCounters> {
  return recordCounter('citationReject', filePath);
}

export async function recordScheduleChange(filePath?: string): Promise<ObservabilityCounters> {
  return recordCounter('scheduleChange', filePath);
}

export async function resetCounters(filePath = defaultCountersPath()): Promise<ObservabilityCounters> {
  await ensureDir(filePath);
  const counters = { ...DEFAULT_COUNTERS, updatedAt: new Date().toISOString() };
  await saveCounters(counters, filePath);
  return counters;
}
