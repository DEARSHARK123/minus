'use client';

import React from 'react';
import type { LucideProps } from 'lucide-react';
import { BarChart3, BookOpen, Bug, Code, Dna, Pencil, Plug, Search, SearchCode, Zap } from 'lucide-react';

const iconMap = {
  code: Code,
  barChart: BarChart3,
  search: Search,
  searchCode: SearchCode,
  plug: Plug,
  pencil: Pencil,
  bug: Bug,
  bookOpen: BookOpen,
  dna: Dna,
  zap: Zap,
};

export type PlaybookIconName = keyof typeof iconMap;

interface PlaybookIconProps extends Omit<LucideProps, 'ref'> {
  name: string;
}

export function PlaybookIcon({ name, ...props }: PlaybookIconProps): React.ReactElement {
  const Icon = (iconMap as Record<string, React.ComponentType<LucideProps>>)[name] || Zap;
  return <Icon {...props} />;
}
