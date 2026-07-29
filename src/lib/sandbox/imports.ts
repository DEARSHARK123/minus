const STANDARD_LIBRARY_MODULES = new Set([
  'os', 'sys', 'math', 'json', 're', 'datetime', 'time', 'random',
  'collections', 'itertools', 'functools', 'pathlib', 'io', 'csv',
  'hashlib', 'base64', 'urllib', 'http', 'email', 'html', 'xml',
  'logging', 'unittest', 'typing', 'dataclasses', 'enum', 'abc',
  'contextlib', 'textwrap', 'string', 'struct', 'array', 'copy',
  'pprint', 'traceback', 'warnings', 'weakref', 'types', 'operator',
  'statistics', 'decimal', 'fractions', 'cmath', 'binascii', 'codecs',
  'gzip', 'zipfile', 'tarfile', 'sqlite3', 'socket', 'ssl', 'select',
  'threading', 'multiprocessing', 'subprocess', 'signal', 'shutil',
  'glob', 'fnmatch', 'tempfile', 'argparse', 'configparser',
  'concurrent', 'asyncio', 'ast', 'dis', 'importlib',
]);

const JS_BUILTINS = new Set([
  'fs', 'path', 'os', 'crypto', 'http', 'https', 'url', 'stream',
  'buffer', 'events', 'child_process', 'worker_threads', 'net',
  'tls', 'dns', 'readline', 'zlib', 'util', 'assert', 'querystring',
  'perf_hooks', 'v8', 'vm', 'cluster',
]);

const COMMON_PREINSTALLED = new Set([
  'pandas', 'numpy', 'matplotlib', 'seaborn', 'requests',
  'beautifulsoup4', 'bs4', 'scikit-learn', 'sklearn',
  'scipy', 'pillow', 'PIL', 'lxml', 'openpyxl',
  'plotly', 'flask', 'fastapi', 'pydantic',
]);

export interface ScanResult {
  imports: string[];
  missing: string[];
  needsInstall: boolean;
}

export function scanImports(code: string, language: 'python' | 'javascript' | 'typescript'): ScanResult {
  if (language === 'python') {
    return scanPythonImports(code);
  }
  return scanJsImports(code);
}

function scanPythonImports(code: string): ScanResult {
  const imports: string[] = [];

  const importPattern = /^import\s+([\w.]+)/gm;
  const fromPattern = /^from\s+([\w.]+)\s+import/gm;

  let match;
  while ((match = importPattern.exec(code)) !== null) {
    const mod = match[1].split('.')[0];
    imports.push(mod);
  }
  while ((match = fromPattern.exec(code)) !== null) {
    const mod = match[1].split('.')[0];
    imports.push(mod);
  }

  const unique = [...new Set(imports)];
  const missing = unique.filter(m =>
    !STANDARD_LIBRARY_MODULES.has(m) && !COMMON_PREINSTALLED.has(m)
  );

  return {
    imports: unique,
    missing,
    needsInstall: missing.length > 0,
  };
}

function scanJsImports(code: string): ScanResult {
  const imports: string[] = [];

  const requirePattern = /require\s*\(\s*['"]([^'"./][^'"]*)['"]\s*\)/g;
  const esmPattern = /import\s+(?:.*\s+from\s+)?['"]([^'"./][^'"]*)['"]/g;
  const bareImport = /import\s+['"]([^'"./][^'"]*)['"]/g;

  let match;
  while ((match = requirePattern.exec(code)) !== null) {
    imports.push(match[1].split('/')[0]);
  }
  while ((match = esmPattern.exec(code)) !== null) {
    imports.push(match[1].split('/')[0]);
  }
  while ((match = bareImport.exec(code)) !== null) {
    imports.push(match[1].split('/')[0]);
  }

  const unique = [...new Set(imports)];
  const missing = unique.filter(m => !JS_BUILTINS.has(m));

  return {
    imports: unique,
    missing,
    needsInstall: missing.length > 0,
  };
}

export function buildInstallCommand(packages: string[], language: 'python' | 'javascript' | 'typescript'): string {
  if (language === 'python') {
    return `uv pip install --quiet ${packages.join(' ')} 2>/dev/null || pip install --quiet ${packages.join(' ')}`;
  }
  const pm = language === 'typescript' ? 'npm' : 'npm';
  return `${pm} install ${packages.join(' ')} 2>/dev/null`;
}
