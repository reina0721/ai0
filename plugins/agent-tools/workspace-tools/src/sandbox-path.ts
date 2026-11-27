import { existsSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

const SENSITIVE_REL_PATTERNS: readonly RegExp[] = [
  /(?:^|\/)\.git\/hooks(?:\/|$)/iu,
  /(?:^|\/)souls\/host\/vault(?:\/|$)/iu,
  /(?:^|\/)souls\/host\/infrastructure\.json$/iu,
  /(?:^|\/)\.env(?:\.[^/]+)?$/iu,
  /\.(?:pem|key|p12|pfx|keystore)$/iu
];

export class WorkspaceSandboxError extends Error {
  constructor(
    readonly code: "WORKSPACE_NOT_CONFIGURED" | "PATH_OUTSIDE_WORKSPACE" | "SENSITIVE_PATH_DENIED" | "INVALID_PATH",
    message: string
  ) {
    super(message);
    this.name = "WorkspaceSandboxError";
  }
}

export function resolveConfiguredWorkspaceRoot(rawRoot: unknown): string | null {
  if (typeof rawRoot !== "string" || !rawRoot.trim()) return null;
  const candidate = resolve(rawRoot.trim());
  if (!existsSync(candidate)) return null;
  try {
    const stats = statSync(candidate);
    if (!stats.isDirectory()) return null;
    return realpathSync(candidate);
  } catch {
    return null;
  }
}

function isStrictlyInsideRoot(rootPath: string, targetPath: string): boolean {
  const rel = relative(rootPath, targetPath);
  if (rel === "") return true;
  return !rel.startsWith("..") && !isAbsolute(rel);
}

function resolveRealTargetOrAncestor(candidate: string): string {
  let cursor = candidate;
  const tailSegments: string[] = [];
  while (!existsSync(cursor)) {
    const parent = dirname(cursor);
    if (parent === cursor) break;
    tailSegments.unshift(relative(parent, cursor));
    cursor = parent;
  }
  const realBase = existsSync(cursor) ? realpathSync(cursor) : cursor;
  return tailSegments.length > 0 ? resolve(realBase, ...tailSegments) : realBase;
}

export function resolveSandboxedWorkspacePath(
  workspaceRoot: string,
  requestedPath: string,
  allowRootDirectory = false
): { absolutePath: string; relativePosixPath: string } {
  const trimmed = requestedPath.trim();
  if ((!trimmed && !allowRootDirectory) || trimmed.includes("\0")) {
    throw new WorkspaceSandboxError("INVALID_PATH", "Invalid workspace path");
  }
  const realRoot = realpathSync(resolve(workspaceRoot));
  const lexicalCandidate = resolve(realRoot, trimmed || ".");
  if (!isStrictlyInsideRoot(realRoot, lexicalCandidate)) {
    throw new WorkspaceSandboxError("PATH_OUTSIDE_WORKSPACE", `Path escapes workspace root: ${requestedPath}`);
  }
  const realCandidate = resolveRealTargetOrAncestor(lexicalCandidate);
  if (!isStrictlyInsideRoot(realRoot, realCandidate)) {
    throw new WorkspaceSandboxError("PATH_OUTSIDE_WORKSPACE", `Symlink target escapes workspace root: ${requestedPath}`);
  }
  const relativePosixPath = relative(realRoot, realCandidate).split("\\").join("/") || ".";
  if (!allowRootDirectory && relativePosixPath === ".") {
    throw new WorkspaceSandboxError("INVALID_PATH", "File path must not point to workspace root directory");
  }
  if (SENSITIVE_REL_PATTERNS.some((pattern) => pattern.test(relativePosixPath))) {
    throw new WorkspaceSandboxError("SENSITIVE_PATH_DENIED", `Access to sensitive path is denied: ${relativePosixPath}`);
  }
  return { absolutePath: realCandidate, relativePosixPath };
}
