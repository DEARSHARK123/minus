export interface Playbook {
  id: string;
  name: string;
  description: string;
  category: PlaybookCategory;
  icon: PlaybookIconName;
  tags: string[];
  prompt: string;
  tools: string[];
  steps: PlaybookStep[];
  createdAt: Date;
  updatedAt: Date;
  usageCount: number;
  rating: number;
}

export interface PlaybookStep {
  id: string;
  title: string;
  description: string;
  tool?: string;
  parameters?: Record<string, unknown>;
  order: number;
}

export type PlaybookCategory =
  | 'featured'
  | 'business'
  | 'creative'
  | 'sales_marketing'
  | 'education'
  | 'life';

export type PlaybookIconName =
  | 'code'
  | 'barChart'
  | 'search'
  | 'searchCode'
  | 'plug'
  | 'pencil'
  | 'bug'
  | 'bookOpen'
  | 'dna'
  | 'zap';

export interface PlaybookTemplate {
  id: string;
  name: string;
  description: string;
  category: PlaybookCategory;
  icon: PlaybookIconName;
  tags: string[];
  prompt: string;
  tools: string[];
  steps: Omit<PlaybookStep, 'id'>[];
}

export interface PlaybookRegistry {
  register(template: PlaybookTemplate): void;
  get(id: string): Playbook | undefined;
  getAll(): Playbook[];
  getByCategory(category: PlaybookCategory): Playbook[];
  search(query: string): Playbook[];
  createFromTemplate(templateId: string, customizations?: Partial<Playbook>): Playbook;
}
