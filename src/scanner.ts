import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import matter from 'gray-matter';
import {
  AgentSkillObservation,
  InstalledSkill,
  ResolvedAgent,
  ScanResult,
  SkillScope,
} from './types';
import * as agentStore from './agentStore';
import { agentSkillsDir, centralSkillsDir } from './known-agents';
import { normalizeSource } from './source';

interface LockEntry {
  source?: string;
  sourceUrl?: string;
}

interface DirectoryEntry {
  name: string;
  path: string;
  linkTarget?: string;
  link: boolean;
  broken: boolean;
}

export class SkillScanner {
  getAllGlobalDirs(): string[] {
    const central = centralSkillsDir('global');
    const agents = agentStore.resolved().map(agent => agent.globalSkillsDir);
    return uniquePaths([central!, ...agents]);
  }

  getAllProjectDirs(): string[] {
    const central = centralSkillsDir('project');
    const agents = agentStore.resolved()
      .map(agent => agentSkillsDir(agent, 'project'))
      .filter((value): value is string => Boolean(value));
    return uniquePaths([central, ...agents].filter((value): value is string => Boolean(value)));
  }

  getCanonicalGlobalDir(): string {
    return centralSkillsDir('global')!;
  }

  async scan(): Promise<ScanResult> {
    const agents = agentStore.resolved();
    const globalDir = centralSkillsDir('global')!;
    const projectDir = centralSkillsDir('project');
    const globalSources = await this.readLockSources(this.globalLockPath());
    const projectSources = projectDir
      ? await this.readLockSources(path.join(path.dirname(path.dirname(projectDir)), 'skills-lock.json'))
      : new Map<string, string>();

    const globalSkills = await this.scanCentralDirectory(globalDir, 'global', globalSources);
    const projectSkills = projectDir
      ? await this.scanCentralDirectory(projectDir, 'project', projectSources)
      : [];

    const globalObservations = await this.observeAgents(
      agents,
      'global',
      globalDir,
      globalSkills,
    );
    const projectObservations = projectDir
      ? await this.observeAgents(agents, 'project', projectDir, projectSkills)
      : [];

    attachObservations(globalSkills, globalObservations);
    attachObservations(projectSkills, projectObservations);

    return {
      globalSkills,
      projectSkills,
      agentSkills: [...globalObservations, ...projectObservations]
        .filter(item => item.state === 'agent-owned'
          || item.state === 'override'
          || (item.enabled
            && (item.state === 'missing' || item.state === 'broken-link'))),
      agents,
    };
  }

  private async scanCentralDirectory(
    dir: string,
    scope: SkillScope,
    sources: Map<string, string>,
  ): Promise<InstalledSkill[]> {
    const entries = await this.readDirectory(dir);
    const skills: InstalledSkill[] = [];
    for (const entry of entries.values()) {
      if (entry.broken) { continue; }
      const parsed = await this.parseSkillMd(path.join(entry.path, 'SKILL.md'));
      skills.push({
        folderName: entry.name,
        name: parsed?.name ?? entry.name,
        description: parsed?.description,
        path: entry.path,
        scope,
        agents: [],
        observations: [],
        source: sources.get(entry.name),
      });
    }
    return skills;
  }

  private async observeAgents(
    agents: ResolvedAgent[],
    scope: SkillScope,
    centralDir: string,
    centralSkills: InstalledSkill[],
  ): Promise<AgentSkillObservation[]> {
    const central = new Map(centralSkills.map(skill => [skill.folderName, skill]));
    const observations: AgentSkillObservation[] = [];
    for (const agent of agents) {
      const dir = agentSkillsDir(agent, scope);
      if (!dir) { continue; }
      const sameDirectory = path.resolve(dir) === path.resolve(centralDir);
      const entries = sameDirectory ? new Map<string, DirectoryEntry>() : await this.readDirectory(dir);
      const names = new Set([...central.keys(), ...entries.keys()]);
      for (const skillId of names) {
        const centralSkill = central.get(skillId);
        const entry = entries.get(skillId);
        observations.push(await this.observeEntry(
          agent,
          scope,
          centralDir,
          dir,
          skillId,
          centralSkill,
          entry,
          sameDirectory,
        ));
      }
    }
    return observations;
  }

