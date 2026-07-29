import { AgentState } from '@/types/agent';

export const MAX_TOOL_RETRIES = 2;

export function isRetryableError(error: string): boolean {
  if (/timeout/i.test(error)) return true;
  if (/ECONNREFUSED|ECONNRESET|ENOTFOUND/i.test(error)) return true;
  if (/5\d{2}\s/i.test(error)) return true;
  if (/JSON/i.test(error)) return true;
  return false;
}

const EXECUTION_INTENT_PATTERNS = [
  /执行|运行|运行代码|跑一下|跑一遍|execute|run\s+(this|the|my)?\s*code/i,
  /写一个?\s*(程序|脚本|代码|函数|方法)|write\s+(a|the)?\s*(program|script|code|function)/i,
  /帮我写|帮我生成|帮我创建|help\s+me\s+(write|generate|create)/i,
  /print\s*\(|console\.log|def\s+\w+|function\s+\w+|import\s+\w+/i,
  /python|javascript|typescript|html|css|sql/i,
  /搜索|查找|查询|search|look\s+up|find\s+out/i,
  /读取文件|写入文件|创建文件|read\s+file|write\s+file|create\s+file/i,
  /数据分析|统计|可视化|data\s+analysis|statistics|visualization/i,
];

export function detectExecutionIntent(message: string): boolean {
  return EXECUTION_INTENT_PATTERNS.some(pattern => pattern.test(message));
}

export interface LLMToolCallResult {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface LLMIterationResponse {
  content: string | null;
  tool_calls: LLMToolCallResult[];
  hasToolCalls: boolean;
}

export function generateSummary(state: AgentState): string {
  const completedSteps = state.plan.filter(s => s.status === 'completed').length;
  const totalSteps = state.plan.length;
  const toolCallsCount = state.toolCalls.length;
  const artifactsCount = state.artifacts.length;

  let summary = `Task execution completed!\n\n`;
  summary += `📊 Execution Statistics:\n`;
  summary += `- Completed steps: ${completedSteps}/${totalSteps}\n`;
  summary += `- Tool calls: ${toolCallsCount}\n`;
  summary += `- Artifacts: ${artifactsCount}\n\n`;

  if (state.artifacts.length > 0) {
    summary += `📁 Generated Artifacts:\n`;
    state.artifacts.forEach(artifact => {
      summary += `- ${artifact.name}\n`;
    });
    summary += `\n`;
  }

  summary += `Check the monitor panel for detailed results and artifacts.`;

  return summary;
}
