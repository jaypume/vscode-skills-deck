/**
 * File-backed store for declared skills data.
 *
 * Ported from extensions-bookmark/store.js → TypeScript. Keeps the declared
 * skills list in a standalone JSON file under the extension's globalStorage
 * directory instead of polluting settings.json. Mirrors the subset of
 * vscode.WorkspaceConfiguration the extension uses: get(key, fallback) /
 * update(key, value).
 *
 * The data file lives at:
 *   <globalStorageUri>/data.json
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { DeclaredSkill, SkillRepository, SkillsState } from './types';
import { repositoryId, repositoryName } from './source';
import { defaults as defaultAgents, normalizeAgents } from './agentStore';

const DATA_FILE = 'data.json';
const LEGACY_AGENTS_FILE = 'agents.json';

export const DEFAULTS: SkillsState = {
  schemaVersion: 3,
  repositories: [],
  skills: [],
  categories: ['Default'],
  agents: defaultAgents(),
};

let file: string | null = null;

/** Initialize the store path. Call once in activate(). */
export function init(context: vscode.ExtensionContext): void {
  file = path.join(context.globalStorageUri.fsPath, DATA_FILE);
  migrateStoredState();
  migrateAgentsJson(context);
}

function getStatePath(): string {
  if (!file) { throw new Error('store not initialized; call init(context) first'); }
  return file;
}

/** Read + normalize the whole state, falling back to defaults. */
export function read(): SkillsState {
  try {
    const p = getStatePath();
    if (fs.existsSync(p)) {
      return normalizeState(JSON.parse(fs.readFileSync(p, 'utf8')));
    }
  } catch (e) {
    console.warn('[skills-deck] read store failed:', e);
  }
  return { ...DEFAULTS };
}

/** Persist the whole state atomically (sorted keys, trailing newline). */
export function write(state: SkillsState): void {
  try {
    const p = getStatePath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, `${JSON.stringify(sortKeys(state), null, 2)}\n`, 'utf8');
  } catch (e) {
    console.warn('[skills-deck] write store failed:', e);
  }
}

/**
 * Recursively sort object keys for stable, readable output.
 * Scalars first (alphabetical), then arrays/objects (alphabetical) — so heavy
 * nested fields like `availableSkills` sink to the end of their object while
 * scalar metadata stays on top.
 */
function sortKeys<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(sortKeys) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    entries.sort(([ak, av], [bk, bv]) => {
      const aComplex = isComplex(av);
      const bComplex = isComplex(bv);
      if (aComplex !== bComplex) { return aComplex ? 1 : -1; }
      return ak.localeCompare(bk);
    });
    return Object.fromEntries(entries.map(([k, v]) => [k, sortKeys(v)])) as unknown as T;
  }
  return value;
}

function isComplex(value: unknown): boolean {
  return Array.isArray(value) || (value !== null && typeof value === 'object');
}

/** get/update façade, mirroring vscode.WorkspaceConfiguration ergonomics. */
export function get<K extends keyof SkillsState>(key: K): SkillsState[K] {
  const v = read()[key];
  return v === undefined ? DEFAULTS[key] : v;
}

export function update<K extends keyof SkillsState>(key: K, value: SkillsState[K]): void {
  const state = read();
  (state as unknown as Record<string, unknown>)[key as string] = value;
  write(state);
}

/** Returns the absolute path to data.json (for the "Open data.json" command). */
export function dataFilePath(): string {
  return getStatePath();
}

/** Defensive normalization against hand-edited or partial data files. */
export function normalizeState(o: Partial<SkillsState> | null): SkillsState {
  const out: SkillsState = { ...DEFAULTS, repositories: [], skills: [] };
  const raw = (o ?? {}) as Partial<SkillsState> & {
    skills?: Array<Partial<DeclaredSkill> & {
      source?: string;
      category?: string;
      wanted?: boolean;
    }>;
  };

  if (Array.isArray(raw.repositories)) {
    out.repositories = raw.repositories
      .filter(repo => repo && typeof repo.repoId === 'string')
      .map(repo => ({
        repoId: repo.repoId,
        name: repo.name || repositoryName(repo.repoId, repo.repoId),
        source: repo.source,
        category: repo.category,
        wanted: repo.wanted,
        dateAdded: repo.dateAdded || new Date().toISOString(),
        availableSkills: Array.isArray(repo.availableSkills) ? repo.availableSkills : undefined,
      }));
  }

  const repositories = new Map(out.repositories.map(repo => [repo.repoId, repo]));
  if (Array.isArray(raw.skills)) {
    for (const item of raw.skills) {
      if (!item || typeof item.id !== 'string') { continue; }
      const scope = item.scope === 'project' ? 'project' : 'global';
      const source = typeof item.source === 'string' ? item.source : '';
      const repoId = typeof item.repoId === 'string' && item.repoId
        ? item.repoId
        : repositoryId(source, `${scope}:${item.id}`);
      let repository = repositories.get(repoId);
      if (!repository) {
        repository = {
          repoId,
          name: repositoryName(repoId, item.name || item.id),
          source,
          category: item.category || 'Default',
          wanted: item.wanted ?? true,
          dateAdded: item.dateAdded || new Date().toISOString(),
        };
        repositories.set(repoId, repository);
      }

      out.skills.push({
        id: item.id,
        skillId: item.skillId || item.id,
        repoId,
        name: item.name || item.skillId || item.id,
        source: source && source !== repository.source ? source : undefined,
        category: item.category && item.category !== repository.category ? item.category : undefined,
        wanted: item.wanted !== undefined && item.wanted !== repository.wanted
          ? item.wanted
          : undefined,
        dateAdded: item.dateAdded || new Date().toISOString(),
        scope,
        note: item.note,
      });
    }
  }
  out.repositories = Array.from(repositories.values());

  if (Array.isArray(raw.categories) && raw.categories.length > 0) { out.categories = raw.categories; }
  out.agents = normalizeAgents(raw.agents);
  return out;
}

function migrateStoredState(): void {
  const p = getStatePath();
  if (!fs.existsSync(p)) { return; }
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as Partial<SkillsState>;
    if (raw.schemaVersion === 3 && Array.isArray(raw.repositories)) { return; }
    write(normalizeState(raw));
  } catch (e) {
    console.warn('[skills-deck] migrate store failed:', e);
  }
}

/** Merge a legacy standalone agents.json into data.json, then remove it. */
function migrateAgentsJson(context: vscode.ExtensionContext): void {
  const legacy = path.join(context.globalStorageUri.fsPath, LEGACY_AGENTS_FILE);
  if (!fs.existsSync(legacy)) { return; }
  try {
    const raw = JSON.parse(fs.readFileSync(legacy, 'utf8')) as Partial<{
      setupCompleted?: boolean;
      preferences?: unknown;
      customAgents?: unknown;
    }>;
    const state = read();
    state.agents = normalizeAgents({
      setupCompleted: raw.setupCompleted,
      preferences: raw.preferences as never,
      customAgents: raw.customAgents as never,
    });
    write(state);
    fs.unlinkSync(legacy);
  } catch (e) {
    console.warn('[skills-deck] migrate agents.json failed:', e);
  }
}
