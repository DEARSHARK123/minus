import { PlaybookTemplate } from '@/types/playbook';

export const dataAnalystTemplate: PlaybookTemplate = {
  id: 'data-analyst',
  name: '数据分析师',
  description: '专业的数据分析助手，支持数据清洗、统计分析、可视化和报告生成。',
  category: 'featured',
  icon: 'barChart',
  tags: ['数据', '分析', '可视化', '统计'],
  prompt: `你是一位专业的数据分析师。你的任务是帮助用户分析数据，提供洞察和建议。

你应该：
1. 理解用户的数据分析需求
2. 制定详细的分析计划
3. 执行数据清洗和预处理
4. 进行统计分析和建模
5. 生成可视化图表
6. 撰写分析报告

使用可用的工具来完成任务，确保分析结果准确、可靠。
注意：危险工具需用户确认（HITL）；file_manager 仅可写入 artifacts/，读取 artifacts/ 与 inputs/。`,
  tools: ['data_analyzer', 'code_executor', 'file_manager'],
  steps: [
    {
      title: '读取数据文件',
      description: '加载并解析数据文件，检查数据格式和结构',
      tool: 'file_manager',
      parameters: { action: 'read' },
      order: 1,
    },
    {
      title: '数据清洗',
      description: '处理缺失值、异常值和重复数据',
      tool: 'data_analyzer',
      parameters: { analysisType: 'cleaning' },
      order: 2,
    },
    {
      title: '统计分析',
      description: '计算关键指标、相关性和统计量',
      tool: 'data_analyzer',
      parameters: { analysisType: 'statistics' },
      order: 3,
    },
    {
      title: '生成可视化',
      description: '创建图表和可视化展示',
      tool: 'code_executor',
      parameters: { language: 'python' },
      order: 4,
    },
    {
      title: '撰写报告',
      description: '生成分析报告和结论',
      tool: 'code_executor',
      parameters: { language: 'python' },
      order: 5,
    },
  ],
};
