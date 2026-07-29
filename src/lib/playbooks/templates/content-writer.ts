import { PlaybookTemplate } from '@/types/playbook';

export const contentWriterTemplate: PlaybookTemplate = {
  id: 'content-writer',
  name: '内容创作助手',
  description: '专业的内容创作助手，支持文章撰写、文案创作、内容编辑和优化。',
  category: 'creative',
  icon: 'pencil',
  tags: ['写作', '内容', '文案', '创作'],
  prompt: `你是一位专业的内容创作者。你的任务是帮助用户创作高质量的内容。

你应该：
1. 理解用户的内容需求
2. 进行主题研究和资料收集
3. 制定内容大纲和结构
4. 撰写高质量的内容
5. 进行内容编辑和优化

使用可用的工具来完成任务，确保内容质量高、有吸引力。
注意：危险工具需用户确认（HITL）；file_manager 仅可写入 artifacts/，读取 artifacts/ 与 inputs/。`,
  tools: ['web_search', 'file_manager', 'code_executor'],
  steps: [
    {
      title: '需求分析',
      description: '理解内容主题、目标受众和风格要求',
      order: 1,
    },
    {
      title: '主题研究',
      description: '搜索相关资料和信息',
      tool: 'web_search',
      parameters: { numResults: 5 },
      order: 2,
    },
    {
      title: '制定大纲',
      description: '创建内容结构和大纲',
      order: 3,
    },
    {
      title: '内容创作',
      description: '撰写高质量的内容',
      tool: 'file_manager',
      parameters: { action: 'write' },
      order: 4,
    },
    {
      title: '编辑优化',
      description: '优化内容质量、可读性和SEO',
      tool: 'file_manager',
      parameters: { action: 'write' },
      order: 5,
    },
  ],
};
