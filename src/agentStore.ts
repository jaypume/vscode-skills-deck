import * as vscode from 'vscode';
import {
  AgentPreference,
  AgentsPayload,
  AgentsState,
  CustomAgent,
  ResolvedAgent,
} from './types';
import { ALL_AGENT_IDS, resolveAgents } from './known-agents';
import * as store from './store';

const DEFAULTS: AgentsPayload = {
  setupCompleted: false,
  preferences: [],
  customAgents: [],
};

let initialized = false;

/** No-op now that data lives in data.json; kept for extension.ts wiring. */
export function init(_context: vscode.ExtensionContext): void {
  initialized = true;
}

/** Normalize a raw agents payload (shared with store.normalizeState). */
export function normalizeAgents(raw: Partial<AgentsPayload> | null | undefined): AgentsPayload {
  const source = raw ?? {};
  const preferenceItems = Array.isArray(source.preferences)
    ? source.preferences.filter(validPreference).map(item => ({
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
  const customItems = Array.isArray(source.customAgents)
    ? source.customAgents.filter(validCustom).map(item => ({
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
    setupCompleted: source.setupCompleted === true,
    preferences,
    customAgents,
  };
}

/** Read agents payload from the shared data.json. */
export function read(): AgentsState {
  if (!initialized) { throw new Error('agent store not initialized'); }
  const payload = store.get('agents');
  return { schemaVersion: 1, ...payload };
}

/** Persist agents payload into the shared data.json. */
export function write(state: AgentsState): void {
  if (!initialized) { throw new Error('agent store not initialized'); }
  const payload: AgentsPayload = {
    setupCompleted: state.setupCompleted,
    preferences: state.preferences,
    customAgents: state.customAgents,
  };
  store.update('agents', payload);
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

/** Default agents payload (for store.DEFAULTS). */
export function defaults(): AgentsPayload {
  return { ...DEFAULTS, preferences: [], customAgents: [] };
}
