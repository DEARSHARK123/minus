import { toolRegistry } from './registry';
import { codeExecutorTool } from './code-executor';
import { webSearchTool } from './web-search';
import { fileManagerTool } from './file-manager';
import { dataAnalyzerTool } from './data-analyzer';
import { askHumanTool } from './ask-human';

toolRegistry.register(codeExecutorTool);
toolRegistry.register(webSearchTool);
toolRegistry.register(fileManagerTool);
toolRegistry.register(dataAnalyzerTool);
toolRegistry.register(askHumanTool);

export { toolRegistry };
export type { Tool, ToolResult, ToolRegistry } from '@/types/tool';
