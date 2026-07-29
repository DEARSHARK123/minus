export interface BlackboardEntry {
  key: string;
  value: unknown;
  source: string;
  timestamp: number;
  ttl?: number;
}

export class Blackboard {
  private entries: Map<string, BlackboardEntry> = new Map();
  private maxEntries = 100;

  set(key: string, value: unknown, source: string, ttlMs?: number): void {
    this.entries.set(key, {
      key,
      value,
      source,
      timestamp: Date.now(),
      ttl: ttlMs,
    });
    this.trim();
  }

  get(key: string): unknown | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;

    if (entry.ttl && Date.now() - entry.timestamp > entry.ttl) {
      this.entries.delete(key);
      return undefined;
    }

    return entry.value;
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  getAll(): BlackboardEntry[] {
    this.cleanExpired();
    return Array.from(this.entries.values());
  }

  getSummary(maxChars = 2000): string {
    this.cleanExpired();
    const entries = Array.from(this.entries.values());
    if (entries.length === 0) return '';

    const lines = entries.map(e => {
      const val = typeof e.value === 'string' ? e.value : JSON.stringify(e.value);
      const truncated = val.length > 200 ? val.slice(0, 200) + '...' : val;
      return `[${e.source}] ${e.key}: ${truncated}`;
    });

    let result = lines.join('\n');
    if (result.length > maxChars) {
      result = result.slice(0, maxChars) + '\n... (truncated)';
    }

    return result;
  }

  clear(): void {
    this.entries.clear();
  }

  remove(key: string): void {
    this.entries.delete(key);
  }

  private cleanExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (entry.ttl && now - entry.timestamp > entry.ttl) {
        this.entries.delete(key);
      }
    }
  }

  private trim(): void {
    if (this.entries.size > this.maxEntries) {
      const sorted = Array.from(this.entries.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp);
      const toRemove = sorted.slice(0, sorted.length - this.maxEntries);
      for (const [key] of toRemove) {
        this.entries.delete(key);
      }
    }
  }
}

export const blackboard = new Blackboard();
