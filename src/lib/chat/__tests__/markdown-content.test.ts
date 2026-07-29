import { describe, expect, it } from 'vitest';
import { parseMarkdownBlocks } from '../markdown-content';

describe('teaching markdown parser', () => {
  it('parses headings, prose, lists, rules, code and tables', () => {
    const blocks = parseMarkdownBlocks(`### 核心定义

**作用域**决定变量的可见范围。

- 全局作用域
- 函数作用域

---

\`\`\`javascript
const value = 1;
\`\`\`

| 概念 | 含义 |
| --- | --- |
| 闭包 | 函数与词法环境 |
`);

    expect(blocks.map((block) => block.kind)).toEqual([
      'heading',
      'paragraph',
      'unordered_list',
      'rule',
      'code',
      'table',
    ]);
    expect(blocks.find((block) => block.kind === 'code')).toMatchObject({
      language: 'javascript',
      code: 'const value = 1;',
    });
  });

  it('keeps raw HTML inert as paragraph text', () => {
    const blocks = parseMarkdownBlocks('<script>alert(1)</script>');
    expect(blocks).toEqual([
      { kind: 'paragraph', text: '<script>alert(1)</script>' },
    ]);
  });
});
