import * as vscode from 'vscode';

const SECTION = 'skills-deck';

export function getConfig<T>(key: string, fallback: T): T {
  return vscode.workspace.getConfiguration(SECTION).get<T>(key, fallback);
}

export function affectsConfig(
  event: vscode.ConfigurationChangeEvent,
  key: string,
): boolean {
  return event.affectsConfiguration(`${SECTION}.${key}`);
}
