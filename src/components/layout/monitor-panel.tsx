'use client';

import { useState, useMemo } from 'react';
import { X, Eye, Code, Terminal, Activity, Zap, ListOrdered } from 'lucide-react';
import { CodePreview } from '../monitor/code-preview';
import { Terminal as TerminalComponent } from '../monitor/terminal';
import { WorkspacePanel } from '../workspace/workspace-panel';
import { TaskManager } from '../agent/task-manager';
import { ExecutionTimeline } from '../ui/execution-timeline';
import { useAgentStore } from '@/store/agent-store';
import { iconSizes } from '@/lib/icons';

interface MonitorPanelProps {
  onClose?: () => void;
}

export function MonitorPanel({ onClose }: MonitorPanelProps) {
  const [activeTab, setActiveTab] = useState('workspace');

  const artifacts = useAgentStore(s => s.state.artifacts);
  const toolCalls = useAgentStore(s => s.state.toolCalls);
  const agentPlan = useAgentStore(s => s.state.plan);
  const agentCurrentStep = useAgentStore(s => s.state.currentStep);
  const agentStatus = useAgentStore(s => s.state.status);
  const executionSteps = useAgentStore(s => s.state.executionSteps || []);

  const tabs = [
    { id: 'workspace', label: 'Workspace', icon: Eye },
    { id: 'code', label: 'Code', icon: Code },
    { id: 'terminal', label: 'Terminal', icon: Terminal },
    { id: 'activity', label: 'Activity', icon: Activity },
    { id: 'timeline', label: 'Timeline', icon: ListOrdered },
  ];

  const terminalLines = useMemo(() =>
    toolCalls.map((tc) => ({
      id: tc.id,
      type: tc.status === 'failed' ? 'error' as const :
            tc.status === 'completed' ? 'success' as const : 'output' as const,
      content: tc.status === 'completed'
        ? `$ ${tc.toolName} → ${tc.result?.slice(0, 80) || 'OK'}`
        : tc.status === 'failed'
        ? `$ ${tc.toolName} → ERROR: ${tc.result || 'Unknown error'}`
        : `$ ${tc.toolName} [${tc.status}]...`,
      timestamp: new Date(),
    })),
    [toolCalls]
  );

  const codeArtifacts = useMemo(() =>
    artifacts.filter(a => a.type === 'code'),
    [artifacts]
  );

  return (
    <aside className="w-[360px] bg-[var(--bg-primary)]/80 backdrop-blur-sm border-l border-[var(--border)] flex flex-col">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)]">
        <div className="flex gap-1 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors duration-200 whitespace-nowrap ${
                activeTab === tab.id
                  ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)] border border-[var(--border)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]/50'
              }`}
            >
              <tab.icon size={iconSizes.sm} aria-hidden />
              {tab.label}
              {tab.id === 'workspace' && artifacts.length > 0 && (
                <span className="ml-1 px-1.5 py-0.5 bg-[var(--accent)]/20 text-[var(--accent)] font-tech text-[10px] rounded-full">
                  {artifacts.length}
                </span>
              )}
            </button>
          ))}
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="p-1 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]/50 transition-colors duration-200 ml-2"
            aria-label="Close monitor panel"
            title="Close monitor panel"
          >
            <X size={iconSizes.md} aria-hidden />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-hidden">
        {activeTab === 'workspace' && (
          <WorkspacePanel
            artifacts={artifacts}
            onClose={() => {}}
          />
        )}

        {activeTab === 'code' && (
          <div className="h-full overflow-y-auto p-3">
            {codeArtifacts.length > 0 ? (
              codeArtifacts.map(artifact => (
                <div key={artifact.id} className="mb-3">
                  <CodePreview
                    code={artifact.content}
                    language="python"
                    title={artifact.name}
                  />
                </div>
              ))
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center p-6">
                <Code size={iconSizes['2xl']} className="text-[var(--text-muted)]/40 mb-3" aria-hidden />
                <p className="font-zh text-sm text-[var(--text-secondary)]">No code artifacts yet</p>
                <p className="font-tech text-xs text-[var(--text-muted)] mt-1">
                  Code will appear here when the agent generates scripts
                </p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'terminal' && (
          <div className="h-full overflow-y-auto p-3">
            <TerminalComponent
              initialLines={terminalLines.length > 0 ? terminalLines : [
                {
                  id: 'welcome',
                  type: 'output',
                  content: 'Minus Agent Terminal — ready for execution',
                  timestamp: new Date(),
                },
              ]}
            />
          </div>
        )}

        {activeTab === 'activity' && (
          <div className="h-full overflow-y-auto p-3 space-y-2">
            <TaskManager
              steps={agentPlan}
              currentStep={agentCurrentStep}
              status={agentStatus}
            />
            {toolCalls.length > 0 ? (
              toolCalls.map((tc) => (
                <div
                  key={tc.id}
                  className={`p-3 border transition-colors ${
                    tc.status === 'completed' ? 'border-[var(--success-border)] bg-[var(--success-bg)]' :
                    tc.status === 'failed' ? 'border-[var(--error-border)] bg-[var(--error-bg)]' :
                    tc.status === 'running' ? 'border-[var(--accent)]/30 bg-[var(--accent)]/5' :
                    'border-[var(--border-20)]'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Zap size={iconSizes.sm} className={
                      tc.status === 'completed' ? 'text-[var(--success)]' :
                      tc.status === 'failed' ? 'text-[var(--error)]' :
                      tc.status === 'running' ? 'text-[var(--accent)] animate-pulse' :
                      'text-[var(--text-muted)]/40'
                    } aria-hidden />
                    <span className="font-tech text-xs font-bold text-[var(--text-primary)]">{tc.toolName}</span>
                    <span className={`font-tech text-[10px] px-1.5 py-0.5 rounded-full ${
                      tc.status === 'completed' ? 'bg-[var(--success)]/20 text-[var(--success)]' :
                      tc.status === 'failed' ? 'bg-[var(--error)]/20 text-[var(--error)]' :
                      tc.status === 'running' ? 'bg-[var(--accent)]/20 text-[var(--accent)]' :
                      'bg-[var(--accent)]/10 text-[var(--text-muted)]'
                    }`}>
                      {tc.status}
                    </span>
                  </div>
                  {tc.result && (
                    <p className="font-tech text-xs text-[var(--text-secondary)] mt-1 truncate">
                      {tc.result.slice(0, 120)}
                    </p>
                  )}
                </div>
              ))
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center p-6">
                <Activity size={iconSizes['2xl']} className="text-[var(--text-muted)]/40 mb-3" aria-hidden />
                <p className="font-zh text-sm text-[var(--text-secondary)]">No activity yet</p>
                <p className="font-tech text-xs text-[var(--text-muted)] mt-1">
                  Tool calls will appear here during agent execution
                </p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'timeline' && (
          <div className="h-full overflow-y-auto p-3">
            <ExecutionTimeline steps={executionSteps} />
          </div>
        )}
      </div>
    </aside>
  );
}
