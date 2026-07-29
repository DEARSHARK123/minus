'use client';

/**
 * QUARANTINED (UX08) — Legacy dual-truth learning workbench.
 *
 * Production surfaces are App Router only:
 * `/chat` · `/library` · `/history` · `/course/[id]` · `/calendar`
 *
 * This shell previously switched on `activeLearningView` and could mount
 * LearningFeed as a competing Home. It intentionally renders nothing so it
 * cannot become a second visible product flow.
 *
 * KnowledgeBase / LearningHistory / LearningSessionView remain available via
 * chat page wrappers — do not re-enable the store-driven switcher.
 *
 * @deprecated Use App Router pages under `src/app/(app)/*`.
 */
export function LearningWorkspace() {
  // Intentionally empty — prevents dual-truth LearningFeed Home mount.
  return null;
}
