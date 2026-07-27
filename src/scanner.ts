/**
 * Skill scanner — simplified port of skills-sh-plus SkillScanner.
 *
 * Scans the skill directories of all active agents (global + project),
 * deduplicates across agents (same folderName → one entry with merged agents[]),
 * preferring the canonical (~/.agents/skills/) entry for metadata.
 *
 * First version omits WSL scanning and lock-file dual-matching; presence is
 * determined by directory existence. SKILL.md frontmatter is parsed via
 * gray-matter for display name / description.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';
import matter from 'gray-matter';
import { InstalledSkill, ScanResult, SkillScope } from './types';
import { KNOWN_AGENTS, KnownAgent } from './known-agents';
import { normalizeSource } from './source';
import { getConfig } from './config';

interface AgentScanEntry {
  skill: InstalledSkill;
  agentDisplayName: string;
  isCanonical: boolean;
}

interface LockEntry {
  source?: string;
  sourceUrl?: string;
  sourceType?: string;
}

export class SkillScanner {
  /** Active agents per user configuration (default: all). */
  private getActiveAgents(): KnownAgent[] {
    const activeIds = getConfig<string[]>('activeAgents', []);
    if (!activeIds || activeIds.length === 0) { return KNOWN_AGENTS; }
    const idSet = new Set(activeIds);
    return KNOWN_AGENTS.filter(a => idSet.has(a.id));
  }

  /** Resolve the global skill directory for a given agent. */
  private resolveGlobalDir(agent: KnownAgent): string {
    if (agent.envOverride) {
      const envDir = process.env[agent.envOverride];
      if (envDir) { return path.join(envDir, 'skills'); }
    }
    return path.join(os.homedir(), agent.skillsDir);
  }

  /** All global skill directories to watch. */
  getAllGlobalDirs(): string[] {
    return this.getActiveAgents().map(a => this.resolveGlobalDir(a));
  }

  /** All project-level skill directories (for the first workspace folder). */
  getAllProjectDirs(): string[] {
    const ws = vscode.workspace.workspaceFolders;
    if (!ws || ws.length === 0) { return []; }
    const root = ws[0].uri.fsPath;
    return this.getActiveAgents().map(a => path.join(root, a.skillsDir));
  }

  /** The canonical global skills dir (~/.agents/skills). */
  getCanonicalGlobalDir(): string {
    const c = KNOWN_AGENTS.find(a => a.isCanonical);
    return c ? this.resolveGlobalDir(c) : path.join(os.homedir(), '.agents', 'skills');
  }

  async scan(): Promise<ScanResult> {
    const activeAgents = this.getActiveAgents();
    const globalSources = await this.readLockSources(this.globalLockPath());

    // Global skills
    const globalEntries: AgentScanEntry[] = [];
    for (const agent of activeAgents) {
      const dir = this.resolveGlobalDir(agent);
      const skills = await this.scanDirectory(dir, 'global', globalSources);
      for (const skill of skills) {
        globalEntries.push({ skill, agentDisplayName: agent.displayName, isCanonical: agent.isCanonical === true });
      }
    }
    const globalSkills = this.deduplicateAcrossAgents(globalEntries);

    // Project skills
    let projectSkills: InstalledSkill[] = [];
    const ws = vscode.workspace.workspaceFolders;
    const root = ws?.[0]?.uri.fsPath;
    if (root) {
      const projectSources = await this.readLockSources(path.join(root, 'skills-lock.json'));
      const projectEntries: AgentScanEntry[] = [];
      for (const agent of activeAgents) {
        const dir = path.join(root, agent.skillsDir);
        const skills = await this.scanDirectory(dir, 'project', projectSources);
        for (const skill of skills) {
          projectEntries.push({ skill, agentDisplayName: agent.displayName, isCanonical: agent.isCanonical === true });
        }
      }
      projectSkills = this.deduplicateAcrossAgents(projectEntries);
    }

    return { globalSkills, projectSkills };
  }

  /**
   * Deduplicate across agent dirs: same folderName → single entry with merged
   * agents[]. Canonical entry preferred for metadata.
   */
  private deduplicateAcrossAgents(entries: AgentScanEntry[]): InstalledSkill[] {
    const map = new Map<string, { skill: InstalledSkill; agents: Set<string>; hasCanonical: boolean }>();
    for (const { skill, agentDisplayName, isCanonical } of entries) {
      const existing = map.get(skill.folderName);
      if (!existing) {
        map.set(skill.folderName, {
          skill: { ...skill, agents: [] },
          agents: new Set([agentDisplayName]),
          hasCanonical: isCanonical,
        });
      } else {
        existing.agents.add(agentDisplayName);
        if (isCanonical && !existing.hasCanonical) {
          existing.skill = { ...skill, agents: [] };
          existing.hasCanonical = true;
        }
      }
    }
    return Array.from(map.values()).map(({ skill, agents }) => ({
      ...skill,
      agents: Array.from(agents).sort(),
    }));
  }

  private async scanDirectory(
    dir: string,
    scope: SkillScope,
    sources: Map<string, string>,
  ): Promise<InstalledSkill[]> {
    const skills: InstalledSkill[] = [];
    try { await fs.promises.access(dir); } catch { return skills; }

    let entries: fs.Dirent[];
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); }
    catch { return skills; }

    for (const entry of entries) {
      // Hidden directories may be owned by the agent runtime (for example,
      // Codex's `.system`) and are outside user-managed skill state.
      if (entry.name.startsWith('.')) { continue; }
      if (!(await this.isDirectoryEntry(dir, entry))) { continue; }
      const skillMdPath = path.join(dir, entry.name, 'SKILL.md');
      const parsed = await this.parseSkillMd(skillMdPath);
      // Require a SKILL.md for it to count as a skill folder.
      skills.push({
        folderName: entry.name,
        name: parsed?.name ?? entry.name,
        description: parsed?.description,
        path: path.join(dir, entry.name),
        scope,
        agents: [],
        source: sources.get(entry.name),
      });
    }
    return skills;
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
    } catch { /* lock file is optional */ }
    return sources;
  }

  /** Follows symlinks when deciding directory-ness. */
  private async isDirectoryEntry(dir: string, entry: fs.Dirent): Promise<boolean> {
    if (entry.isDirectory()) { return true; }
    if (entry.isSymbolicLink()) {
      try { return (await fs.promises.stat(path.join(dir, entry.name))).isDirectory(); }
      catch { return false; }
    }
    return false;
  }

  private async parseSkillMd(skillMdPath: string): Promise<{ name: string; description?: string } | null> {
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
