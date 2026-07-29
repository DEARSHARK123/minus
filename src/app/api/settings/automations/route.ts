import { NextRequest, NextResponse } from 'next/server';
import { runAutomation, runDueAutomations } from '@/lib/automation/scheduler';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      action?: 'runDue' | 'runOne';
      automationId?: string;
      context?: {
        now?: string;
        idleMinutes?: number;
        transcript?: Array<{ role: 'user' | 'assistant'; content: string }>;
        userSystemPrompt?: string;
        event?: {
          type: 'course_completed' | 'assessment_failed' | 'course_idle';
          courseId?: string;
          eventId: string;
        };
        courseActivity?: Array<{ courseId: string; idleMinutes: number }>;
      };
    };
    const data = body.action === 'runOne'
      ? await runAutomation(String(body.automationId || ''), body.context || {}, { manual: true })
      : await runDueAutomations(body.context || {});
    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Automation run failed' },
      { status: 400 },
    );
  }
}
