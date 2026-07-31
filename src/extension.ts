/**
 * Extension entry point.
 *
 * Wires store → scanner → provider → commands, plus:
 *  - FileSystemWatcher + focus rescan to keep installed state fresh.
 *  - onOperationCompleted (from installer) triggers rescan.
 *  - Tree selection drives the native Details tree.
 */

import * as vscode from 'vscode';
import * as store from './store';
import * as agentStore from './agentStore';
import * as viewState from './viewState';
import * as avatarCache from './avatarCache';
import { SkillScanner } from './scanner';
import { SkillsTreeProvider, SkillNode } from './provider';
import { DetailsTreeProvider } from './detailsView';
import { registerCommands } from './commands';
import { AgentsTreeProvider } from './agentsView';
import { registerAgentCommands } from './agentCommands';
import { onOperationCompleted, notifyOperationCompleted, disposeInstaller } from './installer';
import { reconcile } from './reconcile';
import { repositoryId, repositoryName } from './source';
import { getConfig } from './config';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  store.init(context);
  agentStore.init(context);
  avatarCache.init(context);

  const scanner = new SkillScanner();
  const provider = new SkillsTreeProvider();
  const agentsProvider = new AgentsTreeProvider(context.extensionUri);
  const details = new DetailsTreeProvider();

  const treeView = vscode.window.createTreeView('skillsDeck.view', {
    treeDataProvider: provider,
    canSelectMany: true,
  });
  const detailsView = vscode.window.createTreeView('skillsDeck.details', {
    treeDataProvider: details,
  });
  const agentsView = vscode.window.createTreeView('skillsDeck.agents', {
    treeDataProvider: agentsProvider,
  });
  context.subscriptions.push(treeView, agentsView, detailsView);
  provider.bindTreeView(treeView);
  agentsProvider.bindTreeView(agentsView);
  context.subscriptions.push(
    ...registerTreeExpansion(
      treeView,
      provider,
      'skillsDeck.view',
      'skillsDeck.skillsTreeExpanded',
      'skillsDeck.expandSkillsTree',
      'skillsDeck.collapseSkillsTree',
    ),
    ...registerTreeExpansion(
      agentsView,
      agentsProvider,
      'skillsDeck.agents',
      'skillsDeck.agentsTreeExpanded',
      'skillsDeck.expandAgentsTree',
      'skillsDeck.collapseAgentsTree',
    ),
  );
  let detailSource: 'skill' | 'agent' = 'skill';

  // Rescan reads disk + pushes the result into the provider.
  const rescan = async () => {
    const scan = await scanner.scan();
    reconcileStoredRepositories(scan);
    provider.setScan(scan);
    agentsProvider.setScan(scan);
    updateEmptyContext(scan);
    const sel = treeView.selection[0]?.skill;
    if (sel) {
      // Re-derive the selected skill's decorated state for the details pane.
      const state = store.read();
      const decorated = reconcile(state.skills, state.repositories, scan)
        .find(s => s.scope === sel.scope
          && s.repoId === sel.repoId
          && s.skillId === sel.skillId);
      details.show(decorated);
    }
    if (detailSource === 'agent') {
      const agentSelection = agentsView.selection[0];
      if (agentSelection?.observation && agentSelection.agent) {
        const observation = scan.agentSkills.find(item =>
          item.agentId === agentSelection.observation!.agentId
          && item.scope === agentSelection.observation!.scope
          && item.skillId === agentSelection.observation!.skillId);
        const agent = scan.agents.find(item => item.id === agentSelection.agent!.id);
        details.showAgentSkill(observation, agent);
      } else if (agentSelection?.agent) {
        const current = scan.agents.find(agent => agent.id === agentSelection.agent!.id);
        details.showAgent(current);
      }
    }
  };

  // Tree selection → details.
  context.subscriptions.push(treeView.onDidChangeSelection(e => {
    detailSource = 'skill';
    const skill = e.selection[0]?.skill;
    details.show(skill);
  }));
  context.subscriptions.push(agentsView.onDidChangeSelection(e => {
    detailSource = 'agent';
    const node = e.selection[0];
    if (node?.observation && node.agent) {
      details.showAgentSkill(node.observation, node.agent);
    } else {
      details.showAgent(node?.agent);
    }
  }));

  // Keyboard ↑/↓ navigation: sync selection to the focused row so the
  // Details pane updates without requiring a click/Enter. Without this,
  // TreeView.selection only changes on click and Details drift.
  type NavDirection = 1 | -1;
  // Match the current row by stable TreeItem.id, not reference equality:
  // getChildren() rebuilds fresh node instances on every call, so `===` never
  // matches and navigation would snap back to the first row on every keystroke.
  const navSkill = (dir: NavDirection) => async () => {
    const flat = provider.getVisibleFlat();
    const currentId = treeView.selection[0]?.id;
    const idx = currentId !== undefined
      ? flat.findIndex(node => node.id === currentId) : -1;
    const target = idx >= 0 ? flat[idx + dir] : flat[dir === 1 ? 0 : flat.length - 1];
    if (!target) { return; }
    await treeView.reveal(target, { select: true, focus: true, expand: 0 });
  };
  const navAgent = (dir: NavDirection) => async () => {
    const flat = agentsProvider.getVisibleFlat();
    const currentId = agentsView.selection[0]?.id;
    const idx = currentId !== undefined
      ? flat.findIndex(node => node.id === currentId) : -1;
    const target = idx >= 0 ? flat[idx + dir] : flat[dir === 1 ? 0 : flat.length - 1];
    if (!target) { return; }
    await agentsView.reveal(target, { select: true, focus: true, expand: 0 });
  };
  context.subscriptions.push(
    vscode.commands.registerCommand('skillsDeck.focusNextSkill', navSkill(1)),
    vscode.commands.registerCommand('skillsDeck.focusPrevSkill', navSkill(-1)),
    vscode.commands.registerCommand('skillsDeck.focusNextAgent', navAgent(1)),
    vscode.commands.registerCommand('skillsDeck.focusPrevAgent', navAgent(-1)),
  );

  let watchers: vscode.Disposable[] = [];
  const rebuildWatchers = () => {
    for (const watcher of watchers) { watcher.dispose(); }
    watchers = [];
    const paths = scanner.getAllGlobalDirs();
    for (const dir of paths) {
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(vscode.Uri.file(dir), '**/*'),
      );
      watchers.push(watcher);
      watchers.push(
        watcher.onDidChange(() => { notifyOperationCompleted(); }),
        watcher.onDidCreate(() => { notifyOperationCompleted(); }),
        watcher.onDidDelete(() => { notifyOperationCompleted(); }),
      );
    }
  };
  context.subscriptions.push({ dispose: () => {
    for (const watcher of watchers) { watcher.dispose(); }
    watchers = [];
  } });

  // Commands.
  context.subscriptions.push(...registerCommands({ scanner, provider, rescan }));
  context.subscriptions.push(...registerAgentCommands({
    provider: agentsProvider,
    rescan,
    rebuildWatchers,
  }));
  context.subscriptions.push(vscode.commands.registerCommand(
    'skillsDeck.copyDetailValue',
    async (value: string) => {
      await vscode.env.clipboard.writeText(value);
      vscode.window.setStatusBarMessage('Detail value copied', 1500);
    },
  ));

  // Initial groupBy context + first scan.
  vscode.commands.executeCommand('setContext', 'skillsDeck.groupBy', viewState.get('groupBy'));
  vscode.commands.executeCommand(
    'setContext',
    'skillsDeck.groupRepositories',
    viewState.get('groupRepositories'),
  );

  rebuildWatchers();

  // Installer completion → rescan.
  context.subscriptions.push(onOperationCompleted(() => { void rescan(); }));

  // Focus rescan.
  const autoRefresh = getConfig<boolean>('autoRefreshOnFocus', true);
  if (autoRefresh) {
    context.subscriptions.push(vscode.window.onDidChangeWindowState(e => {
      if (e.focused) { void rescan(); }
    }));
  }

  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => {
    rebuildWatchers();
    void rescan();
  }));
  let setupPromptShown = false;
  const promptAgentSetup = () => {
    if (setupPromptShown || agentStore.read().setupCompleted) { return; }
    setupPromptShown = true;
    void vscode.commands.executeCommand('skillsDeck.setupAgents');
  };
  context.subscriptions.push(agentsView.onDidChangeVisibility(e => {
    if (e.visible) { promptAgentSetup(); }
  }));
  if (agentsView.visible) { promptAgentSetup(); }

  context.subscriptions.push({ dispose: disposeInstaller });
  await rescan();
}

