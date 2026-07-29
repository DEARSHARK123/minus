/**
 * Thin convention for structured learning replies rendered as colored boxes.
 *
 * Agents / chat models should emit fenced blocks in ONE merged assistant message:
 *
 *   :::summary
 *   一段摘要…
 *   :::
 *
 *   :::key
 *   - 重点 1
 *   - 重点 2
 *   :::
 *
 *   :::tip
 *   学习提示 / 易错点…
 *   :::
 *
 *   :::definition
 *   核心术语定义…
 *   :::
 *
 *   **章节标题**
 *   正文…
 *
 * Also accepts a JSON fence:
 *   ```learn-json
 *   { "summary": "...", "keyPoints": ["..."], "tip": "...", "definition": "...",
 *     "sections": [{ "title": "...", "body": "..." }] }
 *   ```
 */

export type LearnBlockKind =
  | 'summary'
  | 'key'
  | 'tip'
  | 'definition'
  | 'section'
  | 'prose';

export interface LearnContentBlock {
  kind: LearnBlockKind;
  /** For section / optional labels */
  title?: string;
  body: string;
}

/**
 * Typed teach blocks sent to the browser after server-side parse (batch-05).
 * Alias of LearnContentBlock — product contract name LearningContentBlock.
 */
export type LearningContentBlock = LearnContentBlock;

export const LEARN_CONTENT_SYSTEM_HINT = `## Teaching quality
Use your trained knowledge as the primary basis for a complete and accurate explanation. Explain definitions, relationships or mechanisms, and a concrete example when useful. Address likely misconceptions without forcing a fixed template. Choose plain prose, headings, lists, tables, or code according to the content. Do not emit implementation-specific display fences such as :::summary or :::key. When a structured highlight genuinely helps the learner, you may optionally emit ONE \`\`\`learn-json block with fields summary, keyPoints, sections, tip, definition (all optional): use "tip" for 学习提示 / 易错点 and "definition" for 核心术语定义. Otherwise prefer natural prose.`;

/** Marker used by /api/chat to detect learn-mode teach format enforcement. */
export const LEARN_TEACH_MODE_MARKER = 'Learning content format (when teaching';

/** Outline units optional for deterministic teach wrap. */
export type TeachOutlineFallback = {
  topic: string;
  goalTitle?: string;
  units: Array<{ title: string; knowledgePoints: string[]; description?: string }>;
  levelHint?: string;
};

const FENCE_RE =
  /(?:^|\n):::(summary|key|tip|definition|重点|摘要|提示|定义)\s*\n([\s\S]*?)\n:::/g;

const LEARN_JSON_RE = /```learn-json\s*\n([\s\S]*?)```/i;

type LearnFenceKind = Extract<LearnBlockKind, 'summary' | 'key' | 'tip' | 'definition'>;

const FENCE_BLOCK_TITLES: Record<LearnFenceKind, string> = {
  summary: '摘要',
  key: '重点',
  tip: '提示',
  definition: '定义',
};

function normalizeFenceKind(raw: string): LearnFenceKind {
  const k = raw.trim().toLowerCase();
  if (k === 'summary' || k === '摘要') return 'summary';
  if (k === 'tip' || k === '提示') return 'tip';
  if (k === 'definition' || k === '定义') return 'definition';
  return 'key';
}

function parseLearnJson(raw: string): LearnContentBlock[] | null {
  try {
    const data = JSON.parse(raw) as {
      summary?: string;
      keyPoints?: string[];
      key?: string;
      tip?: string;
      definition?: string;
      sections?: Array<{ title?: string; body?: string }>;
    };
    const blocks: LearnContentBlock[] = [];
    if (data.summary?.trim()) {
      blocks.push({ kind: 'summary', title: '摘要', body: data.summary.trim() });
    }
    const keyBody = Array.isArray(data.keyPoints)
      ? data.keyPoints.map((p) => `- ${String(p).trim()}`).filter((l) => l.length > 2).join('\n')
      : data.key?.trim() || '';
    if (keyBody) {
      blocks.push({ kind: 'key', title: '重点', body: keyBody });
    }
    if (data.tip?.trim()) {
      blocks.push({ kind: 'tip', title: '提示', body: data.tip.trim() });
    }
    if (data.definition?.trim()) {
      blocks.push({ kind: 'definition', title: '定义', body: data.definition.trim() });
    }
    if (Array.isArray(data.sections)) {
      for (const s of data.sections) {
        const title = String(s.title || '').trim();
        const body = String(s.body || '').trim();
        if (title || body) {
          blocks.push({ kind: 'section', title: title || undefined, body });
        }
      }
    }
    return blocks.length > 0 ? blocks : null;
  } catch {
    return null;
  }
}

