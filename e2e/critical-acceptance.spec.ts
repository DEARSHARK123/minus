import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import {
  chatPersistPayload,
  seedChatStore,
  mockChatSse,
  mockAgentsRun,
  clarifyTopicResult,
  clarifyLevelResult,
  outlineResult,
  chatRouteResult,
  dismissNativeDialogs,
  gotoChat,
  sendComposer,
  composerTextarea,
  BASE,
  sseChatBody,
} from './helpers';

const SHOT_DIR = path.join(
  process.env.E2E_SHOT_DIR ||
    path.join(__dirname, '../docs/exec-batches/batch-08-playwright-screenshots'),
);

async function shot(page: Page, name: string) {
  await page.screenshot({
    path: path.join(SHOT_DIR, `${name}.png`),
    fullPage: false,
  });
}

test.describe('Batch-08 real E2E acceptance', () => {
  test.afterEach(async ({ request }) => {
    const response = await request.post(`${BASE}/api/learning`, {
      data: { action: 'getAll', payload: {} },
    });
    if (!response.ok()) return;
    const json = (await response.json()) as {
      success?: boolean;
      data?: { courses?: Array<{ id: string; description?: string }> };
    };
    const temporaryCourses = (json.data?.courses || []).filter(
      (course) => course.description === 'batch-08',
    );
    for (const course of temporaryCourses) {
      await request.post(`${BASE}/api/learning`, {
        data: {
          action: 'deleteCourse',
          payload: { courseId: course.id, confirmCascade: true },
        },
      });
    }
  });

  test('nav aria-current + three viewports', async ({ page }) => {
    await gotoChat(page);
    await expect(page.getByTestId('app-sidebar')).toBeVisible();

    const homeBtn = page.getByRole('button', { name: '主页' });
    await expect(homeBtn).toHaveAttribute('aria-current', 'page');

    await page.getByRole('button', { name: '资料库' }).click();
    await expect(page).toHaveURL(/\/library/);
    await expect(page.getByRole('button', { name: '资料库' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(homeBtn).not.toHaveAttribute('aria-current', 'page');

    await page.getByRole('button', { name: '日历' }).click();
    await expect(page).toHaveURL(/\/calendar/);
    await expect(page.getByRole('button', { name: '日历' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    await page.getByRole('button', { name: '历史' }).click();
    await expect(page).toHaveURL(/\/history/);
    await expect(page.getByRole('button', { name: '历史' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    for (const [w, h, tag] of [
      [1440, 900, '1440'],
      [1024, 768, '1024'],
      [768, 1024, '768'],
    ] as const) {
      await page.setViewportSize({ width: w, height: h });
      await page.goto('/chat', { waitUntil: 'domcontentloaded' });
      const shell = page.getByTestId('app-shell');
      await expect(shell).toBeVisible();
      await expect(shell).toHaveAttribute(
        'data-layout',
        w >= 1200 ? 'desktop' : w >= 768 ? 'tablet' : 'mobile',
      );
      if (w >= 768 && w < 1200) {
        await expect
          .poll(async () => {
            const sidebarBox = await page.getByTestId('app-sidebar').boundingBox();
            return sidebarBox?.width ?? Infinity;
          })
          .toBeLessThanOrEqual(68);
      }
      await shot(page, `viewport-chat-${tag}`);
    }
  });

  test('persisted conversation hydrates without an SSR mismatch', async ({
    page,
  }) => {
    const hydrationProblems: string[] = [];
    const recordHydrationProblem = (message: string) => {
      if (
        /hydration failed|hydration mismatch|server rendered html|did not match/i.test(
          message,
        )
      ) {
        hydrationProblems.push(message);
      }
    };

    page.on('console', (message) => recordHydrationProblem(message.text()));
    page.on('pageerror', (error) => recordHydrationProblem(error.message));

    await seedChatStore(
      page,
      chatPersistPayload({
        activeConversationId: 'conv-hydration',
        conversations: [
          {
            id: 'conv-hydration',
            title: '持久化会话',
            modePreference: 'normal',
            messages: [
              { id: 'u-hydration', role: 'user', content: '恢复我的历史问题' },
              {
                id: 'a-hydration',
                role: 'assistant',
                content: '历史回答已经安全恢复。',
              },
            ],
          },
        ],
      }),
    );

    await page.goto('/chat?c=conv-hydration', {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.getByTestId('app-shell')).toBeVisible();
    await expect(page.getByText('历史回答已经安全恢复。')).toBeVisible();
    expect(hydrationProblems).toEqual([]);
  });

  test('first message from a blank draft completes instead of staying pending', async ({
    page,
  }) => {
    await mockAgentsRun(page, () => chatRouteResult(''));
    await mockChatSse(page, '闭包是函数与其词法环境的组合。');
    await gotoChat(page);

    await sendComposer(page, '请用简洁中文解释：什么是闭包？');

    await expect(
      page.getByText('闭包是函数与其词法环境的组合。'),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('正在整理回答…')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '重新生成回答' })).toBeVisible();
  });

  test('tablet calendar keeps one auxiliary rail and readable month grid', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/calendar', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('app-shell')).toHaveAttribute('data-layout', 'tablet');
    await expect
      .poll(async () => {
        const box = await page.getByTestId('app-sidebar').boundingBox();
        return box?.width ?? Infinity;
      })
      .toBeLessThanOrEqual(68);
    await expect(page.getByTestId('calendar-page')).toHaveAttribute('data-layout', 'tablet');
    await expect(page.getByTestId('calendar-companion')).toHaveCount(0);
    const grid = page.getByTestId('calendar-grid');
    await expect(grid).toBeVisible();
    await expect
      .poll(async () => (await grid.boundingBox())?.width ?? 0)
      .toBeGreaterThanOrEqual(640);
  });

  test('calendar companion conversation updates an uncommitted draft and survives refresh', async ({ page }) => {
    const browserProblems: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning') {
        browserProblems.push(message.text());
      }
    });
    page.on('pageerror', (error) => browserProblems.push(error.message));
    const now = '2026-07-15T08:00:00.000Z';
    const scheduledStart = '2026-07-15T11:00:00.000Z';
    const scheduledEnd = '2026-07-15T11:30:00.000Z';
    let assistantCalls = 0;
    await page.route('**/api/learning', async (route) => {
      const request = route.request();
      if (request.method() !== 'POST') {
        await route.continue();
        return;
      }
      const body = request.postDataJSON() as { action?: string };
      if (body.action === 'getAll') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              version: 2,
              courses: [{ id: 'course-calendar-chat', title: 'JavaScript 进阶', createdAt: now, updatedAt: now }],
              documents: [],
              goals: [],
              units: [],
              tasks: [{
                id: 'task-calendar-chat',
                courseId: 'course-calendar-chat',
                title: '复习闭包',
                estimatedMinutes: 30,
                status: 'confirmed',
                locked: false,
                createdAt: now,
                updatedAt: now,
              }],
              timetable: [],
              sessions: [],
              diagnosticGaps: [],
              artifacts: [],
              feedbackSignals: [],
              learnerProfiles: [],
              importSuggestions: [],
            },
          }),
        });
        return;
      }
      if (body.action === 'getCalendarBrief') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              summary: '今天暂无已确认任务。',
              loadExplanation: '今日负荷：0 项。',
              conflictHints: [],
              agentGenerated: false,
              contextPackLoaded: true,
              contextSummaryLine: '',
              generatedAt: now,
            },
          }),
        });
        return;
      }
      if (body.action === 'calendarAssistant') {
        assistantCalls += 1;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              reply: '已按工作日晚间生成新的安排草案。',
              action: 'replan',
              suggestions: ['每天控制在 45 分钟内'],
              issues: [],
              proposal: {
                id: 'proposal-calendar-chat',
                courseId: 'course-calendar-chat',
                baseRevision: 'v1_calendar_chat',
                createdAt: now,
                timeZone: 'Asia/Shanghai',
                constraints: {
                  availableDays: [1, 2, 3, 4, 5],
                  dayStartHour: 19,
                  dayEndHour: 22,
                },
                plan: {
                  warnings: [],
                  tasks: [{
                    id: 'task-calendar-chat',
                    courseId: 'course-calendar-chat',
                    title: '复习闭包',
                    estimatedMinutes: 30,
                    status: 'scheduled',
                    locked: false,
                    scheduledStart,
                    scheduledEnd,
                    createdAt: now,
                    updatedAt: now,
                  }],
                },
                diffs: [{
                  taskId: 'task-calendar-chat',
                  title: '复习闭包',
                  beforeStatus: 'confirmed',
                  afterStatus: 'scheduled',
                  afterStart: scheduledStart,
                  afterEnd: scheduledEnd,
                }],
                applied: false,
              },
            },
          }),
        });
        return;
      }
      await route.continue();
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/calendar', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('calendar-companion-chat')).toBeVisible();
    await page.getByTestId('calendar-assistant-input').fill('这周只安排在工作日晚上');
    await page.getByTestId('calendar-assistant-send').click();

    await expect(page.getByText('已按工作日晚间生成新的安排草案。')).toBeVisible();
    await expect(page.getByTestId('calendar-assistant-draft-notice')).toContainText('确认前不会写入日历');
    await expect(page.getByTestId('proposal-preview')).toBeVisible();
    await expect(page.getByRole('button', { name: '应用这个安排' })).toBeEnabled();
    expect(assistantCalls).toBe(1);
    await shot(page, 'calendar-assistant-desktop');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByText('已按工作日晚间生成新的安排草案。')).toBeVisible();
    await expect(page.getByTestId('proposal-preview')).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: '学习伴侣' }).click();
    await expect(page.getByTestId('calendar-companion-mobile')).toBeVisible();
    await expect(page.getByTestId('calendar-companion-chat')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
      await page.evaluate(() => document.documentElement.clientWidth),
    );
    await shot(page, 'calendar-assistant-mobile');
    expect(browserProblems).toEqual([]);
  });

  test('calendar companion keeps one failed turn and retries it without duplicate input', async ({ page }) => {
    const now = '2026-07-15T08:00:00.000Z';
    const scheduledStart = '2026-07-15T11:00:00.000Z';
    const scheduledEnd = '2026-07-15T11:30:00.000Z';
    let assistantCalls = 0;
    await page.route('**/api/learning', async (route) => {
      const request = route.request();
      if (request.method() !== 'POST') {
        await route.continue();
        return;
      }
      const body = request.postDataJSON() as { action?: string };
      if (body.action === 'getAll') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              version: 2,
              courses: [{ id: 'course-calendar-retry', title: 'JavaScript 进阶', createdAt: now, updatedAt: now }],
              documents: [],
              goals: [],
              units: [],
              tasks: [{
                id: 'task-calendar-retry',
                courseId: 'course-calendar-retry',
                title: '复习闭包',
                estimatedMinutes: 30,
                status: 'confirmed',
                locked: false,
                createdAt: now,
                updatedAt: now,
              }],
              timetable: [],
              sessions: [],
              diagnosticGaps: [],
              artifacts: [],
              feedbackSignals: [],
              learnerProfiles: [],
              importSuggestions: [],
            },
          }),
        });
        return;
      }
      if (body.action === 'getCalendarBrief') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              summary: '今天暂无已确认任务。',
              loadExplanation: '今日负荷：0 项。',
              conflictHints: [],
              agentGenerated: false,
              contextPackLoaded: true,
              contextSummaryLine: '',
              generatedAt: now,
            },
          }),
        });
        return;
      }
      if (body.action === 'calendarAssistant') {
        assistantCalls += 1;
        if (assistantCalls === 1) {
          await route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({
              success: false,
              error: 'SHOULD_NOT_RENDER: fetch failed',
              details: { code: 'MODEL_NETWORK_ERROR' },
            }),
          });
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              reply: '已重新生成更均匀的安排草案。',
              action: 'replan',
              suggestions: ['每天控制在 45 分钟内'],
              issues: [],
              proposal: {
                id: 'proposal-calendar-retry',
                courseId: 'course-calendar-retry',
                baseRevision: 'v1_calendar_retry',
                createdAt: now,
                timeZone: 'Asia/Shanghai',
                constraints: { deadlinePreference: 'even' },
                plan: {
                  warnings: [],
                  tasks: [{
                    id: 'task-calendar-retry',
                    courseId: 'course-calendar-retry',
                    title: '复习闭包',
                    estimatedMinutes: 30,
                    status: 'scheduled',
                    locked: false,
                    scheduledStart,
                    scheduledEnd,
                    createdAt: now,
                    updatedAt: now,
                  }],
                },
                diffs: [{
                  taskId: 'task-calendar-retry',
                  title: '复习闭包',
                  beforeStatus: 'confirmed',
                  afterStatus: 'scheduled',
                  afterStart: scheduledStart,
                  afterEnd: scheduledEnd,
                }],
                applied: false,
              },
            },
          }),
        });
        return;
      }
      await route.continue();
    });

    await page.goto('/calendar', { waitUntil: 'domcontentloaded' });
    const failedText = '把当前草案安排得更均匀';
    await page.getByTestId('calendar-assistant-input').fill(failedText);
    await page.getByTestId('calendar-assistant-send').click();

    await expect(page.getByTestId('calendar-assistant-error')).toContainText(
      '暂时无法连接模型服务',
    );
    await expect(page.getByText('SHOULD_NOT_RENDER: fetch failed')).toHaveCount(0);
    await expect(page.getByTestId('calendar-assistant-message-user')).toHaveCount(1);
    await expect(page.getByTestId('calendar-assistant-input')).toHaveValue('');
    await expect(
      page.getByTestId('calendar-assistant-suggestions').getByRole('button', { name: failedText }),
    ).toHaveCount(0);

    await page.getByTestId('calendar-assistant-retry').click();
    await expect(page.getByText('已重新生成更均匀的安排草案。')).toBeVisible();
    await expect(page.getByTestId('calendar-assistant-message-user')).toHaveCount(1);
    await expect(page.getByTestId('calendar-assistant-input')).toHaveValue('');
    await expect(page.getByTestId('proposal-preview')).toBeVisible();
    expect(assistantCalls).toBe(2);
  });

  test('empty Library upload opens chooser and cancel clears the pending file', async ({ page }) => {
    let courseCreated = false;
    let importCalls = 0;
    const now = new Date().toISOString();
    await page.route('**/api/learning', async (route) => {
      const request = route.request();
      if (request.method() !== 'POST') {
        await route.continue();
        return;
      }
      const body = request.postDataJSON() as { action?: string };
      if (body.action === 'createCourse') {
        courseCreated = true;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              id: 'course-upload-test',
              title: '代码资料',
              createdAt: now,
              updatedAt: now,
            },
          }),
        });
        return;
      }
      if (body.action === 'importDocument') {
        importCalls += 1;
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ success: false, error: 'unexpected import' }),
        });
        return;
      }
      if (body.action !== 'getAll') {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            version: 2,
            courses: courseCreated
              ? [
                  {
                    id: 'course-upload-test',
                    title: '代码资料',
                    createdAt: now,
                    updatedAt: now,
                  },
                ]
              : [],
            documents: [],
            goals: [],
            units: [],
            tasks: [],
            timetable: [],
            sessions: [],
            diagnosticGaps: [],
            artifacts: [],
            feedbackSignals: [],
            learnerProfiles: [],
            importSuggestions: [],
          },
        }),
      });
    });
    await page.goto('/library', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('library-empty')).toBeVisible();
    const chooserPromise = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: '上传资料' }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles({
      name: 'old-note.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from('# old'),
    });
    await expect(page.getByText('先创建资料文件夹')).toBeVisible();
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await page.getByRole('button', { name: '新建文件夹', exact: true }).click();
    await page.getByLabel('文件夹名称').fill('代码资料');
    await page.getByRole('button', { name: '创建', exact: true }).click();
    await expect(page.getByTestId('library-workspace')).toBeVisible();
    expect(importCalls).toBe(0);
  });

  test('Home Tools exposes explicit modes and prefills Study Planner', async ({ page }) => {
    await gotoChat(page);
    await page.getByTestId('home-tools-menu').click();
    await expect(page.getByText('学习计划', { exact: true })).toBeVisible();
    await expect(page.getByText('本机任务', { exact: true })).toBeVisible();
    await expect(page.getByText('资料问答', { exact: true })).toBeVisible();
    await page.getByText('学习计划', { exact: true }).click();
    await expect(await composerTextarea(page)).toHaveValue(/深入学习计划/);
    await expect(page.getByTestId('home-deep-status')).toBeVisible();
  });

  test('global search locates a document and highlights a calendar task', async ({ page, request }) => {
    const createCourse = await request.post(`${BASE}/api/learning`, {
      data: {
        action: 'createCourse',
        payload: { title: '搜索定位课程', description: 'batch-08' },
      },
    });
    const courseJson = await createCourse.json();
    const courseId = String(courseJson.data?.id || '');
    expect(courseId).not.toBe('');

    await request.post(`${BASE}/api/learning`, {
      data: {
        action: 'importDocument',
        payload: {
          courseId,
          title: '搜索定位资料',
          format: 'markdown',
          content: '# 搜索定位资料\n这是用于对象定位验收的内容。',
        },
      },
    });
    const start = new Date();
    start.setHours(10, 0, 0, 0);
    const end = new Date(start.getTime() + 45 * 60 * 1000);
    await request.post(`${BASE}/api/learning`, {
      data: {
        action: 'upsertTask',
        payload: {
          courseId,
          title: '搜索定位任务',
          estimatedMinutes: 45,
          status: 'scheduled',
          scheduledStart: start.toISOString(),
          scheduledEnd: end.toISOString(),
        },
      },
    });

    await gotoChat(page);
    await page.getByLabel('搜索对话、课程、资料和任务').click();
    await page.getByLabel('搜索关键词').fill('搜索定位资料');
    await page.getByRole('button', { name: /搜索定位资料/ }).click();
    await expect(page).toHaveURL(/\/library/);
    await expect(page.getByTestId('library-doc-actions')).toContainText('搜索定位资料');

    await page.getByLabel('搜索对话、课程、资料和任务').click();
    await page.getByLabel('搜索关键词').fill('搜索定位任务');
    await page.getByRole('button', { name: /搜索定位任务/ }).click();
    await expect(page).toHaveURL(/\/calendar/);
    await expect(page.locator('[data-highlighted="true"]')).toContainText('搜索定位任务');
  });

  test('data restore previews overwrite scope before any write', async ({ page }) => {
    let importCalls = 0;
    await page.route('**/api/settings/data', async (route) => {
      if (route.request().method() === 'POST') importCalls += 1;
      await route.continue();
    });
    await gotoChat(page);
    await page.getByRole('button', { name: '设置 模型 · 安全 · 记忆 · 审计' }).click();
    await page.getByRole('button', { name: '数据与存储', exact: true }).click();
    const backup = {
      product: 'minus',
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      server: {
        schemaVersion: 1,
        learning: {
          version: 2,
          courses: [],
          documents: [],
          goals: [],
          units: [],
          tasks: [],
          timetable: [],
          sessions: [],
          diagnosticGaps: [],
          artifacts: [],
          feedbackSignals: [],
          learnerProfiles: [],
          importSuggestions: [],
        },
        memory: {
          version: 2,
          persona: '',
          strengths: [],
          stylePrefs: [],
          memories: [],
          externalDoc: '',
        },
      },
      browser: { chat: null, settings: null },
    };
    await page.getByLabel('选择 Minus 数据包').setInputFiles({
      name: 'minus-backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(backup)),
    });
    await expect(page.getByText('即将恢复「minus-backup.json」')).toBeVisible();
    await expect(page.getByRole('status')).toContainText('确认前不会写入');
    expect(importCalls).toBe(0);
    await page.getByRole('button', { name: '取消', exact: true }).click();
    expect(importCalls).toBe(0);
  });

  test('Settings is a focus-trapped dialog and restores trigger focus on Escape', async ({ page }) => {
    await gotoChat(page);
    const trigger = page.getByRole('button', {
      name: '设置 模型 · 安全 · 记忆 · 审计',
    });
    await trigger.click();
    await expect(page.getByRole('dialog', { name: '设置' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: '设置' })).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test('Course early finish persists reflection without completing the task', async ({ page, request }) => {
    const course = await (
      await request.post(`${BASE}/api/learning`, {
        data: {
          action: 'createCourse',
          payload: { title: '复盘验收课程', description: 'batch-08' },
        },
      })
    ).json();
    const courseId = String(course.data.id);
    await request.post(`${BASE}/api/learning`, {
      data: {
        action: 'upsertUnit',
        payload: { courseId, title: '尚未完成的单元', order: 0 },
      },
    });
    const task = await (
      await request.post(`${BASE}/api/learning`, {
        data: {
          action: 'upsertTask',
          payload: {
            courseId,
            title: '复盘验收任务',
            estimatedMinutes: 30,
            status: 'confirmed',
          },
        },
      })
    ).json();
    const taskId = String(task.data.id);
    const session = await (
      await request.post(`${BASE}/api/learning`, {
        data: {
          action: 'createSession',
          payload: { courseId, taskId, notes: 'E2E' },
        },
      })
    ).json();
    const sessionId = String(session.data.id);

    await page.goto(`/course/${courseId}?s=${sessionId}`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.getByTestId('course-session-layout')).toBeVisible();
    await expect(page.getByText('当前课程还没有导入资料')).toHaveCount(0);
    await expect(page.getByTestId('course-knowledge-sources')).toContainText(
      '模型知识',
    );
    const smartWeb = page.getByRole('button', { name: '智能', exact: true });
    const alwaysWeb = page.getByRole('button', { name: '每次', exact: true });
    await expect(smartWeb).toHaveAttribute('aria-pressed', 'true');
    await alwaysWeb.click();
    await expect(alwaysWeb).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: '查看完成总结' }).click();
    await expect(page.getByRole('dialog', { name: '要提前结束本次学习吗？' })).toBeVisible();
    await page
      .getByPlaceholder('记录掌握点、疑问或下次想继续的内容…')
      .fill('下次继续练习这一节');
    await page.getByRole('button', { name: '保存总结并结束本次' }).click();
    await expect(page).toHaveURL(/\/history/);

    const restored = await (
      await request.post(`${BASE}/api/learning`, {
        data: { action: 'getSession', payload: { sessionId } },
      })
    ).json();
    expect(restored.data.notes).toContain('[Minus 学习总结]');
    expect(restored.data.notes).toContain('下次继续练习这一节');
    const all = await (
      await request.post(`${BASE}/api/learning`, {
        data: { action: 'getAll', payload: {} },
      })
    ).json();
    const savedTask = all.data.tasks.find((item: { id: string }) => item.id === taskId);
    expect(savedTask.status).not.toBe('completed');
  });

  test('mode toggle: deep switches to status chip', async ({ page }) => {
    await gotoChat(page);
    await expect(page.getByTestId('home-empty')).toBeVisible();
    await expect(page.getByTestId('home-mode-toggle')).toBeVisible();

    await page.getByTestId('mode-deep').click();
    // Selecting Deep upgrades experience → deep_planning: toggle hides, status shows.
    await expect(page.getByTestId('home-deep-status')).toBeVisible();
    await expect(page.getByTestId('home-mode-toggle')).toHaveCount(0);
    await expect(page.getByTestId('home-deep-status')).toContainText('深入');
    await shot(page, 'mode-toggle');
  });

  test('Deep clarify buttons + outline once no fences', async ({ page }) => {
    let call = 0;
    await mockAgentsRun(page, () => {
      call += 1;
      if (call === 1) return clarifyTopicResult();
      if (call === 2) return clarifyLevelResult();
      return outlineResult('Python 入门');
    });
    await mockChatSse(page, '不应走到普通流');

    await gotoChat(page);
    await page.getByTestId('mode-deep').click();
    await expect(page.getByTestId('home-deep-status')).toBeVisible();
    await sendComposer(page, '我想深入学习');

    await expect(page.getByTestId('inline-single-choice')).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByTestId('inline-single-choice')).toHaveAttribute(
      'data-clarify-field',
      'topic',
    );
    await expect(page.getByTestId('clarify-option-0')).toBeVisible();
    await page.getByTestId('clarify-option-0').click();

    await expect(page.getByTestId('inline-single-choice')).toHaveAttribute(
      'data-clarify-field',
      'level',
      { timeout: 20_000 },
    );
    await page.getByTestId('clarify-option-0').click();

    await expect(page.getByTestId('editable-outline')).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByTestId('editable-outline')).toHaveCount(1);
    await expect(page.getByTestId('outline-unit-list')).toBeVisible();

    const bodyText = await page.locator('body').innerText();
    expect(bodyText).not.toMatch(/:::summary/);
    expect(bodyText).not.toMatch(/:::key/);
    expect(bodyText).not.toMatch(/propose\s*≠\s*commit/i);
    await shot(page, 'deep-outline-once');
  });

  test('A Deep outline → B normal Q&A → return A (isolation)', async ({
    page,
  }) => {
    const now = new Date().toISOString();
    const payload = chatPersistPayload({
      activeConversationId: 'conv-a',
      conversations: [
        {
          id: 'conv-a',
          title: 'A深入Python',
          modePreference: 'deep',
          currentTurnId: 'turn-a1',
          experience: {
            stage: 'outline',
            topic: 'Python 入门',
            experienceMode: 'deep_planning',
            modePreference: 'deep',
            artifacts: [
              {
                id: 'outline_only',
                kind: 'outline_card',
                title: 'Python 入门',
                units: [
                  {
                    title: '环境与语法基础',
                    knowledgePoints: ['安装'],
                  },
                ],
              },
            ],
            updatedAt: now,
          },
          messages: [
            {
              id: 'ua1',
              role: 'user',
              content: '我想深入学 Python',
              turnId: 'turn-a1',
            },
            {
              id: 'aa1',
              role: 'assistant',
              content: '已为「Python 入门」整理学习大纲。',
              turnId: 'turn-a1',
              artifacts: [
                {
                  id: 'guide_outline',
                  kind: 'plain_assistant',
                  content: '已为「Python 入门」整理学习大纲。',
                },
                {
                  id: 'outline_only',
                  kind: 'outline_card',
                  title: 'Python 入门',
                  units: [
                    {
                      title: '环境与语法基础',
                      knowledgePoints: ['安装'],
                    },
                  ],
                },
              ],
            },
          ],
        },
        {
          id: 'conv-b',
          title: 'B普通问答',
          modePreference: 'normal',
          experience: {
            stage: 'idle',
            experienceMode: 'normal',
            modePreference: 'normal',
            artifacts: [],
            updatedAt: now,
          },
          messages: [
            {
              id: 'ub1',
              role: 'user',
              content: '今天天气怎样？',
            },
            {
              id: 'ab1',
              role: 'assistant',
              content: '我没法查实时天气，但可以帮你看看出行建议。',
            },
          ],
        },
      ],
    });

    await seedChatStore(page, payload);
    await mockAgentsRun(page, () => chatRouteResult('ok'));
    await mockChatSse(page, 'B 会话的独立回复');

    // Open A by conversation URL so AppShell does not force openDraft().
    await page.goto('/chat?c=conv-a', { waitUntil: 'domcontentloaded' });
    await page.getByTestId('app-shell').waitFor({ state: 'visible' });

    await expect(page.getByText('A深入Python').first()).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByTestId('editable-outline')).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByTestId('editable-outline')).toHaveCount(1);

    await page.getByText('B普通问答').first().click();
    await expect(page.getByText('今天天气怎样？')).toBeVisible();
    await expect(page.getByTestId('editable-outline')).toHaveCount(0);
    await expect(page.getByText('环境与语法基础')).toHaveCount(0);

    await sendComposer(page, '再问一句普通问题');
    await expect(page.getByText('B 会话的独立回复')).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByTestId('editable-outline')).toHaveCount(0);

    await page.getByText('A深入Python').first().click();
    await expect(page.getByTestId('editable-outline')).toBeVisible();
    await expect(page.getByText('B 会话的独立回复')).toHaveCount(0);
    await expect(page.getByText('今天天气怎样？')).toHaveCount(0);
    await shot(page, 'isolation-return-a');
  });

  test('edit history message + regenerate truncates trailing', async ({
    page,
  }) => {
    const payload = chatPersistPayload({
      activeConversationId: 'conv-edit',
      conversations: [
        {
          id: 'conv-edit',
          title: '编辑重生成',
          modePreference: 'normal',
          messages: [
            { id: 'u1', role: 'user', content: '原始问题甲' },
            { id: 'a1', role: 'assistant', content: '原始回答甲' },
            { id: 'u2', role: 'user', content: '后续问题乙' },
            { id: 'a2', role: 'assistant', content: '后续回答乙' },
          ],
        },
      ],
    });
    await seedChatStore(page, payload);

    let agentsCalls = 0;
    await mockAgentsRun(page, () => {
      agentsCalls += 1;
      return chatRouteResult('regen');
    });
    await mockChatSse(page, '编辑后重新生成的回答');

    await page.goto('/chat?c=conv-edit', { waitUntil: 'domcontentloaded' });
    await page.getByTestId('app-shell').waitFor({ state: 'visible' });
    await expect(page.getByText('后续回答乙')).toBeVisible({ timeout: 20_000 });

    await page.getByTestId('edit-message-u1').click();
    const input = await composerTextarea(page);
    await expect(input).toHaveValue('原始问题甲');
    await input.fill('');
    await input.pressSequentially('修改后的问题甲', { delay: 15 });
    await page.getByTitle('发送 (Enter)').click();

    await expect(page.getByText('修改后的问题甲')).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText('编辑后重新生成的回答')).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText('后续问题乙')).toHaveCount(0);
    await expect(page.getByText('后续回答乙')).toHaveCount(0);
    expect(agentsCalls).toBeGreaterThan(0);
    await shot(page, 'edit-regenerate');
  });

  test('sidebar conversation rename + delete', async ({ page }) => {
    const payload = chatPersistPayload({
      activeConversationId: 'conv-crud',
      conversations: [
        {
          id: 'conv-crud',
          title: '待管理对话',
          modePreference: 'normal',
          messages: [
            { id: 'u1', role: 'user', content: '你好' },
            { id: 'a1', role: 'assistant', content: '你好，有什么可以帮你？' },
          ],
        },
        {
          id: 'conv-keep',
          title: '保留对话',
          modePreference: 'normal',
          messages: [
            { id: 'u2', role: 'user', content: '保留' },
            { id: 'a2', role: 'assistant', content: '已保留' },
          ],
        },
      ],
    });
    await seedChatStore(page, payload);
    dismissNativeDialogs(page);

    await page.goto('/chat?c=conv-crud', { waitUntil: 'domcontentloaded' });
    await page.getByTestId('app-shell').waitFor({ state: 'visible' });
    await expect(page.getByText('待管理对话').first()).toBeVisible({
      timeout: 20_000,
    });

    const row = page
      .locator('[role="listitem"]')
      .filter({ hasText: '待管理对话' })
      .first();
    await row
      .getByTestId('entity-actions-menu')
      .getByRole('button')
      .first()
      .click();
    await page.getByRole('menuitem', { name: '重命名' }).click();
    await expect(page.getByText('E2E重命名对话').first()).toBeVisible({
      timeout: 10_000,
    });

    const renamed = page
      .locator('[role="listitem"]')
      .filter({ hasText: 'E2E重命名对话' })
      .first();
    await renamed
      .getByTestId('entity-actions-menu')
      .getByRole('button')
      .first()
      .click();
    await page.getByRole('menuitem', { name: '删除' }).click();
    await expect(page.getByText('E2E重命名对话')).toHaveCount(0);
    await expect(page.getByText('保留对话').first()).toBeVisible();
    await shot(page, 'sidebar-conversation-crud');
  });

  test('course sidebar CRUD via learning API + UI', async ({ page, request }) => {
    const create = await request.post(`${BASE}/api/learning`, {
      data: {
        action: 'createCourse',
        payload: { title: 'E2E临时课程', description: 'batch-08' },
      },
    });
    const createJson = (await create.json()) as {
      success?: boolean;
      data?: { id?: string };
      error?: string;
    };
    test.skip(
      !createJson?.success || !createJson?.data?.id,
      `createCourse unavailable: ${JSON.stringify(createJson).slice(0, 200)}`,
    );

    const courseId = createJson.data!.id as string;

    page.on('dialog', async (dialog) => {
      if (dialog.type() === 'prompt') {
        await dialog.accept('E2E课程已改名');
        return;
      }
      await dialog.accept();
    });

    await gotoChat(page);
    const courseRow = page.getByTestId(`sidebar-course-${courseId}`);
    await expect(courseRow).toBeVisible({ timeout: 20_000 });

    await courseRow
      .getByTestId('entity-actions-menu')
      .getByRole('button')
      .first()
      .click();
    await page.getByRole('menuitem', { name: '重命名' }).click();
    await expect(page.getByText('E2E课程已改名').first()).toBeVisible({
      timeout: 15_000,
    });

    const renamedRow = page.getByTestId(`sidebar-course-${courseId}`);
    await renamedRow
      .getByTestId('entity-actions-menu')
      .getByRole('button')
      .first()
      .click();
    await page.getByRole('menuitem', { name: '删除' }).click();
    await expect(page.getByTestId(`sidebar-course-${courseId}`)).toHaveCount(0, {
      timeout: 15_000,
    });
    await shot(page, 'sidebar-course-crud');
  });

  test('HITL single confirm surface allow/deny/cancel', async ({ page }) => {
    // Seed a real conversation first. Draft→first-message remounts activeConversationId
    // and the HomeChat cleanup bumps stream generation, which races desktop SSE.
    const payload = chatPersistPayload({
      activeConversationId: 'conv-hitl',
      conversations: [
        {
          id: 'conv-hitl',
          title: 'HITL会话',
          modePreference: 'normal',
          messages: [
            { id: 'u0', role: 'user', content: '打个招呼' },
            { id: 'a0', role: 'assistant', content: '你好，我在。' },
          ],
        },
      ],
    });
    await seedChatStore(page, payload);

    await page.route('**/api/chat', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: sseChatBody('不应走普通 chat'),
      });
    });

    await page.route(/\/api\/agents\/run\/?$/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          route: 'desktop',
          streamChat: false,
          runDesktop: true,
          artifacts: [],
          nextStage: 'idle',
          experiencePlan: {
            mode: 'chat',
            requiredSteps: [],
            optionalSteps: [],
            skippedSteps: [],
            surface: 'chat',
            nextAction: 'desktop',
            commitPolicy: 'hitl',
            confidence: 0.7,
          },
        }),
      });
    });

    await page.route(/\/api\/agent\/?$/, async (route) => {
      const body = route.request().postDataJSON() as { action?: string };
      if (body?.action === 'cancel' || body?.action === 'resume') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true }),
        });
        return;
      }
      const events = [
        {
          type: 'pending_tool_confirm',
          pending: {
            toolCallId: 'tc1',
            toolName: 'file_manager',
            parameters: { action: 'write', path: 'D:/tmp/e2e.txt' },
            confirmReason: 'dangerous_tool',
            resumeToken: 'tok-e2e-1',
            reasonLabel: '需要确认',
            riskLabel: '较高风险',
            whatChanges: '将写入本地文件',
            content: '工具「file_manager」需要确认',
          },
        },
        {
          type: 'waiting_confirm',
          resumeToken: 'tok-e2e-1',
          toolCallId: 'tc1',
          toolName: 'file_manager',
          parameters: { action: 'write' },
          confirmReason: 'dangerous_tool',
        },
        { type: 'complete', status: 'waiting_confirm' },
      ];
      const sse = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
      await route.fulfill({
        status: 200,
        headers: {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
        },
        body: sse,
      });
    });

    await page.goto('/chat?c=conv-hitl', { waitUntil: 'domcontentloaded' });
    await page.getByTestId('app-shell').waitFor({ state: 'visible' });
    await expect(page.getByText('你好，我在。')).toBeVisible({ timeout: 20_000 });
    await sendComposer(page, '请帮我写入一个本地文件');

    await expect(page.getByTestId('tool-confirm-dialog')).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByTestId('tool-confirm-dialog')).toHaveCount(1);
    await expect(page.getByTestId('hitl-allow-once')).toBeVisible();
    await expect(page.getByTestId('hitl-deny')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('tool-confirm-dialog')).toHaveCount(0, {
      timeout: 10_000,
    });
    await shot(page, 'hitl-single-surface');
  });
});
