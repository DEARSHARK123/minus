import type { Page, Route } from '@playwright/test';
import { expect } from '@playwright/test';

export const BASE = process.env.E2E_BASE_URL || 'http://localhost:3000';

export type SeedMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp?: string;
  turnId?: string;
  status?: string;
  artifacts?: Array<Record<string, unknown>>;
  thinking?: boolean;
};

export type SeedConversation = {
  id: string;
  title: string;
  messages: SeedMessage[];
  modePreference?: 'normal' | 'deep' | null;
  experience?: Record<string, unknown> | null;
  currentTurnId?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

/** Zustand persist envelope for `minus-chat` (schema v2). */
export function chatPersistPayload(input: {
  conversations: SeedConversation[];
  activeConversationId: string | null;
}) {
  const now = new Date().toISOString();
  return {
    state: {
      version: 2,
      conversations: input.conversations.map((c) => ({
        createdAt: now,
        updatedAt: now,
        modePreference: c.modePreference ?? null,
        experience: c.experience ?? null,
        currentTurnId: c.currentTurnId ?? null,
        ...c,
        messages: c.messages.map((m) => ({
          timestamp: now,
          status: 'complete',
          ...m,
        })),
      })),
      activeConversationId: input.activeConversationId,
    },
    version: 2,
  };
}

export async function seedChatStore(
  page: Page,
  payload: ReturnType<typeof chatPersistPayload>,
) {
  await page.addInitScript((data) => {
    try {
      localStorage.setItem('minus-chat', JSON.stringify(data));
    } catch {
      /* ignore */
    }
  }, payload);
}

export function sseChatBody(text: string): string {
  const lines = [
    `data: ${JSON.stringify({ delta: text })}\n\n`,
    `data: [DONE]\n\n`,
  ];
  return lines.join('');
}

export async function mockChatSse(page: Page, text = '这是普通问答回复。') {
  await page.route('**/api/chat', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: sseChatBody(text),
    });
  });
}

export type AgentsRunHandler = (body: Record<string, unknown>) => Record<string, unknown>;

export async function mockAgentsRun(page: Page, handler: AgentsRunHandler) {
  await page.route('**/api/agents/run', async (route: Route) => {
    let body: Record<string, unknown> = {};
    try {
      body = route.request().postDataJSON() as Record<string, unknown>;
    } catch {
      body = {};
    }
    const result = handler(body);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(result),
    });
  });
}

export function clarifyTopicResult(): Record<string, unknown> {
  return {
    success: true,
    route: 'learn_calibrate',
    nextStage: 'goal_clarification',
    streamChat: false,
    runDesktop: false,
    artifacts: [
      {
        id: 'guide_topic',
        kind: 'plain_assistant',
        content: '先选一个想学的主题，或自己输入。',
      },
      {
        id: 'clarify_topic',
        kind: 'single_choice',
        title: '想学什么？',
        content: '选择一个主题，或自定义。',
        options: ['Python 入门', '高等数学', '英语口语', '其他'],
        clarification: {
          field: 'topic',
          selectionMode: 'single',
          allowCustom: true,
        },
      },
    ],
    experiencePlan: {
      mode: 'deep_planning',
      requiredSteps: ['clarify_topic'],
      optionalSteps: [],
      skippedSteps: [],
      surface: 'chat',
      nextAction: 'clarify',
      commitPolicy: 'propose_only',
      confidence: 0.9,
    },
  };
}

export function clarifyLevelResult(): Record<string, unknown> {
  return {
    success: true,
    route: 'learn_calibrate',
    nextStage: 'calibration',
    streamChat: false,
    runDesktop: false,
    artifacts: [
      {
        id: 'guide_level',
        kind: 'plain_assistant',
        content: '你目前大概在什么水平？',
      },
      {
        id: 'clarify_level',
        kind: 'single_choice',
        title: '当前水平',
        content: '选一项即可继续。',
        options: ['零基础', '学过一点', '能完成基础任务', '想进阶', '其他'],
        clarification: {
          field: 'level',
          selectionMode: 'single',
          allowCustom: true,
        },
      },
    ],
    experiencePlan: {
      mode: 'deep_planning',
      requiredSteps: ['clarify_level'],
      optionalSteps: [],
      skippedSteps: [],
      surface: 'chat',
      nextAction: 'clarify',
      commitPolicy: 'propose_only',
      confidence: 0.9,
    },
  };
}

export function outlineResult(topic = 'Python 入门'): Record<string, unknown> {
  return {
    success: true,
    route: 'learn_outline',
    nextStage: 'outline',
    topic,
    streamChat: false,
    runDesktop: false,
    artifacts: [
      {
        id: 'guide_outline',
        kind: 'plain_assistant',
        content: `已为「${topic}」整理学习大纲，可直接调整单元与知识点。确认「开始学习」后才会创建课程；日程排程需在日历中单独确认。`,
      },
      {
        id: 'outline_only',
        kind: 'outline_card',
        title: topic,
        topic,
        units: [
          {
            title: '环境与语法基础',
            knowledgePoints: ['安装', '变量', '控制流'],
            estimatedMinutes: 45,
          },
          {
            title: '函数与模块',
            knowledgePoints: ['def', 'import'],
            estimatedMinutes: 40,
          },
        ],
      },
    ],
    experiencePlan: {
      mode: 'deep_planning',
      requiredSteps: ['outline'],
      optionalSteps: [],
      skippedSteps: [],
      surface: 'chat',
      nextAction: 'outline_preview',
      commitPolicy: 'propose_only',
      confidence: 0.95,
    },
  };
}

export function chatRouteResult(content: string): Record<string, unknown> {
  return {
    success: true,
    route: 'chat',
    nextStage: 'idle',
    streamChat: true,
    runDesktop: false,
    artifacts: [],
    experiencePlan: {
      mode: 'normal',
      requiredSteps: [],
      optionalSteps: [],
      skippedSteps: [],
      surface: 'chat',
      nextAction: 'stream_chat',
      commitPolicy: 'none',
      confidence: 0.8,
    },
    // home-chat may still look at plain_assistant when streamChat false
    _note: content,
  };
}

export async function dismissNativeDialogs(page: Page) {
  page.on('dialog', async (dialog) => {
    const type = dialog.type();
    if (type === 'prompt') {
      await dialog.accept('E2E重命名对话');
      return;
    }
    if (type === 'confirm') {
      await dialog.accept();
      return;
    }
    await dialog.dismiss();
  });
}

export async function gotoChat(page: Page) {
  await page.goto('/chat', { waitUntil: 'domcontentloaded' });
  await page.getByTestId('app-shell').waitFor({ state: 'visible' });
}

export async function composerTextarea(page: Page) {
  return page.getByTestId('home-main-input').getByRole('textbox', {
    name: '主输入框',
  });
}

export async function sendComposer(page: Page, text: string) {
  const input = await composerTextarea(page);
  await input.click();
  await input.fill('');
  await input.pressSequentially(text, { delay: 15 });
  // Prefer explicit submit — controlled React input + Enter can race.
  const submit = page.getByTitle('发送 (Enter)');
  await expect.poll(async () => !(await submit.isDisabled()), {
    timeout: 10_000,
  }).toBeTruthy();
  await submit.click();
}

