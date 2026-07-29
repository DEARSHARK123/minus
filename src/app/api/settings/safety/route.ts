import { NextRequest, NextResponse } from 'next/server';
import {
  isApprovalPolicy,
  isExecutionEnvironment,
  normalizeCategories,
  normalizeGrant,
  readServerSafetyStore,
  writeServerSafetyStore,
  revokeServerGrant,
  clearSafetyAuditEntries,
  readSafetyAuditEntries,
  type ApprovalPolicy,
  type ExecutionEnvironment,
  type AutonomyGrant,
} from '@/lib/agent/action-policy';
import { clearAuditEntries, readAuditEntries } from '@/lib/trust/audit-logger';
import { readUserConfigurationSync } from '@/lib/config/user-configuration';

export const runtime = 'nodejs';

/**
 * GET — current server safety store + recent audit (safety + trust).
 * POST — save grant / policy, or revoke.
 */
export async function GET() {
  const store = readServerSafetyStore();
  const safetyAudit = readSafetyAuditEntries(30);
  const trustAudit = readAuditEntries(20).map((e) => ({
    timestamp: e.timestamp,
    kind: 'trust_execution' as const,
    detail: `${e.language}: ${e.command.slice(0, 120)} (risk=${e.riskLevel}, exit=${e.exitCode})`,
    approvedBy: e.approvedBy,
  }));

  return NextResponse.json({
    success: true,
    data: {
      store,
      audit: {
        safety: safetyAudit,
        trust: trustAudit,
      },
      auditPolicy: readUserConfigurationSync().auditPolicy,
    },
  });
}

export async function POST(request: NextRequest) {
  let body: {
    action?: 'save' | 'revoke' | 'clearAudit';
    approvalPolicy?: ApprovalPolicy;
    executionEnvironment?: ExecutionEnvironment;
    autonomyGrant?: AutonomyGrant | null;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON body' },
      { status: 400 },
    );
  }

  const action = body.action === 'revoke' ? 'revoke' : 'save';

  if (body.action === 'clearAudit') {
    clearSafetyAuditEntries();
    clearAuditEntries();
    return NextResponse.json({ success: true, data: { cleared: true } });
  }

  if (action === 'revoke') {
    const store = revokeServerGrant();
    return NextResponse.json({ success: true, data: { store } });
  }

  const approvalPolicy: ApprovalPolicy = isApprovalPolicy(body.approvalPolicy)
    ? body.approvalPolicy
    : 'supervised';

  let executionEnvironment: ExecutionEnvironment = isExecutionEnvironment(
    body.executionEnvironment,
  )
    ? body.executionEnvironment
    : 'sandbox';

  let grant = normalizeGrant(body.autonomyGrant);

  // Enforce product rules server-side
  switch (approvalPolicy) {
    case 'chat_only':
      grant = null;
      executionEnvironment = 'sandbox';
      break;
    case 'supervised':
      grant = null;
      // allow sandbox or local (local still needs per-run trust confirm for tools)
      break;
    case 'bounded_auto': {
      if (!grant) {
        const expiresAt = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
        grant = {
          allowedCategories: normalizeCategories([
            'web_search',
            'code_run',
            'artifacts_write',
          ]),
          expiresAt,
          approvedBy: 'user',
        };
      } else {
        grant = {
          ...grant,
          allowedCategories: normalizeCategories(grant.allowedCategories),
          approvedBy: 'user',
        };
      }
      executionEnvironment = 'sandbox';
      break;
    }
    case 'full_auto': {
      if (!grant) {
        const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
        grant = {
          allowedCategories: normalizeCategories([
            'web_search',
            'code_run',
            'artifacts_write',
            'package_install',
          ]),
          expiresAt,
          approvedBy: 'user',
        };
      } else {
        grant = {
          ...grant,
          allowedCategories: normalizeCategories(grant.allowedCategories),
          approvedBy: 'user',
        };
      }
      executionEnvironment = 'local';
      break;
    }
    default: {
      const _exhaustive: never = approvalPolicy;
      void _exhaustive;
      grant = null;
      executionEnvironment = 'sandbox';
    }
  }

  const store = writeServerSafetyStore({
    grant,
    approvalPolicy,
    executionEnvironment,
  });

  return NextResponse.json({ success: true, data: { store } });
}
