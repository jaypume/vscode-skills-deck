/**
 * Reconciliation — the declarative core, ported from extensions-bookmark's
 * decorateBookmark (extension.js:87-97) + computeExtraBookmarks (42-69).
 *
 * Diff is computed at render time, never persisted. `wanted` (declared) is
 * crossed with actual install presence to produce a SkillStatus; installed-but-
 * undeclared skills become `extra` pseudo-entries.
 */

import { DeclaredSkill, DecoratedSkill, InstalledSkill, ScanResult, SkillScope, SkillStatus } from './types';
import { classifySource } from './source';

/** folderName → installed skill (with merged agents), for a given scope. */
export type InstalledMap = Map<string, InstalledSkill>;

/** Build a lookup map from a scan result, scoped. */
export function buildInstalledMap(scan: ScanResult, scope: SkillScope): InstalledMap {
  const list = scope === 'project' ? scan.projectSkills : scan.globalSkills;
  const m: InstalledMap = new Map();
  for (const s of list) { m.set(s.folderName, s); }
  return m;
}

/**
 * The four-quadrant status. Mirrors decorateBookmark:
 *   want  = declared.wanted
 *   actual = installedMap.has(declared.id)
 *   want  + actual → 'wanted-installed'
 *   want  + missing→ 'wanted-missing'      ★ diff
 *   !want + actual → 'unwanted-installed'  ★ diff
 *   !want + missing→ 'unwanted-missing'
 */
export function decorateSkill(declared: DeclaredSkill, installed: InstalledMap): DecoratedSkill {
  const actual = installed.get(declared.id);
  const want = declared.wanted;
  const status: SkillStatus = want
    ? (actual ? 'wanted-installed' : 'wanted-missing')
    : (actual ? 'unwanted-installed' : 'unwanted-missing');

  return {
    ...declared,
    status,
    sourceType: classifySource(declared.source),
    installedAgents: actual?.agents ?? [],
    installedPath: actual?.path,
  };
}

/**
 * Installed-but-undeclared skills → `extra` pseudo-entries (one per scope).
 * Mirrors computeExtraBookmarks.
 */
export function computeExtras(
  declared: DeclaredSkill[],
  scan: ScanResult,
): DecoratedSkill[] {
  const declaredIds = new Set(declared.map(d => d.id));
  const out: DecoratedSkill[] = [];

  for (const scope of ['global', 'project'] as SkillScope[]) {
    const map = buildInstalledMap(scan, scope);
    for (const [folderName, installed] of map) {
      if (declaredIds.has(folderName)) { continue; }
      out.push({
        id: folderName,
        name: installed.name,
        source: installed.source ?? '',
        category: 'Default',
        wanted: false,
        dateAdded: '',
        scope,
        note: undefined,
        status: 'extra',
        sourceType: classifySource(installed.source ?? ''),
        installedAgents: installed.agents,
        installedPath: installed.path,
        extra: true,
      });
    }
  }
  return out;
}

/** Diff statuses (★) — what diverges between declaration and reality. */
export function isDiffStatus(s: SkillStatus): boolean {
  return s === 'wanted-missing' || s === 'unwanted-installed' || s === 'extra';
}

/**
 * Full reconcile: decorate every declared skill + append extras.
 * Each declared skill is checked against its own scope's installed map.
 */
export function reconcile(declared: DeclaredSkill[], scan: ScanResult): DecoratedSkill[] {
  const globalMap = buildInstalledMap(scan, 'global');
  const projectMap = buildInstalledMap(scan, 'project');

  const decorated = declared.map(d =>
    decorateSkill(d, d.scope === 'project' ? projectMap : globalMap),
  );
  const extras = computeExtras(declared, scan);
  return [...decorated, ...extras];
}
