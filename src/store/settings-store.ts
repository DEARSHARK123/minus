import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ExecutionEnvironment = 'sandbox' | 'local';

export type ApprovalPolicy =
  | 'chat_only'
  | 'supervised'
  | 'bounded_auto'
  | 'full_auto';

export type AutonomyCategory =
  | 'web_search'
  | 'code_run'
  | 'artifacts_write'
  | 'package_install';

export interface AutonomyGrant {
  allowedCategories: AutonomyCategory[];
  expiresAt: string;
  approvedBy: 'user';
}

export interface Provider {
  id: string;
  name: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  enabled: boolean;
}

export interface Settings {
  providerId: string;
  providers: Provider[];
  temperature: number;
  maxTokens: number;
  topP: number;
  frequencyPenalty: number;
  presencePenalty: number;
  userName: string;
  systemPrompt: string;
  theme: 'dark' | 'light' | 'system';
  chatFontSize: number;
  showToolUse: boolean;
  toolCallExpandedByDefault: boolean;
  language: string;
  autoSave: boolean;
  notifications: boolean;
  /**
   * Legacy binary mode. Kept in sync with executionEnvironment:
   * sandbox → sandbox, local → trust.
   */
  executionMode: 'sandbox' | 'trust';
  /** Where tools run: isolated sandbox vs local host. */
  executionEnvironment: ExecutionEnvironment;
  /** Product approval tier. Default supervised. */
  approvalPolicy: ApprovalPolicy;
  /** Optional time-bounded category grant (client mirror; server is authority). */
  autonomyGrant: AutonomyGrant | null;
  workspacePath: string;
}

const DEFAULT_PROVIDERS: Provider[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    apiKey: '',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o',
    enabled: true,
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    apiKey: '',
    baseUrl: 'https://api.anthropic.com/v1',
    model: 'claude-sonnet-4-20250514',
    enabled: false,
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    apiKey: '',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    model: 'gemini-2.5-pro',
    enabled: false,
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    apiKey: '',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    enabled: true,
  },
  {
    id: 'custom',
    name: '自定义',
    apiKey: '',
    baseUrl: '',
    model: '',
    enabled: false,
  },
];

const defaultSettings: Settings = {
  providerId: 'openai',
  providers: DEFAULT_PROVIDERS,
  temperature: 0.7,
  maxTokens: 4096,
  topP: 1,
  frequencyPenalty: 0,
  presencePenalty: 0,
  userName: '',
  systemPrompt: '',
  theme: 'light',
  chatFontSize: 14,
  showToolUse: true,
  toolCallExpandedByDefault: false,
  language: 'zh-CN',
  autoSave: true,
  notifications: true,
  executionMode: 'sandbox',
  executionEnvironment: 'sandbox',
  approvalPolicy: 'supervised',
  autonomyGrant: null,
  workspacePath: '',
};

function isApprovalPolicy(v: unknown): v is ApprovalPolicy {
  return (
    v === 'chat_only' ||
    v === 'supervised' ||
    v === 'bounded_auto' ||
    v === 'full_auto'
  );
}

function isAutonomyCategory(v: unknown): v is AutonomyCategory {
  return (
    v === 'web_search' ||
    v === 'code_run' ||
    v === 'artifacts_write' ||
    v === 'package_install'
  );
}

function normalizeGrant(raw: unknown): AutonomyGrant | null {
  if (!raw || typeof raw !== 'object') return null;
  const g = raw as Record<string, unknown>;
  const expiresAt = typeof g.expiresAt === 'string' ? g.expiresAt : '';
  if (!expiresAt) return null;
  const categories = Array.isArray(g.allowedCategories)
    ? (g.allowedCategories.filter(isAutonomyCategory) as AutonomyCategory[])
    : [];
  return {
    allowedCategories: categories,
    expiresAt,
    approvedBy: 'user',
  };
}

function isGrantExpired(grant: AutonomyGrant | null): boolean {
  if (!grant) return true;
  const t = Date.parse(grant.expiresAt);
  if (!Number.isFinite(t)) return true;
  return t <= Date.now();
}

/**
 * Migrate legacy executionMode-only settings and expire stale grants.
 */
function migrateSafetyFields(
  partial: Partial<Settings> & { executionMode?: 'sandbox' | 'trust' },
): Pick<
  Settings,
  'executionMode' | 'executionEnvironment' | 'approvalPolicy' | 'autonomyGrant'
