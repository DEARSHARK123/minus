import { LearningSessionView } from '@/components/learning/learning-session';

/** P2: course/session page mounted in chat AppShell. */
export function SessionPage() {
  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <LearningSessionView />
    </div>
  );
}
