import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  AgentsState,
  BuiltInAgent,
  CustomAgent,
  ResolvedAgent,
} from './types';

export const BUILT_IN_AGENTS: BuiltInAgent[] = [
  {
    id: 'claude-code',
    displayName: 'Claude Code',
    rootDir: '~/.claude',
    globalSkillsDir: 'skills',
    projectSkillsDir: '.claude/skills',
    rootEnv: 'CLAUDE_CONFIG_DIR',
  },
  {
    id: 'codex',
    displayName: 'Codex',
    rootDir: '~/.codex',
    globalSkillsDir: 'skills',
    projectSkillsDir: '.agents/skills',
    rootEnv: 'CODEX_HOME',
  },
  {
    id: 'pi',
    displayName: 'Pi',
    rootDir: '~/.pi/agent',
    globalSkillsDir: 'skills',
    projectSkillsDir: '.pi/skills',
  },
  {
    id: 'opencode',
    displayName: 'OpenCode',
    rootDir: '~/.config/opencode',
    globalSkillsDir: 'skills',
    projectSkillsDir: '.agents/skills',
    rootEnv: 'XDG_CONFIG_HOME',
    rootEnvSuffix: 'opencode',
  },
  {
    id: 'cursor',
    displayName: 'Cursor',
    rootDir: '~/.cursor',
    globalSkillsDir: 'skills',
    projectSkillsDir: '.agents/skills',
  },
  {
    id: 'github-copilot',
    displayName: 'GitHub Copilot',
    rootDir: '~/.copilot',
    globalSkillsDir: 'skills',
    projectSkillsDir: '.agents/skills',
  },
  {
    id: 'gemini-cli',
    displayName: 'Gemini CLI',
    rootDir: '~/.gemini',
    globalSkillsDir: 'skills',
    projectSkillsDir: '.agents/skills',
  },
  {
    id: 'windsurf',
    displayName: 'Windsurf',
    rootDir: '~/.codeium/windsurf',
    globalSkillsDir: 'skills',
    projectSkillsDir: '.windsurf/skills',
  },
  {
    id: 'roo',
    displayName: 'Roo Code',
    rootDir: '~/.roo',
    globalSkillsDir: 'skills',
    projectSkillsDir: '.roo/skills',
  },
  {
    id: 'kilo',
    displayName: 'Kilo Code',
    rootDir: '~/.kilocode',
    globalSkillsDir: 'skills',
    projectSkillsDir: '.kilocode/skills',
  },
  {
    id: 'kiro',
    displayName: 'Kiro',
    rootDir: '~/.kiro',
    globalSkillsDir: 'skills',
    projectSkillsDir: '.kiro/skills',
  },
  {
    id: 'continue',
    displayName: 'Continue',
    rootDir: '~/.continue',
    globalSkillsDir: 'skills',
    projectSkillsDir: '.continue/skills',
  },
  {
    id: 'goose',
    displayName: 'Goose',
    rootDir: '~/.config/goose',
    globalSkillsDir: 'skills',
    projectSkillsDir: '.goose/skills',
    rootEnv: 'XDG_CONFIG_HOME',
    rootEnvSuffix: 'goose',
  },
  {
    id: 'trae',
    displayName: 'Trae',
    rootDir: '~/.trae',
    globalSkillsDir: 'skills',
    projectSkillsDir: '.trae/skills',
  },
  {
    id: 'amp',
    displayName: 'Amp',
    rootDir: '~/.config/amp',
    globalSkillsDir: '~/.config/agents/skills',
    projectSkillsDir: '.agents/skills',
    rootEnv: 'XDG_CONFIG_HOME',
    rootEnvSuffix: 'amp',
    globalSkillsEnv: 'XDG_CONFIG_HOME',
    globalSkillsEnvSuffix: 'agents/skills',
  },
];

export const ALL_AGENT_IDS = BUILT_IN_AGENTS.map(agent => agent.id);

export function resolveAgents(state: AgentsState): ResolvedAgent[] {
  const preferences = new Map(state.preferences.map(item => [item.id, item]));
  const builtIns = BUILT_IN_AGENTS.map(agent => {
    const preference = preferences.get(agent.id);
    const defaultRoot = envPath(agent.rootEnv, agent.rootEnvSuffix)
      ?? expandPath(agent.rootDir);
    const rootDir = expandPath(preference?.rootDir ?? defaultRoot);
    const defaultGlobal = envPath(agent.globalSkillsEnv, agent.globalSkillsEnvSuffix)
      ?? resolveFromRoot(defaultRoot, agent.globalSkillsDir);
    const globalSkillsDir = expandPath(
      preference?.globalSkillsDir
        ? resolveFromRoot(rootDir, preference.globalSkillsDir)
        : defaultGlobal,
    );
    return {
      id: agent.id,
      displayName: agent.displayName,
      rootDir,
      globalSkillsDir,
      projectSkillsDir: preference?.projectSkillsDir ?? agent.projectSkillsDir,
      enabled: preference?.enabled ?? false,
      custom: false,
      detected: fs.existsSync(rootDir),
    };
  });
  return [...builtIns, ...state.customAgents.map(resolveCustomAgent)];
}

export function resolveCustomAgent(agent: CustomAgent): ResolvedAgent {
  const rootDir = expandPath(agent.rootDir);
  return {
    id: agent.id,
    displayName: agent.displayName,
    rootDir,
    globalSkillsDir: expandPath(resolveFromRoot(rootDir, agent.globalSkillsDir)),
    projectSkillsDir: agent.projectSkillsDir,
    enabled: agent.enabled,
    custom: true,
    detected: fs.existsSync(rootDir),
  };
}

export function expandPath(value: string): string {
  const expanded = value
    .replace(/^~(?=$|[/\\])/, os.homedir())
    .replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name: string) => process.env[name] ?? '')
    .replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, name: string) => process.env[name] ?? '');
  return path.resolve(expanded);
}

export function compactPath(value: string): string {
  const home = os.homedir();
  return value === home || value.startsWith(`${home}${path.sep}`)
    ? `~${value.slice(home.length)}`
    : value;
}

export function centralSkillsDir(scope: 'global' | 'project'): string | undefined {
  if (scope === 'global') {
    return path.join(os.homedir(), '.agents', 'skills');
  }
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  return root ? path.join(root, '.agents', 'skills') : undefined;
}

export function agentSkillsDir(
  agent: ResolvedAgent,
  scope: 'global' | 'project',
): string | undefined {
  if (scope === 'global') { return agent.globalSkillsDir; }
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) { return undefined; }
  const resolved = path.resolve(root, agent.projectSkillsDir);
  const relative = path.relative(root, resolved);
  return relative.startsWith('..') || path.isAbsolute(relative) ? undefined : resolved;
}

function envPath(name?: string, suffix?: string): string | undefined {
  if (!name) { return undefined; }
  const value = process.env[name]?.trim();
  if (!value) { return undefined; }
  return suffix ? path.join(value, suffix) : value;
}

function resolveFromRoot(root: string, value: string): string {
  const expanded = value.replace(/^~(?=$|[/\\])/, os.homedir());
  return path.isAbsolute(expanded) ? expanded : path.join(root, expanded);
}
