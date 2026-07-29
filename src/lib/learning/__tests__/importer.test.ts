import { describe, it, expect } from 'vitest';
import {
  CHUNK_OVERLAP,
  CHUNK_SIZE,
  ImportError,
  chunkText,
  importDocument,
  importTimetableCsv,
  importTimetableCsvStrict,
  parseCsv,
  timesOverlap,
} from '../importer';

describe('importDocument', () => {
  it('accepts title/format/content and chunks with stable indices', () => {
    const content = 'A'.repeat(2500);
    const doc = importDocument({
      courseId: 'c1',
      title: 'Notes',
      format: 'markdown',
      content,
    });
    expect(doc.chunks.length).toBeGreaterThan(1);
    doc.chunks.forEach((ch, i) => {
      expect(ch.index).toBe(i);
      expect(ch.text.length).toBeLessThanOrEqual(CHUNK_SIZE);
    });
    // overlap: adjacent windows share content
    if (doc.chunks.length >= 2) {
      const a = doc.chunks[0]!.text;
      const b = doc.chunks[1]!.text;
      const overlapSlice = a.slice(a.length - CHUNK_OVERLAP);
      expect(b.startsWith(overlapSlice)).toBe(true);
    }
  });

  it('rejects content larger than 2MB', () => {
    const big = 'x'.repeat(2 * 1024 * 1024 + 1);
    expect(() =>
      importDocument({ courseId: 'c1', title: 'big', format: 'txt', content: big }),
    ).toThrow(ImportError);
  });

  it('rejects path-like fields', () => {
    expect(() =>
      importDocument({
        courseId: 'c1',
        title: 'x',
        format: 'txt',
        content: 'hi',
        // @ts-expect-error intentional
        path: '/tmp/secret.md',
      }),
    ).toThrow(/file paths/i);
  });
});

describe('chunkText', () => {
  it('preserves sequential index starting at 0', () => {
    const chunks = chunkText('hello world '.repeat(200), 100, 20);
    expect(chunks.map((c) => c.index)).toEqual(chunks.map((_, i) => i));
  });
});

describe('importTimetableCsv', () => {
  const header = '星期,开始,结束,课程,地点';

  it('parses valid rows including quoted fields', () => {
    const csv = [
      header,
      '一,08:00,09:40,高等数学,A101',
      '二,10:00,11:40,"线,性代数","教,室B"',
    ].join('\n');
    const { slots, errors } = importTimetableCsv('course-1', csv);
    expect(errors).toHaveLength(0);
    expect(slots).toHaveLength(2);
    expect(slots[0]!.weekday).toBe(1);
    expect(slots[0]!.start).toBe('08:00');
    expect(slots[1]!.courseName).toBe('线,性代数');
    expect(slots[1]!.location).toBe('教,室B');
  });

  it('reports invalid HH:mm with line numbers', () => {
    const csv = [header, '一,8:00,09:00,Math,R1', '二,10:00,25:00,Phys,R2'].join('\n');
    const { errors, slots } = importTimetableCsv('c1', csv);
    expect(slots).toHaveLength(0);
    expect(errors.some((e) => e.line === 2 && /HH:mm/.test(e.message))).toBe(true);
    expect(errors.some((e) => e.line === 3 && /HH:mm|结束/.test(e.message))).toBe(true);
  });

  it('rejects end not later than start with line number', () => {
    const csv = [header, '三,14:00,14:00,Seminar,R3'].join('\n');
    const { errors } = importTimetableCsv('c1', csv);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.line).toBe(2);
    expect(errors[0]!.message).toMatch(/later|结束/);
  });

  it('detects same-day conflicts with line numbers', () => {
    const csv = [
      header,
      '一,08:00,10:00,A,L1',
      '一,09:00,11:00,B,L2',
    ].join('\n');
    const { errors, slots } = importTimetableCsv('c1', csv);
    expect(slots).toHaveLength(1);
    expect(errors.some((e) => e.line === 3 && /conflict/i.test(e.message))).toBe(true);
  });

  it('strict mode throws on row errors', () => {
    const csv = [header, '一,99:00,10:00,X,Y'].join('\n');
    expect(() => importTimetableCsvStrict('c1', csv)).toThrow(ImportError);
  });

  it('rejects wrong header', () => {
    expect(() => importTimetableCsv('c1', 'a,b,c\n1,2,3')).toThrow(/header/i);
  });
});

describe('parseCsv', () => {
  it('handles escaped quotes', () => {
    const rows = parseCsv('a,b\n"he""llo",world');
    expect(rows[1]).toEqual(['he"llo', 'world']);
  });

  it('rejects multiline or unclosed quoted fields with physical line details', () => {
    expect(() => parseCsv('a,b\n"line one\nline two",x')).toThrow(/line 2/i);
    expect(() => parseCsv('a,b\n"unclosed,x')).toThrow(/line 2/i);
  });
});

describe('timesOverlap', () => {
  it('detects half-open overlap', () => {
    expect(timesOverlap('08:00', '10:00', '09:00', '11:00')).toBe(true);
    expect(timesOverlap('08:00', '10:00', '10:00', '11:00')).toBe(false);
    expect(timesOverlap('08:00', '09:00', '09:30', '10:00')).toBe(false);
  });
});
