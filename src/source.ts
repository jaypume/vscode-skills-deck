/**
 * Source classification & normalization.
 *
 * skills-sh-plus has no central classifier; we build one here. The `source`
 * string on a DeclaredSkill uses a `type:spec` prefix syntax (compatible with
 * the chezmoi agent-skills.yaml plan), with bare URLs / owner-repo auto-inferred.
 */

import * as path from 'path';
import * as os from 'os';
import { SourceType } from './types';

/** Split a stored `source` into its type and raw spec. */
export function parseSource(source: string): { type: SourceType; spec: string } {
  const idx = source.indexOf(':');
  if (idx <= 0) {
    return { type: inferType(source), spec: source };
  }
  const prefix = source.slice(0, idx).toLowerCase();
  const spec = source.slice(idx + 1);
  switch (prefix) {
    case 'github': return { type: 'github', spec };
    case 'local': return { type: 'local', spec };
    case 'marketplace': return { type: 'marketplace', spec };
    case 'skillhub': return { type: 'skillhub', spec };
    default: return { type: inferType(source), spec: source };
  }
}

/** Infer type from a bare (un-prefixed) string. */
export function inferType(raw: string): SourceType {
  const s = raw.trim().toLowerCase();
  if (s.startsWith('https://github.com/') || /^[a-z0-9_.-]+\/[a-z0-9_.-]+/i.test(s)) {
    return 'github';
  }
  if (s.includes('skillhub.cn')) { return 'skillhub'; }
  if (s.startsWith('https://') || s.startsWith('http://')) { return 'marketplace'; }
  // Looks like a filesystem path
  if (s.startsWith('/') || s.startsWith('~/') || s.startsWith('./') || /^[a-z]:[\\/]/i.test(s)) {
    return 'local';
  }
  return 'unknown';
}

/** Classify a stored source string into its SourceType. */
export function classifySource(source: string): SourceType {
  return parseSource(source).type;
}

/**
 * Normalize free-form input into a stored `source` string.
 * Accepts: bare URL, owner/repo, prefixed forms, absolute/relative paths.
 */
export function normalizeSource(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) { return trimmed; }

  // Already prefixed — keep as-is (but validate prefix).
  const { type } = parseSource(trimmed);
  if (trimmed.includes(':') && type !== 'unknown') {
    return trimmed;
  }

  // Bare input — infer and prepend prefix.
  const inferred = inferType(trimmed);
  if (inferred === 'local') {
    return `local:${expandPath(trimmed)}`;
  }
  return `${inferred}:${trimmed}`;
}

/** Expand ~ and resolve to absolute (for local sources). */
export function expandPath(p: string): string {
  if (p.startsWith('~/') || p === '~') {
    return path.join(os.homedir(), p.slice(1));
  }
  return path.resolve(p);
}

/** Extract the on-disk local path from a `local:` source. */
export function localPath(source: string): string {
  const { spec } = parseSource(source);
  return expandPath(spec);
}

/**
 * The argument to pass to `npx skills add` for github/marketplace/skillhub.
 * For `github:owner/repo` → `owner/repo` or full URL; for prefixed URLs the
 * spec is already the URL.
 */
export function npxAddArg(source: string): string {
  const { type, spec } = parseSource(source);
  switch (type) {
    case 'github':
      // spec may be owner/repo or a full https URL (with optional /tree/sub).
      return spec;
    case 'marketplace':
    case 'skillhub':
      return spec;
    default:
      return spec;
  }
}

/**
 * Parse a pasted `npx skills add <args>` command into source + optional skill.
 * Used by the Add wizard's "skills.sh" path.
 * Returns the normalized source string and the --skill value if present.
 */
export function parseNpxCommand(input: string): { source: string; skill?: string } {
  const s = input.trim();
  const addIdx = s.indexOf('skills add');
  const rest = addIdx >= 0 ? s.slice(addIdx + 'skills add'.length).trim() : s;
  // Tokenize, respecting quoted args.
  const tokens = rest.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
  let positional: string | undefined;
  let skill: string | undefined;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i].replace(/^"|"$/g, '');
    if (t === '-s' || t === '--skill') {
      skill = tokens[i + 1]?.replace(/^"|"$/g, '');
      i++;
    } else if (t.startsWith('--skill=')) {
      skill = t.slice('--skill='.length).replace(/^"|"$/g, '');
    } else if (!t.startsWith('-') && !positional) {
      positional = t;
    }
  }
  if (!positional) { return { source: '' }; }
  return { source: normalizeSource(positional), skill };
}
