import React from 'react';
import type { LucideProps } from 'lucide-react';
import {
  BarChart3,
  CheckCircle2,
  Circle,
  Code,
  Database,
  File,
  FileCode,
  FileImage,
  FileJson,
  FileText,
  FileType,
  Folder,
  Hourglass,
  Image,
  Loader2,
  Search,
  Terminal,
  UserCircle,
  Wrench,
  XCircle,
} from 'lucide-react';

export const iconSizes = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
  xl: 24,
  '2xl': 32,
  hero: 48,
} as const;

const toolIconMap: Record<string, React.ComponentType<LucideProps>> = {
  code_executor: Terminal,
  web_search: Search,
  file_manager: Folder,
  data_analyzer: BarChart3,
  ask_human: UserCircle,
};

export function ToolIcon({
  tool,
  ...props
}: { tool?: string } & LucideProps): React.ReactElement {
  const Icon = toolIconMap[tool || ''] || Wrench;
  return <Icon {...props} />;
}

const artifactIconMap: Record<string, React.ComponentType<LucideProps>> = {
  code: Code,
  image: Image,
  data: Database,
  file: FileText,
};

export function ArtifactIcon({
  type,
  ...props
}: { type?: string } & LucideProps): React.ReactElement {
  const Icon = artifactIconMap[type || ''] || FileText;
  return <Icon {...props} />;
}

const fileExtensionIconMap: Record<string, React.ComponentType<LucideProps>> = {
  js: FileCode,
  jsx: FileCode,
  ts: FileCode,
  tsx: FileCode,
  py: FileCode,
  html: FileCode,
  css: FileType,
  json: FileJson,
  md: FileText,
  txt: FileText,
  png: FileImage,
  jpg: FileImage,
  jpeg: FileImage,
  gif: FileImage,
  svg: FileImage,
};

export function FileIcon({
  name,
  ...props
}: { name: string } & LucideProps): React.ReactElement {
  const ext = name.split('.').pop()?.toLowerCase();
  const Icon = ext ? fileExtensionIconMap[ext] || File : File;
  return <Icon {...props} />;
}

const statusIconMap: Record<
  'pending' | 'running' | 'completed' | 'failed' | 'waiting',
  { icon: React.ComponentType<LucideProps>; animate?: boolean }
> = {
  pending: { icon: Circle },
  running: { icon: Loader2, animate: true },
  completed: { icon: CheckCircle2 },
  failed: { icon: XCircle },
  waiting: { icon: Hourglass },
};

export function StatusIcon({
  status,
  ...props
}: { status: string } & LucideProps): React.ReactElement {
  const config = statusIconMap[status as keyof typeof statusIconMap] || statusIconMap.pending;
  const className = [props.className || '', config.animate ? 'animate-spin' : '']
    .filter(Boolean)
    .join(' ');
  const Icon = config.icon;
  return <Icon {...props} className={className} />;
}
