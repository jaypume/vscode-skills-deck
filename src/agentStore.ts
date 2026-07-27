import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  AgentPreference,
  AgentsState,
  CustomAgent,
  ResolvedAgent,
} from './types';
import { ALL_AGENT_IDS, resolveAgents } from './known-agents';

const AGENTS_FILE = 'agents.json';
const DEFAULTS: AgentsState = {
  schemaVersion: 1,
  setupCompleted: false,
  preferences: [],
  customAgents: [],
};

let file: string | undefined;

export function init(context: vscode.ExtensionContext): void {
  file = path.join(context.globalStorageUri.fsPath, AGENTS_FILE);
}

export function read(): AgentsState {
  if (!file) { throw new Error('agent store not initialized'); }
  try {
    if (fs.existsSync(file)) {
      return normalize(JSON.parse(fs.readFileSync(file, 'utf8')));
    }
  } catch (error) {
    console.warn('[skills-deck] read agents failed:', error);
  }
  return cloneDefaults();
}

export function write(state: AgentsState): void {
  if (!file) { throw new Error('agent store not initialized'); }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

export function resolved(): ResolvedAgent[] {
  return resolveAgents(read());
}

export function setSetupCompleted(value = true): void {
  const state = read();
  state.setupCompleted = value;
  write(state);
}

export function setEnabled(id: string, enabled: boolean): void {
  const state = read();
  state.setupCompleted = true;
  const custom = state.customAgents.find(agent => agent.id === id);
  if (custom) {
    custom.enabled = enabled;
  } else {
    const preference = getPreference(state, id);
    preference.enabled = enabled;
  }
  write(state);
}

export function updatePreference(value: AgentPreference): void {
  const state = read();
  const index = state.preferences.findIndex(item => item.id === value.id);
  if (index >= 0) {
    state.preferences[index] = value;
  } else {
    state.preferences.push(value);
  }
  write(state);
}

export function upsertCustom(value: CustomAgent): void {
  const state = read();
  const index = state.customAgents.findIndex(item => item.id === value.id);
  if (index >= 0) {
    state.customAgents[index] = value;
  } else {
    state.customAgents.push(value);
  }
  write(state);
}

export function removeCustom(id: string): void {
  const state = read();
  state.customAgents = state.customAgents.filter(agent => agent.id !== id);
  write(state);
}

export function isKnownId(id: string, excludeId?: string): boolean {
  if (id !== excludeId && ALL_AGENT_IDS.includes(id)) { return true; }
  return read().customAgents.some(agent => agent.id === id && agent.id !== excludeId);
}

function normalize(raw: Partial<AgentsState>): AgentsState {
  const preferenceItems = Array.isArray(raw.preferences)
    ? raw.preferences.filter(validPreference).map(item => ({
      id: item.id,
      enabled: item.enabled === true,
      rootDir: text(item.rootDir),
      globalSkillsDir: text(item.globalSkillsDir),
      projectSkillsDir: text(item.projectSkillsDir),
    }))
    : [];
  const preferences = Array.from(
    new Map(preferenceItems.map(item => [item.id, item])).values(),
  );
  const customItems = Array.isArray(raw.customAgents)
    ? raw.customAgents.filter(validCustom).map(item => ({
      id: item.id,
      displayName: item.displayName,
      rootDir: item.rootDir,
      globalSkillsDir: item.globalSkillsDir,
      projectSkillsDir: item.projectSkillsDir,
      enabled: item.enabled === true,
    }))
    : [];
  const customAgents: CustomAgent[] = [];
  const ids = new Set(ALL_AGENT_IDS);
  for (const item of customItems) {
    if (ids.has(item.id)) {
      console.warn(`[skills-deck] ignored duplicate custom agent: ${item.id}`);
      continue;
    }
    ids.add(item.id);
    customAgents.push(item);
  }
  return {
    schemaVersion: 1,
    setupCompleted: raw.setupCompleted === true,
    preferences,
    customAgents,
  };
}

function validPreference(value: unknown): value is AgentPreference {
  if (!value || typeof value !== 'object') { return false; }
  const item = value as Partial<AgentPreference>;
  return typeof item.id === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.id);
}

function validCustom(value: unknown): value is CustomAgent {
  if (!validPreference(value)) { return false; }
  const item = value as Partial<CustomAgent>;
  return typeof item.displayName === 'string'
    && typeof item.rootDir === 'string'
    && typeof item.globalSkillsDir === 'string'
    && typeof item.projectSkillsDir === 'string';
}

function getPreference(state: AgentsState, id: string): AgentPreference {
  let preference = state.preferences.find(item => item.id === id);
  if (!preference) {
    preference = { id, enabled: false };
    state.preferences.push(preference);
  }
  return preference;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function cloneDefaults(): AgentsState {
  return {
    ...DEFAULTS,
    preferences: [],
    customAgents: [],
  };
}
