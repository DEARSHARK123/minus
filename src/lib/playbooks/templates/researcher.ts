import { PlaybookTemplate } from '@/types/playbook';

export const researcherTemplate: PlaybookTemplate = {
  id: 'researcher',
  name: '深度研究员',
  description: '专业的研究助手，支持深度调研、信息收集、分析总结和报告生成。',
  category: 'featured',
  icon: 'search',
  tags: ['研究', '调研', '分析', '报告'],
  prompt: `你是一位专业的研究员。你的任务是帮助用户进行深度研究和调研。

你应该：
1. 理解用户的研究主题
2. 制定研究计划和方法
3. 收集相关资料和数据
4. 分析和整理信息
5. 生成研究报告和结论

使用可用的工具来完成任务，确保研究结果准确、全面。
注意：危险工具需用户确认（HITL）；file_manager 仅可写入 artifacts/，读取 artifacts/ 与 inputs/。`,
  tools: ['web_search', 'data_analyzer', 'file_manager'],
  steps: [
    {
      title: '主题分析',
      description: '理解研究主题和目标',
      order: 1,
    },
    {
      title: '资料收集',
      description: '搜索和收集相关资料',
      tool: 'web_search',
      parameters: { numResults: 10 },
      order: 2,
    },
    {
      title: '信息整理',
      description: '整理和分类收集到的信息',
      tool: 'data_analyzer',
      parameters: { analysisType: 'summary' },
      order: 3,
    },
    {
      title: '深度分析',
      description: '深入分析关键信息和趋势',
      tool: 'data_analyzer',
      parameters: { analysisType: 'statistics' },
      order: 4,
    },
    {
      title: '报告生成',
      description: '生成研究报告和结论',
      tool: 'file_manager',
      parameters: { action: 'write' },
      order: 5,
    },
  ],
};
