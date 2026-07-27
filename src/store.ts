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

const DATA_FILE = 'data.json';
const LEGACY_EXTENSION_ID = 'pujie.skills-manager';

export const DEFAULTS: SkillsState = {
  schemaVersion: 2,
  repositories: [],
  skills: [],
  categories: ['Default'],
  groupBy: 'category',
  groupRepositories: true,
  statusFilter: 'all',
  sortingOption: 'A-Z',
};

let file: string | null = null;

/** Initialize the store path. Call once in activate(). */
export function init(context: vscode.ExtensionContext): void {
  file = path.join(context.globalStorageUri.fsPath, DATA_FILE);
  migrateLegacyData(context);
  migrateStoredState();
}

function migrateLegacyData(context: vscode.ExtensionContext): void {
  const current = getStatePath();
  if (fs.existsSync(current)) { return; }
  const legacy = path.join(
    path.dirname(context.globalStorageUri.fsPath),
    LEGACY_EXTENSION_ID,
    DATA_FILE,
  );
  if (!fs.existsSync(legacy)) { return; }
  try {
    fs.mkdirSync(path.dirname(current), { recursive: true });
    fs.copyFileSync(legacy, current, fs.constants.COPYFILE_EXCL);
  } catch (error) {
    console.warn('[skills-deck] migrate legacy data failed:', error);
  }
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

function sortKeys<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(sortKeys) as unknown as T;
  }
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort((a, b) => a.localeCompare(b))
      .reduce((sorted: Record<string, unknown>, key) => {
        sorted[key] = sortKeys((value as Record<string, unknown>)[key]);
        return sorted;
      }, {}) as unknown as T;
  }
  return value;
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
        legacyRepositoryPlaceholder: item.legacyRepositoryPlaceholder
          ?? (raw.schemaVersion !== 2
            && item.id === repositoryName(repoId, item.name || item.id)),
      });
    }
  }
  out.repositories = Array.from(repositories.values());

  if (Array.isArray(raw.categories) && raw.categories.length > 0) { out.categories = raw.categories; }
  if (isGroupBy(raw.groupBy)) { out.groupBy = raw.groupBy; }
  if (typeof raw.groupRepositories === 'boolean') {
    out.groupRepositories = raw.groupRepositories;
  }
  if (isStatusFilter(raw.statusFilter)) { out.statusFilter = raw.statusFilter; }
  if (isSorting(raw.sortingOption)) { out.sortingOption = raw.sortingOption; }
  return out;
}

function migrateStoredState(): void {
  const p = getStatePath();
  if (!fs.existsSync(p)) { return; }
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as Partial<SkillsState>;
    if (raw.schemaVersion === 2 && Array.isArray(raw.repositories)) { return; }
    write(normalizeState(raw));
  } catch (e) {
    console.warn('[skills-deck] migrate store failed:', e);
  }
}

function isGroupBy(v: unknown): v is SkillsState['groupBy'] {
  return v === 'category' || v === 'source' || v === 'status' || v === 'scope' || v === 'flat';
}
function isStatusFilter(v: unknown): v is SkillsState['statusFilter'] {
  return v === 'all' || v === 'installed' || v === 'unwanted' || v === 'diff';
}
function isSorting(v: unknown): v is SkillsState['sortingOption'] {
  return v === 'A-Z' || v === 'Z-A' || v === 'New-Old' || v === 'Old-New';
}
