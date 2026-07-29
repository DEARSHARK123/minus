'use client';

import { useEffect } from 'react';
import { useSettingsStore } from '@/store/settings-store';

function getSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useSettingsStore(s => s.settings.theme);

  useEffect(() => {
    const root = document.documentElement;

    const apply = (t: 'light' | 'dark') => {
      root.setAttribute('data-theme', t);
    };

    if (theme === 'system') {
      apply(getSystemTheme());
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = (e: MediaQueryListEvent) => apply(e.matches ? 'dark' : 'light');
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    }

    apply(theme);
  }, [theme]);

  return <>{children}</>;
}
