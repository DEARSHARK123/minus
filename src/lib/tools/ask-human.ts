import { z } from 'zod';
import { Tool, ToolResult } from '@/types/tool';

const askHumanSchema = z.object({
  question: z.string().describe('The question or help request to present to the user'),
  context: z.string().optional().describe('Additional context about why help is needed'),
  urgency: z.enum(['low', 'medium', 'high']).default('medium').describe('Urgency level'),
});

export const askHumanTool: Tool = {
  name: 'ask_human',
  description: 'Ask the human user for help when you are stuck, need clarification, or encounter an error you cannot resolve. Use this tool to escalate issues to the user.',
  parameters: askHumanSchema,
  isDangerous: false,
  execute: async (params): Promise<ToolResult> => {
    const { question, context, urgency } = params as z.infer<typeof askHumanSchema>;
    return {
      success: true,
      data: {
        type: 'human_escalation',
        question,
        context: context || '',
        urgency: urgency || 'medium',
        timestamp: Date.now(),
      },
    };
  },
};
