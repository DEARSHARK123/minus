/**
 * Client-safe action policy: types, labels, pure helpers.
 * No Node builtins (fs/path/os) — safe for client/migration bundles.
 * Server I/O + resolveEffectivePolicy live in action-policy.ts.
 */

// ── Types ──────────────────────────────────────────────────────────────────

export type ExecutionEnvironment = 'sandbox' | 'local';
export type NetworkAccessMode = 'allow' | 'ask' | 'off';

export type ApprovalPolicy =
  | 'chat_only'
  | 'supervised'
  | 'bounded_auto'
  | 'full_auto';

/** Categories that may be pre-authorized for auto-approve. Never red-line ops. */
export type AutonomyCategory =
  | 'web_search'
  | 'code_run'
  | 'artifacts_write'
  | 'package_install';

/** Permanent red lines — never auto-approved, even under full_auto. */
export type RedLineOp =
  | 'credentials'
  | 'path_escape'
  | 'privilege_expand'
  | 'sensitive_delete'
  | 'unauthorized_publish';

export interface AutonomyGrant {
  allowedCategories: AutonomyCategory[];
  expiresAt: string;
  approvedBy: 'user';
}

export const ALL_AUTONOMY_CATEGORIES: AutonomyCategory[] = [
  'web_search',
  'code_run',
  'artifacts_write',
  'package_install',
];

export const RED_LINE_OPS: RedLineOp[] = [
  'credentials',
  'path_escape',
  'privilege_expand',
  'sensitive_delete',
  'unauthorized_publish',
];

export const RED_LINE_LABELS: Record<RedLineOp, string> = {
  credentials: '读取凭据 / 密钥',
  path_escape: '越出工作区路径',
  privilege_expand: '权限提升（sudo 等）',
  sensitive_delete: '敏感删除',
  unauthorized_publish: '未授权外发 / 发布',
};

export const CATEGORY_LABELS: Record<AutonomyCategory, string> = {
  web_search: '网络搜索',
  code_run: '代码执行',
  artifacts_write: '写入产物',
  package_install: '安装依赖',
};

export const POLICY_LABELS: Record<ApprovalPolicy, string> = {
  chat_only: '仅对话',
  supervised: '监督模式',
  bounded_auto: '有界自主',
  full_auto: '本机完全自主',
};

export interface ClientPolicyClaim {
  approvalPolicy?: ApprovalPolicy;
  executionEnvironment?: ExecutionEnvironment;
  autonomyGrant?: AutonomyGrant | null;
  /** Legacy binary mode — mapped when new fields absent. */
  requestedExecutionMode?: 'sandbox' | 'trust';
  trustConfirmed?: boolean;
  /** Explicit user HITL for this run (supervised path). */
  dangerousConfirmed?: boolean;
}

export interface EffectivePolicy {
  approvalPolicy: ApprovalPolicy;
  executionEnvironment: ExecutionEnvironment;
  /** Legacy alias: local → trust, sandbox → sandbox */
  executionMode: 'sandbox' | 'trust';
  toolsAllowed: boolean;
  /** Categories auto-approved for dangerous tools this run */
  autoApprovedCategories: AutonomyCategory[];
  /** True when user (or auto-grant) confirmed dangerous tools for this run */
  dangerousConfirmed: boolean;
  grant: AutonomyGrant | null;
  downgradeReason?: string;
  redLines: RedLineOp[];
  networkAccess?: NetworkAccessMode;
}

export type SafetyAuditKind =
  | 'policy_resolve'
  | 'grant_save'
  | 'grant_revoke'
  | 'grant_expire'
  | 'forge_rejected'
  | 'chat_only_block'
  | 'red_line_block'
  | 'auto_approve'
  | 'trust_elevation'
  /** B04 HITL action chain */
  | 'hitl_pause'
  | 'hitl_confirm'
  | 'hitl_deny'
  | 'hitl_resume'
  | 'hitl_cancel'
  | 'hitl_answer'
  | 'audit_cleared'
  | 'automation_run'
  | 'configuration_change';

export interface SafetyAuditEntry {
  timestamp: string;
  kind: SafetyAuditKind;
  detail: string;
  approvalPolicy?: ApprovalPolicy;
  executionEnvironment?: ExecutionEnvironment;
  categories?: AutonomyCategory[];
}

