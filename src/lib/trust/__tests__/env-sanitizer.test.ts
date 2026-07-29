import { describe, it, expect } from 'vitest';
import { buildSanitizedEnv, isEnvKeySensitive, getEnvAuditReport } from '../env-sanitizer';

describe('buildSanitizedEnv', () => {
  it('should include PATH from process.env', () => {
    const env = buildSanitizedEnv();
    expect(env.PATH).toBeDefined();
  });

  it('should include NODE_ENV', () => {
    const env = buildSanitizedEnv();
    expect(env.NODE_ENV).toBeDefined();
  });

  it('should NOT include OPENAI_API_KEY', () => {
    const original = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'sk-test-secret-key';
    const env = buildSanitizedEnv();
    expect(env.OPENAI_API_KEY).toBeUndefined();
    if (original !== undefined) {
      process.env.OPENAI_API_KEY = original;
    } else {
      delete process.env.OPENAI_API_KEY;
    }
  });

  it('should NOT include arbitrary env vars', () => {
    process.env.MY_CUSTOM_SECRET = 'should-not-pass';
    const env = buildSanitizedEnv();
    expect(env.MY_CUSTOM_SECRET).toBeUndefined();
    delete process.env.MY_CUSTOM_SECRET;
  });
});

describe('isEnvKeySensitive', () => {
  it('should detect KEY pattern', () => {
    expect(isEnvKeySensitive('OPENAI_API_KEY')).toBe(true);
    expect(isEnvKeySensitive('AWS_SECRET_KEY')).toBe(true);
  });

  it('should detect SECRET pattern', () => {
    expect(isEnvKeySensitive('MY_SECRET_VALUE')).toBe(true);
  });

  it('should detect TOKEN pattern', () => {
    expect(isEnvKeySensitive('AUTH_TOKEN')).toBe(true);
  });

  it('should detect PASSWORD pattern', () => {
    expect(isEnvKeySensitive('DB_PASSWORD')).toBe(true);
  });

  it('should NOT flag safe keys', () => {
    expect(isEnvKeySensitive('PATH')).toBe(false);
    expect(isEnvKeySensitive('HOME')).toBe(false);
    expect(isEnvKeySensitive('LANG')).toBe(false);
  });
});

describe('getEnvAuditReport', () => {
  it('should return safe and stripped arrays', () => {
    const report = getEnvAuditReport();
    expect(report).toHaveProperty('safe');
    expect(report).toHaveProperty('stripped');
    expect(Array.isArray(report.safe)).toBe(true);
    expect(Array.isArray(report.stripped)).toBe(true);
  });

  it('should include PATH in safe list', () => {
    const report = getEnvAuditReport();
    expect(report.safe).toContain('PATH');
  });
});
