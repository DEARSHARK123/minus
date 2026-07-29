import { Tool, ToolCapability } from '@/types/tool';
import { Message } from '@/types/agent';

const MATCH_THRESHOLD = 0.3;
const KEYWORD_MAX_SCORE = 0.6;
const INTENT_MAX_SCORE = 0.3;
const CONTEXT_MAX_SCORE = 0.1;

export class ToolMatcher {
  private tools: Map<string, Tool> = new Map();

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  registerAll(tools: Tool[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  match(stepTitle: string, context: Message[]): string | null {
    const title = stepTitle.toLowerCase();
    let bestTool: string | null = null;
    let bestScore = 0;

    for (const tool of this.tools.values()) {
      if (!tool.capability) continue;

      const score = this.calculateScore(title, context, tool.capability);
      if (score > bestScore) {
        bestScore = score;
        bestTool = tool.name;
      }
    }

    return bestScore >= MATCH_THRESHOLD ? bestTool : null;
  }

  private calculateScore(title: string, context: Message[], capability: ToolCapability): number {
    const keywordScore = this.calculateKeywordScore(title, capability.keywords);
    const intentScore = this.calculateIntentScore(title, capability.intents);
    const contextScore = this.calculateContextScore(context, capability.keywords);

    return keywordScore + intentScore + contextScore;
  }

  private calculateKeywordScore(title: string, keywords: { zh: string[]; en: string[] }): number {
    let matched = 0;
    const allKeywords = [...keywords.zh, ...keywords.en];

    for (const keyword of allKeywords) {
      if (title.includes(keyword.toLowerCase())) {
        matched++;
      }
    }

    if (matched === 0) return 0;
    return Math.min(0.2 + matched * 0.15, KEYWORD_MAX_SCORE);
  }

  private calculateIntentScore(title: string, intents: string[]): number {
    for (const intent of intents) {
      if (title.includes(intent.toLowerCase())) {
        return INTENT_MAX_SCORE;
      }
    }
    return 0;
  }

  private calculateContextScore(context: Message[], keywords: { zh: string[]; en: string[] }): number {
    const contextText = context.map(m => m.content.toLowerCase()).join(' ');
    const allKeywords = [...keywords.zh, ...keywords.en];

    for (const keyword of allKeywords) {
      if (contextText.includes(keyword.toLowerCase())) {
        return CONTEXT_MAX_SCORE;
      }
    }

    return 0;
  }
}

export const toolMatcher = new ToolMatcher();
