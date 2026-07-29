import { NextRequest, NextResponse } from 'next/server';
import {
  getProviderStatus,
  listSupportedProviders,
  writeProviderSecret,
} from '@/lib/config/server-env';

export const runtime = 'nodejs';

export async function GET(request: NextRequest): Promise<Response> {
  const providerId = request.nextUrl.searchParams.get('providerId') || 'openai';
  try {
    const status = getProviderStatus(providerId);
    return NextResponse.json({
      success: true,
      data: {
        ...status,
        supportedProviders: listSupportedProviders(),
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to load provider status',
      },
      { status: 400 },
    );
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  let body: {
    providerId?: string;
    apiKey?: string;
    baseUrl?: string;
    model?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const providerId = body.providerId?.trim();
  if (!providerId) {
    return NextResponse.json({ success: false, error: 'providerId required' }, { status: 400 });
  }

  try {
    await writeProviderSecret(providerId, {
      apiKey: body.apiKey,
      baseUrl: body.baseUrl,
      model: body.model,
    });
    const status = getProviderStatus(providerId);
    return NextResponse.json({ success: true, data: status });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to save provider',
      },
      { status: 500 },
    );
  }
}