/**
 * Parse assistant text into ordered learn blocks. Unrecognized regions become prose.
 */
export function parseLearnContent(content: string): LearnContentBlock[] {
  if (!content || !content.trim()) return [];

  const jsonMatch = content.match(LEARN_JSON_RE);
  if (jsonMatch?.[1]) {
    const fromJson = parseLearnJson(jsonMatch[1]);
    if (fromJson) {
      const without = content.replace(LEARN_JSON_RE, '').trim();
      return without
        ? [...fromJson, ...parseLearnContentFences(without)]
        : fromJson;
    }
  }

  return parseLearnContentFences(content);
}

function parseLearnContentFences(content: string): LearnContentBlock[] {
  const blocks: LearnContentBlock[] = [];
  let lastIndex = 0;
  const re = new RegExp(FENCE_RE.source, 'g');
  let match: RegExpExecArray | null;

  while ((match = re.exec(content)) !== null) {
    const full = match[0];
    const start = match.index + (full.startsWith('\n') ? 1 : 0);
    const prose = content.slice(lastIndex, start).trim();
    if (prose) {
      blocks.push(...splitProseIntoSections(prose));
    }
    const kind = normalizeFenceKind(match[1] || 'key');
    const body = (match[2] || '').trim();
    if (body) {
      blocks.push({
        kind,
        title: FENCE_BLOCK_TITLES[kind],
        body,
      });
    }
    lastIndex = match.index + full.length;
  }

  const rest = content.slice(lastIndex).trim();
  if (rest) {
    blocks.push(...splitProseIntoSections(rest));
  }

  return blocks;
}

/** Split markdown-ish prose so **Title** lines become section headers. */
function splitProseIntoSections(prose: string): LearnContentBlock[] {
  const lines = prose.split('\n');
  const out: LearnContentBlock[] = [];
  let currentTitle: string | undefined;
  let buf: string[] = [];

  const flush = () => {
    const body = buf.join('\n').trim();
    if (!body && !currentTitle) return;
    if (currentTitle) {
      out.push({ kind: 'section', title: currentTitle, body });
    } else if (body) {
      out.push({ kind: 'prose', body });
    }
    buf = [];
    currentTitle = undefined;
  };

  for (const line of lines) {
    const heading = line.trim().match(/^\*\*(.+?)\*\*\s*$/);
    if (heading) {
      flush();
      currentTitle = heading[1]!.trim();
      buf = [];
      continue;
    }
    buf.push(line);
  }
  flush();
  return out;
}

export function hasLearnContentMarkup(content: string): boolean {
  if (!content) return false;
  if (LEARN_JSON_RE.test(content)) return true;
  // Lookahead instead of \b: CJK fence aliases (重点/摘要/提示/定义) are non-word chars.
  return /:::(summary|key|tip|definition|重点|摘要|提示|定义)(?=\s|$)/i.test(content);
}

/**
 * Convert typed blocks to fence-free display text for message.content storage.
 * Browsers must not need raw :::summary / :::key to render teach chrome.
 */