// ── Validation helpers ─────────────────────────────────────────────────────

export function isApprovalPolicy(v: unknown): v is ApprovalPolicy {
  return (
    v === 'chat_only' ||
    v === 'supervised' ||
    v === 'bounded_auto' ||
    v === 'full_auto'
  );
}

export function isExecutionEnvironment(v: unknown): v is ExecutionEnvironment {
  return v === 'sandbox' || v === 'local';
}

export function isAutonomyCategory(v: unknown): v is AutonomyCategory {
  return (
    v === 'web_search' ||
    v === 'code_run' ||
    v === 'artifacts_write' ||
    v === 'package_install'
  );
}

export function normalizeCategories(raw: unknown): AutonomyCategory[] {
  if (!Array.isArray(raw)) return [];
  const out: AutonomyCategory[] = [];
  for (const item of raw) {
    if (isAutonomyCategory(item) && !out.includes(item)) {
      out.push(item);
    }
  }
  return out;
}

export function normalizeGrant(raw: unknown): AutonomyGrant | null {
  if (!raw || typeof raw !== 'object') return null;
  const g = raw as Record<string, unknown>;
  const expiresAt = typeof g.expiresAt === 'string' ? g.expiresAt : '';
  if (!expiresAt) return null;
  const categories = normalizeCategories(g.allowedCategories);
  return {
    allowedCategories: categories,
    expiresAt,
    approvedBy: 'user',
  };
}

export function isGrantExpired(
  grant: AutonomyGrant | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!grant) return true;
  const t = Date.parse(grant.expiresAt);
  if (!Number.isFinite(t)) return true;
  return t <= now.getTime();
}

export function isGrantActive(
  grant: AutonomyGrant | null | undefined,
  now: Date = new Date(),
): boolean {
  return !!grant && !isGrantExpired(grant, now);
}

/**
 * Map tool name (+ params) → autonomy category, or null if uncategorized.
 */
export function categoryForTool(
  toolName: string,
  params?: Record<string, unknown>,
): AutonomyCategory | null {
  switch (toolName) {
    case 'web_search':
      return 'web_search';
    case 'code_executor':
      return 'code_run';
    case 'data_analyzer':
      return 'code_run';
    case 'file_manager': {
      const action = params?.action;
      if (action === 'write' || action === 'delete') return 'artifacts_write';
      return null;
    }
    case 'ask_human':
      return null;
    default:
      return null;
  }
}

/**
 * Detect red-line ops from tool + params. Returns matching red lines (may be empty).
 */
export function detectRedLines(
  toolName: string,
  params?: Record<string, unknown>,
): RedLineOp[] {
  const hits: RedLineOp[] = [];
  const blob = JSON.stringify(params || {}).toLowerCase();

  // Credentials / secrets
  if (
    /\.env\b/.test(blob) ||
    /id_rsa|id_ed25519|\.pem\b|\.key\b|credentials|api[_-]?key|secret|password|token/.test(blob) ||
    /\.ssh|\.aws|\.gnupg/.test(blob)
  ) {
    hits.push('credentials');
  }

  // Path escape signals (absolute outside workspace markers)
  if (
    /\.\.[\\/]/.test(blob) ||
    /[a-z]:\\users\\|\/etc\/|\/root\//.test(blob)
  ) {
    hits.push('path_escape');
  }

  // Privilege expansion
  if (/\bsudo\b|\bchmod\s+777|\bsetuid\b|runas\b|privilege/.test(blob)) {
    hits.push('privilege_expand');
  }

  // Sensitive delete (system / secret paths — not normal artifacts/ cleanup)
  if (
    /\brm\s+-rf|\bdel\s+\/s|\bremove-item.*-recurse/.test(blob) ||
    (toolName === 'file_manager' && params?.action === 'delete')
  ) {
    if (
      /[\\/](\.git|\.ssh|\.aws|\.env|node_modules|system32|windows|program files)/.test(blob) ||
      /\/etc\/|\/root\//.test(blob)
    ) {
      if (!hits.includes('sensitive_delete')) hits.push('sensitive_delete');
    }
  }

  // Unauthorized publish
  if (
    /\bnpm\s+publish|\bgit\s+push|\bcurl\s+.*(-d|--data)|invoke-webrequest.*-method\s*post/.test(blob) ||
    /publish|webhook|upload.*remote/.test(blob)
  ) {
    hits.push('unauthorized_publish');
  }

  return hits;
}

