import path from 'path';
import { describe, it, expect } from 'vitest';
import {
  isPathInside,
  validateAllowlistedPath,
  validateFilePath,
  truncateResult,
} from '../sandbox';

const workspace = path.resolve('/tmp/minus-workspace-test');

describe('validateFilePath', () => {
  it('should allow valid relative paths within workspace', () => {
    const result = validateFilePath('data/output.csv', workspace);
    expect(result).toContain('output.csv');
    expect(result).toContain('data');
  });

  it('should block path traversal attempts', () => {
    expect(() => validateFilePath('../../../etc/passwd', workspace)).toThrow();
    expect(() => validateFilePath('data/../../../etc/passwd', workspace)).toThrow();
  });

  it('should block access to system directories', () => {
    expect(() => validateFilePath('/etc/passwd', workspace)).toThrow();
  });

  it('should block access to sensitive files', () => {
    expect(() => validateFilePath('.env', workspace)).toThrow();
    expect(() => validateFilePath('.git/config', workspace)).toThrow();
    expect(() => validateFilePath('node_modules/package.json', workspace)).toThrow();
  });

  it('should allow normal workspace subdirectories', () => {
    const result = validateFilePath('src/index.ts', workspace);
    expect(result).toContain('src');
    expect(result).toContain('index.ts');
  });

  it('should use path boundary (not brittle prefix) against sibling dirs', () => {
    const sibling = `${workspace}_evil${path.sep}secret.txt`;
    expect(isPathInside(sibling, workspace)).toBe(false);
  });
});

describe('validateAllowlistedPath', () => {
  it('allows write paths under artifacts/', () => {
    const result = validateAllowlistedPath('artifacts/out.txt', workspace, ['artifacts']);
    expect(result).toContain(path.join('artifacts', 'out.txt'));
  });

  it('allows read under inputs/', () => {
    const result = validateAllowlistedPath('inputs/in.csv', workspace, ['artifacts', 'inputs']);
    expect(result).toContain(path.join('inputs', 'in.csv'));
  });

  it('rejects write outside artifacts/', () => {
    expect(() =>
      validateAllowlistedPath('src/index.ts', workspace, ['artifacts']),
    ).toThrow(/artifacts/);
  });

  it('rejects traversal out of artifacts/', () => {
    expect(() =>
      validateAllowlistedPath('artifacts/../inputs/x', workspace, ['artifacts']),
    ).toThrow();
  });
});

describe('truncateResult', () => {
  it('should return short strings unchanged', () => {
    expect(truncateResult('hello')).toBe('hello');
  });

  it('should truncate strings exceeding max length', () => {
    const long = 'a'.repeat(20000);
    const result = truncateResult(long);
    expect(result.length).toBeLessThan(long.length);
    expect(result).toContain('TRUNCATED');
  });

  it('should handle empty strings', () => {
    expect(truncateResult('')).toBe('');
  });
});
