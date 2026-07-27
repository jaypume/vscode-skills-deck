import * as fs from 'fs';
import * as path from 'path';
import {
  AgentSkillObservation,
  ResolvedAgent,
  SkillScope,
} from './types';
import * as agentStore from './agentStore';
import { agentSkillsDir, centralSkillsDir } from './known-agents';

export interface SyncSummary {
  created: number;
  removed: number;
  linked: number;
  overrides: number;
  broken: number;
  skipped: number;
  failures: string[];
}

export async function previewAgentSync(
  agent: ResolvedAgent,
  scope: SkillScope,
): Promise<SyncSummary> {
  return reconcileAgent(agent, scope, false);
}

export async function syncAgent(
  agent: ResolvedAgent,
  scope: SkillScope,
): Promise<SyncSummary> {
  return reconcileAgent(agent, scope, true);
}

export async function syncEnabledAgents(scope: SkillScope): Promise<SyncSummary> {
  const summary = emptySummary();
  for (const agent of agentStore.resolved().filter(item => item.enabled)) {
    mergeSummary(summary, await syncAgent(agent, scope));
  }
  return summary;
}

export async function cleanupDisabledAgents(scope: SkillScope): Promise<SyncSummary> {
  const summary = emptySummary();
  for (const agent of agentStore.resolved().filter(item => !item.enabled)) {
    mergeSummary(summary, await removeAgentLinks(agent, scope, true));
  }
  return summary;
}

export async function previewDisableAgent(agent: ResolvedAgent): Promise<SyncSummary> {
  return removeAgentLinks(agent, 'global', false);
}

export async function disableAgentLinks(agent: ResolvedAgent): Promise<SyncSummary> {
  return removeAgentLinks(agent, 'global', true);
}

export async function replaceOverride(
  observation: AgentSkillObservation,
  agent: ResolvedAgent,
): Promise<string> {
  if (observation.state !== 'override' || !observation.centralPath) {
    throw new Error('Only an override can be replaced');
  }
  const agentDir = agentSkillsDir(agent, observation.scope);
  if (!agentDir || path.dirname(observation.path) !== agentDir) {
    throw new Error('Agent skill path is outside the configured directory');
  }
  await fs.promises.access(observation.centralPath);
  const suffix = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = `${observation.path}.bak-${suffix}`;
  await fs.promises.rename(observation.path, backup);
  try {
    await fs.promises.symlink(observation.centralPath, observation.path, 'dir');
  } catch (error) {
    await fs.promises.rename(backup, observation.path);
    throw error;
  }
  return backup;
}

function emptySummary(): SyncSummary {
  return {
    created: 0,
    removed: 0,
    linked: 0,
    overrides: 0,
    broken: 0,
    skipped: 0,
    failures: [],
  };
}

async function reconcileAgent(
  agent: ResolvedAgent,
  scope: SkillScope,
  apply: boolean,
): Promise<SyncSummary> {
  const summary = emptySummary();
  const centralDir = centralSkillsDir(scope);
  const targetDir = agentSkillsDir(agent, scope);
  if (!centralDir || !targetDir) {
    summary.skipped++;
    return summary;
  }
  if (path.resolve(centralDir) === path.resolve(targetDir)) {
    summary.skipped++;
    return summary;
  }

  const centralNames = await skillNames(centralDir);
  if (apply && centralNames.size > 0) {
    try {
      await fs.promises.mkdir(targetDir, { recursive: true });
    } catch (error) {
      summary.failures.push(`${targetDir}: ${message(error)}`);
      return summary;
    }
  }

  for (const name of centralNames) {
    const expected = path.join(centralDir, name);
    const link = path.join(targetDir, name);
    const current = inspectLink(link, centralDir);
    if (!current.exists) {
      summary.created++;
      if (apply) {
        try { await fs.promises.symlink(expected, link, 'dir'); }
        catch (error) { summary.failures.push(`${link}: ${message(error)}`); }
      }
      continue;
    }
    if (current.target && samePath(current.target, expected)) {
      summary.linked++;
      continue;
    }
    if (current.managed) {
      summary.broken++;
      if (apply) {
        try {
          await fs.promises.unlink(link);
          await fs.promises.symlink(expected, link, 'dir');
        } catch (error) {
          summary.failures.push(`${link}: ${message(error)}`);
        }
      }
      continue;
    }
    summary.overrides++;
  }

  for (const entry of await directoryLinks(targetDir)) {
    if (centralNames.has(entry.name)) { continue; }
    const inspected = inspectLink(entry.path, centralDir);
    if (!inspected.managed) { continue; }
    summary.removed++;
    if (apply) {
      try { await fs.promises.unlink(entry.path); }
      catch (error) { summary.failures.push(`${entry.path}: ${message(error)}`); }
    }
  }
  return summary;
}

