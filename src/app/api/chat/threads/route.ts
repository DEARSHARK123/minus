import { NextRequest, NextResponse } from 'next/server';
import {
  ChatThreadsRepository,
  chatThreadsRepository,
  ChatThreadsError,
  type ChatThread,
} from '@/lib/chat/threads';

export const runtime = 'nodejs';

function getRepo(): ChatThreadsRepository {
  if (process.env.CHAT_THREADS_PATH) {
    return new ChatThreadsRepository({ dataPath: process.env.CHAT_THREADS_PATH });
  }
  return chatThreadsRepository;
}

function ok<T>(data: T, status = 200): NextResponse {
  return NextResponse.json({ success: true, data }, { status });
}

function fail(error: string, status = 400, details?: unknown): NextResponse {
  return NextResponse.json(
    { success: false, error, ...(details !== undefined ? { details } : {}) },
    { status },
  );
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  const repo = getRepo();

  try {
    if (id) {
      const thread = await repo.get(id);
      if (!thread) {
        return fail(`Thread not found: ${id}`, 404);
      }
      return ok(thread);
    }
    const threads = await repo.list();
    return ok(threads);
  } catch (err) {
    if (err instanceof ChatThreadsError) {
      const status = err.code === 'NOT_FOUND' ? 404 : 400;
      return fail(err.message, status, { code: err.code });
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    return fail(message, 500);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: { thread?: ChatThread };
  try {
    body = await request.json();
  } catch {
    return fail('Invalid JSON body', 400);
  }

  const { thread } = body;
  if (!thread || typeof thread !== 'object') {
    return fail('Request must include { thread }', 400);
  }

  const repo = getRepo();
  try {
    const saved = await repo.saveThread(thread as ChatThread);
    return ok(saved);
  } catch (err) {
    if (err instanceof ChatThreadsError) {
      const status = err.code === 'NOT_FOUND' ? 404 : 400;
      return fail(err.message, status, { code: err.code });
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    return fail(message, 500);
  }
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) {
    return fail('Query parameter id is required', 400);
  }

  const repo = getRepo();
  try {
    const result = await repo.delete(id);
    return ok(result);
  } catch (err) {
    if (err instanceof ChatThreadsError) {
      const status = err.code === 'NOT_FOUND' ? 404 : 400;
      return fail(err.message, status, { code: err.code });
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    return fail(message, 500);
  }
}