export function learningBlocksToDisplayText(
  blocks: LearningContentBlock[],
): string {
  if (!blocks.length) return '';
  return blocks
    .map((b) => {
      if (
        b.kind === 'summary' ||
        b.kind === 'key' ||
        b.kind === 'tip' ||
        b.kind === 'definition'
      ) {
        return b.title ? `${b.title}\n${b.body}` : b.body;
      }
      if (b.kind === 'section') {
        return b.title ? `**${b.title}**\n${b.body}` : b.body;
      }
      return b.body;
    })
    .filter(Boolean)
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Server-side teach egress: parse fences → typed blocks + fence-free content.
 * Final browser payload must not contain raw :::summary / :::key markers.
 */
export function toPublicTeachPayload(rawText: string): {
  content: string;
  contentBlocks: LearningContentBlock[];
} {
  const text = rawText || '';
  if (!text.trim()) {
    return { content: '', contentBlocks: [] };
  }
  const contentBlocks = parseLearnContent(text);
  if (contentBlocks.length === 0) {
    return { content: text.trim(), contentBlocks: [] };
  }
  const content = learningBlocksToDisplayText(contentBlocks);
  // Defense: never leave fence markers in public content
  const fenceNames = /:::(summary|key|tip|definition|重点|摘要|提示|定义)(?=\s|$)/gi;
  const cleaned = content
    .replace(fenceNames, '')
    .replace(/```learn-json\b/gi, '')
    .trim();
  return {
    content: cleaned || text.replace(fenceNames, '').trim(),
    contentBlocks,
  };
}

/**
 * @deprecated Outline path must NOT emit this as user-visible dual-write.
 * Kept only for ensureTeachFences / session_teach repair internals.
 * Deep Planning uses outline_card + natural guide (batch-05).
 */
/** Build a merged teach message from outline units (no extra LLM call). */
export function buildMergedOutlineTeachMessage(opts: {
  topic: string;
  goalTitle?: string;
  units: Array<{ title: string; knowledgePoints: string[]; description?: string }>;
  levelHint?: string;
}): string {
  const { topic, goalTitle, units, levelHint } = opts;
  const summaryParts = [
    goalTitle ? `目标：${goalTitle}` : `主题：${topic}`,
    levelHint ? `当前水平参考：${levelHint}` : null,
    `共 ${units.length} 个学习单元，下方为重点知识点与分节说明。`,
  ].filter(Boolean);

  const keyLines = units.flatMap((u) =>
    (u.knowledgePoints || []).slice(0, 4).map((kp) => `- ${u.title}：${kp}`),
  );

  const sections = units
    .map((u) => {
      const body =
        (u.description && u.description.trim()) ||
        (u.knowledgePoints || []).map((kp) => `- ${kp}`).join('\n') ||
        '（待补充）';
      return `**${u.title}**\n${body}`;
    })
    .join('\n\n');

  return [
    ':::summary',
    summaryParts.join('\n'),
    ':::',
    '',
    ':::key',
    keyLines.slice(0, 12).join('\n') || `- 围绕「${topic}」掌握核心概念与练习`,
    ':::',
    '',
    sections,
  ].join('\n');
}

/**
 * Short greeting / social replies must never be wrapped into teach boxes.
 * Used as defense-in-depth when ensureTeachFences is called incorrectly.
 */
export function isGreetingLikeText(text: string): boolean {
  const t = (text || '').trim();
  if (!t || t.length > 100) return false;
  if (hasLearnContentMarkup(t)) return false;
  const greetingOnly =
    /^(你好|您好|嗨|哈喽|hello|hi|hey|good\s*(morning|afternoon|evening)|早上好|下午好|晚上好)([\s，,!！.。~～？?\u2026…]*)$/i;
  if (greetingOnly.test(t)) return true;
  // Short plain social reply: few lines, no list/heading structure
  const lines = t.split('\n').map((l) => l.trim()).filter(Boolean);
  if (
    t.length <= 48 &&
    lines.length <= 2 &&
    !/^[-*•]\s|^\d+[.)]\s|\*\*.+\*\*|#{1,3}\s/m.test(t)
  ) {
    return true;
  }
  return false;
}

/**
 * Deterministic wrap: if teaching text lacks :::summary / :::key (or Chinese aliases),
 * wrap body into the required fences. Prefer outline builder when units exist.
 * Defense: no outline + greeting-like short text → return original unchanged.
 */
export function ensureTeachFences(
  text: string,
  outline?: TeachOutlineFallback,
): string {
  const trimmed = (text || '').trim();
  if (hasLearnContentMarkup(trimmed)) {
    return trimmed;
  }
  if (outline?.units && outline.units.length > 0) {
    return buildMergedOutlineTeachMessage(outline);
  }
  // B01: never wrap casual greetings into orange/green boxes
  if (isGreetingLikeText(trimmed)) {
    return trimmed;
  }
  if (!trimmed) {
    return [
      ':::summary',
      '（暂无教学内容）',
      ':::',
      '',
      ':::key',
      '- 请补充学习要点',
      ':::',
    ].join('\n');
  }

  const lines = trimmed.split('\n').map((l) => l.trim()).filter(Boolean);
  const keyCandidates = lines
    .filter((l) => /^[-*•]\s+/.test(l) || /^\d+[.)]\s+/.test(l))
    .slice(0, 8);
  const summary =
    lines.slice(0, 3).join(' ').slice(0, 280) || trimmed.slice(0, 280);
  const keyBody =
    keyCandidates.length > 0
      ? keyCandidates.map((l) => (l.startsWith('-') ? l : `- ${l.replace(/^[-*•]\s+/, '').replace(/^\d+[.)]\s+/, '')}`)).join('\n')
      : `- ${trimmed.slice(0, 120).replace(/\n/g, ' ')}`;

  return [
    ':::summary',
    summary,
    ':::',
    '',
    ':::key',
    keyBody,
    ':::',
    '',
    trimmed,
  ].join('\n');
}
