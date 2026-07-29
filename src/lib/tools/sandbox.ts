import path from 'path';

const DEFAULT_WORKSPACE = path.resolve(
  /* turbopackIgnore: true */ process.cwd(),
);
const BLOCKED_PATTERNS = [
  /\.\./,
  /^\/etc/,
  /^\/usr/,
  /^\/var/,
  /^\/root/,
  /^\/home/,
  /node_modules/i,
  /\.env/i,
  /\.git/i,
];

const MAX_RESULT_LENGTH = 10_000;

/**
 * True if `child` resolves inside `parent` (path boundary, not brittle startsWith alone).
 */
export function isPathInside(child: string, parent: string): boolean {
  const resolvedParent = path.resolve(/* turbopackIgnore: true */ parent);
  const resolvedChild = path.resolve(/* turbopackIgnore: true */ child);
  const rel = path.relative(resolvedParent, resolvedChild);
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
}

export function validateFilePath(filePath: string, workspacePath?: string): string {
  const ws = path.resolve(
    /* turbopackIgnore: true */ workspacePath || DEFAULT_WORKSPACE,
  );
  const resolved = path.resolve(/* turbopackIgnore: true */ ws, filePath);

  if (!isPathInside(resolved, ws)) {
    throw new Error(`Access denied: path "${filePath}" is outside workspace`);
  }

  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(filePath)) {
      throw new Error(`Access denied: path "${filePath}" matches blocked pattern`);
    }
  }

  return resolved;
}

/** Roots under workspace for file_manager allowlist. */
export type FileAllowRoot = 'artifacts' | 'inputs';

/**
 * Resolve a path that must stay under workspace/<root>/ (e.g. artifacts or inputs).
 * Creates the root directory when ensureRoot is true.
 */
export function validateAllowlistedPath(
  filePath: string,
  workspacePath: string,
  allowedRoots: FileAllowRoot[],
  options?: { ensureRoot?: boolean; rootForEnsure?: FileAllowRoot },
): string {
  void options;
  const ws = path.resolve(/* turbopackIgnore: true */ workspacePath);
  const resolved = validateFilePath(filePath, ws);

  const underAllowed = allowedRoots.some((root) => {
    const rootAbs = path.resolve(/* turbopackIgnore: true */ ws, root);
    return isPathInside(resolved, rootAbs);
  });

  if (!underAllowed) {
    throw new Error(
      `Access denied: path "${filePath}" must be under ${allowedRoots.map((r) => `${r}/`).join(' or ')}`,
    );
  }

  return resolved;
}

export function getWorkspaceArtifactsDir(workspacePath?: string): string {
  return path.resolve(
    /* turbopackIgnore: true */ workspacePath || DEFAULT_WORKSPACE,
    'artifacts',
  );
}

export function getWorkspaceInputsDir(workspacePath?: string): string {
  return path.resolve(
    /* turbopackIgnore: true */ workspacePath || DEFAULT_WORKSPACE,
    'inputs',
  );
}

export function truncateResult(text: string, maxLength?: number): string {
  const limit = maxLength || MAX_RESULT_LENGTH;
  if (text.length <= limit) return text;

  const headSize = Math.floor(limit * 0.7);
  const tailSize = limit - headSize - 50;

  return (
    text.slice(0, headSize) +
    '\n\n... [TRUNCATED: ' + (text.length - limit) + ' chars omitted] ...\n\n' +
    text.slice(-tailSize)
  );
}

export function safeToolResult(
  data: unknown,
  options?: { maxLength?: number; workspacePath?: string }
): string {
  const raw = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  return truncateResult(raw, options?.maxLength);
}
