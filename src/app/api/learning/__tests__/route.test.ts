import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { NextRequest } from 'next/server';

vi.mock('@/lib/llm/client', () => ({
  callLLM: vi.fn(async (messages: Array<{ role: string; content: string }>) => {
    const system = messages[0]?.content || '';
    const user = messages[1]?.content || '';
    if (system.includes('日历学习伴侣')) {
      return {
        content: JSON.stringify({
          reply: '已按工作日晚间、每天 60 分钟生成新的安排草案。',
          action: 'replan',
          constraints: {
            availableDays: [1, 2, 3, 4, 5],
            dailyBudgetMinutes: 60,
            dayStartHour: 19,
            dayEndHour: 22,
          },
          suggestions: ['再均匀一点'],
        }),
      };
    }
    if (system.includes('rigorous teaching assessor')) {
      return { content: 'RESULT: pass\nNOTES: 回答覆盖了核心概念，可以继续下一节。' };
    }
    if (user.includes('关系模型')) {
      return { content: '关系模型把数据组织成表，主键唯一标识记录，外键表达表之间的引用关系。约束用于防止无效数据，规范化则减少重复和更新异常。以用户表和订单表为例，订单中的用户编号作为外键指向用户主键。' };
    }
    return { content: '梯度下降通过沿损失函数梯度的反方向更新参数来逐步降低误差。学习率决定步长，过大会造成震荡，过小会收敛缓慢。可以把它理解为根据当前位置的坡度反复下山，并在每一步检查是否接近低点。' };
  }),
}));

import { callLLM } from '@/lib/llm/client';

async function tempDataPath(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'minus-learning-api-'));
  return path.join(dir, 'learning-data.json');
}

function post(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/learning', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function createCalendarAssistantCourse(
  POST: (req: NextRequest) => Promise<Response>,
): Promise<string> {
  const response = await POST(
    post({ action: 'createCourse', payload: { title: 'Calendar failure test' } }),
  );
  const result = await response.json();
  return result.data.id as string;
}

function calendarAssistantRequest(courseId: string): NextRequest {
  return post({
    action: 'calendarAssistant',
    payload: {
      courseId,
      providerId: 'openai',
      messages: [{ role: 'user', content: '把当前草案安排得更均匀' }],
    },
  });
}

