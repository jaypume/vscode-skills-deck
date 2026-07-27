import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import * as agentStore from './agentStore';
import {
  disableAgentLinks,
  previewAgentSync,
  previewDisableAgent,
  replaceOverride,
  syncAgent,
  SyncSummary,
} from './agentSync';
import { AgentNode, AgentsTreeProvider } from './agentsView';
import { AgentPreference, CustomAgent, ResolvedAgent } from './types';
import { centralSkillsDir } from './known-agents';

interface AgentCommandDeps {
  provider: AgentsTreeProvider;
  rescan: () => Promise<void>;
  rebuildWatchers: () => void;
}

export function registerAgentCommands(deps: AgentCommandDeps): vscode.Disposable[] {
  const subscriptions: vscode.Disposable[] = [];
  const output = vscode.window.createOutputChannel('Skills Deck Agents');
  subscriptions.push(output);

  const register = (
    command: string,
    callback: (...args: never[]) => unknown,
  ) => subscriptions.push(vscode.commands.registerCommand(command, callback));

  const changed = async () => {
    deps.rebuildWatchers();
    deps.provider.refresh();
    await deps.rescan();
  };

  register('skillsDeck.setupAgents', async () => {
    const agents = agentStore.resolved();
    const legacy = explicitLegacyAgentIds();
    const picked = await vscode.window.showQuickPick(
      agents.map(agent => ({
        label: agent.displayName,
        description: agent.detected ? 'detected' : 'not detected',
        detail: agent.rootDir,
        agent,
        picked: agent.detected || legacy.has(agent.id),
      })),
      {
        canPickMany: true,
        title: 'Enable Agents',
        placeHolder: 'Select agents to sync from the global library',
        matchOnDescription: true,
        matchOnDetail: true,
      },
    );
    if (!picked) { return; }
    const selected = new Set(picked.map(item => item.agent.id));
    const firstSetup = !agentStore.read().setupCompleted;
    const disabling = agents.filter(agent =>
      !selected.has(agent.id) && (firstSetup || agent.enabled));
    const preview = await previewMany(picked.map(item => item.agent));
    for (const agent of disabling) {
      mergeSummary(preview, await previewDisableAgent(agent));
    }
    const confirmed = await confirmSync(
      `Enable ${selected.size} agents? ${summaryText(preview)}`,
      'Enable',
    );
    if (!confirmed) { return; }

    await withAgentProgress('Syncing enabled agents', async () => {
      const summary = emptySummary();
      for (const agent of disabling) {
        const result = await disableAgentLinks(agent);
        mergeSummary(summary, result);
        if (result.failures.length > 0) { selected.add(agent.id); }
      }
      for (const agent of agents) {
        if (selected.has(agent.id)) {
          mergeSummary(summary, await syncAgent({ ...agent, enabled: true }, 'global'));
        }
      }
      reportSummary(summary, output);
    });
    const state = agentStore.read();
    state.setupCompleted = true;
    state.preferences = state.preferences.map(item => ({
      ...item,
      enabled: selected.has(item.id),
    }));
    for (const agent of agents.filter(item => !item.custom)) {
      const current = state.preferences.find(item => item.id === agent.id);
      if (current) {
        current.enabled = selected.has(agent.id);
      } else {
        state.preferences.push({ id: agent.id, enabled: selected.has(agent.id) });
      }
    }
    for (const custom of state.customAgents) {
      custom.enabled = selected.has(custom.id);
    }
    agentStore.write(state);
    await changed();
  });

  register('skillsDeck.enableAgent', async (node: AgentNode) => {
    const agent = node?.agent;
    if (!agent || agent.enabled) { return; }
    const preview = await previewAgentSync(agent, 'global');
    if (!await confirmSync(
      `Enable ${agent.displayName}? ${summaryText(preview)}`,
      'Enable',
    )) { return; }
    agentStore.setEnabled(agent.id, true);
    const summary = await withAgentProgress(
      `Syncing ${agent.displayName}`,
      () => syncAgent({ ...agent, enabled: true }, 'global'),
    );
    reportSummary(summary, output);
    await changed();
  });

  register('skillsDeck.disableAgent', async (node: AgentNode) => {
    const agent = node?.agent;
    if (!agent || !agent.enabled) { return; }
    const preview = await previewDisableAgent(agent);
    if (!await confirmSync(
      `Disable ${agent.displayName}? ${preview.removed} managed links will be removed.`,
      'Disable',
    )) { return; }
    const summary = await withAgentProgress(
      `Disabling ${agent.displayName}`,
      () => disableAgentLinks(agent),
    );
    reportSummary(summary, output);
    if (summary.failures.length === 0) {
      agentStore.setEnabled(agent.id, false);
    }
    await changed();
  });

  register('skillsDeck.syncAgent', async (node: AgentNode) => {
    const agent = node?.agent;
    if (!agent?.enabled) { return; }
    const summary = await withAgentProgress(
      `Syncing ${agent.displayName}`,
      () => syncAgent(agent, 'global'),
    );
    reportSummary(summary, output);
    await changed();
  });

  register('skillsDeck.openAgentSkillsDirectory', async (node: AgentNode) => {
    const target = node?.agent?.globalSkillsDir
      ?? (node?.kind === 'library' ? centralSkillsDir('global') : undefined);
    if (!target) { return; }
    try {
      const stat = await fs.promises.stat(target);
      const directory = stat.isDirectory() ? target : path.dirname(target);
      const opened = await vscode.env.openExternal(vscode.Uri.file(directory));
      if (!opened) {
        vscode.window.showWarningMessage(`Could not open directory: ${directory}`);
      }
    } catch {
      vscode.window.showWarningMessage(`Directory does not exist: ${target}`);
    }
  });

  register('skillsDeck.addAgent', async () => {
    const agent = await collectCustomAgent();
    if (!agent) { return; }
    agentStore.upsertCustom(agent);
    await changed();
  });

  register('skillsDeck.editAgent', async (node: AgentNode) => {
    const agent = node?.agent;
    if (!agent) { return; }
    if (agent.enabled) {
      vscode.window.showWarningMessage('Disable the agent before editing its paths.');
      return;
    }
    if (agent.custom) {
      const current = agentStore.read().customAgents.find(item => item.id === agent.id);
      const updated = current ? await collectCustomAgent(current) : undefined;
      if (updated) {
        agentStore.upsertCustom(updated);
        await changed();
      }
      return;
    }
    const preference = await collectBuiltInOverride(agent);
    if (preference) {
      agentStore.updatePreference(preference);
      await changed();
    }
  });

  register('skillsDeck.deleteAgent', async (node: AgentNode) => {
    const agent = node?.agent;
    if (!agent?.custom) { return; }
    if (agent.enabled) {
      vscode.window.showWarningMessage('Disable the custom agent before deleting it.');
      return;
    }
    const confirmed = await vscode.window.showWarningMessage(
      `Delete custom agent "${agent.displayName}"? Agent-owned skills will not be removed.`,
      { modal: true },
      'Delete',
    );
    if (confirmed !== 'Delete') { return; }
    const cleanup = await disableAgentLinks(agent);
    if (cleanup.failures.length > 0) {
      reportSummary(cleanup, output);
      return;
    }
    agentStore.removeCustom(agent.id);
    await changed();
  });

  register('skillsDeck.replaceAgentOverride', async (node: AgentNode) => {
    const agent = node?.agent;
    const observation = node?.observation;
    if (!agent || observation?.state !== 'override') { return; }
    const confirmed = await vscode.window.showWarningMessage(
      `Replace "${observation.skillId}" in ${agent.displayName} with a managed link? `
        + 'The current entry will be backed up.',
      { modal: true },
      'Replace',
    );
    if (confirmed !== 'Replace') { return; }
    try {
      const backup = await replaceOverride(observation, agent);
      vscode.window.showInformationMessage(`Override backed up to ${backup}.`);
      await changed();
    } catch (error) {
      vscode.window.showErrorMessage(`Replace failed: ${message(error)}`);
    }
  });

  return subscriptions;
}

