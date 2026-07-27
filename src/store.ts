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
 *   i.e. User/globalStorage/pujie.skills-manager/data.json
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { SkillsState } from './types';

const DATA_FILE = 'data.json';

export const DEFAULTS: SkillsState = {
  skills: [],
  categories: ['Default'],
  groupBy: 'category',
  statusFilter: 'all',
  sortingOption: 'A-Z',
};

let file: string | null = null;

/** Initialize the store path. Call once in activate(). */
export function init(context: vscode.ExtensionContext): void {
  file = path.join(context.globalStorageUri.fsPath, DATA_FILE);
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
      return normalize(JSON.parse(fs.readFileSync(p, 'utf8')));
    }
  } catch (e) {
    console.warn('[skills-manager] read store failed:', e);
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
    console.warn('[skills-manager] write store failed:', e);
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
function normalize(o: Partial<SkillsState> | null): SkillsState {
  const out: SkillsState = { ...DEFAULTS };
  if (Array.isArray(o?.skills)) { out.skills = o!.skills as SkillsState['skills']; }
  if (Array.isArray(o?.categories) && o!.categories.length > 0) { out.categories = o!.categories; }
  if (isGroupBy(o?.groupBy)) { out.groupBy = o!.groupBy; }
  if (isStatusFilter(o?.statusFilter)) { out.statusFilter = o!.statusFilter; }
  if (isSorting(o?.sortingOption)) { out.sortingOption = o!.sortingOption; }
  return out;
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
