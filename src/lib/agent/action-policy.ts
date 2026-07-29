/**
 * Server-authoritative execution & safety policy.
 * Client claims are advisory; grant + red lines are enforced here.
 *
 * Pure types/helpers live in action-policy-core.ts (client-safe).
 * This module owns Node fs grant/audit persistence and resolveEffectivePolicy.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  compactAuditFile,
  clearAuditFile,
  redactAuditDetail,
} from '@/lib/trust/audit-policy';

export type {
  ExecutionEnvironment,
  NetworkAccessMode,
  ApprovalPolicy,
  AutonomyCategory,
  RedLineOp,
  AutonomyGrant,
  ClientPolicyClaim,
  EffectivePolicy,
  SafetyAuditKind,
  SafetyAuditEntry,
} from './action-policy-core';

export {
  ALL_AUTONOMY_CATEGORIES,
  RED_LINE_OPS,
  RED_LINE_LABELS,
  CATEGORY_LABELS,
  POLICY_LABELS,
  isApprovalPolicy,
  isExecutionEnvironment,
  isAutonomyCategory,
  normalizeCategories,
  normalizeGrant,
  isGrantExpired,
  isGrantActive,
  categoryForTool,
  detectRedLines,
  mayAutoApproveTool,
  migrateFromExecutionMode,
  syncExecutionMode,
  clientDowngradeIfExpired,
} from './action-policy-core';

import type {
  ApprovalPolicy,
  ExecutionEnvironment,
  AutonomyCategory,
  AutonomyGrant,
  ClientPolicyClaim,
  EffectivePolicy,
  SafetyAuditEntry,
} from './action-policy-core';
import {
  isApprovalPolicy,
  isGrantActive,
  isGrantExpired,
  normalizeGrant,
  RED_LINE_OPS,
} from './action-policy-core';
import { readUserConfigurationSync } from '@/lib/config/user-configuration';

// ── Paths ──────────────────────────────────────────────────────────────────

function dataDir(): string {
  if (process.env.MINUS_DATA_DIR) {
    return process.env.MINUS_DATA_DIR;
  }
  return path.join(os.homedir(), '.minus', 'data');
}

function logsDir(): string {
  if (process.env.MINUS_DATA_DIR) {
    return path.join(process.env.MINUS_DATA_DIR, 'logs');
  }
  return path.join(os.homedir(), '.minus', 'logs');
}

export function autonomyGrantPath(): string {
  return path.join(dataDir(), 'autonomy-grant.json');
}

export function safetyAuditPath(): string {
  return path.join(logsDir(), 'safety-audit.jsonl');
}

// ── Grant store (server-side authority) ────────────────────────────────────

interface StoredGrantFile {
  grant: AutonomyGrant | null;
  approvalPolicy: ApprovalPolicy;
  executionEnvironment: ExecutionEnvironment;
  updatedAt: string;
}

function emptyStore(): StoredGrantFile {
  return {
    grant: null,
    approvalPolicy: 'supervised',
    executionEnvironment: 'sandbox',
    updatedAt: new Date().toISOString(),
  };
}

export function readServerSafetyStore(): StoredGrantFile {
  try {
    const p = autonomyGrantPath();
    if (!fs.existsSync(p)) return emptyStore();
    const raw = fs.readFileSync(p, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<StoredGrantFile>;
    return {
      grant: normalizeGrant(parsed.grant ?? null),
      approvalPolicy: isApprovalPolicy(parsed.approvalPolicy)
        ? parsed.approvalPolicy
        : 'supervised',
      executionEnvironment:
        parsed.executionEnvironment === 'local' ? 'local' : 'sandbox',
      updatedAt: typeof parsed.updatedAt === 'string'
        ? parsed.updatedAt
        : new Date().toISOString(),
    };
  } catch {
    return emptyStore();
  }
}

export function writeServerSafetyStore(input: {
  grant: AutonomyGrant | null;
  approvalPolicy: ApprovalPolicy;
  executionEnvironment: ExecutionEnvironment;
}): StoredGrantFile {
  const dir = dataDir();
  fs.mkdirSync(dir, { recursive: true });
  const file: StoredGrantFile = {
    grant: normalizeGrant(input.grant),
    approvalPolicy: input.approvalPolicy,
    executionEnvironment: input.executionEnvironment,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(autonomyGrantPath(), JSON.stringify(file, null, 2), 'utf-8');
  writeSafetyAudit({
    kind: input.grant ? 'grant_save' : 'grant_revoke',
    detail: input.grant
      ? `保存授权：${input.approvalPolicy}，类别 ${input.grant.allowedCategories.join(',') || '无'}，至 ${input.grant.expiresAt}`
      : `撤销授权；策略 → ${input.approvalPolicy}`,
    approvalPolicy: input.approvalPolicy,
    executionEnvironment: input.executionEnvironment,
    categories: input.grant?.allowedCategories,
  });
  return file;
}

export function revokeServerGrant(): StoredGrantFile {
  return writeServerSafetyStore({
    grant: null,
    approvalPolicy: 'supervised',
    executionEnvironment: 'sandbox',
  });
}

// ── Audit ──────────────────────────────────────────────────────────────────

export function writeSafetyAudit(
  entry: Omit<SafetyAuditEntry, 'timestamp'> & { timestamp?: string },
): void {
  try {
    const dir = logsDir();
    fs.mkdirSync(dir, { recursive: true });
    compactAuditFile(safetyAuditPath());
    const full: SafetyAuditEntry = {
      timestamp: entry.timestamp || new Date().toISOString(),
      kind: entry.kind,
      detail: redactAuditDetail(entry.detail),
      approvalPolicy: entry.approvalPolicy,
      executionEnvironment: entry.executionEnvironment,
      categories: entry.categories,
    };
    fs.appendFileSync(safetyAuditPath(), JSON.stringify(full) + '\n', 'utf-8');
    compactAuditFile(safetyAuditPath());
  } catch {
    // non-blocking
  }
}

export function clearSafetyAuditEntries(): void {
  clearAuditFile(safetyAuditPath());
  writeSafetyAudit({
    kind: 'audit_cleared',
    detail: '用户清理了安全审计日志。',
    approvalPolicy: 'supervised',
    executionEnvironment: 'sandbox',
  });
}

export function readSafetyAuditEntries(limit = 50): SafetyAuditEntry[] {
  try {
    const p = safetyAuditPath();
    if (!fs.existsSync(p)) return [];
    const content = fs.readFileSync(p, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    return lines
      .slice(-limit)
      .map((line) => {
        try {
          return JSON.parse(line) as SafetyAuditEntry;
        } catch {
          return null;
        }
      })
      .filter((e): e is SafetyAuditEntry => e !== null)
      .reverse();
  } catch {
    return [];
  }
}

// ── Resolve effective policy ───────────────────────────────────────────────

/**
 * Resolve server-effective policy from client claim + persisted server grant.
 * Client cannot forge full_auto / bounded_auto without a valid non-expired server grant.
 */
