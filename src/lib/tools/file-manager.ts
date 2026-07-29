import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';
import { Tool, ToolResult, ToolExecutionContext } from '@/types/tool';
import {
  getWorkspaceArtifactsDir,
  truncateResult,
  validateAllowlistedPath,
} from './sandbox';

const fileManagerSchema = z.object({
  action: z.enum(['read', 'write', 'delete', 'list']).describe('File operation'),
  path: z.string().describe('File path relative to workspace (artifacts/ or inputs/)'),
  content: z.string().optional().describe('Content to write (for write action)'),
  encoding: z.string().default('utf-8').describe('File encoding'),
});

function getDefaultWorkspacePath(): string {
  return process.env.MINUS_WORKSPACE || process.cwd();
}

export const fileManagerTool: Tool = {
  name: 'file_manager',
  description:
    'Manage files under workspace artifacts/ (write/delete) and artifacts/|inputs/ (read/list). Paths must stay inside those roots. Write/delete require HITL unless auto-approved.',
  parameters: fileManagerSchema,
  /** Write/delete gated in registry via toolRequiresHitlGate; read/list stay open. */
  isDangerous: false,
  capability: {
    keywords: {
      zh: ['读取', '加载', '导入', '文件', '数据', '打开', '查看', '写入', '保存', '导出', '删除', '列出'],
      en: ['read', 'load', 'import', 'file', 'data', 'open', 'view', 'write', 'save', 'export', 'delete', 'list'],
    },
    intents: ['file_read', 'file_write', 'file_delete', 'file_list', 'data_loading'],
  },
  execute: async (params, context?: ToolExecutionContext): Promise<ToolResult> => {
    const { action, path: filePath, content, encoding } = params as z.infer<typeof fileManagerSchema>;

    if (!filePath || filePath.trim().length === 0) {
      return {
        success: false,
        error: 'File path is empty. Please provide a valid file path.',
      };
    }

    const workspace = context?.workspacePath || getDefaultWorkspacePath();
    let resolvedPath: string;

    try {
      switch (action) {
        case 'write':
        case 'delete': {
          await fs.mkdir(getWorkspaceArtifactsDir(workspace), { recursive: true });
          resolvedPath = validateAllowlistedPath(filePath, workspace, ['artifacts']);
          break;
        }
        case 'read':
        case 'list': {
          resolvedPath = validateAllowlistedPath(filePath, workspace, ['artifacts', 'inputs']);
          break;
        }
        default: {
          const _exhaustive: never = action;
          return { success: false, error: `Unknown action: ${_exhaustive}` };
        }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Path validation failed',
      };
    }

    try {
      switch (action) {
        case 'read': {
          const stat = await fs.stat(resolvedPath);
          if (stat.isDirectory()) {
            return {
              success: false,
              error: `"${filePath}" is a directory, not a file. Use action "list" to list directory contents.`,
            };
          }
          const data = await fs.readFile(resolvedPath, { encoding: encoding as BufferEncoding });
          return { success: true, data: truncateResult(data) };
        }

        case 'write': {
          if (content === undefined) {
            return { success: false, error: 'Content is required for write action.' };
          }
          await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
          await fs.writeFile(resolvedPath, content, { encoding: encoding as BufferEncoding });
          return {
            success: true,
            data: `File written successfully: ${filePath} (${content.length} chars)`,
          };
        }

        case 'delete': {
          const stat = await fs.stat(resolvedPath);
          if (stat.isDirectory()) {
            return {
              success: false,
              error: `Cannot delete directory "${filePath}". Only file deletion is supported.`,
            };
          }
          await fs.unlink(resolvedPath);
          return { success: true, data: `File deleted: ${filePath}` };
        }

        case 'list': {
          const entries = await fs.readdir(resolvedPath, { withFileTypes: true });
          const listing = entries
            .map((e) => {
              const prefix = e.isDirectory() ? 'd ' : 'f ';
              return prefix + e.name;
            })
            .join('\n');
          return {
            success: true,
            data: truncateResult(listing || '(empty directory)'),
          };
        }

        default: {
          const _exhaustive: never = action;
          return { success: false, error: `Unknown action: ${_exhaustive}` };
        }
      }
    } catch (error: unknown) {
      const nodeError = error as { code?: string; message?: string };
      if (nodeError.code === 'ENOENT') {
        return { success: false, error: `File not found: ${filePath}` };
      }
      if (nodeError.code === 'EACCES') {
        return { success: false, error: `Permission denied: ${filePath}` };
      }
      return {
        success: false,
        error: `File operation failed: ${nodeError.message || 'Unknown error'}`,
      };
    }
  },
};
