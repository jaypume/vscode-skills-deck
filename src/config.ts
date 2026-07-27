import * as vscode from 'vscode';

const SECTION = 'skills-deck';
const LEGACY_SECTION = 'skills-manager';

export function getConfig<T>(key: string, fallback: T): T {
  const current = vscode.workspace.getConfiguration(SECTION);
  const values = current.inspect<T>(key);
  const hasCurrentValue = values?.workspaceFolderValue !== undefined
    || values?.workspaceValue !== undefined
    || values?.globalValue !== undefined;
  if (hasCurrentValue) { return current.get<T>(key, fallback); }
  return vscode.workspace.getConfiguration(LEGACY_SECTION)
    .get<T>(key, current.get<T>(key, fallback));
}

export function affectsConfig(
  event: vscode.ConfigurationChangeEvent,
  key: string,
): boolean {
  return event.affectsConfiguration(`${SECTION}.${key}`)
    || event.affectsConfiguration(`${LEGACY_SECTION}.${key}`);
}