describe('POST /api/learning', () => {
  let dataPath: string;
  let dataDir: string;
  let POST: (req: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    vi.mocked(callLLM).mockClear();
    dataPath = await tempDataPath();
    dataDir = path.dirname(dataPath);
    process.env.LEARNING_DATA_PATH = dataPath;
    // A fake key activates the mocked provider path without contacting the network.
    process.env.OPENAI_API_KEY = 'test-key';
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.GEMINI_API_KEY;
    // Fresh module so runtime picks up current env values.
    vi.resetModules();
    const mod = await import('../route');
    POST = mod.POST;
  });

  afterEach(async () => {
    vi.useRealTimers();
    delete process.env.LEARNING_DATA_PATH;
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it('returns 400 for unknown action', async () => {
    const res = await POST(post({ action: 'nope', payload: {} }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toMatch(/Unknown action/i);
  });

  it('returns 400 for an invalid planning date', async () => {
    const res = await POST(post({
      action: 'plan',
      payload: { courseId: 'course-1', now: 'not-a-date' },
    }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/valid date/i);
  });

  it('supports createCourse → getAll → deleteCourse cascade', async () => {
    const created = await (await POST(post({ action: 'createCourse', payload: { title: 'ML' } }))).json();
    expect(created.success).toBe(true);
    const courseId = created.data.id as string;

    await POST(
      post({
        action: 'upsertGoal',
        payload: { courseId, title: 'Finish week 1' },
      }),
    );
    await POST(
      post({
        action: 'importDocument',
        payload: {
          courseId,
          title: 'Ch1',
          format: 'markdown',
          content: 'Intro to gradient descent.',
        },
      }),
    );

    const all = await (await POST(post({ action: 'getAll' }))).json();
    expect(all.success).toBe(true);
    expect(all.data.courses).toHaveLength(1);
    expect(all.data.goals).toHaveLength(1);
    expect(all.data.documents).toHaveLength(1);

    // Batch-06: cascade delete requires secondary confirm flag (shared schema).
    const denied = await (
      await POST(post({ action: 'deleteCourse', payload: { courseId } }))
    ).json();
    expect(denied.success).toBe(false);
    expect(String(denied.error)).toMatch(/confirmCascade/i);

    const del = await (
      await POST(
        post({
          action: 'deleteCourse',
          payload: { courseId, confirmCascade: true },
        }),
      )
    ).json();
    expect(del.success).toBe(true);
    const after = await (await POST(post({ action: 'getAll' }))).json();
    expect(after.data.courses).toHaveLength(0);
    expect(after.data.goals).toHaveLength(0);
    expect(after.data.documents).toHaveLength(0);
  });

  it('supports renameCourse / renameDocument via shared entity action schema', async () => {
    const created = await (
      await POST(post({ action: 'createCourse', payload: { title: 'ML' } }))
    ).json();
    const courseId = created.data.id as string;

    const renamed = await (
      await POST(
        post({
          action: 'renameCourse',
          payload: { courseId, title: '机器学习' },
        }),
      )
    ).json();
    expect(renamed.success).toBe(true);
    expect(renamed.data.title).toBe('机器学习');

    await POST(
      post({
        action: 'importDocument',
        payload: {
          courseId,
          title: 'Ch1',
          format: 'markdown',
          content: 'gradient descent notes',
        },
      }),
    );
    const all = await (await POST(post({ action: 'getAll' }))).json();
    const documentId = all.data.documents[0].id as string;

    const docRenamed = await (
      await POST(
        post({
          action: 'renameDocument',
          payload: { documentId, title: '第一章' },
        }),
      )
    ).json();
    expect(docRenamed.success).toBe(true);
    expect(docRenamed.data.title).toBe('第一章');

    const docDel = await (
      await POST(post({ action: 'deleteDocument', payload: { documentId } }))
    ).json();
    expect(docDel.success).toBe(true);
  });

  it('importTimetable surfaces CSV errors with line details', async () => {
    const course = await (await POST(post({ action: 'createCourse', payload: { title: 'C' } }))).json();
    const courseId = course.data.id as string;
    const csv = '星期,开始,结束,课程,地点\n一,08:00,08:00,Bad,R1';
    const res = await (
      await POST(post({ action: 'importTimetable', payload: { courseId, csv } }))
    ).json();
    expect(res.success).toBe(false);
    expect(res.details).toBeTruthy();
  });

  it('search is course-isolated', async () => {
    const a = await (await POST(post({ action: 'createCourse', payload: { title: 'A' } }))).json();
    const b = await (await POST(post({ action: 'createCourse', payload: { title: 'B' } }))).json();
    await POST(
      post({
        action: 'importDocument',
        payload: {
          courseId: a.data.id,
          title: 'A doc',
          format: 'txt',
          content: 'unique-token-alpha appears here',
        },
      }),
    );
    await POST(
      post({
        action: 'importDocument',
        payload: {
          courseId: b.data.id,
          title: 'B doc',
          format: 'txt',
          content: 'unique-token-alpha should not show for A',
        },
      }),
    );

    const hits = await (
      await POST(
        post({
          action: 'search',
          payload: { courseId: a.data.id, query: 'unique-token-alpha' },
        }),
      )
    ).json();
    expect(hits.success).toBe(true);
    expect(hits.data.every((h: { title: string }) => h.title === 'A doc')).toBe(true);
  });

  it('plan returns warnings when locked tasks and no free slots interact correctly', async () => {
    const course = await (await POST(post({ action: 'createCourse', payload: { title: 'Plan' } }))).json();
    const courseId = course.data.id as string;

    // Full-day timetable blocks all weekdays
    const rows = ['星期,开始,结束,课程,地点'];
    for (const d of ['一', '二', '三', '四', '五', '六', '日']) {
      rows.push(`${d},08:00,22:00,Block,R`);
    }
    await POST(
      post({
        action: 'importTimetable',
        payload: { courseId, csv: rows.join('\n') },
      }),
    );

    await POST(
      post({
        action: 'upsertTask',
        payload: {
          courseId,
          title: 'Locked',
          estimatedMinutes: 30,
          locked: true,
          scheduledStart: '2026-07-13T09:00:00.000Z',
          scheduledEnd: '2026-07-13T09:30:00.000Z',
        },
      }),
    );
    await POST(
      post({
        action: 'upsertTask',
        payload: { courseId, title: 'Open', estimatedMinutes: 45, status: 'confirmed' },
      }),
    );

    const plan = await (await POST(post({ action: 'plan', payload: { courseId } }))).json();
    expect(plan.success).toBe(true);
    expect(plan.data.warnings.length).toBeGreaterThan(0);
    const locked = plan.data.tasks.find((t: { title: string }) => t.title === 'Locked');
    expect(locked.locked).toBe(true);
    expect(locked.scheduledStart).toBe('2026-07-13T09:00:00.000Z');
  });

  it('proposes with validated constraints and rejects stale confirmation', async () => {
    const course = await (
      await POST(post({ action: 'createCourse', payload: { title: 'Plan safely' } }))
    ).json();
    const courseId = course.data.id as string;
    const task = await (
      await POST(post({
        action: 'upsertTask',
        payload: {
          courseId,
          title: 'Review constraints',
          estimatedMinutes: 30,
          status: 'confirmed',
        },
      }))
    ).json();

    const invalid = await POST(post({
      action: 'proposePlan',
      payload: { courseId, constraints: { availableDays: [0, 8] } },
    }));
    expect(invalid.status).toBe(400);

    const proposed = await (
      await POST(post({
        action: 'proposePlan',
        payload: {
          courseId,
          now: '2026-07-15T08:00:00',
          constraints: {
            availableDays: [4],
            dailyBudgetMinutes: 60,
            dayStartHour: 19,
            dayEndHour: 22,
          },
        },
      }))
    ).json();
    expect(proposed.success).toBe(true);
    expect(proposed.data.baseRevision).toMatch(/^v1_/);
    expect(proposed.data.constraints.availableDays).toEqual([4]);

    await POST(post({
      action: 'upsertTask',
      payload: {
        ...task.data,
        title: 'Review constraints updated',
        estimatedMinutes: 45,
      },
    }));
    const stale = await POST(post({
      action: 'confirmPlan',
      payload: { proposal: proposed.data },
    }));
    expect(stale.status).toBe(409);
    expect((await stale.json()).details.code).toBe('PLAN_STALE');

    const fresh = await (
      await POST(post({
        action: 'proposePlan',
        payload: { courseId, now: '2026-07-15T08:00:00' },
      }))
    ).json();
    const firstConfirm = await (
      await POST(post({
        action: 'confirmPlan',
        payload: { proposal: fresh.data },
      }))
    ).json();
    const replayConfirm = await (
      await POST(post({
        action: 'confirmPlan',
        payload: { proposal: fresh.data },
      }))
    ).json();
    expect(firstConfirm.success).toBe(true);
    expect(firstConfirm.data.replayed).toBe(false);
    expect(replayConfirm.success).toBe(true);
    expect(replayConfirm.data.replayed).toBe(true);
  });

  it('calendarAssistant creates an uncommitted draft from a conversation', async () => {
    const course = await (
      await POST(post({ action: 'createCourse', payload: { title: 'Calendar chat' } }))
    ).json();
    const courseId = course.data.id as string;
    await POST(post({
      action: 'upsertTask',
      payload: {
        id: 'calendar-task-1',
        courseId,
        title: '复习闭包',
        estimatedMinutes: 30,
        status: 'confirmed',
      },
    }));

    const response = await POST(post({
      action: 'calendarAssistant',
      payload: {
        courseId,
        providerId: 'openai',
        messages: [{ role: 'user', content: '工作日晚上学习，每天不超过一小时' }],
      },
    }));
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(result.success).toBe(true);
    expect(result.data.action).toBe('replan');
    expect(result.data.proposal.applied).toBe(false);
    expect(result.data.proposal.constraints).toMatchObject({
      availableDays: [1, 2, 3, 4, 5],
      dailyBudgetMinutes: 60,
      dayStartHour: 19,
      dayEndHour: 22,
    });

    const stored = await (await POST(post({ action: 'getAll' }))).json();
    const storedTask = stored.data.tasks.find((item: { id: string }) => item.id === 'calendar-task-1');
    expect(storedTask.status).toBe('confirmed');
    expect(storedTask.scheduledStart).toBeUndefined();
  });

  it.each([
    {
      name: 'network failure',
      error: 'LLM调用失败: fetch failed',
      status: 503,
      code: 'MODEL_NETWORK_ERROR',
      copy: '暂时无法连接模型服务',
    },
    {
      name: 'authentication failure',
      error: 'LLM调用失败: LLM API error (401): upstream-secret-body',
      status: 503,
      code: 'MODEL_AUTH_ERROR',
      copy: '模型认证失败',
    },
    {
      name: 'rate limit',
      error: 'LLM调用失败: LLM API error (429): upstream-secret-body',
      status: 429,
      code: 'MODEL_RATE_LIMIT',
      copy: '模型请求过多或额度暂不可用',
    },
    {
      name: 'upstream outage',
      error: 'LLM调用失败: LLM API error (503): upstream-secret-body',
      status: 503,
      code: 'MODEL_UNAVAILABLE',
      copy: '模型服务暂时不可用',
    },
  ])('calendarAssistant classifies $name without leaking provider errors', async (expected) => {
    const courseId = await createCalendarAssistantCourse(POST);
    vi.mocked(callLLM).mockRejectedValueOnce(new Error(expected.error));

    const response = await POST(calendarAssistantRequest(courseId));
    const result = await response.json();

    expect(response.status).toBe(expected.status);
    expect(result.success).toBe(false);
    expect(result.details.code).toBe(expected.code);
    expect(result.error).toContain(expected.copy);
    expect(result.error).not.toMatch(/fetch failed|upstream-secret-body|JSON|LLM调用失败/i);
    expect(callLLM).toHaveBeenCalledTimes(1);
  });

  it('calendarAssistant returns MODEL_INVALID_RESPONSE after one format retry', async () => {
    const courseId = await createCalendarAssistantCourse(POST);
    vi.mocked(callLLM)
      .mockResolvedValueOnce({ content: 'not-json' })
      .mockResolvedValueOnce({ content: JSON.stringify({ wrong: true }) });

    const response = await POST(calendarAssistantRequest(courseId));
    const result = await response.json();

    expect(response.status).toBe(502);
    expect(result.details.code).toBe('MODEL_INVALID_RESPONSE');
    expect(result.error).toBe('模型返回格式不符合要求，请重试或切换模型。');
    expect(result.error).not.toMatch(/JSON|parse|validation/i);
    expect(callLLM).toHaveBeenCalledTimes(2);
  });

  it('calendarAssistant returns MODEL_TIMEOUT without exposing AbortError', async () => {
    vi.useFakeTimers();
    const courseId = await createCalendarAssistantCourse(POST);
    let started!: () => void;
    const requestStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    vi.mocked(callLLM).mockImplementationOnce((_messages, _tools, _config, signal) => {
      started();
      return new Promise((_resolve, reject) => {
        signal?.addEventListener(
          'abort',
          () => reject(new DOMException('aborted', 'AbortError')),
          { once: true },
        );
      });
    });

    const responsePromise = POST(calendarAssistantRequest(courseId));
    await requestStarted;
    await vi.advanceTimersByTimeAsync(60_000);
    const response = await responsePromise;
    const result = await response.json();

    expect(response.status).toBe(504);
    expect(result.details.code).toBe('MODEL_TIMEOUT');
    expect(result.error).toBe('学习伴侣响应超时，请重试或切换模型。');
    expect(result.error).not.toMatch(/AbortError|aborted/i);
  });

  it('createSession and completeTask work', async () => {
    const course = await (await POST(post({ action: 'createCourse', payload: { title: 'S' } }))).json();
    const courseId = course.data.id as string;
    const task = await (
      await POST(
        post({
          action: 'upsertTask',
          payload: { courseId, title: 'T', estimatedMinutes: 20 },
        }),
      )
    ).json();
    const session = await (
      await POST(
        post({
          action: 'createSession',
          payload: { courseId, taskId: task.data.id, notes: 'focus' },
        }),
      )
    ).json();
    expect(session.success).toBe(true);
    const ended = await (
      await POST(post({ action: 'endSession', payload: { sessionId: session.data.id } }))
    ).json();
    expect(ended.success).toBe(true);
    expect(ended.data.endedAt).toBeTruthy();
    const done = await (
      await POST(post({ action: 'completeTask', payload: { taskId: task.data.id } }))
    ).json();
    expect(done.data.status).toBe('done');
  });

  it('proposeTask, confirmTask, and rejectSuggestion manage suggestion lifecycle', async () => {
    const course = await (await POST(post({ action: 'createCourse', payload: { title: 'S' } }))).json();
    const courseId = course.data.id as string;

    const proposed = await (
      await POST(
        post({
          action: 'proposeTask',
          payload: { courseId, title: 'Suggested', estimatedMinutes: 20 },
        }),
      )
    ).json();
    expect(proposed.success).toBe(true);
    expect(proposed.data.status).toBe('pending_suggestion');

    const confirmed = await (
      await POST(
        post({
          action: 'confirmTask',
          payload: { taskId: proposed.data.id },
        }),
      )
    ).json();
    expect(confirmed.success).toBe(true);
    expect(confirmed.data.status).toBe('confirmed');

    const proposed2 = await (
      await POST(
        post({
          action: 'proposeTask',
          payload: { courseId, title: 'Bad idea', estimatedMinutes: 10 },
        }),
      )
    ).json();
    const rejected = await (
      await POST(
        post({
          action: 'rejectSuggestion',
          payload: { taskId: proposed2.data.id },
        }),
      )
    ).json();
    expect(rejected.success).toBe(true);
    expect(rejected.data.deleted).toBe(true);
  });

  it('createSession builds sections from course units and hydrates currentSectionId', async () => {
    const course = await (await POST(post({ action: 'createCourse', payload: { title: 'S' } }))).json();
    const courseId = course.data.id as string;
    await POST(
      post({
        action: 'upsertUnit',
        payload: { courseId, title: 'U1', order: 0 },
      }),
    );
    await POST(
      post({
        action: 'upsertUnit',
        payload: { courseId, title: 'U2', order: 1 },
      }),
    );

    const session = await (
      await POST(post({ action: 'createSession', payload: { courseId } }))
    ).json();
    expect(session.success).toBe(true);
    expect(session.data.sections).toHaveLength(2);
    expect(session.data.sections[0]!.status).toBe('open');
    expect(session.data.sections[1]!.status).toBe('locked');
    expect(session.data.currentSectionId).toBe(session.data.sections[0]!.id);
  });

  it('sessionOpenSection keeps guided order strict but supports explicit flexible access', async () => {
    const course = await (
      await POST(post({ action: 'createCourse', payload: { title: 'Flexible course' } }))
    ).json();
    const courseId = course.data.id as string;
    await POST(post({ action: 'upsertUnit', payload: { courseId, title: 'First', order: 0 } }));
    await POST(post({ action: 'upsertUnit', payload: { courseId, title: 'Second', order: 1 } }));
    const session = await (
      await POST(post({ action: 'createSession', payload: { courseId } }))
    ).json();
    const firstId = session.data.sections[0]!.id as string;
    const secondId = session.data.sections[1]!.id as string;

    const guided = await POST(post({
      action: 'sessionOpenSection',
      payload: { sessionId: session.data.id, sectionId: secondId, mode: 'guided' },
    }));
    expect(guided.status).toBe(400);

    const flexible = await (
      await POST(post({
        action: 'sessionOpenSection',
        payload: { sessionId: session.data.id, sectionId: secondId, mode: 'flexible' },
      }))
    ).json();
    expect(flexible.success).toBe(true);
    expect(flexible.data.currentSectionId).toBe(secondId);
    expect(flexible.data.sections.find((item: { id: string }) => item.id === firstId).status).toBe('open');
    expect(flexible.data.sections.find((item: { id: string }) => item.id === secondId).status).toBe('open');
  });

  it('sessionTeach persists a substantive model lesson and source status', async () => {
    const course = await (await POST(post({ action: 'createCourse', payload: { title: 'S' } }))).json();
    const courseId = course.data.id as string;
    await POST(
      post({
        action: 'importDocument',
        payload: {
          courseId,
          title: 'Ch1',
          format: 'markdown',
          content: 'Definition: gradient descent is an optimization algorithm.',
        },
      }),
    );
    await POST(
      post({
        action: 'upsertUnit',
        payload: { courseId, title: 'U1', order: 0 },
      }),
    );
    const session = await (
      await POST(post({ action: 'createSession', payload: { courseId } }))
    ).json();
    const sessionId = session.data.id as string;
    const sectionId = session.data.sections[0]!.id as string;

    const hits = await (
      await POST(post({ action: 'search', payload: { courseId, query: 'gradient descent' } }))
    ).json();

    const taught = await (
      await POST(
        post({
          action: 'sessionTeach',
          payload: { sessionId, courseId, sectionId, hits: hits.data },
        }),
      )
    ).json();
    expect(taught.success).toBe(true);
    expect(taught.data.sections[0]!.turns.length).toBeGreaterThan(0);
    expect(taught.data.sections[0]!.turns[0]!.contentOrigin).toBe('model');
    expect(taught.data.sections[0]!.turns[0]!.qualityStatus).toBe('substantive');
  });

  it('sessionTeach can start from the outline without local documents', async () => {
    const course = await (
      await POST(
        post({ action: 'createCourse', payload: { title: '数据库基础' } }),
      )
    ).json();
    const courseId = course.data.id as string;
    await POST(
      post({
        action: 'upsertUnit',
        payload: {
          courseId,
          title: '关系模型',
          description: '理解表、主键、外键和关系约束',
          knowledgePoints: ['主键', '外键', '规范化'],
          order: 0,
        },
      }),
    );
    const session = await (
      await POST(post({ action: 'createSession', payload: { courseId } }))
    ).json();

    const taught = await (
      await POST(
        post({
          action: 'sessionTeach',
          payload: {
            sessionId: session.data.id,
            courseId,
            sectionId: session.data.sections[0]!.id,
            providerId: 'openai',
          },
        }),
      )
    ).json();

    expect(taught.success).toBe(true);
    const content = String(taught.data.sections[0]!.turns[0]!.content);
    expect(content).toContain('关系模型');
    expect(content).toContain('主键');
    expect(content).not.toContain('Read the course materials');
  });

  it('sessionStartRecall advances section phase to active_recall after teach', async () => {
    const course = await (await POST(post({ action: 'createCourse', payload: { title: 'S' } }))).json();
    const courseId = course.data.id as string;
    await POST(
      post({
        action: 'importDocument',
        payload: {
          courseId,
          title: 'Ch1',
          format: 'markdown',
          content: 'Definition: gradient descent is an optimization algorithm.',
        },
      }),
    );
    await POST(post({ action: 'upsertUnit', payload: { courseId, title: 'U1', description: 'gradient descent is an optimization algorithm', order: 0 } }));

    const session = await (
      await POST(post({ action: 'createSession', payload: { courseId } }))
    ).json();
    const sessionId = session.data.id as string;
    const sectionId = session.data.sections[0]!.id as string;

    const hits = await (
      await POST(post({ action: 'search', payload: { courseId, query: 'gradient descent' } }))
    ).json();

    await POST(
      post({
        action: 'sessionTeach',
        payload: { sessionId, courseId, sectionId, hits: hits.data },
      }),
    );

    const recall = await (
      await POST(post({ action: 'sessionStartRecall', payload: { sessionId, sectionId } }))
    ).json();

    expect(recall.success).toBe(true);
    expect(recall.data.sections[0]!.phase).toBe('active_recall');
    expect(recall.data.sections[0]!.turns.some((t: { role: string }) => t.role === 'assistant')).toBe(true);
  });

  it('sessionSubmitRecall and sessionAssess advance to next section on pass', async () => {
    const course = await (await POST(post({ action: 'createCourse', payload: { title: 'S' } }))).json();
    const courseId = course.data.id as string;
    await POST(
      post({
        action: 'importDocument',
        payload: {
          courseId,
          title: 'Ch1',
          format: 'markdown',
          content: 'Definition: gradient descent is an optimization algorithm.',
        },
      }),
    );
    await POST(post({ action: 'upsertUnit', payload: { courseId, title: 'U1', order: 0 } }));
    await POST(post({ action: 'upsertUnit', payload: { courseId, title: 'U2', order: 1 } }));

    const session = await (
      await POST(post({ action: 'createSession', payload: { courseId } }))
    ).json();
    const sessionId = session.data.id as string;
    const sectionId = session.data.sections[0]!.id as string;

    const hits = await (
      await POST(post({ action: 'search', payload: { courseId, query: 'gradient descent' } }))
    ).json();

    await POST(
      post({
        action: 'sessionTeach',
        payload: { sessionId, courseId, sectionId, hits: hits.data },
      }),
    );
    await POST(
      post({
        action: 'sessionStartRecall',
        payload: { sessionId, sectionId },
      }),
    );
    await POST(
      post({
        action: 'sessionSubmitRecall',
        payload: { sessionId, sectionId, answer: 'gradient descent is an optimization algorithm' },
      }),
    );
    const assessed = await (
      await POST(
        post({
          action: 'sessionAssess',
          payload: { sessionId, courseId, sectionId },
        }),
      )
    ).json();

    expect(assessed.success).toBe(true);
    expect(assessed.data.sections[0]!.status).toBe('done');
    expect(assessed.data.sections[1]!.status).toBe('open');
    expect(assessed.data.currentSectionId).toBe(assessed.data.sections[1]!.id);
  });

  it('diagnoseGaps, confirmDiagnosticGap, and dismissDiagnosticGap manage gap lifecycle', async () => {
    const course = await (await POST(post({ action: 'createCourse', payload: { title: 'G' } }))).json();
    const courseId = course.data.id as string;
    await POST(
      post({
        action: 'importDocument',
        payload: {
          courseId,
          title: 'Ch1',
          format: 'markdown',
          content: 'Short.',
        },
      }),
    );

    const diag = await (
      await POST(post({ action: 'diagnoseGaps', payload: { courseId } }))
    ).json();
    expect(diag.success).toBe(true);
    expect(diag.data.gaps.length).toBeGreaterThan(0);
    expect(diag.data.tasks.every((t: { status: string }) => t.status === 'pending_suggestion')).toBe(true);

    const gapId = diag.data.gaps[0].id as string;
    const confirmed = await (
      await POST(post({ action: 'confirmDiagnosticGap', payload: { gapId } }))
    ).json();
    expect(confirmed.success).toBe(true);
    expect(confirmed.data.gap.status).toBe('confirmed');
    expect(confirmed.data.task.status).toBe('confirmed');

    const diag2 = await (
      await POST(post({ action: 'diagnoseGaps', payload: { courseId } }))
    ).json();
    const gap2Id = diag2.data.gaps[0].id as string;
    const dismissed = await (
      await POST(post({ action: 'dismissDiagnosticGap', payload: { gapId: gap2Id } }))
    ).json();
    expect(dismissed.success).toBe(true);
    expect(dismissed.data.status).toBe('dismissed');
  });

  it('createArtifact requires valid citations', async () => {
    const course = await (await POST(post({ action: 'createCourse', payload: { title: 'A' } }))).json();
    const courseId = course.data.id as string;
    await POST(
      post({
        action: 'importDocument',
        payload: {
          courseId,
          title: 'Ch1',
          format: 'markdown',
          content: 'Definition: gradient descent.',
        },
      }),
    );
    const hits = await (
      await POST(post({ action: 'search', payload: { courseId, query: 'gradient descent' } }))
    ).json();

    const artifact = await (
      await POST(
        post({
          action: 'createArtifact',
          payload: {
            courseId,
            kind: 'summary',
            title: 'GD Summary',
            hits: hits.data,
          },
        }),
      )
    ).json();
    expect(artifact.success).toBe(true);
    expect(artifact.data.citations.length).toBeGreaterThan(0);

    const bad = await (
      await POST(
        post({
          action: 'createArtifact',
          payload: {
            courseId,
            kind: 'quiz',
            title: 'Bad',
            hits: [{ documentId: 'missing', chunkIndex: 99, snippet: 'x', title: 'x', score: 0 }],
          },
        }),
      )
    ).json();
    expect(bad.success).toBe(false);
  });

  it('recordFeedback and getLearnerProfile update profile', async () => {
    const course = await (await POST(post({ action: 'createCourse', payload: { title: 'F' } }))).json();
    const courseId = course.data.id as string;
    const session = await (
      await POST(post({ action: 'createSession', payload: { courseId } }))
    ).json();
    await POST(post({ action: 'endSession', payload: { sessionId: session.data.id } }));

    const fb = await (
      await POST(
        post({
          action: 'recordFeedback',
          payload: {
            courseId,
            sessionId: session.data.id,
            rating: 4,
            difficulty: 3,
            understood: true,
            notes: 'Good.',
          },
        }),
      )
    ).json();
    expect(fb.success).toBe(true);
    expect(fb.data.feedback.rating).toBe(4);

    const profile = await (
      await POST(post({ action: 'getLearnerProfile', payload: { courseId } }))
    ).json();
    expect(profile.success).toBe(true);
    expect(profile.data.totalSessions).toBe(1);
    expect(profile.data.avgRating).toBe(4);
  });

  it('proactiveTrigger creates pending suggestions', async () => {
    const course = await (await POST(post({ action: 'createCourse', payload: { title: 'C' } }))).json();
    const courseId = course.data.id as string;

    const result = await (
      await POST(
        post({
          action: 'proactiveTrigger',
          payload: { kind: 'add_goal', courseId, goalId: 'g1', goalTitle: 'Goal' },
        }),
      )
    ).json();

    expect(result.success).toBe(true);
    expect(result.data.suggestions).toHaveLength(1);

    const all = await (await POST(post({ action: 'getAll' }))).json();
    expect(all.data.tasks).toHaveLength(1);
    expect(all.data.tasks[0]!.status).toBe('pending_suggestion');
  });

  it('skipDay reschedules tasks off the skipped day', async () => {
    const course = await (await POST(post({ action: 'createCourse', payload: { title: 'C' } }))).json();
    const courseId = course.data.id as string;

    await POST(
      post({
        action: 'upsertTask',
        payload: {
          id: 't1',
          courseId,
          title: 'Task',
          estimatedMinutes: 60,
          status: 'confirmed',
          scheduledStart: '2026-07-13T09:00:00.000Z',
          scheduledEnd: '2026-07-13T10:00:00.000Z',
        },
      }),
    );

    const result = await (
      await POST(
        post({
          action: 'skipDay',
          payload: { courseId, skippedDate: '2026-07-13' },
        }),
      )
    ).json();

    expect(result.success).toBe(true);
    const task = result.data.tasks.find((t: { id: string }) => t.id === 't1');
    expect(task).toBeTruthy();
    expect(task.status).toBe('scheduled');
    const localDate = new Date(task.scheduledStart).toLocaleDateString('en-CA');
    expect(localDate).not.toBe('2026-07-13');
  });

  it('getObservabilityCounters returns counters', async () => {
    const result = await (await POST(post({ action: 'getObservabilityCounters' }))).json();
    expect(result.success).toBe(true);
    expect(typeof result.data.llmCalls).toBe('number');
    expect(typeof result.data.citationRejects).toBe('number');
    expect(typeof result.data.scheduleChanges).toBe('number');
  });

  it('getProviderStatus returns configured provider status', async () => {
    delete process.env.DEEPSEEK_API_KEY;
    process.env.OPENAI_API_KEY = 'test-api-key-placeholder';
    process.env.OPENAI_MODEL = 'gpt-4o';

    const result = await (
      await POST(post({ action: 'getProviderStatus', payload: { providerId: 'openai' } }))
    ).json();

    expect(result.success).toBe(true);
    expect(result.data.providerId).toBe('openai');
    expect(result.data.hasKey).toBe(true);
    expect(result.data.maskedKey).toContain('****');
    expect(result.data.model).toBe('gpt-4o');
    expect(result.data.configuredProviders).toContain('openai');
  });

  it('getProviderStatus reports unconfigured providers without error', async () => {
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.OPENAI_API_KEY;

    const result = await (
      await POST(post({ action: 'getProviderStatus', payload: { providerId: 'openai' } }))
    ).json();

    expect(result.success).toBe(true);
    expect(result.data.hasKey).toBe(false);
    expect(result.data.configuredProviders).not.toContain('openai');
  });

  it('persists a session reflection for later history review', async () => {
    const course = await (
      await POST(post({ action: 'createCourse', payload: { title: 'Reflection' } }))
    ).json();
    const courseId = course.data.id as string;
    const session = await (
      await POST(post({ action: 'createSession', payload: { courseId } }))
    ).json();
    const sessionId = session.data.id as string;
    const notes = '[Minus 学习总结]\n完成单元：1/1\n学习者心得：理解了核心概念';

    const saved = await (
      await POST(
        post({
          action: 'saveSessionReflection',
          payload: { sessionId, notes },
        }),
      )
    ).json();
    expect(saved.success).toBe(true);
    expect(saved.data.notes).toBe(notes);

    const restored = await (
      await POST(post({ action: 'getSession', payload: { sessionId } }))
    ).json();
    expect(restored.data.notes).toBe(notes);
  });

  it('sessionTeach rejects an explicit provider with a missing key and persists nothing', async () => {
    delete process.env.DEEPSEEK_API_KEY;
    const course = await (await POST(post({ action: 'createCourse', payload: { title: 'Provider' } }))).json();
    const courseId = course.data.id as string;
    await POST(
      post({
        action: 'importDocument',
        payload: {
          courseId,
          title: 'Ch1',
          format: 'markdown',
          content: 'Definition: gradient descent is an optimization algorithm.',
        },
      }),
    );
    await POST(post({ action: 'upsertUnit', payload: { courseId, title: 'U1', order: 0 } }));
    const session = await (await POST(post({ action: 'createSession', payload: { courseId } }))).json();
    const sessionId = session.data.id as string;
    const sectionId = session.data.sections[0]!.id as string;

    const hits = await (
      await POST(post({ action: 'search', payload: { courseId, query: 'gradient descent' } }))
    ).json();

    const taught = await (
      await POST(
        post({
          action: 'sessionTeach',
            payload: { sessionId, courseId, sectionId, hits: hits.data, providerId: 'definitely-missing-provider' },
        }),
      )
    ).json();

    expect(taught.success).toBe(false);
    expect(taught.details.code).toBe('MODEL_UNAVAILABLE');
    const restored = await (await POST(post({ action: 'getSession', payload: { sessionId } }))).json();
    expect(restored.data.sections[0]!.turns).toHaveLength(0);
  });
});
