export type MarkdownBlock =
  | { kind: 'heading'; level: 1 | 2 | 3 | 4; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'unordered_list'; items: string[] }
  | { kind: 'ordered_list'; items: string[] }
  | { kind: 'quote'; text: string }
  | { kind: 'code'; language?: string; code: string }
  | { kind: 'table'; headers: string[]; rows: string[][] }
  | { kind: 'rule' };

const HEADING_RE = /^(#{1,4})\s+(.+)$/;
const UNORDERED_RE = /^\s*[-*+]\s+(.+)$/;
const ORDERED_RE = /^\s*\d+[.)]\s+(.+)$/;
const RULE_RE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const TABLE_DIVIDER_RE = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/;

function tableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function beginsBlock(lines: string[], index: number): boolean {
  const line = lines[index] ?? '';
  const next = lines[index + 1] ?? '';
  return (
    !line.trim() ||
    line.trim().startsWith('```') ||
    HEADING_RE.test(line) ||
    RULE_RE.test(line) ||
    UNORDERED_RE.test(line) ||
    ORDERED_RE.test(line) ||
    /^\s*>\s?/.test(line) ||
    (line.includes('|') && TABLE_DIVIDER_RE.test(next))
  );
}

/** Parse the safe Markdown subset used by chat and course explanations. */
export function parseMarkdownBlocks(content: string): MarkdownBlock[] {
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? '';
    const trimmed = line.trim();
    if (!trimmed) {
      index += 1;
      continue;
    }

    if (trimmed.startsWith('```')) {
      const language = trimmed.slice(3).trim() || undefined;
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? '').trim().startsWith('```')) {
        code.push(lines[index] ?? '');
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ kind: 'code', language, code: code.join('\n') });
      continue;
    }

    const heading = line.match(HEADING_RE);
    if (heading) {
      blocks.push({
        kind: 'heading',
        level: heading[1]!.length as 1 | 2 | 3 | 4,
        text: heading[2]!.trim(),
      });
      index += 1;
      continue;
    }

    if (RULE_RE.test(line)) {
      blocks.push({ kind: 'rule' });
      index += 1;
      continue;
    }

    if (line.includes('|') && TABLE_DIVIDER_RE.test(lines[index + 1] ?? '')) {
      const headers = tableCells(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && (lines[index] ?? '').includes('|') && (lines[index] ?? '').trim()) {
        rows.push(tableCells(lines[index] ?? ''));
        index += 1;
      }
      blocks.push({ kind: 'table', headers, rows });
      continue;
    }

    const unordered = line.match(UNORDERED_RE);
    if (unordered) {
      const items: string[] = [];
      while (index < lines.length) {
        const match = (lines[index] ?? '').match(UNORDERED_RE);
        if (!match) break;
        items.push(match[1]!.trim());
        index += 1;
      }
      blocks.push({ kind: 'unordered_list', items });
      continue;
    }

    const ordered = line.match(ORDERED_RE);
    if (ordered) {
      const items: string[] = [];
      while (index < lines.length) {
        const match = (lines[index] ?? '').match(ORDERED_RE);
        if (!match) break;
        items.push(match[1]!.trim());
        index += 1;
      }
      blocks.push({ kind: 'ordered_list', items });
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index] ?? '')) {
        quote.push((lines[index] ?? '').replace(/^\s*>\s?/, '').trim());
        index += 1;
      }
      blocks.push({ kind: 'quote', text: quote.join(' ') });
      continue;
    }

    const paragraph = [trimmed];
    index += 1;
    while (index < lines.length && !beginsBlock(lines, index)) {
      paragraph.push((lines[index] ?? '').trim());
      index += 1;
    }
    blocks.push({ kind: 'paragraph', text: paragraph.join(' ') });
  }

  return blocks;
}