  private async observeEntry(
    agent: ResolvedAgent,
    scope: SkillScope,
    centralDir: string,
    agentDir: string,
    skillId: string,
    centralSkill: InstalledSkill | undefined,
    entry: DirectoryEntry | undefined,
    sameDirectory: boolean,
  ): Promise<AgentSkillObservation> {
    const centralPath = centralSkill?.path;
    let state: AgentSkillObservation['state'];
    if (centralSkill && sameDirectory) {
      state = 'managed-link';
    } else if (centralSkill && !entry) {
      state = 'missing';
    } else if (!centralSkill) {
      state = 'agent-owned';
    } else if (entry?.link && entry.linkTarget
      && samePath(entry.linkTarget, centralPath!)) {
      state = 'managed-link';
    } else if (entry?.link && entry.broken
      && entry.linkTarget && isWithin(entry.linkTarget, centralDir)) {
      state = 'broken-link';
    } else {
      state = 'override';
    }

    const parsed = entry && !entry.broken
      ? await this.parseSkillMd(path.join(entry.path, 'SKILL.md'))
      : null;
    return {
      agentId: agent.id,
      agentName: agent.displayName,
      enabled: agent.enabled,
      scope,
      skillId,
      name: centralSkill?.name ?? parsed?.name ?? skillId,
      path: entry?.path ?? path.join(agentDir, skillId),
      state,
      centralPath,
      linkTarget: entry?.linkTarget,
    };
  }

  private async readDirectory(dir: string): Promise<Map<string, DirectoryEntry>> {
    const out = new Map<string, DirectoryEntry>();
    let entries: fs.Dirent[];
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); }
    catch { return out; }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) { continue; }
      if (!entry.isDirectory() && !entry.isSymbolicLink()) { continue; }
      const entryPath = path.join(dir, entry.name);
      let linkTarget: string | undefined;
      let broken = false;
      if (entry.isSymbolicLink()) {
        try {
          const value = await fs.promises.readlink(entryPath);
          linkTarget = path.resolve(dir, value);
          await fs.promises.stat(entryPath);
        } catch {
          broken = true;
        }
      }
      out.set(entry.name, {
        name: entry.name,
        path: entryPath,
        link: entry.isSymbolicLink(),
        linkTarget,
        broken,
      });
    }
    return out;
  }

  private globalLockPath(): string {
    const stateHome = process.env.XDG_STATE_HOME;
    return stateHome
      ? path.join(stateHome, 'skills', '.skill-lock.json')
      : path.join(os.homedir(), '.agents', '.skill-lock.json');
  }

  private async readLockSources(lockPath: string): Promise<Map<string, string>> {
    const sources = new Map<string, string>();
    try {
      const raw = JSON.parse(await fs.promises.readFile(lockPath, 'utf8')) as {
        skills?: Record<string, LockEntry>;
      };
      for (const [skillId, entry] of Object.entries(raw.skills ?? {})) {
        const value = entry.sourceUrl || entry.source;
        if (typeof value === 'string' && value.trim()) {
          sources.set(skillId, normalizeSource(value));
        }
      }
    } catch { /* optional */ }
    return sources;
  }

  private async parseSkillMd(
    skillMdPath: string,
  ): Promise<{ name: string; description?: string } | null> {
    try {
      const raw = await fs.promises.readFile(skillMdPath, 'utf8');
      const { data } = matter(raw);
      const name = typeof data.name === 'string' && data.name.trim()
        ? data.name.trim()
        : path.basename(path.dirname(skillMdPath));
      const description = typeof data.description === 'string' ? data.description : undefined;
      return { name, description };
    } catch {
      return null;
    }
  }
}

function attachObservations(
  skills: InstalledSkill[],
  observations: AgentSkillObservation[],
): void {
  const bySkill = new Map<string, AgentSkillObservation[]>();
  for (const observation of observations) {
    if (!observation.centralPath) { continue; }
    const list = bySkill.get(observation.skillId) ?? [];
    list.push(observation);
    bySkill.set(observation.skillId, list);
  }
  for (const skill of skills) {
    skill.observations = bySkill.get(skill.folderName) ?? [];
    skill.agents = skill.observations
      .filter(item => item.enabled
        && (item.state === 'managed-link' || item.state === 'override'))
      .map(item => item.agentName)
      .sort();
  }
}

function samePath(left: string, right: string): boolean {
  try { return fs.realpathSync(left) === fs.realpathSync(right); }
  catch { return path.resolve(left) === path.resolve(right); }
}

function isWithin(value: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(value));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function uniquePaths(values: string[]): string[] {
  return Array.from(new Set(values.map(value => path.resolve(value))));
}
