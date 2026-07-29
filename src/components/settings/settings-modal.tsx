'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  X, RotateCcw, Save, Bot, User, Info, Check, Pencil, Trash2, Shield, Clock3,
  Sparkles, Database, ScrollText, Download, UploadCloud, Palette, Sun, Moon, Monitor,
} from 'lucide-react';
import {
  useSettingsStore,
  type ApprovalPolicy,
  type AutonomyCategory,
  type AutonomyGrant,
  type ExecutionEnvironment,
  type Settings,
} from '@/store/settings-store';
import { useUIStore, SettingsTab } from '@/store/ui-store';
import { iconSizes } from '@/lib/icons';
import { useFocusTrap } from '@/lib/ui/use-focus-trap';
import { MinusLogo } from '@/components/brand/minus-logo';
import { APP_VERSION } from '@/lib/brand';
import {
  AuditWorkspace,
  AutomationsWorkspace,
  SkillsWorkspace,
} from './customization-workspaces';

/**
 * 弹窗内部使用的标签页 id。'theme' 不在 ui-store 的 SettingsTab 联合类型中
 * （外部 openSettings 不直接定位到它），仅在弹窗内部扩展。
 */
type SettingsModalTab = Exclude<SettingsTab, 'personalization'> | 'theme';

/** B07 final Settings IA (no dead personalization-only tab). */
const TAB_ITEMS: { id: SettingsModalTab; label: string; icon: typeof Bot }[] = [
  { id: 'model', label: '模型', icon: Bot },
  { id: 'safety', label: '执行与安全', icon: Shield },
  { id: 'memory', label: 'Memory 与隐私', icon: User },
  { id: 'theme', label: '主题', icon: Palette },
  { id: 'skills', label: 'Skills', icon: Sparkles },
  { id: 'automations', label: '自动化', icon: Clock3 },
  { id: 'data', label: '数据与存储', icon: Database },
  { id: 'audit', label: '审计', icon: ScrollText },
  { id: 'about', label: '关于', icon: Info },
];

const SAFETY_LEVELS: {
  id: ApprovalPolicy;
  title: string;
  desc: string;
  env: ExecutionEnvironment;
}[] = [
  {
    id: 'chat_only',
    title: '仅对话',
    desc: '不调用任何工具，仅文本对话。适合纯问答。',
    env: 'sandbox',
  },
  {
    id: 'supervised',
    title: '监督模式（默认）',
    desc: '默认沙箱执行；危险工具与本机升权需你确认。',
    env: 'sandbox',
  },
  {
    id: 'bounded_auto',
    title: '有界自主',
    desc: '在过期前自动批准你勾选的工具类别；其余仍需确认。',
    env: 'sandbox',
  },
  {
    id: 'full_auto',
    title: '本机完全自主',
    desc: '本机工具在预授权范围内自动执行；界面常驻标识，可一键撤销。红线操作仍禁止。',
    env: 'local',
  },
];

const CATEGORY_OPTIONS: { id: AutonomyCategory; label: string }[] = [
  { id: 'web_search', label: '网络搜索' },
  { id: 'code_run', label: '代码执行' },
  { id: 'artifacts_write', label: '写入产物' },
  { id: 'package_install', label: '安装依赖' },
];

const RED_LINE_ITEMS = [
  '读取凭据 / 密钥',
  '越出工作区路径',
  '权限提升（sudo 等）',
  '敏感删除',
  '未授权外发 / 发布',
];

const POLICY_SHORT: Record<ApprovalPolicy, string> = {
  chat_only: '仅对话',
  supervised: '监督模式',
  bounded_auto: '有界自主',
  full_auto: '本机完全自主',
};

interface ProviderStatus {
  providerId: string;
  hasKey: boolean;
  maskedKey: string;
  model: string;
  baseUrl: string;
  configuredProviders: string[];
  source?: 'file' | 'env' | 'none';
  supportedProviders?: Array<{ id: string; defaultModel: string; defaultBaseUrl: string }>;
}

interface MemoryEvidence {
  conversationId?: string;
  messageId?: string;
  quote?: string;
}

interface MemoryItem {
  id: string;
  text: string;
  source: 'ai' | 'manual';
  kind: string;
  confidence?: number;
  evidence?: MemoryEvidence[];
  firstObservedAt?: string;
  lastObservedAt?: string;
  status?: 'proposed' | 'confirmed' | 'conflicted' | 'expired' | 'rejected';
  sensitive?: boolean;
  createdAt: string;
  updatedAt: string;
}

interface LearnerMemoryData {
  persona: string;
  strengths: string[];
  stylePrefs: string[];
  memories: MemoryItem[];
  externalDoc: string;
}

const PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  deepseek: 'DeepSeek',
  gemini: 'Google Gemini',
};

/** Display labels only — never shown as empty-state questionnaire grids. */
const PERSONA_LABELS: Record<string, string> = {
  high_school: '高中生',
  undergrad: '本科生',
  grad: '研究生',
  self_learner: '自学者 / 职场人士',
  other: '其他',
};

const STRENGTH_LABELS: Record<string, string> = {
  math: '数理 / 定量推理',
  coding: '计算机 / 编程',
  humanities: '写作 / 阅读 / 人文',
  business: '商科 / 经济',
  natural_science: '自然科学',
  exploring: '还在摸索',
};

const STYLE_LABELS: Record<string, string> = {
  simple_first: '先用简单语言讲清概念',
  analogy_first: '先给例子或类比',
  step_by_step: '一步步拆解',
  examples_then_theory: '先练后讲',
};

const KIND_LABELS: Record<string, string> = {
  preference: '偏好',
  goal: '目标',
  fact: '事实',
  other: '其他',
};

const STATUS_LABELS: Record<string, string> = {
  proposed: '待确认',
  confirmed: '已确认',
  conflicted: '冲突',
  expired: '已过期',
  rejected: '已拒绝',
};

/** Vacuum when nothing user/AI has contributed (infer-first). */
function isMemoryOverviewEmpty(data: LearnerMemoryData | null): boolean {
  if (!data) return true;
  const active = (data.memories || []).filter(
    (m) => m.status !== 'rejected' && m.status !== 'expired',
  );
  return (
    !data.persona &&
    (data.strengths || []).length === 0 &&
    (data.stylePrefs || []).length === 0 &&
    active.length === 0 &&
    !(data.externalDoc || '').trim()
  );
}

function listOverviewMemories(data: LearnerMemoryData): MemoryItem[] {
  return (data.memories || []).filter(
    (m) => m.status !== 'rejected' && m.status !== 'expired',
  );
}

function formatConfidence(c?: number): string {
  if (typeof c !== 'number' || !Number.isFinite(c)) return '—';
  return `${Math.round(Math.max(0, Math.min(1, c)) * 100)}%`;
}

async function fetchProviderStatus(providerId: string): Promise<ProviderStatus> {
  const res = await fetch(`/api/settings/provider?providerId=${encodeURIComponent(providerId)}`);
  const json = await res.json();
  if (!json.success) throw new Error(json.error || 'Failed to load provider status');
  return json.data;
}

async function saveProviderConfig(payload: {
  providerId: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}): Promise<ProviderStatus> {
  const res = await fetch('/api/settings/provider', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error || 'Failed to save provider');
  return json.data;
}

async function memoryApi(action: string, payload?: Record<string, unknown>) {
  const res = await fetch('/api/memory', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, payload }),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error || 'Memory API failed');
  return json.data as LearnerMemoryData;
}

