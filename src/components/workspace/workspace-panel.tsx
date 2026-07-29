'use client';

import { useState } from 'react';
import { FileText, Download, Eye, X, Maximize2, Minimize2 } from 'lucide-react';
import { ArtifactIcon, iconSizes } from '@/lib/icons';
import { Artifact } from '@/types/agent';

interface WorkspacePanelProps {
  artifacts: Artifact[];
  onClose: () => void;
}

export function WorkspacePanel({ artifacts, onClose }: WorkspacePanelProps) {
  const [selectedArtifact, setSelectedArtifact] = useState<Artifact | null>(null);
  const [isMaximized, setIsMaximized] = useState(false);

  const getIcon = (type: Artifact['type']) => (
    <ArtifactIcon type={type} size={iconSizes.md} className={
      type === 'image' ? 'text-[var(--success)]' :
      type === 'data' ? 'text-[var(--warning)]' :
      'text-[var(--accent)]'
    } aria-hidden />
  );

  if (artifacts.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center p-8">
        <div className="w-16 h-16 border border-[var(--border)] bg-[var(--bg-tertiary)] flex items-center justify-center mb-4">
          <FileText size={iconSizes.xl} className="text-[var(--accent)]" aria-hidden />
        </div>
        <h3 className="font-classic text-sm tracking-widest text-[var(--text-secondary)] uppercase mb-2">
          Workspace
        </h3>
        <p className="font-zh text-xs text-[var(--text-muted)]">
          Artifacts will appear here when the agent generates files, code, or data.
        </p>
      </div>
    );
  }

  return (
    <div className={`h-full flex flex-col ${isMaximized ? 'fixed inset-0 z-50 bg-[var(--bg-primary)]' : ''}`}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
        <div className="flex items-center gap-2">
          <span className="font-tech text-xs tracking-wider text-[var(--text-secondary)] uppercase">
            Artifacts
          </span>
          <span className="font-tech text-xs text-[var(--accent)]">({artifacts.length})</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsMaximized(!isMaximized)}
            className="p-1.5 text-[var(--accent)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]/50 transition-colors"
            aria-label={isMaximized ? 'Restore panel' : 'Maximize panel'}
          >
            {isMaximized ? <Minimize2 size={iconSizes.sm} aria-hidden /> : <Maximize2 size={iconSizes.sm} aria-hidden />}
          </button>
          <button
            onClick={onClose}
            className="p-1.5 text-[var(--accent)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]/50 transition-colors"
            aria-label="Close workspace panel"
          >
            <X size={iconSizes.sm} aria-hidden />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden flex">
        <div className="w-48 border-r border-[var(--border-20)] overflow-y-auto">
          {artifacts.map((artifact) => (
            <button
              key={artifact.id}
              onClick={() => setSelectedArtifact(artifact)}
              className={`w-full flex items-center gap-2 px-3 py-2.5 text-left transition-colors ${
                selectedArtifact?.id === artifact.id
                  ? 'bg-[var(--accent)]/10 border-r-2 border-[var(--accent)]'
                  : 'hover:bg-[var(--bg-tertiary)]/30'
              }`}
            >
              {getIcon(artifact.type)}
              <span className="font-tech text-xs text-[var(--text-primary)] truncate">{artifact.name}</span>
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {selectedArtifact ? (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h4 className="font-zh text-sm font-bold text-[var(--text-primary)]">{selectedArtifact.name}</h4>
                <div className="flex gap-1">
                  <button
                    className="p-1.5 text-[var(--accent)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]/50 transition-colors"
                    aria-label="Preview artifact"
                  >
                    <Eye size={iconSizes.sm} aria-hidden />
                  </button>
                  <button
                    className="p-1.5 text-[var(--accent)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]/50 transition-colors"
                    aria-label="Download artifact"
                  >
                    <Download size={iconSizes.sm} aria-hidden />
                  </button>
                </div>
              </div>
              {selectedArtifact.type === 'code' ? (
                <pre className="p-4 bg-[var(--text-primary)] text-[var(--bg-primary)] font-tech text-sm overflow-x-auto">
                  <code>{selectedArtifact.content}</code>
                </pre>
              ) : selectedArtifact.type === 'image' ? (
                <div className="border border-[var(--border)] p-4 text-center">
                  <ArtifactIcon type="image" size={iconSizes.hero} className="mx-auto text-[var(--accent)] mb-2" aria-hidden />
                  <p className="font-tech text-xs text-[var(--accent)]">{selectedArtifact.name}</p>
                </div>
              ) : (
                <pre className="p-4 bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] font-tech text-sm overflow-x-auto whitespace-pre-wrap">
                  {selectedArtifact.content}
                </pre>
              )}
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-[var(--text-muted)]">
              <p className="font-zh text-sm">Select an artifact to preview</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
