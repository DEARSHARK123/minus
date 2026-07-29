import {
  DocumentFormatSchema,
  SourceDocumentSchema,
  TimetableSlotSchema,
  newId,
  nowIso,
  type DocumentChunk,
  type SourceDocument,
  type TimetableSlot,
} from '@/types/learning';

/** Max document content size: 2 MiB. */
export const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;

/** Target chunk size in characters (~1200). */
export const CHUNK_SIZE = 1200;

/** Overlap between consecutive chunks. */
export const CHUNK_OVERLAP = 150;

export const TIMETABLE_HEADERS = ['星期', '开始', '结束', '课程', '地点'] as const;

export class ImportError extends Error {
  readonly details?: unknown;

  constructor(message: string, details?: unknown) {
    super(message);
    this.name = 'ImportError';
    this.details = details;
  }
}

export type ImportDocumentInput = {
  courseId: string;
  title: string;
  format: 'markdown' | 'txt';
  content: string;
  id?: string;
};

/**
 * Import a document from title/format/content only (no file path).
 * Chunks content ~1200 chars with overlap; each chunk keeps its index.
 */
export function importDocument(input: ImportDocumentInput): SourceDocument {
  // Reject accidental path-like payloads
  if ('path' in (input as object) || 'filePath' in (input as object) || 'filepath' in (input as object)) {
    throw new ImportError('Document import does not accept file paths; provide title, format, and content only');
  }

  const format = DocumentFormatSchema.parse(input.format);
  if (!input.title || !input.title.trim()) {
    throw new ImportError('Document title is required');
  }
  if (typeof input.content !== 'string') {
    throw new ImportError('Document content is required');
  }

  const byteLength = Buffer.byteLength(input.content, 'utf-8');
  if (byteLength > MAX_DOCUMENT_BYTES) {
    throw new ImportError(
      `Document exceeds maximum size of ${MAX_DOCUMENT_BYTES} bytes (got ${byteLength})`,
      { maxBytes: MAX_DOCUMENT_BYTES, actualBytes: byteLength },
    );
  }

  const ts = nowIso();
  const chunks = chunkText(input.content, CHUNK_SIZE, CHUNK_OVERLAP);

  return SourceDocumentSchema.parse({
    id: input.id ?? newId(),
    courseId: input.courseId,
    title: input.title.trim(),
    format,
    content: input.content,
    chunks,
    createdAt: ts,
    updatedAt: ts,
  });
}

/**
 * Slice text into ~chunkSize character windows with overlap. Indices are stable 0..n-1.
 */
export function chunkText(
  text: string,
  chunkSize: number = CHUNK_SIZE,
  overlap: number = CHUNK_OVERLAP,
): DocumentChunk[] {
  if (chunkSize <= 0) throw new ImportError('chunkSize must be positive');
  if (overlap < 0 || overlap >= chunkSize) {
    throw new ImportError('overlap must be >= 0 and < chunkSize');
  }

  if (text.length === 0) {
    return [{ index: 0, text: '', startOffset: 0, endOffset: 0 }];
  }

  const chunks: DocumentChunk[] = [];
  let start = 0;
  let index = 0;
  const step = chunkSize - overlap;

  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    chunks.push({
      index,
      text: text.slice(start, end),
      startOffset: start,
      endOffset: end,
    });
    index += 1;
    if (end >= text.length) break;
    start += step;
  }

  return chunks;
}

// ─── Timetable CSV ──────────────────────────────────────────────────────────

const WEEKDAY_MAP: Record<string, number> = {
  '1': 1,
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  日: 7,
  天: 7,
  周一: 1,
  周二: 2,
  周三: 3,
  周四: 4,
  周五: 5,
  周六: 6,
  周日: 7,
  周天: 7,
  星期一: 1,
  星期二: 2,
  星期三: 3,
  星期四: 4,
  星期五: 5,
  星期六: 6,
  星期日: 7,
  星期天: 7,
  mon: 1,
  monday: 1,
  tue: 2,
  tuesday: 2,
  wed: 3,
  wednesday: 3,
  thu: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
  sun: 7,
  sunday: 7,
};

export type ImportTimetableResult = {
  slots: TimetableSlot[];
  errors: Array<{ line: number; message: string }>;
};

/**
 * Parse timetable CSV with fixed headers: 星期,开始,结束,课程,地点
 * Supports quoted fields. Errors include line numbers.
 * Validates HH:mm, end > start, and same-day conflicts.
 */
