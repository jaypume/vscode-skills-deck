/**
 * Extension entry point.
 *
 * Wires store → scanner → provider → commands, plus:
 *  - FileSystemWatcher + focus rescan to keep installed state fresh.
 *  - onOperationCompleted (from installer) triggers rescan.
 *  - Tree selection drives the Details webview.
 */

import * as vscode from 'vscode';
import * as store from './store';
import { SkillScanner } from './scanner';
import { SkillsTreeProvider, SkillNode } from './provider';
import { DetailsViewProvider } from './detailsView';
import { registerCommands } from './commands';
import { onOperationCompleted, notifyOperationCompleted, disposeTerminal } from './installer';
import { reconcile } from './reconcile';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  store.init(context);

  const scanner = new SkillScanner();
  const provider = new SkillsTreeProvider();
  const details = new DetailsViewProvider();

  const treeView = vscode.window.createTreeView('skillsManager.view', {
    treeDataProvider: provider,
    showCollapseAll: true,
  });
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(DetailsViewProvider.viewType, details),
  );

  // Rescan reads disk + pushes the result into the provider.
  const rescan = async () => {
    const scan = await scanner.scan();
    provider.setScan(scan);
    updateEmptyContext(scan);
    const sel = treeView.selection[0]?.skill;
    if (sel) {
      // Re-derive the selected skill's decorated state for the details pane.
      const decorated = reconcile(store.get('skills'), scan)
        .find(s => s.scope === sel.scope && s.id === sel.id);
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

  // Initial groupBy context + first scan.
  vscode.commands.executeCommand('setContext', 'skillsManager.groupBy', store.get('groupBy'));

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
  const autoRefresh = vscode.workspace.getConfiguration('skills-manager')
    .get<boolean>('autoRefreshOnFocus', true);
  if (autoRefresh) {
    context.subscriptions.push(vscode.window.onDidChangeWindowState(e => {
      if (e.focused) { void rescan(); }
    }));
  }

  // Re-scan when activeAgents config changes.
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
    if (e.affectsConfiguration('skills-manager.activeAgents')) { void rescan(); }
  }));

  context.subscriptions.push({ dispose: disposeTerminal });
  await rescan();
}

function updateEmptyContext(scan: { globalSkills: unknown[]; projectSkills: unknown[] }): void {
  const total = scan.globalSkills.length + scan.projectSkills.length;
  const declared = store.get('skills').length;
  vscode.commands.executeCommand('setContext', 'skillsManager.noSkills', total === 0 && declared === 0);
}

export function deactivate(): void { /* nothing persistent */ }
