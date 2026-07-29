/**
 * UX04 — Natural Chinese mastery feedback for primary UI.
 * Internal AssessmentResult (pass/partial/fail) stays in SessionEngine;
 * never surface raw enums, LLM, or validation chains in main UI.
 */

export type AssessmentResultLabel = 'pass' | 'partial' | 'fail' | string;

/** Primary short label for assessment result (badge / tree). */
export function masteryFeedbackLabel(result: AssessmentResultLabel | undefined | null): string {
  switch (result) {
    case 'pass':
      return '掌握得不错';
    case 'partial':
      return '部分掌握';
    case 'fail':
      return '再练一下';
    default:
      return '继续练习';
  }
}

/** Longer coach-style sentence for assistant bubbles. */
export function masteryFeedbackSentence(
  result: AssessmentResultLabel | undefined | null,
  opts?: { canAdvance?: boolean },
): string {
  switch (result) {
    case 'pass':
      return opts?.canAdvance
        ? '掌握得不错，这一节可以进入下一节。'
        : '掌握得不错。';
    case 'partial':
      return '部分掌握了，建议再练一下薄弱点。';
    case 'fail':
      return '再练一下这一节，我们一起巩固关键概念。';
    default:
      return '继续练习，有疑问随时问我。';
  }
}

/** Phase hint in natural Chinese (no engineer stage names). */
export function sectionPhaseNaturalLabel(
  phase: string | undefined | null,
): string {
  switch (phase) {
    case 'teach':
      return '讲解';
    case 'active_recall':
      return '练习';
    case 'assess':
      return '检验';
    case 'remediate':
      return '再练一下';
    case 'done':
      return '已完成';
    default:
      return '学习中';
  }
}

/**
 * True if text would leak internal assessment/engine jargon into primary UI.
 * Used by tests and optional sanitizers.
 */
export function hasMasteryJargonLeak(text: string): boolean {
  return /\b(pass|partial|fail)\b|LLM|引用验证|SessionEngine|OutlineAgent|IntentJudge/i.test(
    text,
  );
}
