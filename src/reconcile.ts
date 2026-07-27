/**
 * Reconciliation — the declarative core, ported from extensions-bookmark's
 * decorateBookmark (extension.js:87-97) + computeExtraBookmarks (42-69).
 *
 * Diff is computed at render time, never persisted. `wanted` (declared) is
 * crossed with actual install presence to produce a SkillStatus; installed-but-
 * undeclared skills become `extra` pseudo-entries.
 */

import {
  DeclaredSkill,
  DecoratedSkill,
  InstalledSkill,
  ResolvedSkill,
  ScanResult,
  SkillRepository,
  SkillScope,
  SkillStatus,
} from './types';
import { classifySource, repositoryId, repositoryName } from './source';

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
export function decorateSkill(declared: ResolvedSkill, installed: InstalledMap): DecoratedSkill {
  const actual = installed.get(declared.id);
  const want = declared.wanted;
  const status: SkillStatus = want
    ? (actual ? 'wanted-installed' : 'wanted-missing')
    : (actual ? 'unwanted-installed' : 'unwanted-missing');

  return {
    ...declared,
    status,
    sourceType: classifySource(declared.source),
    installed: Boolean(actual),
    installedAgents: actual?.agents ?? [],
    missingAgents: actual?.observations
      .filter(item => item.enabled && item.state === 'missing')
      .map(item => item.agentName) ?? [],
    overrideAgents: actual?.observations
      .filter(item => item.enabled && item.state === 'override')
      .map(item => item.agentName) ?? [],
    brokenAgents: actual?.observations
      .filter(item => item.enabled && item.state === 'broken-link')
      .map(item => item.agentName) ?? [],
    hasAgentDiff: actual?.observations.some(item =>
      item.enabled && (item.state === 'missing' || item.state === 'broken-link')) ?? false,
    installedPath: actual?.path,
  };
}

/**
 * Installed-but-undeclared skills → `extra` pseudo-entries (one per scope).
 * Mirrors computeExtraBookmarks.
 */
export function computeExtras(
  declared: DeclaredSkill[],
  repositories: SkillRepository[],
  scan: ScanResult,
): DecoratedSkill[] {
  const declaredIds = new Set(declared.map(d => `${d.scope}:${d.id}`));
  const repositoryMap = new Map(repositories.map(repo => [repo.repoId, repo]));
  const out: DecoratedSkill[] = [];

  for (const scope of ['global', 'project'] as SkillScope[]) {
    const map = buildInstalledMap(scan, scope);
    for (const [folderName, installed] of map) {
      if (declaredIds.has(`${scope}:${folderName}`)) { continue; }
      const source = installed.source ?? '';
      const repoId = repositoryId(source, `${scope}:${folderName}`);
      const repository = repositoryMap.get(repoId) ?? {
        repoId,
        name: repositoryName(repoId, folderName),
        source,
        category: 'Default',
        wanted: false,
        dateAdded: '',
      };
      out.push({
        id: folderName,
        skillId: folderName,
        repoId,
        name: installed.name,
        source,
        category: 'Default',
        wanted: false,
        dateAdded: '',
        scope,
        note: undefined,
        status: 'extra',
        sourceType: classifySource(installed.source ?? ''),
        installed: true,
        installedAgents: installed.agents,
        missingAgents: [],
        overrideAgents: [],
        brokenAgents: [],
        hasAgentDiff: installed.observations.some(item =>
          item.enabled && (item.state === 'missing' || item.state === 'broken-link')),
        installedPath: installed.path,
        repository,
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

export function resolveDeclaredSkill(
  declared: DeclaredSkill,
  repositories: SkillRepository[],
): ResolvedSkill {
  const repository = repositories.find(repo => repo.repoId === declared.repoId) ?? {
    repoId: declared.repoId,
    name: repositoryName(declared.repoId, declared.name),
    source: declared.source ?? '',
    category: 'Default',
    wanted: true,
    dateAdded: declared.dateAdded,
  };
  return {
    ...declared,
    source: declared.source ?? repository.source ?? '',
    category: declared.category ?? repository.category ?? 'Default',
    wanted: declared.wanted ?? repository.wanted ?? true,
    repository,
  };
}

/**
 * Full reconcile: decorate every declared skill + append extras.
 * Each declared skill is checked against its own scope's installed map.
 */
export function reconcile(
  declared: DeclaredSkill[],
  repositories: SkillRepository[],
  scan: ScanResult,
): DecoratedSkill[] {
  const globalMap = buildInstalledMap(scan, 'global');
  const projectMap = buildInstalledMap(scan, 'project');

  const decorated = declared.map(item => {
    const resolved = resolveDeclaredSkill(item, repositories);
    return decorateSkill(resolved, resolved.scope === 'project' ? projectMap : globalMap);
  });
  const extras = computeExtras(declared, repositories, scan);
  return [...decorated, ...extras];
}
