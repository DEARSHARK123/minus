/**
 * Server-only LearnerContextPack loader (reads disk via learner-memory).
 * Do not import from client components — use buildLearnerContextPack with API data.
 */

import { readLearnerMemory } from './learner-memory';
import {
  buildLearnerContextPack,
  type ContextPackAudience,
  type LearnerContextPack,
} from './context-pack';

/** Read store and build pack (server-side). */
export async function loadLearnerContextPack(
  audience: ContextPackAudience = 'chat',
): Promise<LearnerContextPack> {
  try {
    const data = await readLearnerMemory();
    return buildLearnerContextPack(data, audience);
  } catch (err) {
    console.warn(
      '[LearnerContextPack] failed to load:',
      err instanceof Error ? err.message : err,
    );
    return {
      empty: true,
      labeledBlock: '',
      summaryLine: '',
      entries: [],
    };
  }
}