/**
 * Whether a dangerous tool may run without interactive confirm under this policy.
 * Red-line hits always require HITL (never auto).
 */
export function mayAutoApproveTool(
  policy: EffectivePolicy,
  toolName: string,
  params?: Record<string, unknown>,
): { auto: boolean; blocked?: boolean; reason?: string; redLines: RedLineOp[] } {
  const reds = detectRedLines(toolName, params);
  if (reds.length > 0) {
    return {
      auto: false,
      reason: `红线操作不可自动批准：${reds.map((r) => RED_LINE_LABELS[r]).join('、')}`,
      redLines: reds,
    };
  }

  if (toolName === 'web_search') {
    if (policy.networkAccess === 'off') {
      return {
        auto: false,
        blocked: true,
        reason: '网络读取已在设置中关闭',
        redLines: [],
      };
    }
    if (policy.networkAccess === 'allow') {
      return { auto: true, redLines: [] };
    }
  }

  if (policy.approvalPolicy === 'chat_only') {
    return { auto: false, reason: '仅对话模式禁止工具', redLines: [] };
  }

  if (policy.approvalPolicy === 'supervised') {
    return {
      auto: policy.dangerousConfirmed === true,
      reason: policy.dangerousConfirmed ? undefined : '监督模式需要用户确认',
      redLines: [],
    };
  }

  // bounded_auto / full_auto
  const cat = categoryForTool(toolName, params);
  if (cat && policy.autoApprovedCategories.includes(cat)) {
    return { auto: true, redLines: [] };
  }

  // Uncategorized dangerous tools still need HITL
  if (policy.dangerousConfirmed && policy.approvalPolicy === 'full_auto' && !cat) {
    // full_auto still only auto-approves grant categories; rest HITL
    return {
      auto: false,
      reason: '不在预授权类别内，需要确认',
      redLines: [],
    };
  }

  return {
    auto: false,
    reason: cat
      ? `类别「${CATEGORY_LABELS[cat]}」未在授权范围内`
      : '工具不在预授权范围内，需要确认',
    redLines: [],
  };
}

/**
 * Client-side helper: map legacy executionMode → new dimensions.
 */
export function migrateFromExecutionMode(
  executionMode: 'sandbox' | 'trust' | undefined,
): {
  executionEnvironment: ExecutionEnvironment;
  approvalPolicy: ApprovalPolicy;
  executionMode: 'sandbox' | 'trust';
} {
  if (executionMode === 'trust') {
    return {
      executionEnvironment: 'local',
      approvalPolicy: 'supervised',
      executionMode: 'trust',
    };
  }
  return {
    executionEnvironment: 'sandbox',
    approvalPolicy: 'supervised',
    executionMode: 'sandbox',
  };
}

/**
 * Keep executionMode in sync with environment for legacy readers.
 */
export function syncExecutionMode(
  env: ExecutionEnvironment,
): 'sandbox' | 'trust' {
  return env === 'local' ? 'trust' : 'sandbox';
}

/**
 * If local grant is expired, return downgraded settings patch.
 */
export function clientDowngradeIfExpired(
  approvalPolicy: ApprovalPolicy,
  grant: AutonomyGrant | null | undefined,
  now: Date = new Date(),
): {
  approvalPolicy: ApprovalPolicy;
  executionEnvironment: ExecutionEnvironment;
  executionMode: 'sandbox' | 'trust';
  autonomyGrant: AutonomyGrant | null;
  expired: boolean;
} {
  const elevated =
    approvalPolicy === 'bounded_auto' || approvalPolicy === 'full_auto';
  if (elevated && isGrantExpired(grant, now)) {
    return {
      approvalPolicy: 'supervised',
      executionEnvironment: 'sandbox',
      executionMode: 'sandbox',
      autonomyGrant: null,
      expired: true,
    };
  }
  return {
    approvalPolicy,
    executionEnvironment:
      approvalPolicy === 'full_auto' ? 'local' : 'sandbox',
    executionMode: approvalPolicy === 'full_auto' ? 'trust' : 'sandbox',
    autonomyGrant: grant ?? null,
    expired: false,
  };
}
