import { NextRequest } from 'next/server';
import { runOrchestrator } from '@/lib/agents/orchestrator';
import type { OrchestratorRequest, OrchestratorResult } from '@/lib/agents/types';
import {
  resolveProviderConfig,
  missingApiKeyError,
} from '@/lib/config/server-env';

export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * Strip any accidental internalReason from client JSON (batch-05 PublicExperiencePlan).
 * Audit stays server-side only.
 */
function sanitizeOrchestratorForClient(
  result: OrchestratorResult,
): OrchestratorResult {
  if (!result.experiencePlan) return result;
  const plan = { ...result.experiencePlan } as Record<string, unknown>;
  if ('internalReason' in plan) {
    delete plan.internalReason;
  }
  return {
    ...result,
    experiencePlan: plan as NonNullable<OrchestratorResult['experiencePlan']>,
  };
}

export async function POST(request: NextRequest): Promise<Response> {
  let body: OrchestratorRequest;
  try {
    body = (await request.json()) as OrchestratorRequest;
  } catch {
    return Response.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.message?.trim() && (!body.action || body.action === 'intent')) {
    return Response.json({ success: false, error: 'message is required' }, { status: 400 });
  }

  let resolved;
  try {
    resolved = resolveProviderConfig(body.providerId || 'openai');
  } catch (error) {
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unsupported provider',
      },
      { status: 400 },
    );
  }

  if (!resolved.apiKey) {
    return Response.json(
      { success: false, error: missingApiKeyError(resolved.providerId) },
      { status: 401 },
    );
  }

  const raw = await runOrchestrator(body, resolved, request.signal);
  const result = sanitizeOrchestratorForClient(raw);
  const status = result.error && result.artifacts.length === 0 ? 500 : 200;
  return Response.json(
    { success: !result.error || result.artifacts.length > 0, ...result },
    { status },
  );
}
