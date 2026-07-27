/**
 * Installer — installs/uninstalls skills to reconcile declaration with reality.
 *
 * Source-dispatched:
 *  - `local`  : plugin-managed symlinks (one per active agent skill dir),
 *               bypassing npx. Matches the chezmoi agent-skills.yaml plan.
 *  - github / marketplace / skillhub : `npx skills add <arg> [--skill id] -g -y`.
 *
 * Completion is detected via terminal shell-integration with a watcher/timeout
 * fallback (simplified from skills-sh-plus installer.ts:141-201). The watcher
 * in extension.ts fires `notifyOperationCompleted` on filesystem changes.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';
import { DeclaredSkill, SkillScope } from './types';
import { classifySource, localPath, npxAddArg } from './source';
import { KNOWN_AGENTS } from './known-agents';

// Event bus: fires when an install/uninstall operation (likely) completed.
const _onOperationCompleted = new vscode.EventEmitter<void>();
export const onOperationCompleted = _onOperationCompleted.event;

export function notifyOperationCompleted(): void {
  _onOperationCompleted.fire();
}

let sharedTerminal: vscode.Terminal | undefined;

function getTerminal(): vscode.Terminal {
  if (sharedTerminal && !sharedTerminal.exitStatus) { return sharedTerminal; }
  sharedTerminal = vscode.window.createTerminal({ name: 'Skills Manager' });
  return sharedTerminal;
}

function getActiveAgents() {
  const ids = vscode.workspace.getConfiguration('skills-manager').get<string[]>('activeAgents');
  if (!ids || ids.length === 0) { return KNOWN_AGENTS; }
  const set = new Set(ids);
  return KNOWN_AGENTS.filter(a => set.has(a.id));
}

function resolveAgentDir(agentSkillsDir: string, scope: SkillScope): string {
  if (scope === 'project') {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) { throw new Error('No workspace open for project-scope install'); }
    return path.join(root, agentSkillsDir);
  }
  return path.join(os.homedir(), agentSkillsDir);
}

/** Install a declared skill (source-dispatched). */
export async function installSkill(d: DeclaredSkill): Promise<void> {
  const type = classifySource(d.source);
  if (type === 'local') {
    await installLocalSymlink(d);
  } else {
    await installViaNpx(d);
  }
}

/** Uninstall a skill (source-dispatched). */
export async function uninstallSkill(d: DeclaredSkill): Promise<void> {
  const type = classifySource(d.source);
  if (type === 'local') {
    await uninstallLocalSymlink(d);
  } else {
    await uninstallViaNpx(d);
  }
}

// ── local: plugin-managed symlinks ──────────────────────────────────────────

async function installLocalSymlink(d: DeclaredSkill): Promise<void> {
  const target = localPath(d.source);
  if (!fs.existsSync(target)) {
    throw new Error(`Local source path does not exist: ${target}`);
  }
  for (const agent of getActiveAgents()) {
    const dir = resolveAgentDir(agent.skillsDir, d.scope);
    const link = path.join(dir, d.id);
    await fs.promises.mkdir(dir, { recursive: true });

    // Already a correct symlink → skip.
    if (isCorrectSymlink(link, target)) { continue; }

    // Existing non-matching entry → back up, then recreate.
    // existsSync follows symlinks; use lstatSync to also catch broken links.
    let entryExists = false;
    try { fs.lstatSync(link); entryExists = true; } catch { entryExists = false; }
    if (entryExists) {
      await fs.promises.rename(link, `${link}.bak`);
    }
    await fs.promises.symlink(target, link, 'dir');
  }
  notifyOperationCompleted();
}

async function uninstallLocalSymlink(d: DeclaredSkill): Promise<void> {
  for (const agent of getActiveAgents()) {
    const dir = resolveAgentDir(agent.skillsDir, d.scope);
    const link = path.join(dir, d.id);
    try {
      if (fs.lstatSync(link).isSymbolicLink()) {
        await fs.promises.unlink(link);
      }
    } catch { /* not present — fine */ }
  }
  notifyOperationCompleted();
}

function isCorrectSymlink(link: string, target: string): boolean {
  try {
    if (!fs.lstatSync(link).isSymbolicLink()) { return false; }
    const real = fs.realpathSync(link);
    return real === fs.realpathSync(target);
  } catch { return false; }
}

// ── npx: github / marketplace / skillhub ────────────────────────────────────

async function installViaNpx(d: DeclaredSkill): Promise<void> {
  const arg = npxAddArg(d.source);
  const isGlobal = d.scope === 'global';

  let cmd = `npx skills add ${arg}`;
  // Multi-skill repo: pass --skill <id> when id differs from the bare repo name.
  if (d.id && looksLikeSubskill(arg, d.id)) {
    cmd += ` --skill ${d.id}`;
  }
  cmd += isGlobal ? ' -g' : '';
  cmd += ' -y';

  const terminal = getTerminal();
  terminal.show();
  terminal.sendText(cmd);
  waitForCompletion(`Installing "${d.id}"`);
}

async function uninstallViaNpx(d: DeclaredSkill): Promise<void> {
  if (d.scope === 'project') {
    // Project-scoped skills aren't managed by the CLI — delete directly.
    await uninstallLocalSymlink(d);
    return;
  }
  const cmd = `npx skills remove ${d.id} -g -y`;
  const terminal = getTerminal();
  terminal.show();
  terminal.sendText(cmd);
  waitForCompletion(`Uninstalling "${d.id}"`);
}

/** Heuristic: does `id` look like a sub-skill within the given source arg? */
function looksLikeSubskill(arg: string, id: string): boolean {
  // owner/repo or a URL — id is a folder name that may or may not equal repo.
  const repoName = arg.replace(/\.git$/, '').replace(/.*\//, '').replace(/\/tree\/.*/, '');
  // Always pass --skill for multi-skill repos is safest when id != repo basename.
  return id !== repoName || arg.includes('/tree/');
}

/**
 * Best-effort completion wait: shell-integration when available, watcher via
 * onOperationCompleted otherwise, with a 30s timeout fallback.
 */
function waitForCompletion(label: string): void {
  vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `${label}...`, cancellable: false },
    () => {
      const minDelay = new Promise<void>(r => setTimeout(r, 2000));
      const detection = new Promise<void>(resolve => {
        const disposables: vscode.Disposable[] = [];
        let done = false;
        const finish = () => {
          if (done) { return; }
          done = true;
          disposables.forEach(x => x.dispose());
          clearTimeout(timer);
          resolve();
        };
        disposables.push(onOperationCompleted(finish));
        const timer = setTimeout(finish, 30_000);
      });
      return Promise.all([minDelay, detection]).then(() => undefined);
    },
  );
}

export function disposeTerminal(): void {
  sharedTerminal?.dispose();
  sharedTerminal = undefined;
}
