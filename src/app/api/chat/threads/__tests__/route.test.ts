import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

function get(url: string): NextRequest {
  return new NextRequest(url, { method: 'GET' });
}

function post(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/chat/threads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function del(id: string): NextRequest {
  return new NextRequest(`http://localhost/api/chat/threads?id=${id}`, {
    method: 'DELETE',
  });
}

describe('/api/chat/threads', () => {
  let dataPath: string;
  let dataDir: string;
  let handlers: {
    GET: (req: NextRequest) => Promise<Response>;
    POST: (req: NextRequest) => Promise<Response>;
    DELETE: (req: NextRequest) => Promise<Response>;
  };

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'minus-chat-threads-'));
    dataPath = path.join(dataDir, 'chat-threads.json');
    process.env.CHAT_THREADS_PATH = dataPath;

    vi.resetModules();
    const mod = await import('../route');
    handlers = { GET: mod.GET, POST: mod.POST, DELETE: mod.DELETE };
  });

  afterEach(async () => {
    delete process.env.CHAT_THREADS_PATH;
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it('lists, saves, gets, and deletes threads', async () => {
    const listEmpty = await (await handlers.GET(get('http://localhost/api/chat/threads'))).json();
    expect(listEmpty.success).toBe(true);
    expect(listEmpty.data).toEqual([]);

    const saved = await (
      await handlers.POST(
        post({
          thread: {
            id: 't1',
            title: 'First chat',
            messages: [{ role: 'user', content: 'hello' }],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        }),
      )
    ).json();
    expect(saved.success).toBe(true);
    expect(saved.data.id).toBe('t1');

    const list = await (await handlers.GET(get('http://localhost/api/chat/threads'))).json();
    expect(list.success).toBe(true);
    expect(list.data).toHaveLength(1);
    expect(list.data[0].title).toBe('First chat');

    const got = await (
      await handlers.GET(get('http://localhost/api/chat/threads?id=t1'))
    ).json();
    expect(got.success).toBe(true);
    expect(got.data.id).toBe('t1');

    const deleted = await (await handlers.DELETE(del('t1'))).json();
    expect(deleted.success).toBe(true);
    expect(deleted.data.deleted).toBe(true);

    const listAfter = await (
      await handlers.GET(get('http://localhost/api/chat/threads'))
    ).json();
    expect(listAfter.data).toHaveLength(0);
  });

  it('returns 404 for missing thread', async () => {
    const res = await handlers.GET(get('http://localhost/api/chat/threads?id=missing'));
    expect(res.status).toBe(404);
  });

  it('rejects invalid thread payload', async () => {
    const res = await handlers.POST(post({ thread: { id: 'bad', messages: 'not-array' } }));
    expect(res.status).toBe(400);
  });
});
