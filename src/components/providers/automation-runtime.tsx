'use client';

import { useEffect, useRef } from 'react';
import { useChatStore } from '@/store/chat-store';
import { useSettingsStore } from '@/store/settings-store';
import { useLearningStore } from '@/store/learning-store';

function eligibleTranscript() {
  return useChatStore
    .getState()
    .conversations.slice(0, 5)
    .flatMap((conversation) => conversation.messages)
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .filter((message) => typeof message.content === 'string' && message.content.trim())
    .slice(-30)
    .map((message) => ({
      role: message.role as 'user' | 'assistant',
      content: message.content.slice(0, 1000),
    }));
}

function courseActivity() {
  const data = useLearningStore.getState().data;
  const now = Date.now();
  return data.courses.map((course) => {
    const latest = data.sessions
      .filter((session) => session.courseId === course.id)
      .reduce((timestamp, session) => Math.max(timestamp, Date.parse(session.updatedAt)), Date.parse(course.updatedAt));
    return { courseId: course.id, idleMinutes: Math.max(0, Math.floor((now - latest) / 60_000)) };
  });
}

export function AutomationRuntime() {
  const lastActivityRef = useRef<number | null>(null);
  const runningRef = useRef(false);

  useEffect(() => {
    lastActivityRef.current = Date.now();
    const markActive = () => {
      lastActivityRef.current = Date.now();
    };
    const events: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'input', 'focus'];
    events.forEach((event) => window.addEventListener(event, markActive, { passive: true }));

    const run = async () => {
      if (runningRef.current || document.visibilityState === 'hidden') return;
      runningRef.current = true;
      try {
        await fetch('/api/settings/automations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'runDue',
            context: {
              idleMinutes: Math.floor((Date.now() - (lastActivityRef.current ?? Date.now())) / 60_000),
              transcript: eligibleTranscript(),
              userSystemPrompt: useSettingsStore.getState().settings.systemPrompt,
              courseActivity: courseActivity(),
            },
          }),
        });
      } finally {
        runningRef.current = false;
      }
    };

    void run();
    const timer = window.setInterval(() => void run(), 60_000);
    return () => {
      window.clearInterval(timer);
      events.forEach((event) => window.removeEventListener(event, markActive));
    };
  }, []);

  return null;
}