export function resolveEffectivePolicy(
  claim: ClientPolicyClaim,
  now: Date = new Date(),
  serverStore?: StoredGrantFile,
): EffectivePolicy {
  const store = serverStore ?? readServerSafetyStore();
  const redLines = [...RED_LINE_OPS];

  // Start from server store as authority for elevated policies
  let approvalPolicy: ApprovalPolicy = store.approvalPolicy;
  let executionEnvironment: ExecutionEnvironment = store.executionEnvironment;
  let grant = isGrantActive(store.grant, now) ? store.grant : null;
  let downgradeReason: string | undefined;

  // Expired server grant → force downgrade on disk side-effect is caller's job;
  // here we only resolve in-memory.
  if (store.grant && isGrantExpired(store.grant, now)) {
    if (
      store.approvalPolicy === 'bounded_auto' ||
      store.approvalPolicy === 'full_auto'
    ) {
      approvalPolicy = 'supervised';
      executionEnvironment = 'sandbox';
      grant = null;
      downgradeReason = '授权已过期，已降级为监督模式';
      writeSafetyAudit({
        kind: 'grant_expire',
        detail: downgradeReason,
        approvalPolicy: 'supervised',
        executionEnvironment: 'sandbox',
      });
    }
  }

  // Client may request chat_only or supervised freely (downgrade always ok)
  const clientPolicy = isApprovalPolicy(claim.approvalPolicy)
    ? claim.approvalPolicy
    : undefined;

  if (clientPolicy === 'chat_only') {
    approvalPolicy = 'chat_only';
    executionEnvironment = 'sandbox';
    grant = null;
  } else if (clientPolicy === 'supervised') {
    // Explicit supervised request — allow (user downgrade)
    approvalPolicy = 'supervised';
    // Keep env from claim if sandbox/local but local only with trust confirm path
    if (claim.executionEnvironment === 'local' && claim.trustConfirmed === true) {
      executionEnvironment = 'local';
    } else if (claim.requestedExecutionMode === 'trust' && claim.trustConfirmed === true) {
      executionEnvironment = 'local';
    } else {
      executionEnvironment = 'sandbox';
    }
    grant = null;
  } else if (clientPolicy === 'bounded_auto' || clientPolicy === 'full_auto') {
    // Elevation requires valid server grant
    if (!isGrantActive(store.grant, now)) {
      approvalPolicy = 'supervised';
      executionEnvironment = 'sandbox';
      grant = null;
      downgradeReason =
        '客户端声称自主模式但服务端无有效授权，已拒绝并降级为监督模式';
      writeSafetyAudit({
        kind: 'forge_rejected',
        detail: downgradeReason,
        approvalPolicy: 'supervised',
      });
    } else {
      // Trust server store for elevated mode (ignore client forging different categories)
      approvalPolicy = store.approvalPolicy;
      // full_auto requires local; bounded stays sandbox unless store says local
      if (store.approvalPolicy === 'full_auto') {
        executionEnvironment = 'local';
      } else {
        executionEnvironment =
          store.executionEnvironment === 'local' ? 'local' : 'sandbox';
      }
      grant = store.grant;
    }
  } else {
    // No client policy: use server store (already loaded), map legacy trust
    if (!clientPolicy) {
      if (
        claim.requestedExecutionMode === 'trust' &&
        claim.trustConfirmed === true &&
        approvalPolicy === 'supervised'
      ) {
        executionEnvironment = 'local';
      }
    }
  }

  // If store still says elevated but grant missing after resolve
  if (
    (approvalPolicy === 'bounded_auto' || approvalPolicy === 'full_auto') &&
    !isGrantActive(grant, now)
  ) {
    approvalPolicy = 'supervised';
    executionEnvironment = 'sandbox';
    grant = null;
    if (!downgradeReason) {
      downgradeReason = '自主授权无效，已降级为监督模式';
    }
  }

  const toolsAllowed = approvalPolicy !== 'chat_only';

  let autoApprovedCategories: AutonomyCategory[] = [];
  if (
    (approvalPolicy === 'bounded_auto' || approvalPolicy === 'full_auto') &&
    isGrantActive(grant, now)
  ) {
    autoApprovedCategories = [...(grant!.allowedCategories)];
  }

  // User explicit HITL confirm for this run (supervised / residual)
  const userDangerous = claim.dangerousConfirmed === true;

  // Global dangerousConfirmed when supervised user confirmed OR any auto category active
  const dangerousConfirmed =
    userDangerous ||
    (autoApprovedCategories.length > 0 &&
      (approvalPolicy === 'bounded_auto' || approvalPolicy === 'full_auto'));

  const executionMode: 'sandbox' | 'trust' =
    executionEnvironment === 'local' ? 'trust' : 'sandbox';

  // Only audit meaningful security events (forge/expire already written above).
  // Routine resolves are intentionally silent to avoid audit spam.

  return {
    approvalPolicy,
    executionEnvironment,
    executionMode,
    toolsAllowed,
    autoApprovedCategories,
    dangerousConfirmed,
    grant,
    downgradeReason,
    redLines,
    networkAccess: readUserConfigurationSync().networkAccess,
  };
}