> {
  let executionEnvironment: ExecutionEnvironment =
    partial.executionEnvironment === 'local' ? 'local' : 'sandbox';
  let approvalPolicy: ApprovalPolicy = isApprovalPolicy(partial.approvalPolicy)
    ? partial.approvalPolicy
    : 'supervised';
  let autonomyGrant = normalizeGrant(partial.autonomyGrant);

  // Legacy: only executionMode present
  if (
    partial.executionEnvironment === undefined &&
    partial.approvalPolicy === undefined
  ) {
    if (partial.executionMode === 'trust') {
      executionEnvironment = 'local';
      approvalPolicy = 'supervised';
    } else {
      executionEnvironment = 'sandbox';
      approvalPolicy = 'supervised';
    }
  }

  // Expired grant auto-downgrade
  if (
    (approvalPolicy === 'bounded_auto' || approvalPolicy === 'full_auto') &&
    isGrantExpired(autonomyGrant)
  ) {
    approvalPolicy = 'supervised';
    executionEnvironment = 'sandbox';
    autonomyGrant = null;
  }

  // Keep dimensions consistent for product tiers
  if (approvalPolicy === 'chat_only') {
    executionEnvironment = 'sandbox';
    autonomyGrant = null;
  } else if (approvalPolicy === 'supervised') {
    // env may be sandbox (default) or local after trust elevation; leave as-is if set
    if (partial.executionEnvironment === undefined && partial.executionMode === 'trust') {
      executionEnvironment = 'local';
    }
  } else if (approvalPolicy === 'bounded_auto') {
    executionEnvironment = 'sandbox';
  } else if (approvalPolicy === 'full_auto') {
    executionEnvironment = 'local';
  }

  const executionMode: 'sandbox' | 'trust' =
    executionEnvironment === 'local' ? 'trust' : 'sandbox';

  return {
    executionMode,
    executionEnvironment,
    approvalPolicy,
    autonomyGrant,
  };
}

/** Strip secrets and client-side provider config before writing to storage. */
function sanitizeSettingsForPersist(settings: Settings): Record<string, unknown> {
  const { workspacePath: _wp, ...rest } = settings;
  void _wp;
  return {
    ...rest,
    providers: settings.providers.map((p) => ({
      id: p.id,
      name: p.name,
      enabled: p.enabled,
    })),
  };
}

function migrateProvider(p: Provider): Provider {
  // Legacy id "google" → "gemini"
  const id = p.id === 'google' ? 'gemini' : p.id;
  const defaultP = DEFAULT_PROVIDERS.find((dp) => dp.id === id);
  return {
    ...(defaultP || p),
    ...p,
    id,
    // Never rehydrate stored api keys
    apiKey: '',
  };
}

interface SettingsStore {
  settings: Settings;
  updateSettings: (updates: Partial<Settings>) => void;
  resetSettings: () => void;
  getActiveProvider: () => Provider;
  switchProvider: (providerId: string) => void;
  updateProvider: (providerId: string, updates: Partial<Provider>) => void;
  addProvider: (provider: Provider) => void;
  removeProvider: (providerId: string) => void;
  getApiKey: () => string;
  setApiKey: (apiKey: string) => void;
  /** Revoke autonomy → supervised + sandbox; clear grant. */
  revokeAutonomy: () => void;
  /** Apply product tier + optional grant; keeps executionMode in sync. */
  setSafetyLevel: (
    policy: ApprovalPolicy,
    opts?: {
      categories?: AutonomyCategory[];
      expiresAt?: string;
      executionEnvironment?: ExecutionEnvironment;
    },
  ) => void;
}

