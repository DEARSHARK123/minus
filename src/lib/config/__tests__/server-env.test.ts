import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import os from 'os';
import { maskApiKey } from '../server-env';

const originalEnv = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  process.env = { ...originalEnv };
  process.env.MINUS_DATA_DIR = path.join(os.tmpdir(), `minus-test-secrets-${process.pid}`);
});

afterEach(() => {
  process.env = originalEnv;
});

describe('maskApiKey', () => {
  it('should mask a long API key', () => {
    expect(maskApiKey('sk-1234567890abcdef')).toBe('sk-1****cdef');
  });

  it('should mask a short key completely', () => {
    expect(maskApiKey('short')).toBe('****');
  });

  it('should return (empty) for empty string', () => {
    expect(maskApiKey('')).toBe('(empty)');
  });
});

describe('resolveProviderConfig', () => {
  it('should use server-side key only', async () => {
    process.env.OPENAI_API_KEY = 'sk-server-key-12345678';
    process.env.OPENAI_BASE_URL = 'https://custom.openai.com/v1';
    process.env.OPENAI_MODEL = 'gpt-4o';

    const { resolveProviderConfig } = await import('../server-env');
    const result = resolveProviderConfig('openai');

    expect(result.apiKey).toBe('sk-server-key-12345678');
    expect(result.baseUrl).toBe('https://custom.openai.com/v1');
    expect(result.model).toBe('gpt-4o');
    expect(result.source).toBe('server');
  });

  it('should ignore client keys — empty when server key is not set', async () => {
    delete process.env.OPENAI_API_KEY;

    const { resolveProviderConfig } = await import('../server-env');
    const result = resolveProviderConfig('openai');

    expect(result.apiKey).toBe('');
    expect(result.source).toBe('server');
  });

  it('should return empty config when server key is unavailable', async () => {
    delete process.env.OPENAI_API_KEY;

    const { resolveProviderConfig } = await import('../server-env');
    const result = resolveProviderConfig('openai');

    expect(result.apiKey).toBe('');
    expect(result.source).toBe('server');
  });

  it('should map legacy google id to gemini', async () => {
    process.env.GEMINI_API_KEY = 'gem-server-key-xxxxxxxx';

    const { resolveProviderConfig } = await import('../server-env');
    const result = resolveProviderConfig('google');

    expect(result.providerId).toBe('gemini');
    expect(result.apiKey).toBe('gem-server-key-xxxxxxxx');
  });

  it('should reject unknown providers instead of falling back', async () => {
    const { resolveProviderConfig } = await import('../server-env');
    expect(() => resolveProviderConfig('unknown')).toThrow(/Unsupported provider/);
  });

  it('should produce clear missing-key error message', async () => {
    const { missingApiKeyError } = await import('../server-env');
    const msg = missingApiKeyError('openai');
    expect(msg).toContain('OPENAI_API_KEY');
    expect(msg).toMatch(/Settings|\.env/);
  });
});

describe('getConfiguredProviders', () => {
  it('returns only providers with server-side API keys', async () => {
    process.env.OPENAI_API_KEY = 'sk-openai';
    process.env.DEEPSEEK_API_KEY = 'sk-deepseek';
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GEMINI_API_KEY;

    const { getConfiguredProviders } = await import('../server-env');
    expect(getConfiguredProviders()).toEqual(['openai', 'deepseek']);
  });

  it('returns empty array when no keys are set', async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.GEMINI_API_KEY;

    const { getConfiguredProviders } = await import('../server-env');
    expect(getConfiguredProviders()).toEqual([]);
  });

  it('caps at two configured providers in deterministic order', async () => {
    process.env.OPENAI_API_KEY = 'sk-openai';
    process.env.ANTHROPIC_API_KEY = 'sk-anthropic';
    process.env.DEEPSEEK_API_KEY = 'sk-deepseek';

    const { getConfiguredProviders } = await import('../server-env');
    expect(getConfiguredProviders()).toEqual(['openai', 'anthropic', 'deepseek']);
  });
});

describe('getProviderStatus', () => {
  it('returns status for the selected configured provider', async () => {
    process.env.OPENAI_API_KEY = 'sk-status-12345678';
    process.env.OPENAI_MODEL = 'gpt-4o';
    process.env.OPENAI_BASE_URL = 'https://openai.example.com/v1';

    const { getProviderStatus } = await import('../server-env');
    const status = getProviderStatus('openai');

    expect(status.providerId).toBe('openai');
    expect(status.hasKey).toBe(true);
    expect(status.maskedKey).toBe('sk-s****5678');
    expect(status.model).toBe('gpt-4o');
    expect(status.baseUrl).toBe('https://openai.example.com/v1');
    expect(status.configuredProviders).toEqual(['openai']);
  });

  it('reports unconfigured provider without throwing', async () => {
    delete process.env.OPENAI_API_KEY;

    const { getProviderStatus } = await import('../server-env');
    const status = getProviderStatus('openai');

    expect(status.hasKey).toBe(false);
    expect(status.maskedKey).toBe('(empty)');
    expect(status.configuredProviders).toEqual([]);
  });

  it('maps legacy google id to gemini', async () => {
    process.env.GEMINI_API_KEY = 'gem-status-12345678';

    const { getProviderStatus } = await import('../server-env');
    const status = getProviderStatus('google');

    expect(status.providerId).toBe('gemini');
    expect(status.hasKey).toBe(true);
  });
});