async function collectCustomAgent(current?: CustomAgent): Promise<CustomAgent | undefined> {
  const displayName = await vscode.window.showInputBox({
    title: current ? 'Edit Custom Agent' : 'Add Custom Agent',
    prompt: 'Display name',
    value: current?.displayName,
    validateInput: value => value.trim() ? undefined : 'Display name is required.',
  });
  if (!displayName) { return undefined; }
  const suggestedId = slug(displayName);
  const id = await vscode.window.showInputBox({
    title: current ? 'Edit Custom Agent' : 'Add Custom Agent',
    prompt: 'Agent ID (lowercase kebab-case)',
    value: current?.id ?? suggestedId,
    validateInput: value => validateAgentId(value, current?.id),
  });
  if (!id) { return undefined; }
  const rootDir = await vscode.window.showInputBox({
    title: current ? 'Edit Custom Agent' : 'Add Custom Agent',
    prompt: 'Parent directory',
    value: current?.rootDir ?? `~/.${id}`,
    validateInput: value => value.trim() ? undefined : 'Parent directory is required.',
  });
  if (!rootDir) { return undefined; }
  const globalSkillsDir = await vscode.window.showInputBox({
    title: current ? 'Edit Custom Agent' : 'Add Custom Agent',
    prompt: 'Global skills directory (absolute or relative to parent)',
    value: current?.globalSkillsDir ?? 'skills',
    validateInput: value => value.trim() ? undefined : 'Global skills directory is required.',
  });
  if (!globalSkillsDir) { return undefined; }
  return {
    id,
    displayName: displayName.trim(),
    rootDir: rootDir.trim(),
    globalSkillsDir: globalSkillsDir.trim(),
    projectSkillsDir: current?.projectSkillsDir ?? '.agents/skills',
    enabled: current?.enabled ?? false,
  };
}

