'use client';

import { Folder, ChevronRight, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { FileIcon, iconSizes } from '@/lib/icons';

interface FileItem {
  id: string;
  name: string;
  type: 'file' | 'folder';
  path: string;
  size?: number;
  modified?: Date;
  children?: FileItem[];
}

interface FileViewerProps {
  files: FileItem[];
  onFileSelect?: (file: FileItem) => void;
  onFileDelete?: (file: FileItem) => void;
}

export function FileViewer({ files, onFileSelect, onFileDelete }: FileViewerProps) {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  const toggleFolder = (folderId: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return '-';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const renderItem = (item: FileItem, depth: number = 0) => {
    const isExpanded = expandedFolders.has(item.id);
    const indent = depth * 16;
    return (
      <div key={item.id}>
        <div
          className={`group flex items-center gap-2 py-2 px-3 cursor-pointer hover:bg-[var(--bg-tertiary)]/50 transition-colors duration-150 ${
            item.type === 'file' ? 'text-[var(--text-secondary)]' : 'text-[var(--text-primary)]'
          }`}
          style={{ paddingLeft: `${indent + 12}px` }}
          onClick={() => {
            if (item.type === 'folder') {
              toggleFolder(item.id);
            } else {
              onFileSelect?.(item);
            }
          }}
        >
          {item.type === 'folder' && (
            <ChevronRight
              size={iconSizes.sm}
              className={`text-[var(--text-muted)] transition-transform duration-200 ${
                isExpanded ? 'rotate-90' : ''
              }`}
              aria-hidden
            />
          )}
          {item.type === 'file' && <div className="w-3.5" aria-hidden />}

          {item.type === 'folder' ? (
            <Folder size={iconSizes.sm} className="text-[var(--accent)]" aria-hidden />
          ) : (
            <FileIcon name={item.name} size={iconSizes.sm} className="text-[var(--accent)]" aria-hidden />
          )}
          <span className="font-zh text-sm flex-1 truncate">{item.name}</span>

          {item.type === 'file' && (
            <span className="font-tech text-xs text-[var(--text-muted)]">
              {formatFileSize(item.size)}
            </span>
          )}

          {item.type === 'file' && onFileDelete && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onFileDelete(item);
              }}
              className="p-1 text-[var(--text-muted)] hover:text-red-500 transition-colors duration-200 opacity-0 group-hover:opacity-100"
              aria-label={`Delete ${item.name}`}
              title={`Delete ${item.name}`}
            >
              <Trash2 size={iconSizes.sm} aria-hidden />
            </button>
          )}
        </div>

        {item.type === 'folder' && isExpanded && item.children && (
          <div>
            {item.children.map(child => renderItem(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="rounded-lg border border-[var(--border)] overflow-hidden">
      <div className="px-4 py-3 bg-[var(--bg-primary)] border-b border-[var(--border)]">
        <div className="flex items-center gap-2">
          <Folder size={iconSizes.md} className="text-[var(--accent)]" aria-hidden />
          <span className="font-zh text-sm font-bold text-[var(--text-primary)]">文件管理</span>
          <span className="font-tech text-xs text-[var(--text-muted)]">
            ({files.length} 项目)
          </span>
        </div>
      </div>

      <div className="divide-y divide-[var(--border-20)]">
        {files.length === 0 ? (
          <div className="p-8 text-center">
            <FileIcon name="" size={iconSizes['2xl']} className="mx-auto text-[var(--text-muted)]/30 mb-2" aria-hidden />
            <p className="font-zh text-sm text-[var(--text-muted)]">暂无文件</p>
          </div>
        ) : (
          files.map(file => renderItem(file))
        )}
      </div>
    </div>
  );
}