function reconcileStoredRepositories(
  scan: { globalSkills: Array<{ folderName: string; source?: string }>; projectSkills: Array<{ folderName: string; source?: string }> },
): void {
  const state = store.read();
  let changed = false;
  for (const [scope, skills] of [
    ['global', scan.globalSkills],
    ['project', scan.projectSkills],
  ] as const) {
    for (const skill of skills) {
      const source = skill.source ?? '';
      const repoId = repositoryId(source, `${scope}:${skill.folderName}`);

      if (!source) { continue; }
      let repository = state.repositories.find(repo => repo.repoId === repoId);
      if (!repository) {
        repository = {
          repoId,
          name: repositoryName(repoId, skill.folderName),
          source,
          category: 'Default',
          wanted: true,
          dateAdded: new Date().toISOString(),
          availableSkills: [],
        };
        state.repositories.push(repository);
        changed = true;
      }
      const available = repository.availableSkills ?? [];
      if (!available.some(item => item.skillId === skill.folderName)) {
        available.push({ skillId: skill.folderName, name: skill.folderName });
        repository.availableSkills = available;
        changed = true;
      }

      const declaration = state.skills.find(item =>
        item.scope === scope && item.id === skill.folderName);
      if (!declaration) { continue; }
      const previousRepository = state.repositories.find(repo => repo.repoId === declaration.repoId);
      const effectiveSource = declaration.source ?? previousRepository?.source ?? '';
      if (effectiveSource || declaration.repoId === repoId) { continue; }
      const category = declaration.category ?? previousRepository?.category ?? 'Default';
      const wanted = declaration.wanted ?? previousRepository?.wanted ?? true;
      declaration.repoId = repoId;
      declaration.source = undefined;
      declaration.category = category === (repository.category ?? 'Default') ? undefined : category;
      declaration.wanted = wanted === (repository.wanted ?? true) ? undefined : wanted;
      changed = true;
    }
  }
  if (changed) { store.write(state); }
}

