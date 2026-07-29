'use client';

import { Library, Calendar, Video, History, Sparkles } from 'lucide-react';
import { type AppView } from '@/store/ui-store';

interface StubViewProps {
  view: Exclude<AppView, 'home' | 'session'>;
}

const STUB_CONFIG: Record<
  Exclude<AppView, 'home' | 'session'>,
  {
    title: string;
    description: string;
    icon: typeof Library;
  }
> = {
  library: {
    title: '资料库',
    description: '文档与素材即将接入',
    icon: Library,
  },
  calendar: {
    title: '日历',
    description: '学习规划与日程即将接入',
    icon: Calendar,
  },
  video: {
    title: '视频',
    description: '网课资料即将接入',
    icon: Video,
  },
  history: {
    title: '历史',
    description: '对话与学习轨迹即将接入',
    icon: History,
  },
};

export function StubView({ view }: StubViewProps) {
  const config = STUB_CONFIG[view] || STUB_CONFIG.library;
  const Icon = config.icon;

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 relative overflow-hidden bg-[var(--bg-secondary)] min-h-[400px]">
      {/* Background blueprint grid */}
      <div className="absolute inset-0 blueprint-grid opacity-15 pointer-events-none [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_70%)]" />

      {/* Decorative floating lights */}
      <div className="absolute w-96 h-96 -top-48 -left-48 rounded-full bg-[var(--accent)]/5 blur-[120px] pointer-events-none" />
      <div className="absolute w-96 h-96 -bottom-48 -right-48 rounded-full bg-[var(--accent)]/5 blur-[120px] pointer-events-none" />

      {/* Content Card */}
      <div className="relative z-10 flex flex-col items-center max-w-md text-center p-8 bg-[var(--bg-primary)]/80 backdrop-blur-md border border-[var(--border-20)] shadow-lg hover:border-[var(--border-40)] transition-all duration-300 animate-fade-in group">
        {/* Glow behind icon */}
        <div className="absolute -inset-0.5 rounded-none bg-gradient-to-r from-[var(--accent)]/20 to-[var(--accent)]/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500 blur-sm -z-10" />

        {/* Floating icon */}
        <div className="w-16 h-16 mb-6 rounded-full bg-[var(--bg-tertiary)] border border-[var(--border)] flex items-center justify-center text-[var(--accent)] shadow-inner group-hover:scale-110 transition-transform duration-300 relative">
          <Icon className="w-8 h-8 animate-pulse-glow" aria-hidden />
          <div className="absolute -top-1 -right-1">
            <Sparkles className="w-4 h-4 text-[var(--accent)]/60 animate-bounce" />
          </div>
        </div>

        {/* Text */}
        <h2 className="font-classic text-2xl font-bold tracking-wider text-[var(--text-primary)] mb-3">
          {config.title}
        </h2>
        
        <p className="font-zh text-sm text-[var(--text-secondary)] leading-relaxed px-4 py-2 border-y border-[var(--border-20)] bg-[var(--bg-secondary)]/30 font-medium">
          {config.description}
        </p>

        <div className="mt-6 flex items-center gap-2 text-[10px] font-tech text-[var(--text-muted)] tracking-wider uppercase">
          <span>Feature Preview</span>
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-ping" />
          <span>即将推出</span>
        </div>
      </div>
    </div>
  );
}
