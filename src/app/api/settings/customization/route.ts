import { NextRequest, NextResponse } from 'next/server';
import {
  deleteAutomation,
  listEffectivePlaybooks,
  listEffectiveSkills,
  readUserConfigurationSync,
  resetSkill,
  resetPlaybook,
  saveAutomation,
  savePlaybook,
  saveSkill,
  writeUserConfiguration,
} from '@/lib/config/user-configuration';
import { AuditPolicySchema } from '@/lib/config/user-configuration-core';

export const runtime = 'nodejs';

function payload() {
  const config = readUserConfigurationSync();
  return {
    config,
    skills: listEffectiveSkills(config),
    playbooks: listEffectivePlaybooks(config),
  };
}

export async function GET() {
  return NextResponse.json({ success: true, data: payload() });
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      action?: string;
      id?: string;
      data?: unknown;
    };
    const id = String(body.id || '').trim();
    switch (body.action) {
      case 'saveSkill':
        await saveSkill(body.data);
        break;
      case 'resetSkill':
        if (!id) throw new Error('Skill id is required');
        await resetSkill(id);
        break;
      case 'savePlaybook':
        await savePlaybook(body.data);
        break;
      case 'resetPlaybook':
        if (!id) throw new Error('Playbook id is required');
        await resetPlaybook(id);
        break;
      case 'saveAutomation':
        await saveAutomation(body.data);
        break;
      case 'deleteAutomation':
        if (!id) throw new Error('Automation id is required');
        await deleteAutomation(id);
        break;
      case 'saveAuditPolicy': {
        const current = readUserConfigurationSync();
        await writeUserConfiguration({
          ...current,
          auditPolicy: AuditPolicySchema.parse(body.data),
        });
        break;
      }
      case 'saveNetworkAccess': {
        const mode = body.data;
        if (mode !== 'allow' && mode !== 'ask' && mode !== 'off') {
          throw new Error('Invalid network access mode');
        }
        const current = readUserConfigurationSync();
        await writeUserConfiguration({ ...current, networkAccess: mode });
        break;
      }
      default:
        return NextResponse.json({ success: false, error: 'Unknown action' }, { status: 400 });
    }
    return NextResponse.json({ success: true, data: payload() });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Customization update failed' },
      { status: 400 },
    );
  }
}
