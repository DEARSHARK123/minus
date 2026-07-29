import { Suspense } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { StoreHydrationGate } from '@/components/providers/store-hydration-gate';
import { AutomationRuntime } from '@/components/providers/automation-runtime';

function ShellFallback() {
  return (
    <div className="h-screen flex items-center justify-center bg-[var(--bg-primary)]">
      <div className="font-tech text-sm text-[var(--text-secondary)] animate-pulse">
        加载中…
      </div>
    </div>
  );
}

/**
 * Shared product shell for /chat, /course/[id], /calendar, /library, /history.
 * URL is the page source of truth; AppShell syncs compatibility store mirrors.
 */
export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense fallback={<ShellFallback />}>
      <StoreHydrationGate>
        <AutomationRuntime />
        <AppShell>{children}</AppShell>
      </StoreHydrationGate>
    </Suspense>
  );
}