async function collectBuiltInOverride(
  agent: ResolvedAgent,
): Promise<AgentPreference | undefined> {
  const rootDir = await vscode.window.showInputBox({
    title: `Edit ${agent.displayName}`,
    prompt: 'Parent directory',
    value: agent.rootDir,
  });
  if (!rootDir) { return undefined; }
  const globalSkillsDir = await vscode.window.showInputBox({
    title: `Edit ${agent.displayName}`,
    prompt: 'Global skills directory',
    value: agent.globalSkillsDir,
  });
  if (!globalSkillsDir) { return undefined; }
  return {
    id: agent.id,
    enabled: false,
    rootDir: rootDir.trim(),
    globalSkillsDir: globalSkillsDir.trim(),
    projectSkillsDir: agent.projectSkillsDir,
  };
}

function validateAgentId(value: string, currentId?: string): string | undefined {
  if (currentId && value !== currentId) {
    return 'Agent ID is stable and cannot be changed.';
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
    return 'Use lowercase letters, numbers, and single hyphens.';
  }
  return agentStore.isKnownId(value, currentId) ? `"${value}" already exists.` : undefined;
}

function explicitLegacyAgentIds(): Set<string> {
  const config = vscode.workspace.getConfiguration('skills-deck');
  const inspected = config.inspect<string[]>('activeAgents');
  return new Set(
    inspected?.workspaceFolderValue
      ?? inspected?.workspaceValue
      ?? inspected?.globalValue
      ?? [],
  );
}

async function previewMany(agents: ResolvedAgent[]): Promise<SyncSummary> {
  const summary = emptySummary();
  for (const agent of agents) {
    mergeSummary(summary, await previewAgentSync(agent, 'global'));
  }
  return summary;
}

async function confirmSync(messageText: string, action: string): Promise<boolean> {
  const value = await vscode.window.showWarningMessage(
    messageText,
    { modal: true },
    action,
  );
  return value === action;
}

async function withAgentProgress<T>(title: string, task: () => Promise<T>): Promise<T> {
  return vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title, cancellable: false },
    task,
  );
}

function reportSummary(summary: SyncSummary, output: vscode.OutputChannel): void {
  if (summary.failures.length > 0) {
    output.appendLine(`[${new Date().toISOString()}] agent sync failed`);
    for (const failure of summary.failures) { output.appendLine(failure); }
    output.show(true);
    vscode.window.showErrorMessage(
      `Agent sync completed with ${summary.failures.length} failures.`,
    );
    return;
  }
  vscode.window.showInformationMessage(`Agent sync complete. ${summaryText(summary)}`);
}

function summaryText(summary: SyncSummary): string {
  return [
    `${summary.created} create`,
    `${summary.removed} remove`,
    `${summary.overrides} override`,
    `${summary.broken} repair`,
  ].join(', ');
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

function mergeSummary(target: SyncSummary, value: SyncSummary): void {
  target.created += value.created;
  target.removed += value.removed;
  target.linked += value.linked;
  target.overrides += value.overrides;
  target.broken += value.broken;
  target.skipped += value.skipped;
  target.failures.push(...value.failures);
}

function slug(value: string): string {
  return value.toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'custom-agent';
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