export function importTimetableCsv(
  courseId: string,
  csv: string,
): ImportTimetableResult {
  if (!courseId) {
    throw new ImportError('courseId is required for timetable import');
  }
  if (typeof csv !== 'string') {
    throw new ImportError('CSV content must be a string');
  }

  const rows = parseCsv(csv);
  const errors: Array<{ line: number; message: string }> = [];

  if (rows.length === 0) {
    throw new ImportError('CSV is empty', { line: 1 });
  }

  const header = rows[0]!.map((h) => h.trim());
  const headerLine = 1;
  if (!headersMatch(header)) {
    throw new ImportError(
      `Invalid CSV header on line ${headerLine}: expected ${TIMETABLE_HEADERS.join(',')}, got ${header.join(',')}`,
      { line: headerLine, expected: [...TIMETABLE_HEADERS], actual: header },
    );
  }

  const ts = nowIso();
  const slots: TimetableSlot[] = [];

  for (let i = 1; i < rows.length; i++) {
    const line = i + 1; // 1-based file line (header = 1)
    const row = rows[i]!;
    if (row.length === 1 && row[0]!.trim() === '') continue; // skip blank lines
    if (row.length < 4) {
      errors.push({ line, message: `Expected at least 4 columns, got ${row.length}` });
      continue;
    }

    const [weekdayRaw, startRaw, endRaw, courseNameRaw, locationRaw = ''] = row;
    const weekday = parseWeekday(weekdayRaw?.trim() ?? '');
    if (weekday === null) {
      errors.push({ line, message: `Invalid 星期 value: "${weekdayRaw}"` });
      continue;
    }

    const start = (startRaw ?? '').trim();
    const end = (endRaw ?? '').trim();
    if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(start)) {
      errors.push({ line, message: `Invalid 开始 time (expected HH:mm): "${startRaw}"` });
      continue;
    }
    if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(end)) {
      errors.push({ line, message: `Invalid 结束 time (expected HH:mm): "${endRaw}"` });
      continue;
    }
    if (end <= start) {
      errors.push({ line, message: `结束 must be later than 开始 (got ${start}-${end})` });
      continue;
    }

    const courseName = (courseNameRaw ?? '').trim();
    if (!courseName) {
      errors.push({ line, message: '课程 is required' });
      continue;
    }

    const candidate = {
      id: newId(),
      courseId,
      weekday,
      start,
      end,
      courseName,
      location: (locationRaw ?? '').trim(),
      createdAt: ts,
      updatedAt: ts,
    };

    const parsed = TimetableSlotSchema.safeParse(candidate);
    if (!parsed.success) {
      errors.push({
        line,
        message: parsed.error.issues.map((x) => x.message).join('; '),
      });
      continue;
    }

    // Same-day conflict against slots already accepted in this import
    const conflict = slots.find(
      (s) => s.weekday === parsed.data.weekday && timesOverlap(s.start, s.end, parsed.data.start, parsed.data.end),
    );
    if (conflict) {
      errors.push({
        line,
        message: `Time conflict on weekday ${parsed.data.weekday}: ${parsed.data.start}-${parsed.data.end} overlaps ${conflict.start}-${conflict.end} (${conflict.courseName})`,
      });
      continue;
    }

    slots.push(parsed.data);
  }

  if (errors.length > 0 && slots.length === 0 && rows.length > 1) {
    // All data rows failed — still return errors for caller to surface
  }

  return { slots, errors };
}

/**
 * Import timetable and throw if any row-level errors (strict mode used by API).
 */
export function importTimetableCsvStrict(courseId: string, csv: string): TimetableSlot[] {
  const result = importTimetableCsv(courseId, csv);
  if (result.errors.length > 0) {
    throw new ImportError('Timetable CSV contains errors', result.errors);
  }
  return result.slots;
}

function headersMatch(header: string[]): boolean {
  if (header.length < TIMETABLE_HEADERS.length) return false;
  return TIMETABLE_HEADERS.every((h, i) => header[i] === h);
}

function parseWeekday(raw: string): number | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase();
  if (key in WEEKDAY_MAP) return WEEKDAY_MAP[key]!;
  // bare Chinese without prefix
  if (raw in WEEKDAY_MAP) return WEEKDAY_MAP[raw]!;
  return null;
}

export function timesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  // half-open intervals [start, end)
  return aStart < bEnd && bStart < aEnd;
}

/**
 * RFC-style CSV parser with quoted fields ("" escapes).
 * Returns rows of string fields. Does not strip BOM beyond first cell.
 */
export function parseCsv(text: string): string[][] {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  let line = 1;

  while (i < normalized.length) {
    const ch = normalized[i]!;

    if (inQuotes) {
      if (ch === '"') {
        if (normalized[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      if (ch === '\n') {
        throw new ImportError(
          `Quoted fields cannot contain line breaks (line ${line})`,
          { line },
        );
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      line += 1;
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }

  if (inQuotes) {
    throw new ImportError(`Unclosed quoted field on line ${line}`, { line });
  }

  // last field
  row.push(field);
  // ignore trailing empty line produced solely by final newline
  if (!(row.length === 1 && row[0] === '' && rows.length > 0 && normalized.endsWith('\n'))) {
    rows.push(row);
  } else if (normalized.endsWith('\n') && row.length === 1 && row[0] === '') {
    // skip
  } else {
    rows.push(row);
  }

  // Fix: when file ends with newline we already pushed complete rows and leftover is empty — drop it
  if (rows.length > 0) {
    const last = rows[rows.length - 1]!;
    if (last.length === 1 && last[0] === '' && normalized.endsWith('\n')) {
      rows.pop();
    }
  }

  return rows;
}
