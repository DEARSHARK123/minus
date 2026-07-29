import { PlaybookTemplate } from '@/types/playbook';

export const codeDeveloperTemplate: PlaybookTemplate = {
  id: 'code-developer',
  name: '代码开发助手',
  description: '专业的代码开发助手，支持代码生成、调试、重构和测试。',
  category: 'featured',
  icon: 'code',
  tags: ['代码', '开发', '编程', '调试'],
  prompt: `你是一位专业的软件开发工程师。你的任务是帮助用户编写、调试和优化代码。

你应该：
1. 理解用户的代码需求
2. 设计合理的代码架构
3. 编写高质量、可维护的代码
4. 进行代码测试和调试
5. 提供代码优化建议

使用可用的工具来完成任务，确保代码质量高、性能好。
注意：危险工具（如 code_executor、web_search）需要用户确认（HITL）后才会执行；file_manager 仅可写入 artifacts/，读取 artifacts/ 与 inputs/。`,
  tools: ['code_executor', 'file_manager', 'web_search'],
  steps: [
    {
      title: '理解需求',
      description: '分析代码需求和功能规格',
      order: 1,
    },
    {
      title: '设计架构',
      description: '设计代码结构和模块划分',
      order: 2,
    },
    {
      title: '编写代码',
      description: '实现核心功能代码',
      tool: 'code_executor',
      parameters: { language: 'typescript' },
      order: 3,
    },
    {
      title: '测试验证',
      description: '运行测试并验证功能',
      tool: 'code_executor',
      parameters: { language: 'typescript' },
      order: 4,
    },
    {
      title: '代码优化',
      description: '优化代码性能和可读性',
      tool: 'code_executor',
      parameters: { language: 'typescript' },
      order: 5,
    },
  ],
};
