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
import { SkillScanner } from './scanner';
import { SkillsTreeProvider, SkillNode } from './provider';
import { DetailsTreeProvider } from './detailsView';
import { registerCommands } from './commands';
import { onOperationCompleted, notifyOperationCompleted, disposeInstaller } from './installer';
import { reconcile } from './reconcile';
import { repositoryId, repositoryName } from './source';
import { affectsConfig, getConfig } from './config';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  store.init(context);

  const scanner = new SkillScanner();
  const provider = new SkillsTreeProvider();
  const details = new DetailsTreeProvider();

  const treeView = vscode.window.createTreeView('skillsDeck.view', {
    treeDataProvider: provider,
    showCollapseAll: true,
    canSelectMany: true,
  });
  const detailsView = vscode.window.createTreeView('skillsDeck.details', {
    treeDataProvider: details,
  });
  context.subscriptions.push(treeView, detailsView);

  // Rescan reads disk + pushes the result into the provider.
  const rescan = async () => {
    const scan = await scanner.scan();
    reconcileStoredRepositories(scan);
    provider.setScan(scan);
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
  };

  // Tree selection → details.
  context.subscriptions.push(treeView.onDidChangeSelection(e => {
    const skill = e.selection[0]?.skill;
    details.show(skill);
  }));

  // Commands.
  context.subscriptions.push(...registerCommands({ scanner, provider, rescan }));
  context.subscriptions.push(vscode.commands.registerCommand(
    'skillsDeck.copyDetailValue',
    async (value: string) => {
      await vscode.env.clipboard.writeText(value);
      vscode.window.setStatusBarMessage('Detail value copied', 1500);
    },
  ));

  // Initial groupBy context + first scan.
  vscode.commands.executeCommand('setContext', 'skillsDeck.groupBy', store.get('groupBy'));
  vscode.commands.executeCommand(
    'setContext',
    'skillsDeck.groupRepositories',
    store.get('groupRepositories'),
  );

  // Watcher: any change under global/project skill dirs → rescan + notify.
  const watchGlobs = [...scanner.getAllGlobalDirs(), ...scanner.getAllProjectDirs()];
  for (const dir of watchGlobs) {
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(
      vscode.Uri.file(dir), '**/*'));
    context.subscriptions.push(watcher);
    context.subscriptions.push(
      watcher.onDidChange(() => { notifyOperationCompleted(); }),
      watcher.onDidCreate(() => { notifyOperationCompleted(); }),
      watcher.onDidDelete(() => { notifyOperationCompleted(); }),
    );
  }

  // Installer completion → rescan.
  context.subscriptions.push(onOperationCompleted(() => { void rescan(); }));

  // Focus rescan.
  const autoRefresh = getConfig<boolean>('autoRefreshOnFocus', true);
  if (autoRefresh) {
    context.subscriptions.push(vscode.window.onDidChangeWindowState(e => {
      if (e.focused) { void rescan(); }
    }));
  }

  // Re-scan when activeAgents config changes.
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
    if (affectsConfig(e, 'activeAgents')) { void rescan(); }
  }));

  context.subscriptions.push({ dispose: disposeInstaller });
  await rescan();
}

function reconcileStoredRepositories(
  scan: { globalSkills: Array<{ folderName: string; source?: string }>; projectSkills: Array<{ folderName: string; source?: string }> },
): void {
  const state = store.read();
  const installedByRepository = new Map<string, Set<string>>();
  let changed = false;
  for (const [scope, skills] of [
    ['global', scan.globalSkills],
    ['project', scan.projectSkills],
  ] as const) {
    for (const skill of skills) {
      const source = skill.source ?? '';
      const repoId = repositoryId(source, `${scope}:${skill.folderName}`);
      const key = `${scope}:${repoId}`;
      const ids = installedByRepository.get(key) ?? new Set<string>();
      ids.add(skill.folderName);
      installedByRepository.set(key, ids);

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
  const filtered = state.skills.filter(skill => {
    if (!skill.legacyRepositoryPlaceholder) { return true; }
    const installed = installedByRepository.get(`${skill.scope}:${skill.repoId}`);
    return !installed || installed.size <= 1 || installed.has(skill.id);
  });
  if (filtered.length !== state.skills.length) {
    state.skills = filtered;
    changed = true;
  }
  if (changed) { store.write(state); }
}

function updateEmptyContext(scan: { globalSkills: unknown[]; projectSkills: unknown[] }): void {
  const total = scan.globalSkills.length + scan.projectSkills.length;
  const declared = store.get('skills').length;
  vscode.commands.executeCommand('setContext', 'skillsDeck.noSkills', total === 0 && declared === 0);
}

export function deactivate(): void { /* nothing persistent */ }
