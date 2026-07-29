'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { HomeChat } from './home-chat';
import { LibraryPage } from './library-page';
import { CalendarPage } from './calendar-page';
import { VideoPage } from './video-page';
import { HistoryPage } from './history-page';
import { SessionPage } from './session-page';
import { parseAppPath } from '@/lib/navigation';

/**
 * Legacy view switcher — production App Router mounts pages as AppShell children.
 * Kept for any residual mounts / tests; prefers URL over store so there is no
 * second visible navigation truth.
 *
 * @deprecated Prefer App Router pages under `src/app/(app)/*`.
 */
export function Workspace() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const route = parseAppPath(pathname ?? '/chat', searchParams);

  return (
    <main
      className="flex-1 flex flex-col bg-[var(--bg-secondary)] min-w-0 relative"
      aria-label="Workspace"
    >
      <div className="absolute inset-0 blueprint-grid opacity-20 pointer-events-none [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_70%)]" />
      <div className="relative z-10 flex-1 flex flex-col min-h-0">
        {route.view === 'home' && <HomeChat />}
        {route.view === 'library' && <LibraryPage />}
        {route.view === 'calendar' && <CalendarPage />}
        {route.view === 'video' && <VideoPage />}
        {route.view === 'history' && <HistoryPage />}
        {route.view === 'session' && <SessionPage />}
      </div>
    </main>
  );
}
