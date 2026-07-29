import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  createdAt?: string;
}

export interface ChatThread {
  id: string;
  title?: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface ChatThreadsData {
  threads: ChatThread[];
}

export class ChatThreadsError extends Error {
  readonly code: string;
  constructor(message: string, code = 'CHAT_THREADS_ERROR') {
    super(message);
    this.name = 'ChatThreadsError';
    this.code = code;
  }
}

export interface ChatThreadsOptions {
  /** Absolute path to chat-threads.json. Defaults to ~/.minus/data/chat-threads.json */
  dataPath?: string;
}

function defaultDataPath(): string {
  if (process.env.CHAT_THREADS_PATH) {
    return process.env.CHAT_THREADS_PATH;
  }
  return path.join(os.homedir(), '.minus', 'data', 'chat-threads.json');
}

function nowIso(): string {
  return new Date().toISOString();
}

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function assertThread(value: unknown): asserts value is ChatThread {
  if (!value || typeof value !== 'object') {
    throw new ChatThreadsError('Thread must be an object', 'INVALID_THREAD');
  }
  const t = value as Record<string, unknown>;
  if (typeof t.id !== 'string' || !t.id) {
    throw new ChatThreadsError('Thread id is required', 'INVALID_THREAD');
  }
  if (!Array.isArray(t.messages)) {
    throw new ChatThreadsError('Thread messages must be an array', 'INVALID_THREAD');
  }
  for (const m of t.messages) {
    assertMessage(m);
  }
  if (typeof t.createdAt !== 'string') {
    throw new ChatThreadsError('Thread createdAt is required', 'INVALID_THREAD');
  }
  if (typeof t.updatedAt !== 'string') {
    throw new ChatThreadsError('Thread updatedAt is required', 'INVALID_THREAD');
  }
}

function assertMessage(value: unknown): asserts value is ChatMessage {
  if (!value || typeof value !== 'object') {
    throw new ChatThreadsError('Message must be an object', 'INVALID_MESSAGE');
  }
  const m = value as Record<string, unknown>;
  if (!['system', 'user', 'assistant', 'tool'].includes(m.role as string)) {
    throw new ChatThreadsError(
      `Invalid message role: ${String(m.role)}`,
      'INVALID_MESSAGE',
    );
  }
  if (typeof m.content !== 'string') {
    throw new ChatThreadsError('Message content must be a string', 'INVALID_MESSAGE');
  }
}

function emptyData(): ChatThreadsData {
  return { threads: [] };
}

/**
 * Serialize all read/write mutations in-process so concurrent callers never
 * interleave partial writes of the same JSON file.
 */
let writeChain: Promise<unknown> = Promise.resolve();

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(fn, fn);
  writeChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export class ChatThreadsRepository {
  readonly dataPath: string;

  constructor(options: ChatThreadsOptions = {}) {
    this.dataPath = options.dataPath ?? defaultDataPath();
  }

  get dataDir(): string {
    return path.dirname(this.dataPath);
  }

  private async ensureDir(): Promise<void> {
    await fs.mkdir(this.dataDir, { recursive: true });
  }

  async load(): Promise<ChatThreadsData> {
    return enqueue(() => this._loadUnlocked());
  }

  private async _loadUnlocked(): Promise<ChatThreadsData> {
    await this.ensureDir();
    let raw: string;
    try {
      raw = await fs.readFile(this.dataPath, 'utf-8');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        return emptyData();
      }
      throw new ChatThreadsError(
        `Failed to read chat threads: ${(err as Error).message}`,
        'READ_FAILED',
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new ChatThreadsError(
        `Chat threads JSON is corrupted: ${(err as Error).message}`,
        'CORRUPT_JSON',
      );
    }

    if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as ChatThreadsData).threads)) {
      throw new ChatThreadsError(
        'Chat threads file must be an object with a threads array',
        'SCHEMA_INVALID',
      );
    }

    for (const thread of (parsed as ChatThreadsData).threads) {
      assertThread(thread);
    }

    return parsed as ChatThreadsData;
  }

  async save(data: ChatThreadsData): Promise<void> {
    return enqueue(async () => {
      await this._loadUnlocked();
      await this._saveUnlocked(data);
    });
  }

  private async _saveUnlocked(data: ChatThreadsData): Promise<void> {
    for (const thread of data.threads) {
      assertThread(thread);
    }
    await this.ensureDir();
    const payload = `${JSON.stringify(data, null, 2)}\n`;
    try {
      await fs.writeFile(this.dataPath, payload, 'utf-8');
    } catch (err) {
      throw new ChatThreadsError(
        `Failed to write chat threads: ${(err as Error).message}`,
        'WRITE_FAILED',
      );
    }
  }

  async update(
    mutator: (data: ChatThreadsData) => ChatThreadsData | Promise<ChatThreadsData>,
  ): Promise<ChatThreadsData> {
    return enqueue(async () => {
      const current = await this._loadUnlocked();
      const next = await mutator(current);
      await this._saveUnlocked(next);
      return next;
    });
  }

  async list(): Promise<ChatThread[]> {
    const data = await this.load();
    return data.threads.sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  }

  async get(id: string): Promise<ChatThread | null> {
    const data = await this.load();
    return data.threads.find((t) => t.id === id) ?? null;
  }

  async create(input?: {
    id?: string;
    title?: string;
    messages?: ChatMessage[];
  }): Promise<ChatThread> {
    const ts = nowIso();
    const thread: ChatThread = {
      id: input?.id ?? newId(),
      title: input?.title,
      messages: input?.messages ?? [],
      createdAt: ts,
      updatedAt: ts,
    };
    assertThread(thread);

    await this.update((data) => {
      if (data.threads.some((t) => t.id === thread.id)) {
        throw new ChatThreadsError(
          `Thread already exists: ${thread.id}`,
          'DUPLICATE_ID',
        );
      }
      return { ...data, threads: [...data.threads, thread] };
    });

    return thread;
  }

  async saveThread(thread: ChatThread): Promise<ChatThread> {
    assertThread(thread);
    const toSave: ChatThread = { ...thread, updatedAt: nowIso() };

    await this.update((data) => {
      const exists = data.threads.some((t) => t.id === toSave.id);
      const threads = exists
        ? data.threads.map((t) => (t.id === toSave.id ? toSave : t))
        : [...data.threads, toSave];
      return { ...data, threads };
    });

    return toSave;
  }

  async delete(id: string): Promise<{ deleted: true; id: string }> {
    await this.update((data) => {
      if (!data.threads.some((t) => t.id === id)) {
        throw new ChatThreadsError(`Thread not found: ${id}`, 'NOT_FOUND');
      }
      return { ...data, threads: data.threads.filter((t) => t.id !== id) };
    });
    return { deleted: true, id };
  }
}

/** Default singleton bound to ~/.minus/data/chat-threads.json */
export const chatThreadsRepository = new ChatThreadsRepository();
