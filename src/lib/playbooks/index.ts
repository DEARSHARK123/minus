import { playbookRegistry } from './registry';
import { playbookTemplates } from './templates';

// 注册所有Playbook模板
playbookTemplates.forEach(template => {
  playbookRegistry.register(template);
});

// 创建一些预设的Playbook
playbookRegistry.createFromTemplate('data-analyst');
playbookRegistry.createFromTemplate('code-developer');
playbookRegistry.createFromTemplate('content-writer');
playbookRegistry.createFromTemplate('researcher');

export { playbookRegistry };
export type { Playbook, PlaybookTemplate, PlaybookCategory, PlaybookRegistry } from '@/types/playbook';