function updateEmptyContext(scan: { globalSkills: unknown[]; projectSkills: unknown[] }): void {
  const total = scan.globalSkills.length + scan.projectSkills.length;
  const declared = store.get('skills')
    .filter(skill => skill.scope === 'global')
    .length;
  vscode.commands.executeCommand('setContext', 'skillsDeck.noSkills', total === 0 && declared === 0);
}

export function deactivate(): void { /* nothing persistent */ }

function registerTreeExpansion<T>(
  view: vscode.TreeView<T>,
  provider: vscode.TreeDataProvider<T>,
  viewId: string,
  contextKey: string,
  expandCommand: string,
  collapseCommand: string,
): vscode.Disposable[] {
  const setExpanded = (expanded: boolean) =>
    vscode.commands.executeCommand('setContext', contextKey, expanded);
  void setExpanded(true);
  return [
    vscode.commands.registerCommand(expandCommand, async () => {
      const roots = await provider.getChildren();
      for (const root of roots ?? []) {
        const item = await provider.getTreeItem(root);
        if (item.collapsibleState !== vscode.TreeItemCollapsibleState.None) {
          await view.reveal(root, { expand: 3, focus: false, select: false });
        }
      }
      await setExpanded(true);
    }),
    vscode.commands.registerCommand(collapseCommand, async () => {
      await vscode.commands.executeCommand(
        `workbench.actions.treeView.${viewId}.collapseAll`,
      );
      await setExpanded(false);
    }),
    view.onDidExpandElement(() => { void setExpanded(true); }),
  ];
}