export function SettingsModal() {
  const settingsInitialTab = useUIStore(s => s.settingsInitialTab);
  const toggleSettings = useUIStore(s => s.toggleSettings);
  const { settings, updateSettings, resetSettings, switchProvider, setSafetyLevel, revokeAutonomy } =
    useSettingsStore();

  const normalizeTab = (tab: SettingsTab): SettingsModalTab =>
    tab === 'personalization' ? 'memory' : tab;

  const [activeTab, setActiveTab] = useState<SettingsModalTab>(
    normalizeTab(settingsInitialTab),
  );
  const [localSettings, setLocalSettings] = useState({ ...settings });
  const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [modelDraft, setModelDraft] = useState({ model: '', baseUrl: '', apiKey: '' });
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, { enabled: true, onEscape: toggleSettings });
  const [providerSaving, setProviderSaving] = useState(false);
  const [providerMsg, setProviderMsg] = useState<string | null>(null);
  const [safetyMsg, setSafetyMsg] = useState<string | null>(null);
  const [safetySaving, setSafetySaving] = useState(false);

  useEffect(() => {
    const timeoutId = setTimeout(() => setLocalSettings({ ...settings }), 0);
    return () => clearTimeout(timeoutId);
  }, [settings]);

  useEffect(() => {
    const timeoutId = setTimeout(
      () => setActiveTab(normalizeTab(settingsInitialTab)),
      0,
    );
    return () => clearTimeout(timeoutId);
  }, [settingsInitialTab]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') toggleSettings();
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [toggleSettings]);

  const reloadStatus = useCallback((providerId: string) => {
    setStatusLoading(true);
    fetchProviderStatus(providerId)
      .then(status => {
        setProviderStatus(status);
        setModelDraft({
          model: status.model || '',
          baseUrl: status.baseUrl || '',
          apiKey: '',
        });
      })
      .catch(() => setProviderStatus(null))
      .finally(() => setStatusLoading(false));
  }, []);

  useEffect(() => {
    if (activeTab !== 'model') return;
    const timeoutId = setTimeout(() => reloadStatus(localSettings.providerId), 0);
    return () => clearTimeout(timeoutId);
  }, [activeTab, localSettings.providerId, reloadStatus]);

  const handleSave = () => {
    updateSettings(localSettings);
    toggleSettings();
  };

  const handleReset = () => {
    resetSettings();
    setLocalSettings({ ...useSettingsStore.getState().settings });
  };

  const syncSafetyToServer = useCallback(
    async (next: {
      approvalPolicy: ApprovalPolicy;
      executionEnvironment: ExecutionEnvironment;
      autonomyGrant: AutonomyGrant | null;
    }) => {
      setSafetySaving(true);
      setSafetyMsg(null);
      try {
        const res = await fetch('/api/settings/safety', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'save',
            approvalPolicy: next.approvalPolicy,
            executionEnvironment: next.executionEnvironment,
            autonomyGrant: next.autonomyGrant,
          }),
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.error || '同步失败');
        setSafetyMsg('已同步到服务端授权库（~/.minus/data/autonomy-grant.json）');
      } catch (e) {
        setSafetyMsg(e instanceof Error ? e.message : '服务端同步失败');
      } finally {
        setSafetySaving(false);
      }
    },
    [],
  );

  const handleSelectSafetyLevel = async (policy: ApprovalPolicy, categories?: AutonomyCategory[]) => {
    setSafetyLevel(policy, { categories });
    const next = useSettingsStore.getState().settings;
    setLocalSettings((s) => ({
      ...s,
      approvalPolicy: next.approvalPolicy,
      executionEnvironment: next.executionEnvironment,
      executionMode: next.executionMode,
      autonomyGrant: next.autonomyGrant,
    }));
    await syncSafetyToServer({
      approvalPolicy: next.approvalPolicy,
      executionEnvironment: next.executionEnvironment,
      autonomyGrant: next.autonomyGrant,
    });
  };

  const handleRevokeAutonomy = async () => {
    revokeAutonomy();
    const next = useSettingsStore.getState().settings;
    setLocalSettings((s) => ({
      ...s,
      approvalPolicy: next.approvalPolicy,
      executionEnvironment: next.executionEnvironment,
      executionMode: next.executionMode,
      autonomyGrant: null,
    }));
    try {
      await fetch('/api/settings/safety', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'revoke' }),
      });
      setSafetyMsg('已撤销自主授权，恢复监督模式');
    } catch {
      setSafetyMsg('本地已撤销；服务端撤销请求失败');
    }
  };

  const handleToggleCategory = async (cat: AutonomyCategory) => {
    const policy = localSettings.approvalPolicy;
    if (policy !== 'bounded_auto' && policy !== 'full_auto') return;
    const current = localSettings.autonomyGrant?.allowedCategories || [];
    const nextCats = current.includes(cat)
      ? current.filter((c) => c !== cat)
      : [...current, cat];
    const expiresAt =
      localSettings.autonomyGrant?.expiresAt ||
      new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
    const grant: AutonomyGrant = {
      allowedCategories: nextCats,
      expiresAt,
      approvedBy: 'user',
    };
    updateSettings({ autonomyGrant: grant });
    setLocalSettings((s) => ({ ...s, autonomyGrant: grant }));
    await syncSafetyToServer({
      approvalPolicy: policy,
      executionEnvironment: localSettings.executionEnvironment,
      autonomyGrant: grant,
    });
  };

  const handleSwitchProvider = (providerId: string) => {
    switchProvider(providerId);
    setLocalSettings(s => ({ ...s, providerId }));
    setProviderMsg(null);
  };

  const handleSelectTheme = (theme: Settings['theme']) => {
    setLocalSettings(s => ({ ...s, theme }));
    // 主题点击即时生效并持久化：ThemeProvider 直接订阅 settings.theme 写入
    // document 的 data-theme，不依赖底部「保存偏好」按钮（该按钮仅模型页显示）。
    updateSettings({ theme });
  };

  const handleSaveProvider = async () => {
    setProviderSaving(true);
    setProviderMsg(null);
    try {
      const payload: {
        providerId: string;
        apiKey?: string;
        baseUrl?: string;
        model?: string;
      } = {
        providerId: localSettings.providerId,
        baseUrl: modelDraft.baseUrl,
        model: modelDraft.model,
      };
      if (modelDraft.apiKey.trim()) {
        payload.apiKey = modelDraft.apiKey.trim();
      }
      const status = await saveProviderConfig(payload);
      setProviderStatus(status);
      setModelDraft(d => ({ ...d, apiKey: '', model: status.model, baseUrl: status.baseUrl }));
      setProviderMsg('已保存到本地密钥库（~/.minus/data/provider-secrets.json）');
      switchProvider(localSettings.providerId);
    } catch (e) {
      setProviderMsg(e instanceof Error ? e.message : '保存失败');
    } finally {
      setProviderSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm sm:p-4" onClick={toggleSettings}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="设置"
        className="w-full h-[92vh] sm:h-auto sm:max-w-6xl sm:max-h-[88vh] bg-[var(--surface)] sm:border border-[var(--border-20)] shadow-2xl flex flex-col sm:flex-row animate-fade-in overflow-hidden rounded-t-2xl sm:rounded-2xl"
        onClick={e => e.stopPropagation()}
      >
        <nav className="w-full sm:w-52 shrink-0 border-b sm:border-b-0 sm:border-r border-[var(--border-20)] bg-[var(--surface-soft)] px-2 py-2 sm:p-3 flex flex-row sm:flex-col gap-1 overflow-x-auto sm:overflow-y-auto">
          <div className="hidden sm:block px-3 py-2 mb-2">
            <span className="font-classic text-xs font-bold tracking-widest text-[var(--text-muted)] uppercase">Settings</span>
          </div>
          {TAB_ITEMS.map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`shrink-0 min-h-[40px] rounded-xl flex items-center gap-2 px-3 py-2 text-sm transition-colors text-left ${
                activeTab === tab.id
                  ? 'bg-[var(--surface-elevated)] text-[var(--text-primary)] font-bold shadow-sm'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--surface-elevated)]/70 hover:text-[var(--text-primary)]'
              }`}
            >
              <tab.icon size={iconSizes.md} aria-hidden />
              <span className="font-zh">{tab.label}</span>
            </button>
          ))}
        </nav>

        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex items-center justify-between px-4 sm:px-6 py-3.5 border-b border-[var(--border-20)]">
            <h2 className="font-zh text-lg font-bold text-[var(--text-primary)]">
              {TAB_ITEMS.find(t => t.id === activeTab)?.label}
            </h2>
            <button type="button" onClick={toggleSettings} className="p-2 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]/50 transition-colors" aria-label="Close settings">
              <X size={iconSizes.lg} aria-hidden />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 sm:p-6">
            {(() => {
              switch (activeTab) {
                case 'model':
                  return (
                    <ModelTab
                      localSettings={localSettings}
                      providerStatus={providerStatus}
                      statusLoading={statusLoading}
                      modelDraft={modelDraft}
                      setModelDraft={setModelDraft}
                      onSwitchProvider={handleSwitchProvider}
                      onSaveProvider={handleSaveProvider}
                      providerSaving={providerSaving}
                      providerMsg={providerMsg}
                    />
                  );
                case 'safety':
                  return (
                    <SafetyTab
                      localSettings={localSettings}
                      safetyMsg={safetyMsg}
                      safetySaving={safetySaving}
                      onSelectLevel={handleSelectSafetyLevel}
                      onRevoke={handleRevokeAutonomy}
                      onToggleCategory={handleToggleCategory}
                      onOpenAudit={() => setActiveTab('audit')}
                    />
                  );
                case 'memory':
                  return (
                    <MemoryTab
                      userName={localSettings.userName}
                      onUserNameChange={(name) =>
                        setLocalSettings((s) => ({ ...s, userName: name }))
                      }
                    />
                  );
                case 'theme':
                  return (
                    <ThemeTab
                      theme={localSettings.theme}
                      onSelectTheme={handleSelectTheme}
                    />
                  );
                case 'skills':
                  return <SkillsWorkspace />;
                case 'automations':
                  return <AutomationsWorkspace />;
                case 'data':
                  return <DataStorageTab />;
                case 'audit':
                  return <AuditWorkspace refreshKey={localSettings.approvalPolicy} />;
                case 'about':
                  return <AboutTab />;
                default: {
                  const _never: never = activeTab;
                  return _never;
                }
              }
            })()}
          </div>

          {activeTab === 'model' && (
            <div className="px-4 sm:px-6 py-3 sm:py-4 border-t border-[var(--border-20)] flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                onClick={handleReset}
                className="flex items-center gap-2 px-4 py-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]/50 transition-colors font-zh text-sm"
              >
                <RotateCcw size={iconSizes.sm} aria-hidden />
                重置本地偏好
              </button>
              <div className="flex w-full gap-2 sm:w-auto sm:gap-3">
                <button
                  type="button"
                  onClick={toggleSettings}
                  className="min-h-[40px] flex-1 rounded-lg px-4 py-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]/50 transition-colors font-zh text-sm sm:flex-none"
                >
                  关闭
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  className="flex min-h-[40px] flex-1 items-center justify-center gap-2 rounded-lg px-5 py-2 bg-[var(--user-bubble-bg)] text-[var(--user-bubble-text)] font-zh font-bold text-sm hover:opacity-90 transition-all shadow-md sm:flex-none"
                >
                  <Save size={iconSizes.sm} aria-hidden />
                  保存偏好
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ModelTab({
  localSettings,
  providerStatus,
  statusLoading,
  modelDraft,
  setModelDraft,
  onSwitchProvider,
  onSaveProvider,
  providerSaving,
  providerMsg,
}: {
  localSettings: ReturnType<typeof useSettingsStore.getState>['settings'];
  providerStatus: ProviderStatus | null;
  statusLoading: boolean;
  modelDraft: { model: string; baseUrl: string; apiKey: string };
  setModelDraft: React.Dispatch<React.SetStateAction<{ model: string; baseUrl: string; apiKey: string }>>;
  onSwitchProvider: (id: string) => void;
  onSaveProvider: () => void;
  providerSaving: boolean;
  providerMsg: string | null;
}) {
  const providers =
    providerStatus?.supportedProviders?.map(p => p.id) ||
    ['openai', 'anthropic', 'deepseek', 'gemini'];

  return (
    <div className="space-y-5">
      <div>
        <label className="block font-zh text-sm font-bold text-[var(--text-primary)] mb-3">选择供应商</label>
        <div className="grid grid-cols-2 gap-2">
          {providers.map(id => (
            <button
              key={id}
              type="button"
              onClick={() => onSwitchProvider(id)}
              className={`flex items-center gap-2 px-3 py-3 text-left border transition-colors rounded-lg ${
                localSettings.providerId === id
                  ? 'border-[var(--accent)] bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
                  : 'border-[var(--border-20)] text-[var(--text-secondary)] hover:border-[var(--border-40)]'
              }`}
            >
              {localSettings.providerId === id && <Check size={14} className="text-[var(--accent)] shrink-0" />}
              <div className="min-w-0">
                <div className="font-zh text-sm font-bold truncate">{PROVIDER_LABELS[id] || id}</div>
                <div className="font-tech text-[10px] text-[var(--text-muted)] truncate">{id}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <span className="font-zh text-sm font-bold text-[var(--text-primary)]">连接配置</span>
          {!statusLoading && providerStatus && (
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-tech border rounded ${
                providerStatus.hasKey
                  ? 'border-[var(--success)]/60 text-[var(--success)]'
                  : 'border-amber-500/60 text-amber-500'
              }`}
            >
              {providerStatus.hasKey ? `已配置（${providerStatus.source || 'local'}）` : '未配置密钥'}
            </span>
          )}
        </div>

        {statusLoading ? (
          <p className="font-tech text-sm text-[var(--text-muted)]">加载中…</p>
        ) : (
          <>
            <div>
              <label className="block font-zh text-xs text-[var(--text-muted)] mb-1">模型</label>
              <input
                type="text"
                value={modelDraft.model}
                onChange={e => setModelDraft(d => ({ ...d, model: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg bg-[var(--bg-primary)] border border-[var(--border)] text-sm font-tech text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                placeholder="例如 deepseek-chat"
              />
            </div>
            <div>
              <label className="block font-zh text-xs text-[var(--text-muted)] mb-1">Base URL</label>
              <input
                type="text"
                value={modelDraft.baseUrl}
                onChange={e => setModelDraft(d => ({ ...d, baseUrl: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg bg-[var(--bg-primary)] border border-[var(--border)] text-sm font-tech text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                placeholder="https://api.deepseek.com/v1"
              />
            </div>
            <div>
              <label className="block font-zh text-xs text-[var(--text-muted)] mb-1">
                API Key{providerStatus?.hasKey ? `（当前 ${providerStatus.maskedKey}，留空则保留）` : ''}
              </label>
              <input
                type="password"
                autoComplete="off"
                value={modelDraft.apiKey}
                onChange={e => setModelDraft(d => ({ ...d, apiKey: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg bg-[var(--bg-primary)] border border-[var(--border)] text-sm font-tech text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                placeholder="sk-…"
              />
            </div>
            <button
              type="button"
              onClick={onSaveProvider}
              disabled={providerSaving}
              className="w-full py-2.5 rounded-lg bg-[var(--user-bubble-bg)] text-[var(--user-bubble-text)] font-zh text-sm font-bold hover:opacity-90 disabled:opacity-50"
            >
              {providerSaving ? '保存中…' : '保存到本地密钥库'}
            </button>
            {providerMsg && (
              <p className="font-tech text-xs text-[var(--text-muted)]">{providerMsg}</p>
            )}
            <p className="font-tech text-[10px] text-[var(--text-muted)]">
              密钥写入本机 ~/.minus/data/provider-secrets.json，不进入浏览器持久化。也可继续用 .env 配置。
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function MemoryTab({
  userName,
  onUserNameChange,
}: {
  userName: string;
  onUserNameChange: (name: string) => void;
}) {
  const [data, setData] = useState<LearnerMemoryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [manageOpen, setManageOpen] = useState(false);
  const [proposedBanner, setProposedBanner] = useState(false);

  useEffect(() => {
    let cancelled = false;
    memoryApi('get')
      .then((d) => {
        if (cancelled) return;
        setData(d);
        const proposed = (d.memories || []).filter((m) => m.status === 'proposed').length;
        if (proposed > 0) setProposedBanner(true);
      })
      .catch(() => {
        if (!cancelled) {
          setData({
            persona: '',
            strengths: [],
            stylePrefs: [],
            memories: [],
            externalDoc: '',
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (manageOpen) {
    return (
      <ManageMemoryPanel
        data={data}
        onClose={() => setManageOpen(false)}
        onChange={setData}
      />
    );
  }

  if (loading) {
    return <p className="font-tech text-sm text-[var(--text-muted)]">加载记忆…</p>;
  }

  const empty = isMemoryOverviewEmpty(data);
  const visible = data ? listOverviewMemories(data) : [];
  const proposedCount = visible.filter((m) => m.status === 'proposed').length;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-zh text-base font-bold text-[var(--text-primary)]">Memory 与隐私</h3>
          <p className="font-zh text-xs text-[var(--text-muted)] mt-1">
            从真实对话中推断偏好与目标；空库不展示默认问卷。敏感记忆不会注入 Desktop 工具提示。
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setManageOpen(true);
            setProposedBanner(false);
          }}
          className="shrink-0 px-3 py-1.5 text-xs font-zh border border-[var(--border)] rounded-lg text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
        >
          管理记忆
        </button>
      </div>

      {proposedBanner && proposedCount > 0 && (
        <p className="font-zh text-xs text-amber-600 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
          有 {proposedCount} 条待确认记忆，可在「管理记忆」中确认或拒绝。
        </p>
      )}

      <div>
        <label className="block font-zh text-sm font-bold text-[var(--text-primary)] mb-2">你的名字</label>
        <input
          type="text"
          value={userName}
          onChange={(e) => onUserNameChange(e.target.value)}
          placeholder="可选"
          className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] text-sm font-tech"
        />
      </div>

      {empty ? (
        <section className="rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-20)] p-6 text-center space-y-3">
          <p className="font-zh text-sm text-[var(--text-primary)] leading-relaxed">
            尚无记忆。随着对话进行，Minus 会整理可验证的偏好、目标与学习特点。
          </p>
          <button
            type="button"
            onClick={() => setManageOpen(true)}
            className="px-4 py-2 text-xs font-zh border border-blue-500 text-blue-600 rounded-lg hover:bg-blue-500/10"
          >
            管理记忆
          </button>
        </section>
      ) : (
        <div className="space-y-4">
          {data?.persona && PERSONA_LABELS[data.persona] && (
            <section className="rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-20)] p-4">
              <h4 className="font-zh text-xs font-bold text-[var(--text-muted)] mb-2">画像</h4>
              <span className="inline-block px-3 py-1 rounded-full text-xs font-zh border border-blue-500/40 text-blue-600 bg-blue-500/10">
                {PERSONA_LABELS[data.persona]}
              </span>
            </section>
          )}

          {(data?.strengths || []).length > 0 && (
            <section className="rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-20)] p-4">
              <h4 className="font-zh text-xs font-bold text-[var(--text-muted)] mb-2">擅长领域</h4>
              <div className="flex flex-wrap gap-2">
                {data!.strengths.map((s) => (
                  <span
                    key={s}
                    className="px-3 py-1 rounded-full text-xs font-zh border border-[var(--border)] text-[var(--text-secondary)]"
                  >
                    {STRENGTH_LABELS[s] || s}
                  </span>
                ))}
              </div>
            </section>
          )}

          {(data?.stylePrefs || []).length > 0 && (
            <section className="rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-20)] p-4">
              <h4 className="font-zh text-xs font-bold text-[var(--text-muted)] mb-2">学习偏好</h4>
              <div className="flex flex-wrap gap-2">
                {data!.stylePrefs.map((s) => (
                  <span
                    key={s}
                    className="px-3 py-1 rounded-full text-xs font-zh border border-[var(--border)] text-[var(--text-secondary)]"
                  >
                    {STYLE_LABELS[s] || s}
                  </span>
                ))}
              </div>
            </section>
          )}

          {visible.length > 0 && (
            <section className="rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-20)] p-4 space-y-2">
              <h4 className="font-zh text-xs font-bold text-[var(--text-muted)] mb-1">推断记忆</h4>
              <ul className="space-y-2">
                {visible.slice(0, 8).map((m) => {
                  const status = m.status || 'confirmed';
                  const kindLabel = KIND_LABELS[m.kind] || m.kind || '其他';
                  const statusLabel = STATUS_LABELS[status] || status;
                  const quote = m.evidence?.find((e) => e.quote)?.quote;
                  return (
                    <li
                      key={m.id}
                      className="rounded-lg border border-[var(--border-20)] bg-[var(--bg-primary)] px-3 py-2"
                    >
                      <p className="font-zh text-sm text-[var(--text-primary)]">{m.text}</p>
                      <p className="font-tech text-[10px] text-[var(--text-muted)] mt-1">
                        {kindLabel} · {statusLabel} · 置信 {formatConfidence(m.confidence)} ·{' '}
                        {m.source === 'ai' ? 'AI' : '手动'}
                        {quote ? ` · 「${quote.slice(0, 40)}${quote.length > 40 ? '…' : ''}」` : ''}
                      </p>
                    </li>
                  );
                })}
              </ul>
              {visible.length > 8 && (
                <p className="font-zh text-[10px] text-[var(--text-muted)]">
                  另有 {visible.length - 8} 条，请在管理中查看。
                </p>
              )}
            </section>
          )}

          {data?.externalDoc?.trim() && (
            <section className="rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-20)] p-4">
              <h4 className="font-zh text-xs font-bold text-[var(--text-muted)] mb-2">外部记忆</h4>
              <p className="font-zh text-sm text-[var(--text-secondary)] line-clamp-3">
                {data.externalDoc.trim().slice(0, 200)}
                {data.externalDoc.trim().length > 200 ? '…' : ''}
              </p>
            </section>
          )}

          <button
            type="button"
            onClick={() => setManageOpen(true)}
            className="w-full py-2 text-xs font-zh border border-[var(--border)] rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
          >
            管理记忆
          </button>
        </div>
      )}
    </div>
  );
}

function ManageMemoryPanel({
  data,
  onClose,
  onChange,
}: {
  data: LearnerMemoryData | null;
  onClose: () => void;
  onChange: (d: LearnerMemoryData) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [externalEditing, setExternalEditing] = useState(false);
  const [externalDoc, setExternalDoc] = useState(data?.externalDoc || '');
  const [busy, setBusy] = useState(false);
  const [showRejected, setShowRejected] = useState(false);

  const memories = data?.memories || [];
  const proposed = memories.filter((m) => m.status === 'proposed' || m.status === 'conflicted');
  const confirmed = memories.filter(
    (m) => !m.status || m.status === 'confirmed',
  );
  const rejected = memories.filter((m) => m.status === 'rejected' || m.status === 'expired');

  const refresh = (next: LearnerMemoryData) => {
    onChange(next);
  };

  const handleAdd = async () => {
    if (!draft.trim()) return;
    setBusy(true);
    try {
      const next = await memoryApi('upsertMemory', {
        text: draft.trim(),
        kind: 'preference',
        source: 'manual',
        status: 'confirmed',
      });
      refresh(next);
      setDraft('');
      setAdding(false);
    } finally {
      setBusy(false);
    }
  };

  const handleSaveEdit = async (id: string) => {
    if (!editText.trim()) return;
    setBusy(true);
    try {
      const next = await memoryApi('upsertMemory', { id, text: editText.trim() });
      refresh(next);
      setEditingId(null);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: string) => {
    setBusy(true);
    try {
      const next = await memoryApi('deleteMemory', { id });
      refresh(next);
    } finally {
      setBusy(false);
    }
  };

  const handleConfirm = async (id: string) => {
    setBusy(true);
    try {
      const next = await memoryApi('confirmMemory', { id });
      refresh(next);
    } finally {
      setBusy(false);
    }
  };

  const handleReject = async (id: string) => {
    setBusy(true);
    try {
      const next = await memoryApi('rejectMemory', { id });
      refresh(next);
    } finally {
      setBusy(false);
    }
  };

  const handleSaveExternal = async () => {
    setBusy(true);
    try {
      const next = await memoryApi('saveExternal', { externalDoc });
      refresh(next);
      setExternalEditing(false);
    } finally {
      setBusy(false);
    }
  };

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    } catch {
      return iso;
    }
  };

  const renderRow = (m: MemoryItem) => {
    const status = m.status || 'confirmed';
    const kindLabel = KIND_LABELS[m.kind] || m.kind || '其他';
    const statusLabel = STATUS_LABELS[status] || status;
    const quote = m.evidence?.find((e) => e.quote)?.quote;
    const needsAction = status === 'proposed' || status === 'conflicted';

    return (
      <div
        key={m.id}
        className="rounded-xl border border-[var(--border-20)] bg-[var(--bg-secondary)] px-3 py-2.5 flex gap-2"
      >
        <div className="flex-1 min-w-0">
          {editingId === m.id ? (
            <textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              rows={2}
              className="w-full px-2 py-1 rounded border border-[var(--border)] text-sm font-zh"
            />
          ) : (
            <p className="font-zh text-sm text-[var(--text-primary)]">{m.text}</p>
          )}
          <p className="font-tech text-[10px] text-[var(--text-muted)] mt-1">
            {formatDate(m.lastObservedAt || m.createdAt)} · {kindLabel} · {statusLabel} · 置信{' '}
            {formatConfidence(m.confidence)} · {m.source === 'ai' ? 'AI' : '手动'}
            {quote ? ` · 「${quote.slice(0, 48)}${quote.length > 48 ? '…' : ''}」` : ''}
          </p>
          {needsAction && (
            <div className="flex gap-2 mt-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => handleConfirm(m.id)}
                className="px-2 py-0.5 text-[10px] font-zh rounded bg-blue-600 text-white disabled:opacity-50"
              >
                确认
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => handleReject(m.id)}
                className="px-2 py-0.5 text-[10px] font-zh rounded border border-[var(--border)] text-[var(--text-secondary)] disabled:opacity-50"
              >
                拒绝
              </button>
            </div>
          )}
        </div>
        <div className="flex flex-col gap-1 shrink-0">
          {editingId === m.id ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => handleSaveEdit(m.id)}
              className="text-xs text-blue-600 font-zh"
            >
              保存
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setEditingId(m.id);
                setEditText(m.text);
              }}
              className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              aria-label="编辑"
            >
              <Pencil size={14} />
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => handleDelete(m.id)}
            className="p-1 text-[var(--text-muted)] hover:text-red-500"
            aria-label="删除"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-zh text-base font-bold text-[var(--text-primary)]">记忆管理</h3>
          <p className="font-zh text-xs text-[var(--text-muted)] mt-1">
            AI 提议为「待确认」；确认后注入对话上下文。可编辑、拒绝或删除。
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="px-3 py-1.5 text-xs font-zh border border-blue-500 text-blue-600 rounded-lg"
          >
            添加记忆
          </button>
          <button type="button" onClick={onClose} className="p-1 text-[var(--text-muted)]" aria-label="关闭">
            <X size={18} />
          </button>
        </div>
      </div>

      {adding && (
        <div className="rounded-xl border border-[var(--border)] p-3 space-y-2">
          <div className="font-zh text-xs text-[var(--text-muted)]">手动添加（确认态）</div>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            placeholder="用一两句话描述希望记住的内容…"
            className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] text-sm font-zh"
          />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setAdding(false)} className="px-3 py-1 text-xs font-zh">
              取消
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={handleAdd}
              className="px-3 py-1 text-xs font-zh bg-blue-600 text-white rounded-lg"
            >
              保存
            </button>
          </div>
        </div>
      )}

      <div className="space-y-4 max-h-[42vh] overflow-y-auto">
        {proposed.length > 0 && (
          <section className="space-y-2">
            <h4 className="font-zh text-xs font-bold text-amber-600">待确认 / 冲突（{proposed.length}）</h4>
            {proposed.map(renderRow)}
          </section>
        )}

        <section className="space-y-2">
          <h4 className="font-zh text-xs font-bold text-[var(--text-muted)]">
            已确认（{confirmed.length}）
          </h4>
          {confirmed.length === 0 && proposed.length === 0 && rejected.length === 0 ? (
            <p className="font-zh text-sm text-[var(--text-muted)] text-center py-6">暂无记忆条目</p>
          ) : confirmed.length === 0 ? (
            <p className="font-zh text-xs text-[var(--text-muted)]">尚无已确认条目</p>
          ) : (
            confirmed.map(renderRow)
          )}
        </section>

        {rejected.length > 0 && (
          <section className="space-y-2">
            <button
              type="button"
              onClick={() => setShowRejected((v) => !v)}
              className="font-zh text-xs text-[var(--text-muted)] underline"
            >
              {showRejected ? '隐藏' : '显示'}已拒绝/过期（{rejected.length}）
            </button>
            {showRejected && rejected.map(renderRow)}
          </section>
        )}
      </div>

      <section className="border-t border-[var(--border-20)] pt-4 space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="font-zh text-sm font-bold text-[var(--text-primary)]">外部记忆</h4>
          <button
            type="button"
            onClick={() => {
              setExternalDoc(data?.externalDoc || '');
              setExternalEditing(true);
            }}
            className="px-3 py-1 text-xs font-zh border border-[var(--border)] rounded-lg"
          >
            编辑记忆
          </button>
        </div>
        <p className="font-zh text-xs text-[var(--text-muted)]">
          粘贴从其他助手复制的记忆文档。点击编辑以更新。
        </p>
        {externalEditing ? (
          <div className="space-y-2">
            <textarea
              value={externalDoc}
              onChange={(e) => setExternalDoc(e.target.value)}
              rows={5}
              className="w-full px-3 py-2 rounded-lg border border-[var(--border)] text-sm font-zh"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setExternalEditing(false)}
                className="text-xs font-zh px-2"
              >
                取消
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={handleSaveExternal}
                className="text-xs font-zh px-3 py-1 bg-blue-600 text-white rounded-lg"
              >
                保存
              </button>
            </div>
          </div>
        ) : (
          <p className="font-zh text-sm text-[var(--text-muted)] italic text-center py-4">
            {data?.externalDoc?.trim() ? data.externalDoc.slice(0, 200) : '尚未导入外部记忆。'}
          </p>
        )}
      </section>

      <button type="button" onClick={onClose} className="font-zh text-sm text-[var(--text-secondary)]">
        ← 返回记忆总览
      </button>
    </div>
  );
}

function SafetyTab({
  localSettings,
  safetyMsg,
  safetySaving,
  onSelectLevel,
  onRevoke,
  onToggleCategory,
  onOpenAudit,
}: {
  localSettings: Settings;
  safetyMsg: string | null;
  safetySaving: boolean;
  onSelectLevel: (policy: ApprovalPolicy, categories?: AutonomyCategory[]) => void | Promise<void>;
  onRevoke: () => void | Promise<void>;
  onToggleCategory: (cat: AutonomyCategory) => void | Promise<void>;
  onOpenAudit: () => void;
}) {
  const grant = localSettings.autonomyGrant;
  // Snapshot clock once per mount — avoid impure Date.now() during render.
  const [nowMs] = useState(() => Date.now());
  const grantExpiryMs = grant ? Date.parse(grant.expiresAt) : NaN;
  const grantExpired =
    !!grant && Number.isFinite(grantExpiryMs) && grantExpiryMs <= nowMs;
  const elevated =
    localSettings.approvalPolicy === 'bounded_auto' ||
    localSettings.approvalPolicy === 'full_auto';

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h3 className="font-zh text-sm font-bold text-[var(--text-primary)]">当前级别</h3>
        <div className="border border-[var(--border)] bg-[var(--bg-secondary)] p-4 space-y-2">
          <p className="font-zh text-base font-bold text-[var(--text-primary)]">
            {POLICY_SHORT[localSettings.approvalPolicy]}
            {localSettings.approvalPolicy === 'full_auto' && (
              <span className="ml-2 text-[10px] font-zh tracking-wider text-amber-700 border border-amber-500/40 px-1.5 py-0.5">
                本机完全自主
              </span>
            )}
            {localSettings.approvalPolicy === 'bounded_auto' && (
              <span className="ml-2 text-[10px] font-zh tracking-wider text-sky-700 border border-sky-500/40 px-1.5 py-0.5">
                有界自主
              </span>
            )}
          </p>
          <p className="font-zh text-xs text-[var(--text-secondary)]">
            执行环境：
            <span className="ml-1">
              {localSettings.executionEnvironment === 'local' ? '本机' : '安全环境'}
            </span>
          </p>
          {grant && !grantExpired && (
            <p className="font-zh text-xs text-[var(--text-secondary)]">
              授权类别：
              {(grant.allowedCategories || []).map((c) => CATEGORY_OPTIONS.find((o) => o.id === c)?.label || c).join('、') || '无'}
              <br />
              过期时间：
              <span className="font-tech ml-1">{new Date(grant.expiresAt).toLocaleString()}</span>
            </p>
          )}
          {grantExpired && (
            <p className="font-zh text-xs text-amber-600">授权已过期，刷新后将自动降级为监督模式。</p>
          )}
          {elevated && (
            <button
              type="button"
              onClick={() => void onRevoke()}
              className="mt-1 text-xs font-zh px-3 py-1.5 border border-[var(--error)]/50 text-[var(--error)] hover:bg-[var(--error)]/10"
            >
              立即撤销自主授权
            </button>
          )}
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="font-zh text-sm font-bold text-[var(--text-primary)]">选择安全级别</h3>
        <div className="space-y-2">
          {SAFETY_LEVELS.map((level) => {
            const active = localSettings.approvalPolicy === level.id;
            return (
              <button
                key={level.id}
                type="button"
                disabled={safetySaving}
                onClick={() => void onSelectLevel(level.id)}
                className={`w-full text-left border p-3 transition-colors ${
                  active
                    ? 'border-[var(--accent)] bg-[var(--bg-tertiary)]'
                    : 'border-[var(--border-20)] hover:border-[var(--border)] hover:bg-[var(--bg-secondary)]'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-zh text-sm font-bold text-[var(--text-primary)]">
                    {level.title}
                  </span>
                  {active && <Check size={iconSizes.sm} className="text-[var(--accent)]" aria-hidden />}
                </div>
                <p className="font-zh text-xs text-[var(--text-secondary)] mt-1 leading-relaxed">
                  {level.desc}
                </p>
              </button>
            );
          })}
        </div>
        {safetyMsg && (
          <p className="font-zh text-xs text-[var(--text-muted)] mt-1">{safetyMsg}</p>
        )}
      </section>

      {elevated && (
        <section className="space-y-2">
          <h3 className="font-zh text-sm font-bold text-[var(--text-primary)]">授权类别</h3>
          <p className="font-zh text-xs text-[var(--text-muted)]">
            仅列出可预授权的安全类别；红线操作永远不会出现在此列表。
          </p>
          <div className="flex flex-wrap gap-2">
            {CATEGORY_OPTIONS.map((opt) => {
              const on = (grant?.allowedCategories || []).includes(opt.id);
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => void onToggleCategory(opt.id)}
                  className={`text-xs font-zh px-2.5 py-1 border ${
                    on
                      ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--text-primary)]'
                      : 'border-[var(--border-20)] text-[var(--text-muted)]'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </section>
      )}

      <section className="space-y-2">
        <h3 className="font-zh text-sm font-bold text-[var(--text-primary)]">永久红线（任何级别均禁止）</h3>
        <ul className="border border-[var(--border-20)] bg-[var(--bg-secondary)] p-3 space-y-1">
          {RED_LINE_ITEMS.map((item) => (
            <li key={item} className="font-zh text-xs text-[var(--text-secondary)] flex items-start gap-2">
              <span className="text-[var(--error)] mt-0.5">✕</span>
              {item}
            </li>
          ))}
        </ul>
        <p className="font-zh text-[11px] text-[var(--text-muted)]">
          学习写入（课程 / 日历 / 进度）需要你明确确认后才会保存，与自主级别无关。
        </p>
      </section>

      <section className="space-y-2">
        <h3 className="font-zh text-sm font-bold text-[var(--text-primary)]">审计入口</h3>
        <p className="font-zh text-[11px] text-[var(--text-muted)]">
          策略变更与确认事件写入本地审计日志。完整列表见「审计」页签。
        </p>
        <button
          type="button"
          onClick={onOpenAudit}
          className="text-xs font-zh px-3 py-1.5 border border-[var(--border)] text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
        >
          打开审计日志
        </button>
      </section>
    </div>
  );
}

function DataStorageTab() {
  const importInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{
    kind: 'success' | 'error' | 'info';
    message: string;
  } | null>(null);
  const [pendingImport, setPendingImport] = useState<{
    fileName: string;
    server: { schemaVersion: number; learning: unknown; memory: unknown };
    chat: string | null;
    settings: string | null;
    counts: { conversations: number; courses: number; documents: number; tasks: number };
  } | null>(null);

  const sanitizePersistedSettings = (raw: string | null): string | null => {
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      state?: {
        settings?: {
          workspacePath?: string;
          providers?: Array<Record<string, unknown>>;
        };
      };
    };
    const settings = parsed.state?.settings;
    if (settings) {
      settings.workspacePath = '';
      if (Array.isArray(settings.providers)) {
        settings.providers = settings.providers.map((provider) => ({
          ...provider,
          apiKey: '',
        }));
      }
    }
    return JSON.stringify(parsed);
  };

  const handleExport = async () => {
    setBusy(true);
    setStatus({ kind: 'info', message: '正在整理本地数据包…' });
    try {
      const response = await fetch('/api/settings/data');
      const json = await response.json();
      if (!response.ok || !json.success) {
        throw new Error(json.error || '导出失败');
      }
      const backup = {
        product: 'minus',
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        server: json.data,
        browser: {
          chat: window.localStorage.getItem('minus-chat'),
          settings: sanitizePersistedSettings(
            window.localStorage.getItem('minus-settings'),
          ),
        },
      };
      const blob = new Blob([JSON.stringify(backup, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      const stamp = new Date().toISOString().slice(0, 10);
      anchor.href = url;
      anchor.download = `minus-backup-${stamp}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setStatus({
        kind: 'success',
        message: '数据包已导出。模型密钥、授权文件和审计日志未包含在备份中。',
      });
    } catch (error) {
      setStatus({
        kind: 'error',
        message: error instanceof Error ? error.message : '导出失败',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleImport = async (file: File) => {
    if (file.size > 25 * 1024 * 1024) {
      setStatus({ kind: 'error', message: '备份文件超过 25 MB，未导入。' });
      return;
    }
    setBusy(true);
    setStatus({ kind: 'info', message: '正在校验数据包…' });
    try {
      const parsed = JSON.parse(await file.text()) as {
        product?: string;
        schemaVersion?: number;
        server?: {
          schemaVersion?: number;
          learning?: unknown;
          memory?: unknown;
        };
        browser?: { chat?: string | null; settings?: string | null };
      };
      if (
        parsed.product !== 'minus' ||
        parsed.schemaVersion !== 1 ||
        parsed.server?.schemaVersion !== 1
      ) {
        throw new Error('这不是受支持的 Minus 数据包');
      }

      const parsedChat = parsed.browser?.chat
        ? (JSON.parse(parsed.browser.chat) as {
            state?: { conversations?: unknown[] };
          })
        : null;
      const safeSettings = parsed.browser?.settings
        ? sanitizePersistedSettings(parsed.browser.settings)
        : null;
      const learning = parsed.server.learning as Record<string, unknown>;
      setPendingImport({
        fileName: file.name,
        server: {
          schemaVersion: 1,
          learning: parsed.server.learning,
          memory: parsed.server.memory,
        },
        chat: parsed.browser?.chat || null,
        settings: safeSettings,
        counts: {
          conversations: parsedChat?.state?.conversations?.length || 0,
          courses: Array.isArray(learning.courses) ? learning.courses.length : 0,
          documents: Array.isArray(learning.documents) ? learning.documents.length : 0,
          tasks: Array.isArray(learning.tasks) ? learning.tasks.length : 0,
        },
      });
      setStatus({
        kind: 'info',
        message: '校验通过。确认前不会写入或覆盖任何数据。',
      });
    } catch (error) {
      setPendingImport(null);
      setStatus({
        kind: 'error',
        message: error instanceof Error ? error.message : '导入失败',
      });
    } finally {
      setBusy(false);
    }
  };

  const confirmImport = async () => {
    if (!pendingImport) return;
    setBusy(true);
    setStatus({ kind: 'info', message: '正在备份当前数据并执行恢复…' });

    const previousChat = window.localStorage.getItem('minus-chat');
    const previousSettings = window.localStorage.getItem('minus-settings');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const browserBackupKey = `minus-browser-backup-${stamp}`;
    const browserBackup = JSON.stringify({
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      chat: previousChat,
      settings: previousSettings,
    });

    const restoreBrowserState = () => {
      if (previousChat == null) window.localStorage.removeItem('minus-chat');
      else window.localStorage.setItem('minus-chat', previousChat);
      if (previousSettings == null) window.localStorage.removeItem('minus-settings');
      else window.localStorage.setItem('minus-settings', previousSettings);
    };

    let rollbackToken: string | null = null;
    try {
      window.localStorage.setItem(browserBackupKey, browserBackup);
      if (window.localStorage.getItem(browserBackupKey) !== browserBackup) {
        throw new Error('无法创建浏览器数据备份，恢复已取消');
      }

      const response = await fetch('/api/settings/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'import', data: pendingImport.server }),
      });
      const json = await response.json();
      if (!response.ok || !json.success) {
        throw new Error(json.error || '导入失败');
      }
      rollbackToken = String(json.data?.rollbackToken || '') || null;

      try {
        if (pendingImport.chat) {
          window.localStorage.setItem('minus-chat', pendingImport.chat);
        } else {
          window.localStorage.removeItem('minus-chat');
        }
        if (pendingImport.settings) {
          window.localStorage.setItem('minus-settings', pendingImport.settings);
        } else {
          window.localStorage.removeItem('minus-settings');
        }
      } catch (browserError) {
        restoreBrowserState();
        throw browserError;
      }

      setPendingImport(null);
      setStatus({ kind: 'success', message: '恢复完成，正在重新载入工作台…' });
      window.setTimeout(() => window.location.reload(), 650);
    } catch (error) {
      try {
        restoreBrowserState();
      } catch {
        // The dated browser backup remains for manual recovery.
      }
      if (rollbackToken) {
        try {
          await fetch('/api/settings/data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'rollback', token: rollbackToken }),
          });
        } catch {
          // Server keeps the rollback snapshot on disk for manual recovery.
        }
      }
      setStatus({
        kind: 'error',
        message: error instanceof Error ? error.message : '导入失败，已尝试回滚',
      });
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h3 className="font-zh text-base font-bold text-[var(--text-primary)]">数据与存储</h3>
        <p className="font-zh text-xs text-[var(--text-muted)] mt-1">
          核心数据在本机，不依赖云同步。你可以下载一个带版本号的数据包，并在同一台或另一台 Minus 上恢复。
        </p>
      </div>

      <section className="surface-card p-4 sm:p-5 space-y-3">
        <div>
          <h4 className="font-zh text-sm font-bold text-[var(--text-primary)]">备份与恢复</h4>
          <p className="mt-1 font-zh text-xs leading-relaxed text-[var(--text-muted)]">
            包含课程、资料、日程、学习记录、记忆与对话。不会导出 API Key、授权文件或审计日志。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void handleExport()}
            disabled={busy}
            className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-[var(--user-bubble-bg)] px-4 font-zh text-sm font-bold text-[var(--user-bubble-text)] disabled:opacity-50"
          >
            <Download size={16} aria-hidden />
            导出数据包
          </button>
          <button
            type="button"
            onClick={() => importInputRef.current?.click()}
            disabled={busy}
            className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 font-zh text-sm text-[var(--text-primary)] disabled:opacity-50"
          >
            <UploadCloud size={16} aria-hidden />
            选择数据包
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleImport(file);
              event.currentTarget.value = '';
            }}
            aria-label="选择 Minus 数据包"
          />
        </div>
        {status && (
          <p
            role="status"
            className={`rounded-lg px-3 py-2 font-zh text-xs ${
              status.kind === 'error'
                ? 'bg-[var(--error-bg)] text-[var(--error)]'
                : status.kind === 'success'
                  ? 'bg-[var(--success-bg)] text-[var(--success)]'
                  : 'bg-[var(--surface-soft)] text-[var(--text-secondary)]'
            }`}
          >
            {status.message}
          </p>
        )}
        {pendingImport && (
          <div className="rounded-xl border border-[var(--accent)]/30 bg-[var(--accent-soft)] p-4 space-y-3">
            <div>
              <p className="font-zh text-sm font-bold text-[var(--text-primary)]">
                即将恢复「{pendingImport.fileName}」
              </p>
              <p className="mt-1 font-zh text-xs text-[var(--text-secondary)]">
                {pendingImport.counts.conversations} 段对话 · {pendingImport.counts.courses} 门课程 · {pendingImport.counts.documents} 份资料 · {pendingImport.counts.tasks} 项任务
              </p>
            </div>
            <p className="font-zh text-xs leading-relaxed text-[var(--text-muted)]">
              确认后将覆盖当前对话、偏好、课程、资料、日程与记忆。Minus 会先保存浏览器侧日期化备份和服务端回滚快照；确认前不会写入。
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void confirmImport()}
                disabled={busy}
                className="inline-flex min-h-[40px] items-center rounded-lg bg-[var(--user-bubble-bg)] px-4 font-zh text-sm font-bold text-[var(--user-bubble-text)] disabled:opacity-50"
              >
                确认覆盖并恢复
              </button>
              <button
                type="button"
                onClick={() => {
                  setPendingImport(null);
                  setStatus(null);
                }}
                disabled={busy}
                className="inline-flex min-h-[40px] items-center rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 font-zh text-sm text-[var(--text-primary)] disabled:opacity-50"
              >
                取消
              </button>
            </div>
          </div>
        )}
      </section>

      <ul className="space-y-2 font-zh text-sm text-[var(--text-secondary)]">
        <li className="soft-card px-3 py-2.5">
          <span className="font-bold text-[var(--text-primary)]">学习数据</span>
          <p className="font-tech text-xs text-[var(--text-muted)] mt-1">~/.minus/data/learning-data.json</p>
        </li>
        <li className="soft-card px-3 py-2.5">
          <span className="font-bold text-[var(--text-primary)]">模型密钥</span>
          <p className="font-tech text-xs text-[var(--text-muted)] mt-1">~/.minus/data/provider-secrets.json</p>
        </li>
        <li className="soft-card px-3 py-2.5">
          <span className="font-bold text-[var(--text-primary)]">安全授权</span>
          <p className="font-tech text-xs text-[var(--text-muted)] mt-1">~/.minus/data/autonomy-grant.json</p>
        </li>
        <li className="soft-card px-3 py-2.5">
          <span className="font-bold text-[var(--text-primary)]">审计日志</span>
          <p className="font-tech text-xs text-[var(--text-muted)] mt-1">~/.minus/logs/safety-audit.jsonl</p>
        </li>
        <li className="soft-card px-3 py-2.5">
          <span className="font-bold text-[var(--text-primary)]">浏览器偏好</span>
          <p className="font-tech text-xs text-[var(--text-muted)] mt-1">localStorage（设置 / 对话列表）</p>
        </li>
      </ul>
      <p className="font-zh text-[11px] leading-relaxed text-[var(--text-muted)] px-1">
        恢复前会为当前学习数据和记忆创建日期化本机备份。恢复不会读取或覆盖模型密钥。
      </p>
    </div>
  );
}

function ThemeTab({
  theme,
  onSelectTheme,
}: {
  theme: Settings['theme'];
  onSelectTheme: (theme: Settings['theme']) => void;
}) {
  const themes: { id: Settings['theme']; label: string; desc: string; icon: typeof Sun }[] = [
    { id: 'light', label: '浅色', desc: '奶油纸张底色，适合日间阅读', icon: Sun },
    { id: 'dark', label: '深色', desc: '墨色低亮度界面，适合夜间使用', icon: Moon },
    { id: 'system', label: '跟随系统', desc: '自动匹配系统外观设置', icon: Monitor },
  ];

  return (
    <div className="space-y-5">
      <div>
        <label className="block font-zh text-sm font-bold text-[var(--text-primary)] mb-3">外观模式</label>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {themes.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => onSelectTheme(t.id)}
              aria-pressed={theme === t.id}
              className={`flex items-center gap-2 px-3 py-3 text-left border transition-colors rounded-lg ${
                theme === t.id
                  ? 'border-[var(--accent)] bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
                  : 'border-[var(--border-20)] text-[var(--text-secondary)] hover:border-[var(--border-40)]'
              }`}
            >
              {theme === t.id
                ? <Check size={14} className="text-[var(--accent)] shrink-0" />
                : <t.icon size={14} aria-hidden className="shrink-0" />}
              <div className="min-w-0">
                <div className="font-zh text-sm font-bold truncate">{t.label}</div>
                <div className="font-zh text-[10px] text-[var(--text-muted)] truncate">{t.desc}</div>
              </div>
            </button>
          ))}
        </div>
        <p className="font-tech text-xs text-[var(--text-muted)] mt-2">主题选择即时生效，保存在本地浏览器。</p>
      </div>
    </div>
  );
}

function AboutTab() {
  return (
    <div className="space-y-6">
      <div className="text-center py-8">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-[var(--bg-tertiary)] border border-[var(--border)] flex items-center justify-center">
          <MinusLogo variant="mark" size={40} label="Minus" />
        </div>
        <h3 className="minus-wordmark text-xl text-[var(--text-primary)]">Minus</h3>
        <p className="font-zh text-sm text-[var(--text-muted)] mt-1">本地优先的学习伙伴</p>
        <p className="font-tech text-xs text-[var(--text-muted)]/60 mt-1">v{APP_VERSION}</p>
      </div>
      <p className="font-zh text-xs text-[var(--text-muted)] text-center leading-relaxed">
        数据与密钥保留在本地（~/.minus）。主页为对话与 Desktop；学习需确认后进入。
        无内置完整视频播放器。独立产品，非第三方品牌克隆。
      </p>
    </div>
  );
}
