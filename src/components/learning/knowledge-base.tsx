'use client';

/**
 * UX06 — Library as file/folder workspace.
 * Search · New · folders · file thumbnails · empty upload/create only.
 * Hide chunks / sourceQuality / duplicateId / File.text on primary surface.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FileText,
  Folder,
  FolderPlus,
  Search,
  Upload,
  X,
} from 'lucide-react';
import { iconSizes } from '@/lib/icons';
import { useLearningStore } from '@/store/learning-store';
import { useUIStore } from '@/store/ui-store';
import { useChatStore } from '@/store/chat-store';
import {
  EmptyState,
  ErrorBanner,
  PrimaryButton,
  SecondaryButton,
} from './shared';
import { PendingSuggestionsPanel } from './pending-suggestions-panel';
import { EntityActionsMenu } from '@/components/ui/entity-actions-menu';
import {
  DOCUMENT_PRIMARY_ACTIONS,
  buildAdvancedDocumentDetail,
  buildDocumentActionPrompt,
  buildLibraryEmptyState,
  documentActionById,
  filterDocumentsBySearch,
  parsePhaseLabel,
  phaseFromImportAnalysis,
  shouldInterruptForBackground,
  successToastMessage,
  toLibraryListItem,
  type DocumentActionId,
  type LibraryParsePhase,
} from '@/lib/learning/library-ui';
import { setComposerPrefill } from '@/lib/chat/composer-prefill';
import type { SourceDocument } from '@/types/learning';
import {
  clearEntitySelection,
  peekEntitySelection,
  subscribeEntitySelection,
  type EntitySelection,
} from '@/lib/navigation/entity-selection';

export function KnowledgeBase() {
  const data = useLearningStore((s) => s.data);
  const loading = useLearningStore((s) => s.loading);
  const error = useLearningStore((s) => s.error);
  const clearError = useLearningStore((s) => s.clearError);
  const selectedCourseId = useLearningStore((s) => s.selectedCourseId);
  const setSelectedCourseId = useLearningStore((s) => s.setSelectedCourseId);
  const importDocument = useLearningStore((s) => s.importDocument);
  const importTimetable = useLearningStore((s) => s.importTimetable);
  const createCourse = useLearningStore((s) => s.createCourse);
  const renameCourse = useLearningStore((s) => s.renameCourse);
  const archiveCourse = useLearningStore((s) => s.archiveCourse);
  const deleteCourse = useLearningStore((s) => s.deleteCourse);
  const renameDocument = useLearningStore((s) => s.renameDocument);
  const deleteDocument = useLearningStore((s) => s.deleteDocument);
  const confirmTask = useLearningStore((s) => s.confirmTask);
  const rejectSuggestion = useLearningStore((s) => s.rejectSuggestion);
  const confirmImportSuggestion = useLearningStore((s) => s.confirmImportSuggestion);
  const rejectImportSuggestion = useLearningStore((s) => s.rejectImportSuggestion);

  const setActiveAppView = useUIStore((s) => s.setActiveAppView);
  const openDraft = useChatStore((s) => s.openDraft);

  const [search, setSearch] = useState('');
  const [showNewMenu, setShowNewMenu] = useState(false);
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [showPasteImport, setShowPasteImport] = useState(false);
  const [folderTitle, setFolderTitle] = useState('');
  const [docTitle, setDocTitle] = useState('');
  const [docContent, setDocContent] = useState('');
  const [docFormat, setDocFormat] = useState<'markdown' | 'txt'>('markdown');
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [parsePhase, setParsePhase] = useState<LibraryParsePhase>('idle');
  const [toast, setToast] = useState<string | null>(null);
  const [pendingDecisionCount, setPendingDecisionCount] = useState(0);
  const [pendingUploadFile, setPendingUploadFile] = useState<File | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);

  const courses = data.courses;
  const courseId = selectedCourseId || courses[0]?.id || null;

  const allDocuments = data.documents;
  const folderDocuments = useMemo(
    () =>
      courseId
        ? allDocuments.filter((d) => d.courseId === courseId)
        : allDocuments,
    [allDocuments, courseId],
  );

  const documents = useMemo(
    () => filterDocumentsBySearch(folderDocuments, search),
    [folderDocuments, search],
  );

  const listItems = useMemo(
    () => documents.map((d) => toLibraryListItem(d)),
    [documents],
  );

  const selectedDoc: SourceDocument | null = useMemo(() => {
    if (!selectedDocId) return null;
    return allDocuments.find((d) => d.id === selectedDocId) || null;
  }, [selectedDocId, allDocuments]);

  const currentGoalId = useMemo(() => {
    const goals = data.goals.filter((g) => g.courseId === courseId);
    return [...goals].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
      ?.id;
  }, [data.goals, courseId]);

  useEffect(() => {
    const reveal = (selection: EntitySelection): boolean => {
      if (selection.kind === 'document') {
        const documentMatch = allDocuments.find((item) => item.id === selection.id);
        if (!documentMatch) return false;
        setSelectedCourseId(documentMatch.courseId);
        setSelectedDocId(documentMatch.id);
        setShowAdvanced(false);
        window.setTimeout(() => {
          document
            .querySelector(`[data-testid="library-file-${selection.id}"]`)
            ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 120);
        clearEntitySelection(selection);
        return true;
      }
      if (selection.kind === 'course') {
        if (!courses.some((course) => course.id === selection.id)) return false;
        setSelectedCourseId(selection.id);
        setSelectedDocId(null);
        window.setTimeout(() => {
          document
            .querySelector(`[data-testid="library-folder-${selection.id}"]`)
            ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 120);
        clearEntitySelection(selection);
        return true;
      }
      return false;
    };

    const pendingDocument = peekEntitySelection('document');
    const pendingCourse = peekEntitySelection('course');
    if (pendingDocument) reveal(pendingDocument);
    if (pendingCourse) reveal(pendingCourse);
    return subscribeEntitySelection((selection) => {
      reveal(selection);
    });
  }, [allDocuments, courses, setSelectedCourseId]);

  const emptyState = buildLibraryEmptyState({
    courses,
    documents: allDocuments,
  });

  const showStatusStrip =
    parsePhase !== 'idle' &&
    (parsePhase === 'uploading' ||
      parsePhase === 'processing' ||
      parsePhase === 'error' ||
      shouldInterruptForBackground(parsePhase));

  const flashToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3200);
  };

  const handleCreateFolder = async () => {
    if (!folderTitle.trim()) return;
    try {
      const created = await createCourse(folderTitle.trim());
      setSelectedCourseId(created.id);
      setFolderTitle('');
      setShowCreateFolder(false);
      setShowNewMenu(false);
      flashToast(successToastMessage('folder'));
      if (pendingUploadFile) {
        const file = pendingUploadFile;
        setPendingUploadFile(null);
        await handleFileImport(file, created.id);
      }
    } catch {
      /* store error */
    }
  };

  const handleRenameFolder = async (id: string, currentTitle: string) => {
    const next = window.prompt('新的文件夹名称', currentTitle)?.trim();
    if (!next || next === currentTitle) return;
    try {
      await renameCourse(id, next);
      flashToast('文件夹已重命名');
    } catch {
      /* store error */
    }
  };

  const handleArchiveFolder = async (
    id: string,
    title: string,
    archived: boolean,
  ) => {
    if (archived) {
      if (!window.confirm(`恢复文件夹「${title}」？`)) return;
    } else if (
      !window.confirm(
        `归档「${title}」？归档后侧栏「学习课程」将不再显示，可在此管理。`,
      )
    ) {
      return;
    }
    try {
      await archiveCourse(id, !archived);
      flashToast(archived ? '文件夹已恢复' : '文件夹已归档');
    } catch {
      /* store error */
    }
  };

  const handleDeleteFolder = async (id: string, title: string) => {
    // Secondary confirmation for cascade delete (shared EntityAction schema).
    if (!window.confirm(`删除文件夹「${title}」？`)) return;
    if (
      !window.confirm(
        `将一并删除该文件夹下的文档与关联学习数据，且不可撤销。确认删除？`,
      )
    ) {
      return;
    }
    try {
      await deleteCourse(id, { confirmCascade: true });
      if (selectedDocId) {
        const still = useLearningStore
          .getState()
          .data.documents.some((d) => d.id === selectedDocId);
        if (!still) setSelectedDocId(null);
      }
      flashToast('文件夹已删除');
    } catch {
      /* store error */
    }
  };

  const handleRenameDoc = async (id: string, currentTitle: string) => {
    const next = window.prompt('新的文档名称', currentTitle)?.trim();
    if (!next || next === currentTitle) return;
    try {
      await renameDocument(id, next);
      flashToast('文档已重命名');
    } catch {
      /* store error */
    }
  };

  const handleDeleteDoc = async (id: string, title: string) => {
    if (!window.confirm(`删除文档「${title}」？此操作不可撤销。`)) return;
    try {
      await deleteDocument(id);
      if (selectedDocId === id) setSelectedDocId(null);
      flashToast('文档已删除');
    } catch {
      /* store error */
    }
  };

  const runImport = async (
    payload: {
      title: string;
      format: 'markdown' | 'txt';
      content: string;
    },
    targetCourseId?: string | null,
  ) => {
    const destinationCourseId = targetCourseId || courseId;
    if (!destinationCourseId) {
      // Need a folder first — open create
      setShowCreateFolder(true);
      setParsePhase('idle');
      return;
    }
    setParsePhase('processing');
    try {
      const result = await importDocument({
        courseId: destinationCourseId,
        title: payload.title,
        format: payload.format,
        content: payload.content,
        currentGoalId,
      });
      const pending = result.suggestions?.filter((s) => s.status === 'pending')
        .length ?? 0;
      setPendingDecisionCount(pending);
      const phase = phaseFromImportAnalysis({
        isDuplicate: result.analysis?.isDuplicate,
        pendingSuggestionCount: pending,
      });
      setParsePhase(phase);
      setDocTitle('');
      setDocContent('');
      setShowPasteImport(false);
      setShowNewMenu(false);
      if (result.document?.id) {
        setSelectedDocId(result.document.id);
      }
      flashToast(successToastMessage('document'));
      // Success path: clear non-interrupt phases after a beat
      if (!shouldInterruptForBackground(phase)) {
        window.setTimeout(() => setParsePhase('idle'), 1600);
      }
    } catch {
      setParsePhase('error');
    }
  };

  const handleFileImport = async (file: File, targetCourseId?: string) => {
    const name = file.name.toLowerCase();
    const supportedTextFile = /\.(md|markdown|txt|py|js|jsx|ts|tsx|java|c|cpp|h|hpp|go|rs|json|ya?ml|toml|sql|sh|ps1|html|css)$/i.test(
      name,
    );
    if (!supportedTextFile) {
      useLearningStore.setState({
        error: '目前支持 Markdown、纯文本与常见代码文件；PDF / Word 解析尚未开放。',
      });
      return;
    }
    const destinationCourseId = targetCourseId || courseId;
    if (!destinationCourseId) {
      setPendingUploadFile(file);
      setShowCreateFolder(true);
      return;
    }
    setParsePhase('uploading');
    const format: 'markdown' | 'txt' =
      name.endsWith('.md') || name.endsWith('.markdown') ? 'markdown' : 'txt';
    // Read content only — never expose File.text / path in UI
    const content = await file.text();
    const title =
      docTitle.trim() ||
      file.name.replace(
        /\.(md|markdown|txt|py|js|jsx|ts|tsx|java|c|cpp|h|hpp|go|rs|json|ya?ml|toml|sql|sh|ps1|html|css)$/i,
        '',
      );
    await runImport({ title, format, content }, destinationCourseId);
  };

  const handleManualImport = async () => {
    if (!docContent.trim()) return;
    await runImport({
      title: docTitle.trim() || '未命名文档',
      format: docFormat,
      content: docContent,
    });
  };

  const handleCsvImport = async (text: string) => {
    if (!courseId || !text.trim()) return;
    setParsePhase('processing');
    try {
      await importTimetable(courseId, text);
      setParsePhase('success');
      flashToast(successToastMessage('timetable'));
      window.setTimeout(() => setParsePhase('idle'), 1600);
    } catch {
      setParsePhase('error');
    }
  };

  const handleDocumentAction = (actionId: DocumentActionId) => {
    if (!selectedDoc) return;
    const action = documentActionById(actionId);
    const prompt = buildDocumentActionPrompt(actionId, selectedDoc);
    setComposerPrefill({
      text: prompt,
      mode: action.mode,
      source: 'library',
    });
    openDraft();
    setActiveAppView('home');
  };

  // ── Empty library: upload / create only ──────────────────────────
  if (emptyState.isEmpty) {
    return (
      <div className="flex-1 overflow-y-auto" data-testid="library-empty">
        <input
          ref={fileInputRef}
          type="file"
          className="sr-only"
          accept=".md,.markdown,.txt,.py,.js,.jsx,.ts,.tsx,.java,.c,.cpp,.h,.hpp,.go,.rs,.json,.yaml,.yml,.toml,.sql,.sh,.ps1,.html,.css,text/plain,text/markdown"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void handleFileImport(file);
            event.currentTarget.value = '';
          }}
          aria-label="选择要上传的资料文件"
          data-testid="library-empty-file-input"
        />
        {error && (
          <div className="p-4">
            <ErrorBanner message={error} onDismiss={clearError} />
          </div>
        )}
        {toast && (
          <div
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 border border-[var(--accent)] bg-[var(--bg-primary)] text-[var(--text-primary)] font-zh text-sm shadow-lg"
            role="status"
            data-testid="library-toast"
          >
            {toast}
          </div>
        )}
        {!showCreateFolder ? (
          <EmptyState
            icon={<Folder size={iconSizes['2xl']} aria-hidden />}
            title={emptyState.title}
            description={emptyState.description}
            action={
              <div className="space-y-2 text-center">
                <div className="flex flex-wrap gap-2 justify-center">
                  <PrimaryButton
                    onClick={() => setShowCreateFolder(true)}
                    aria-label="新建文件夹"
                  >
                    <FolderPlus size={iconSizes.sm} aria-hidden />
                    新建
                  </PrimaryButton>
                  <SecondaryButton
                    onClick={() => fileInputRef.current?.click()}
                    aria-label="上传资料"
                  >
                    <Upload size={iconSizes.sm} aria-hidden />
                    上传
                  </SecondaryButton>
                </div>
                <p className="font-zh text-[11px] text-[var(--text-muted)]">
                  支持 Markdown、文本和常见代码文件；PDF / Word 暂未开放
                </p>
              </div>
            }
          />
        ) : (
          <div className="max-w-md mx-auto px-6 py-12">
            <section className="surface-card p-5 space-y-3">
              <h2 className="font-zh text-sm font-bold text-[var(--text-primary)]">
                {pendingUploadFile ? '先创建资料文件夹' : '新建文件夹'}
              </h2>
              {pendingUploadFile && (
                <p className="font-zh text-xs text-[var(--text-muted)]">
                  创建后将自动继续上传「{pendingUploadFile.name}」。
                </p>
              )}
              <input
                value={folderTitle}
                onChange={(e) => setFolderTitle(e.target.value)}
                placeholder="名称"
                className="w-full min-h-[44px] rounded-xl bg-[var(--surface-soft)] border border-[var(--border-20)] px-3 py-2 font-zh text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                aria-label="文件夹名称"
                onKeyDown={(e) => e.key === 'Enter' && void handleCreateFolder()}
              />
              <div className="flex gap-2">
                <PrimaryButton
                  onClick={() => void handleCreateFolder()}
                  disabled={loading || !folderTitle.trim()}
                >
                  创建
                </PrimaryButton>
                <SecondaryButton
                  onClick={() => {
                    setPendingUploadFile(null);
                    setShowCreateFolder(false);
                    setParsePhase('idle');
                  }}
                >
                  取消
                </SecondaryButton>
              </div>
            </section>
          </div>
        )}
      </div>
    );
  }

  // ── Workspace ────────────────────────────────────────────────────
  return (
    <div className="flex-1 overflow-y-auto" data-testid="library-workspace">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-5 sm:py-6 space-y-5">
        {error && <ErrorBanner message={error} onDismiss={clearError} />}

        {toast && (
          <div
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 border border-[var(--accent)] bg-[var(--bg-primary)] text-[var(--text-primary)] font-zh text-sm shadow-lg"
            role="status"
            data-testid="library-toast"
          >
            {toast}
          </div>
        )}

        {/* Toolbar: search + New */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[180px]">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
              aria-hidden
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索资料…"
              className="w-full min-h-[44px] rounded-xl bg-[var(--surface)] border border-[var(--border-20)] pl-9 pr-3 py-2 font-zh text-sm shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              aria-label="搜索资料"
              data-testid="library-search"
            />
          </div>
          <div className="relative">
            <PrimaryButton
              onClick={() => setShowNewMenu((v) => !v)}
              aria-label="新建"
              aria-expanded={showNewMenu}
            >
              新建
            </PrimaryButton>
            {showNewMenu && (
              <div
                className="absolute right-0 mt-2 z-20 min-w-[180px] rounded-xl border border-[var(--border-20)] bg-[var(--surface-elevated)] shadow-[var(--shadow-md)] p-1.5"
                role="menu"
              >
                <button
                  type="button"
                  role="menuitem"
                  className="w-full rounded-lg text-left px-3 py-2 font-zh text-xs hover:bg-[var(--surface-soft)]"
                  onClick={() => {
                    setShowCreateFolder(true);
                    setShowNewMenu(false);
                  }}
                >
                  新建文件夹
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="w-full rounded-lg text-left px-3 py-2 font-zh text-xs hover:bg-[var(--surface-soft)]"
                  onClick={() => {
                    fileInputRef.current?.click();
                    setShowNewMenu(false);
                  }}
                >
                  上传文件
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="w-full rounded-lg text-left px-3 py-2 font-zh text-xs hover:bg-[var(--surface-soft)]"
                  onClick={() => {
                    setShowPasteImport(true);
                    setShowNewMenu(false);
                  }}
                >
                  粘贴文本
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="w-full rounded-lg text-left px-3 py-2 font-zh text-xs hover:bg-[var(--surface-soft)]"
                  onClick={() => {
                    csvInputRef.current?.click();
                    setShowNewMenu(false);
                  }}
                >
                  导入课表
                </button>
              </div>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".md,.markdown,.txt,.py,.js,.jsx,.ts,.tsx,.java,.c,.cpp,.h,.hpp,.go,.rs,.json,.yaml,.yml,.toml,.sql,.sh,.ps1,.html,.css,text/markdown,text/plain"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFileImport(f);
              e.target.value = '';
            }}
          />
          <input
            ref={csvInputRef}
            type="file"
            accept=".csv,text/csv,text/plain"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                void f.text().then((t) => handleCsvImport(t));
              }
              e.target.value = '';
            }}
          />
        </div>

        {/* Short parse status — only when useful / interrupt */}
        {showStatusStrip && (
          <div
            className="rounded-xl bg-[var(--surface-soft)] px-3 py-2.5 font-zh text-xs text-[var(--text-secondary)]"
            data-testid="library-parse-status"
            role="status"
          >
            {parsePhaseLabel(parsePhase)}
            {parsePhase === 'decision_needed' && pendingDecisionCount > 0
              ? `（${pendingDecisionCount} 项）`
              : ''}
            {(parsePhase === 'conflict' || parsePhase === 'decision_needed') && (
              <button
                type="button"
                className="ml-3 underline text-[var(--accent)]"
                onClick={() => setParsePhase('idle')}
              >
                知道了
              </button>
            )}
            {parsePhase === 'error' && (
              <button
                type="button"
                className="ml-3 underline text-[var(--accent)]"
                onClick={() => setParsePhase('idle')}
              >
                关闭
              </button>
            )}
          </div>
        )}

        {/* Folders (courses) */}
        <section aria-label="文件夹">
          <h2 className="font-zh text-xs font-bold text-[var(--text-muted)] mb-2 tracking-wide">
            文件夹
          </h2>
          <div className="flex flex-wrap gap-2">
            {courses.map((c) => {
              const active = c.id === courseId;
              const isArchived = Boolean(c.archivedAt);
              return (
                <div
                  key={c.id}
                  className={`inline-flex items-center gap-0.5 rounded-xl font-zh text-xs transition-colors ${
                    active
                      ? 'bg-[var(--accent-soft)] text-[var(--accent-strong)] shadow-sm'
                      : 'bg-[var(--surface)] text-[var(--text-secondary)] hover:bg-[var(--surface-soft)]'
                  }`}
                  data-testid={`library-folder-${c.id}`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedCourseId(c.id);
                      setSelectedDocId(null);
                      setShowAdvanced(false);
                    }}
                    className="inline-flex items-center gap-2 px-3 py-2 hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)]"
                  >
                    <Folder size={14} className="opacity-70" aria-hidden />
                    <span className="truncate max-w-[140px]">
                      {c.title}
                      {isArchived ? '（已归档）' : ''}
                    </span>
                  </button>
                  <EntityActionsMenu
                    label={c.title}
                    actions={[
                      {
                        id: 'rename',
                        label: '重命名',
                        onSelect: () =>
                          void handleRenameFolder(c.id, c.title),
                      },
                      {
                        id: isArchived ? 'unarchive' : 'archive',
                        label: isArchived ? '取消归档' : '归档',
                        onSelect: () =>
                          void handleArchiveFolder(c.id, c.title, isArchived),
                      },
                      {
                        id: 'delete',
                        label: '删除',
                        danger: true,
                        onSelect: () =>
                          void handleDeleteFolder(c.id, c.title),
                      },
                    ]}
                  />
                </div>
              );
            })}
            <button
              type="button"
              onClick={() => setShowCreateFolder(true)}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-xl px-3 py-2 border border-dashed border-[var(--border)] font-zh text-xs text-[var(--text-muted)] hover:bg-[var(--surface-soft)]"
              aria-label="新建文件夹"
            >
              <FolderPlus size={14} aria-hidden />
              新建
            </button>
          </div>
        </section>

        {showCreateFolder && (
          <section className="surface-card p-4 space-y-3 max-w-md">
            <h3 className="font-zh text-sm font-bold">新建文件夹</h3>
            <input
              value={folderTitle}
              onChange={(e) => setFolderTitle(e.target.value)}
              placeholder="名称"
              className="w-full bg-[var(--bg-secondary)] border border-[var(--border)] px-3 py-2 font-zh text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              aria-label="文件夹名称"
            />
            <div className="flex gap-2">
              <PrimaryButton
                onClick={() => void handleCreateFolder()}
                disabled={loading || !folderTitle.trim()}
              >
                创建
              </PrimaryButton>
              <SecondaryButton
                onClick={() => {
                  setPendingUploadFile(null);
                  setShowCreateFolder(false);
                }}
              >
                取消
              </SecondaryButton>
            </div>
          </section>
        )}

        {showPasteImport && (
          <section className="surface-card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-zh text-sm font-bold">粘贴文本</h3>
              <button
                type="button"
                onClick={() => setShowPasteImport(false)}
                aria-label="关闭"
              >
                <X size={14} />
              </button>
            </div>
            <input
              value={docTitle}
              onChange={(e) => setDocTitle(e.target.value)}
              placeholder="标题（可选）"
              className="w-full bg-[var(--bg-secondary)] border border-[var(--border)] px-3 py-2 font-zh text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              aria-label="文档标题"
            />
            <select
              value={docFormat}
              onChange={(e) =>
                setDocFormat(e.target.value as 'markdown' | 'txt')
              }
              className="bg-[var(--bg-secondary)] border border-[var(--border)] px-2 py-1 font-zh text-xs"
              aria-label="格式"
            >
              <option value="markdown">Markdown</option>
              <option value="txt">文本</option>
            </select>
            <textarea
              value={docContent}
              onChange={(e) => setDocContent(e.target.value)}
              placeholder="粘贴内容…"
              rows={5}
              className="w-full bg-[var(--bg-secondary)] border border-[var(--border)] px-3 py-2 font-zh text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              aria-label="文档内容"
            />
            <PrimaryButton
              onClick={() => void handleManualImport()}
              disabled={loading || !docContent.trim()}
            >
              添加
            </PrimaryButton>
          </section>
        )}

        {/* Decision panel only when needed (import suggestions / tasks) */}
        {(parsePhase === 'decision_needed' ||
          parsePhase === 'conflict' ||
          (data.importSuggestions ?? []).some((s) => s.status === 'pending') ||
          data.tasks.some(
            (t) =>
              t.status === 'pending_suggestion' &&
              (!courseId || t.courseId === courseId),
          )) && (
          <PendingSuggestionsPanel
            tasks={data.tasks}
            importSuggestions={data.importSuggestions ?? []}
            courseId={courseId}
            loading={loading}
            onConfirmTask={async (id) => {
              await confirmTask(id);
            }}
            onRejectTask={async (id) => {
              await rejectSuggestion(id);
            }}
            onConfirmImport={async (id) => {
              await confirmImportSuggestion(id);
              setParsePhase('idle');
            }}
            onRejectImport={async (id) => {
              await rejectImportSuggestion(id);
              setParsePhase('idle');
            }}
            title="待你确认"
          />
        )}

        {/* File thumbnails grid */}
        <section aria-label="文件">
          <h2 className="font-zh text-xs font-bold text-[var(--text-muted)] mb-2 tracking-wide">
            文件
            {listItems.length > 0 ? ` · ${listItems.length}` : ''}
          </h2>
          {listItems.length === 0 ? (
            <div
              className="soft-card px-4 py-10 text-center space-y-3"
              data-testid="library-folder-empty"
            >
              <p className="font-zh text-sm text-[var(--text-muted)]">
                这个文件夹还是空的
              </p>
              <div className="flex justify-center gap-2">
                <SecondaryButton onClick={() => fileInputRef.current?.click()}>
                  <Upload size={iconSizes.sm} aria-hidden />
                  上传
                </SecondaryButton>
                <SecondaryButton onClick={() => setShowPasteImport(true)}>
                  粘贴文本
                </SecondaryButton>
              </div>
            </div>
          ) : (
            <ul
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2"
              data-testid="library-file-grid"
            >
              {listItems.map((item) => {
                const active = item.id === selectedDocId;
                return (
                  <li
                    key={item.id}
                    className={`surface-card flex items-stretch min-h-[104px] overflow-hidden transition-all ${
                      active
                        ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                        : 'hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)]'
                    }`}
                    data-testid={`library-file-${item.id}`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedDocId(item.id);
                        setShowAdvanced(false);
                      }}
                      className="flex-1 text-left px-3 py-3 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)]"
                    >
                      <div className="flex items-start gap-2">
                        <FileText
                          size={18}
                          className="text-[var(--accent)] shrink-0 mt-0.5"
                          aria-hidden
                        />
                        <div className="min-w-0 flex-1">
                          <p className="font-zh text-sm font-bold text-[var(--text-primary)] truncate">
                            {item.title}
                          </p>
                          <p className="font-zh text-[11px] text-[var(--text-muted)] mt-0.5">
                            {item.formatLabel}
                            {item.primaryFields.contentTypeLabel
                              ? ` · ${item.primaryFields.contentTypeLabel}`
                              : ''}
                            {item.updatedLabel
                              ? ` · ${item.updatedLabel}`
                              : ''}
                          </p>
                          {item.summaryLine && (
                            <p className="font-zh text-xs text-[var(--text-secondary)] mt-1 line-clamp-2">
                              {item.summaryLine}
                            </p>
                          )}
                        </div>
                      </div>
                    </button>
                    <EntityActionsMenu
                      label={item.title}
                      onRename={() => void handleRenameDoc(item.id, item.title)}
                      onDelete={() => void handleDeleteDoc(item.id, item.title)}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Selected document actions */}
        {selectedDoc && (
          <section
            className="surface-card p-4 sm:p-5 space-y-4"
            data-testid="library-doc-actions"
            aria-label="资料操作"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="font-zh text-sm font-bold text-[var(--text-primary)] truncate">
                  {selectedDoc.title}
                </h3>
                {selectedDoc.summary && (
                  <p className="font-zh text-xs text-[var(--text-secondary)] mt-1 line-clamp-3">
                    {selectedDoc.summary}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <EntityActionsMenu
                  label={selectedDoc.title}
                  onRename={() =>
                    void handleRenameDoc(selectedDoc.id, selectedDoc.title)
                  }
                  onDelete={() =>
                    void handleDeleteDoc(selectedDoc.id, selectedDoc.title)
                  }
                />
                <button
                  type="button"
                  onClick={() => {
                    setSelectedDocId(null);
                    setShowAdvanced(false);
                  }}
                  className="text-[var(--text-muted)] hover:text-[var(--text-primary)] min-h-[44px] min-w-[44px] sm:min-h-[36px] sm:min-w-[36px] flex items-center justify-center focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                  aria-label="取消选择"
                >
                  <X size={16} />
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {DOCUMENT_PRIMARY_ACTIONS.map((a) => (
                <SecondaryButton
                  key={a.id}
                  onClick={() => handleDocumentAction(a.id)}
                  aria-label={a.label}
                >
                  {a.label}
                </SecondaryButton>
              ))}
            </div>
            <div>
              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                className="font-zh text-[11px] text-[var(--text-muted)] underline"
                data-testid="library-advanced-toggle"
              >
                {showAdvanced ? '收起高级详情' : '高级详情'}
              </button>
              {showAdvanced && (
                <dl
                  className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 font-zh text-[11px] text-[var(--text-muted)] border border-dashed border-[var(--border-20)] p-2"
                  data-testid="library-advanced-detail"
                >
                  {(() => {
                    const adv = buildAdvancedDocumentDetail(selectedDoc);
                    return (
                      <>
                        <div>
                          <dt>分块数</dt>
                          <dd className="text-[var(--text-secondary)]">
                            {adv.chunkCount ?? '—'}
                          </dd>
                        </div>
                        <div>
                          <dt>来源质量</dt>
                          <dd className="text-[var(--text-secondary)]">
                            {adv.sourceQualityPct != null
                              ? `${adv.sourceQualityPct}%`
                              : '—'}
                          </dd>
                        </div>
                        <div className="sm:col-span-2">
                          <dt>重复关联</dt>
                          <dd className="text-[var(--text-secondary)] break-all">
                            {adv.duplicateOfDocumentId || '无'}
                          </dd>
                        </div>
                      </>
                    );
                  })()}
                </dl>
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