function withSyncedSafety(updates: Partial<Settings>, prev: Settings): Settings {
  const merged = { ...prev, ...updates };
  const safety = migrateSafetyFields(merged);
  return { ...merged, ...safety };
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set, get) => ({
      settings: defaultSettings,

      updateSettings: (updates) =>
        set((store) => ({
          settings: withSyncedSafety(updates, store.settings),
        })),

      resetSettings: () =>
        set({
          settings: {
            ...defaultSettings,
            providers: DEFAULT_PROVIDERS.map((p) => ({ ...p })),
          },
        }),

      getActiveProvider: () => {
        const { settings } = get();
        return (
          settings.providers.find((p) => p.id === settings.providerId) ||
          settings.providers[0]
        );
      },

      switchProvider: (providerId) =>
        set((store) => ({
          settings: { ...store.settings, providerId },
        })),

      updateProvider: (providerId, updates) =>
        set((store) => ({
          settings: {
            ...store.settings,
            providers: store.settings.providers.map((p) =>
              p.id === providerId ? { ...p, ...updates } : p,
            ),
          },
        })),

      addProvider: (provider) =>
        set((store) => ({
          settings: {
            ...store.settings,
            providers: [...store.settings.providers, provider],
          },
        })),

      removeProvider: (providerId) =>
        set((store) => {
          const newProviders = store.settings.providers.filter(
            (p) => p.id !== providerId,
          );
          const newProviderId =
            store.settings.providerId === providerId
              ? newProviders[0]?.id || 'openai'
              : store.settings.providerId;
          return {
            settings: {
              ...store.settings,
              providers: newProviders,
              providerId: newProviderId,
            },
          };
        }),

      getApiKey: () => get().getActiveProvider().apiKey,

      setApiKey: (apiKey) => {
        const provider = get().getActiveProvider();
        get().updateProvider(provider.id, { apiKey });
      },

      revokeAutonomy: () => {
        get().updateSettings({
          approvalPolicy: 'supervised',
          executionEnvironment: 'sandbox',
          executionMode: 'sandbox',
          autonomyGrant: null,
        });
      },

      setSafetyLevel: (policy, opts) => {
        let autonomyGrant: AutonomyGrant | null = null;
        let executionEnvironment: ExecutionEnvironment = 'sandbox';

        switch (policy) {
          case 'chat_only':
            autonomyGrant = null;
            executionEnvironment = 'sandbox';
            break;
          case 'supervised':
            autonomyGrant = null;
            executionEnvironment = opts?.executionEnvironment === 'local' ? 'local' : 'sandbox';
            break;
          case 'bounded_auto': {
            const categories = opts?.categories?.length
              ? opts.categories
              : (['web_search', 'code_run', 'artifacts_write'] as AutonomyCategory[]);
            const expiresAt =
              opts?.expiresAt ||
              new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
            autonomyGrant = {
              allowedCategories: categories,
              expiresAt,
              approvedBy: 'user',
            };
            executionEnvironment = 'sandbox';
            break;
          }
          case 'full_auto': {
            const categories = opts?.categories?.length
              ? opts.categories
              : ([
                  'web_search',
                  'code_run',
                  'artifacts_write',
                  'package_install',
                ] as AutonomyCategory[]);
            const expiresAt =
              opts?.expiresAt ||
              new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
            autonomyGrant = {
              allowedCategories: categories,
              expiresAt,
              approvedBy: 'user',
            };
            executionEnvironment = 'local';
            break;
          }
          default: {
            const _exhaustive: never = policy;
            void _exhaustive;
            autonomyGrant = null;
            executionEnvironment = 'sandbox';
          }
        }

        get().updateSettings({
          approvalPolicy: policy,
          executionEnvironment,
          executionMode: executionEnvironment === 'local' ? 'trust' : 'sandbox',
          autonomyGrant,
        });
      },
    }),
    {
      name: 'minus-settings',
      version: 1,
      migrate: (persistedState, version) => {
        // 历史事故：一次未提交的重写意外移除了设置弹窗中的主题切换标签页，
        // 导致 localStorage 中存过 theme: 'dark' 的用户没有任何界面可以切回，
        // 永远卡在深色模式。从旧版本（persist 无 version 字段，即 version 0）
        // 迁移时，一次性把 theme 强制重置为 'light'（浅色默认）；
        // 之后用户可通过恢复回来的「设置 → 主题」标签页自由切换。
        const persisted = persistedState as {
          settings?: Record<string, unknown>;
        };
        if (version < 1 && persisted?.settings) {
          return {
            ...persisted,
            settings: { ...persisted.settings, theme: 'light' },
          };
        }
        return persistedState as { settings: Record<string, unknown> };
      },
      // Rehydrate together with chat state before mounting the product shell.
      // This prevents persisted provider/safety preferences from changing the
      // first client render relative to the server-rendered fallback.
      skipHydration: true,
      partialize: (state) => ({
        settings: sanitizeSettingsForPersist(state.settings),
      }),
      merge: (persisted, current) => {
        const persistedSettings = (persisted as { settings?: Partial<Settings> })
          ?.settings;
        if (!persistedSettings) return current;

        const rawProviders = persistedSettings.providers as Provider[] | undefined;
        const providers =
          rawProviders?.map(migrateProvider) ||
          DEFAULT_PROVIDERS.map((p) => ({ ...p }));

        // Migrate active providerId google → gemini
        let providerId =
          persistedSettings.providerId ?? current.settings.providerId;
        if (providerId === 'google') providerId = 'gemini';

        const safety = migrateSafetyFields(persistedSettings);

        return {
          ...current,
          settings: {
            ...current.settings,
            ...persistedSettings,
            providerId,
            // Never restore workspacePath or apiKeys from storage
            workspacePath: '',
            providers,
            ...safety,
          },
        };
      },
    },
  ),
);
