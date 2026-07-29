import { Playbook, PlaybookTemplate, PlaybookCategory, PlaybookRegistry } from '@/types/playbook';

class PlaybookRegistryImpl implements PlaybookRegistry {
  private templates: Map<string, PlaybookTemplate> = new Map();
  private playbooks: Map<string, Playbook> = new Map();

  register(template: PlaybookTemplate): void {
    this.templates.set(template.id, template);
  }

  get(id: string): Playbook | undefined {
    return this.playbooks.get(id);
  }

  getAll(): Playbook[] {
    return Array.from(this.playbooks.values());
  }

  getByCategory(category: PlaybookCategory): Playbook[] {
    return this.getAll().filter(pb => pb.category === category);
  }

  search(query: string): Playbook[] {
    const lowerQuery = query.toLowerCase();
    return this.getAll().filter(pb =>
      pb.name.toLowerCase().includes(lowerQuery) ||
      pb.description.toLowerCase().includes(lowerQuery) ||
      pb.tags.some(tag => tag.toLowerCase().includes(lowerQuery))
    );
  }

  createFromTemplate(templateId: string, customizations?: Partial<Playbook>): Playbook {
    const template = this.templates.get(templateId);
    if (!template) {
      throw new Error(`Template "${templateId}" not found`);
    }

    const playbook: Playbook = {
      id: `pb_${Date.now()}`,
      name: template.name,
      description: template.description,
      category: template.category,
      icon: template.icon,
      tags: template.tags,
      prompt: template.prompt,
      tools: template.tools,
      steps: template.steps.map((step, index) => ({
        ...step,
        id: `step_${index + 1}`,
      })),
      createdAt: new Date(),
      updatedAt: new Date(),
      usageCount: 0,
      rating: 0,
      ...customizations,
    };

    this.playbooks.set(playbook.id, playbook);
    return playbook;
  }
}

export const playbookRegistry: PlaybookRegistry = new PlaybookRegistryImpl();