async function removeAgentLinks(
  agent: ResolvedAgent,
  scope: SkillScope,
  apply: boolean,
): Promise<SyncSummary> {
  const summary = emptySummary();
  const centralDir = centralSkillsDir(scope);
  const targetDir = agentSkillsDir(agent, scope);
  if (!centralDir || !targetDir) {
    summary.skipped++;
    return summary;
  }
  if (path.resolve(centralDir) === path.resolve(targetDir)) {
    summary.skipped++;
    return summary;
  }
  for (const entry of await directoryLinks(targetDir)) {
    const inspected = inspectLink(entry.path, centralDir);
    if (!inspected.managed) { continue; }
    summary.removed++;
    if (apply) {
      try { await fs.promises.unlink(entry.path); }
      catch (error) { summary.failures.push(`${entry.path}: ${message(error)}`); }
    }
  }
  return summary;
}

function inspectLink(link: string, centralDir: string): {
  exists: boolean;
  target?: string;
  managed: boolean;
} {
  let stat: fs.Stats;
  try { stat = fs.lstatSync(link); }
  catch { return { exists: false, managed: false }; }
  if (!stat.isSymbolicLink()) { return { exists: true, managed: false }; }
  try {
    const value = fs.readlinkSync(link);
    const target = path.resolve(path.dirname(link), value);
    return {
      exists: true,
      target,
      managed: isDirectChild(target, centralDir),
    };
  } catch {
    return { exists: true, managed: false };
  }
}

async function skillNames(dir: string): Promise<Set<string>> {
  const names = new Set<string>();
  let entries: fs.Dirent[];
  try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); }
  catch { return names; }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) { continue; }
    if (entry.isDirectory()) {
      names.add(entry.name);
      continue;
    }
    if (entry.isSymbolicLink()) {
      try {
        if ((await fs.promises.stat(path.join(dir, entry.name))).isDirectory()) {
          names.add(entry.name);
        }
      } catch { /* broken canonical link is not a managed skill */ }
    }
  }
  return names;
}

async function directoryLinks(
  dir: string,
): Promise<Array<{ name: string; path: string }>> {
  let entries: fs.Dirent[];
  try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); }
  catch { return []; }
  return entries
    .filter(entry => !entry.name.startsWith('.') && entry.isSymbolicLink())
    .map(entry => ({ name: entry.name, path: path.join(dir, entry.name) }));
}

function isDirectChild(value: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(value));
  return Boolean(relative)
    && !relative.startsWith('..')
    && !path.isAbsolute(relative)
    && relative.split(path.sep).length === 1;
}

function samePath(left: string, right: string): boolean {
  try { return fs.realpathSync(left) === fs.realpathSync(right); }
  catch { return path.resolve(left) === path.resolve(right); }
}

function mergeSummary(target: SyncSummary, value: SyncSummary): void {
  target.created += value.created;
  target.removed += value.removed;
  target.linked += value.linked;
  target.overrides += value.overrides;
  target.broken += value.broken;
  target.skipped += value.skipped;
  target.failures.push(...value.failures);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
