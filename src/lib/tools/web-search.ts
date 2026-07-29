import { z } from 'zod';
import { Tool, ToolResult } from '@/types/tool';
import { truncateResult } from './sandbox';

const webSearchSchema = z.object({
  query: z.string().describe('Search query'),
  numResults: z.number().min(1).max(10).default(5).describe('Number of results to return'),
  language: z.string().default('en').describe('Search language'),
});

const TAVILY_API_URL = 'https://api.tavily.com/search';

export type WebSearchItem = {
  title: string;
  url: string;
  content: string;
  score: number;
};

export type WebSearchResponse = {
  answer?: string;
  results: WebSearchItem[];
};

/** Structured Tavily search used by both the tool loop and course enrichment. */
export async function searchWeb(
  query: string,
  numResults = 5,
): Promise<WebSearchResponse> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    throw new Error('Tavily API key is not configured. Set TAVILY_API_KEY in your .env file.');
  }

  const response = await fetch(TAVILY_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: Math.max(1, Math.min(10, numResults)),
      search_depth: 'basic',
      include_answer: true,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Tavily API error (${response.status}): ${errorText}`);
  }

  return (await response.json()) as WebSearchResponse;
}

export const webSearchTool: Tool = {
  name: 'web_search',
  description: 'Search the web for information. Returns search results with titles, URLs, and snippets.',
  parameters: webSearchSchema,
  isDangerous: true,
  capability: {
    keywords: {
      zh: ['搜索', '查找', '调研', '查询', '检索', '了解', '调查'],
      en: ['search', 'find', 'lookup', 'query', 'research', 'investigate'],
    },
    intents: ['web_search', 'information_retrieval', 'research'],
  },
  execute: async (params): Promise<ToolResult> => {
    const { query, numResults } = params as z.infer<typeof webSearchSchema>;

    if (!query || query.trim().length === 0) {
      return {
        success: false,
        error: 'Search query is empty. Please provide a valid search query.',
      };
    }

    try {
      const data = await searchWeb(query, numResults);

      const formatted = data.results.map((r, i) =>
        `[${i + 1}] ${r.title}\n    ${r.url}\n    ${r.content}`
      ).join('\n\n');

      const output = data.answer
        ? `Answer: ${data.answer}\n\nSearch Results:\n${formatted}`
        : `Search Results:\n${formatted}`;

      return {
        success: true,
        data: truncateResult(output),
      };
    } catch (error) {
      return {
        success: false,
        error: `Web search failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  },
};
