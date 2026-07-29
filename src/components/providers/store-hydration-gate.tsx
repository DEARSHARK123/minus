'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useChatStore } from '@/store/chat-store';
import { useSettingsStore } from '@/store/settings-store';
import { conversationHasContent, parseAppPath } from '@/lib/navigation';

function HydrationFallback() {
  return (
    <div className="flex h-screen items-center justify-center bg-[var(--bg-primary)]">
      <div
        className="font-tech text-sm text-[var(--text-secondary)] motion-safe:animate-pulse"
        role="status"
        aria-live="polite"
      >
        正在恢复本地工作台…
      </div>
    </div>
  );
}

/**
 * Persisted Zustand state must not participate in the first client render.
 *
 * The server has no localStorage, while Zustand's default synchronous
 * rehydration can make the browser render a persisted conversation before
 * React hydrates the server's empty Home. Mount the product shell only after
 * both persisted stores have made one explicit recovery attempt.
 */
export function StoreHydrationGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const initialRouteRef = useRef(parseAppPath(pathname, searchParams));

  useEffect(() => {
    let active = true;

    void Promise.allSettled([
      useChatStore.persist.rehydrate(),
      useSettingsStore.persist.rehydrate(),
    ]).then(() => {
      if (!active) return;

      // Align the restored chat selection to the initial URL before mounting
      // HomeChat. This prevents a one-frame flash of the last active thread on
      // bare /chat and prevents a different thread flashing on /chat?c=… .
      const route = initialRouteRef.current;
      if (route.view === 'home') {
        const store = useChatStore.getState();
        const wantedId = route.conversationId;
        if (!wantedId) {
          store.openDraft();
        } else {
          const exists = store.conversations.some(
            (conversation) =>
              conversation.id === wantedId &&
              conversationHasContent(conversation),
          );
          if (exists) {
            if (store.activeConversationId !== wantedId) {
              store.switchConversation(wantedId);
            }
          } else {
            store.openDraft();
          }
        }
      }

      setReady(true);
    });

    return () => {
      active = false;
    };
  }, []);

  if (!ready) return <HydrationFallback />;
  return children;
}
