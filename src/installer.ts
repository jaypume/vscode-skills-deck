/**
 * Background installer for reconciling declared and installed skills.
 *
 * Local sources are managed as symlinks. Remote sources run through the skills
 * CLI using execFile, so no shell or VS Code terminal is created.
 */

import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import * as vscode from 'vscode';
import { ResolvedSkill, SkillScope } from './types';
import { classifySource, localPath, npxAddArg } from './source';
import { KNOWN_AGENTS, KnownAgent } from './known-agents';

const execFileAsync = promisify(execFile);

const onOperationCompletedEmitter = new vscode.EventEmitter<void>();
export const onOperationCompleted = onOperationCompletedEmitter.event;

let outputChannel: vscode.OutputChannel | undefined;

export function notifyOperationCompleted(): void {
  onOperationCompletedEmitter.fire();
}

export async function installSkill(skill: ResolvedSkill): Promise<void> {
  await installSkills([skill]);
}

export async function installSkills(skills: ResolvedSkill[]): Promise<void> {
  await runBatch('install', skills);
}

export async function uninstallSkill(skill: ResolvedSkill): Promise<void> {
  await uninstallSkills([skill]);
}

export async function uninstallSkills(skills: ResolvedSkill[]): Promise<void> {
  await runBatch('uninstall', skills);
}

export async function updateSkills(skills: ResolvedSkill[]): Promise<void> {
  await runBatch('update', skills);
}

type Operation = 'install' | 'uninstall' | 'update';

interface OperationFailure {
  skill: string;
  detail: string;
}

async function runBatch(operation: Operation, input: ResolvedSkill[]): Promise<void> {
  const skills = uniqueSkills(input);
  if (skills.length === 0) { return; }

  const present = operation === 'install'
    ? 'Installing'
    : operation === 'uninstall' ? 'Uninstalling' : 'Updating';
  const past = operation === 'install'
    ? 'Installed'
    : operation === 'uninstall' ? 'Uninstalled' : 'Updated';
  const failures: OperationFailure[] = [];
  let completed = 0;

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Window,
      title: `${present} skills`,
      cancellable: false,
    },
    async progress => {
      const batches = operationBatches(operation, skills);
      for (const batch of batches) {
        progress.report({
          message: batch.length === 1 ? batch[0].id : `${batch[0].repository.name} (${batch.length})`,
        });
        try {
          if (operation === 'install') {
            await performInstallBatch(batch);
          } else if (operation === 'uninstall') {
            await performUninstallBatch(batch);
          } else {
            await performUpdateBatch(batch);
          }
          completed += batch.length;
        } catch (error) {
          const detail = errorDetail(error);
          failures.push(...batch.map(skill => ({ skill: skill.id, detail })));
        }
      }
    },
  );

  notifyOperationCompleted();
  if (failures.length === 0) {
    const target = skills.length === 1 ? `"${skills[0].id}"` : `${completed} skills`;
    vscode.window.showInformationMessage(`${past} ${target}.`);
    return;
  }

  writeFailures(operation, failures);
  const choice = await vscode.window.showErrorMessage(
    `${past} ${completed}; failed ${failures.length}.`,
    'Show Output',
  );
  if (choice === 'Show Output') {
    getOutputChannel().show(true);
  }
}

function operationBatches(
  operation: Operation,
  skills: ResolvedSkill[],
): ResolvedSkill[][] {
  const batches = new Map<string, ResolvedSkill[]>();
  for (const skill of skills) {
    const local = classifySource(skill.source) === 'local';
    const key = local
      ? `local:${skill.scope}:${skill.repoId}:${skill.skillId}`
      : operation === 'install'
        ? `remote:${skill.scope}:${skill.source}`
        : `${operation}:${skill.scope}`;
    const batch = batches.get(key) ?? [];
    batch.push(skill);
    batches.set(key, batch);
  }
  return Array.from(batches.values());
}

async function performInstallBatch(skills: ResolvedSkill[]): Promise<void> {
  if (classifySource(skills[0].source) === 'local') {
    await installLocalSymlink(skills[0]);
    return;
  }
  await installViaNpx(skills);
}

async function performUninstallBatch(skills: ResolvedSkill[]): Promise<void> {
  if (classifySource(skills[0].source) === 'local') {
    await uninstallLocalSymlink(skills[0]);
    return;
  }
  await uninstallViaNpx(skills);
}

async function performUpdateBatch(skills: ResolvedSkill[]): Promise<void> {
  if (classifySource(skills[0].source) === 'local') { return; }
  const args = ['update', ...skills.map(skill => skill.id)];
  args.push(skills[0].scope === 'global' ? '-g' : '-p', '-y');
  await runSkillsCli(args, skills[0].scope);
}

function uniqueSkills(skills: ResolvedSkill[]): ResolvedSkill[] {
  const seen = new Set<string>();
  return skills.filter(skill => {
    const key = `${skill.scope}:${skill.id}`;
    if (seen.has(key)) { return false; }
    seen.add(key);
    return true;
  });
}

function getActiveAgents() {
  const ids = vscode.workspace.getConfiguration('skills-manager').get<string[]>('activeAgents');
  if (!ids || ids.length === 0) { return KNOWN_AGENTS; }
  const set = new Set(ids);
  return KNOWN_AGENTS.filter(agent => set.has(agent.id));
}

function resolveAgentDir(agent: KnownAgent, scope: SkillScope): string {
  if (scope === 'project') {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) { throw new Error('No workspace open for project-scope install'); }
    return path.join(root, agent.skillsDir);
  }
  const override = agent.envOverride ? process.env[agent.envOverride] : undefined;
  return override ? path.join(override, 'skills') : path.join(os.homedir(), agent.skillsDir);
}

// ── local: plugin-managed symlinks ──────────────────────────────────────────

async function installLocalSymlink(skill: ResolvedSkill): Promise<void> {
  const target = localPath(skill.source);
  if (!fs.existsSync(target)) {
    throw new Error(`Local source path does not exist: ${target}`);
  }
  for (const agent of getActiveAgents()) {
    const dir = resolveAgentDir(agent, skill.scope);
    const link = path.join(dir, skill.id);
    await fs.promises.mkdir(dir, { recursive: true });

    if (isCorrectSymlink(link, target)) { continue; }

    let entryExists = false;
    try { fs.lstatSync(link); entryExists = true; } catch { entryExists = false; }
    if (entryExists) {
      await fs.promises.rename(link, `${link}.bak`);
    }
    await fs.promises.symlink(target, link, 'dir');
  }
}

async function uninstallLocalSymlink(skill: ResolvedSkill): Promise<void> {
  await removeSkillSymlinks(skill);
}

async function removeSkillSymlinks(
  skill: ResolvedSkill,
): Promise<{ removed: number; hasDirectory: boolean }> {
  let removed = 0;
  let hasDirectory = false;
  for (const agent of getActiveAgents()) {
    const dir = resolveAgentDir(agent, skill.scope);
    const link = path.join(dir, skill.id);
    try {
      const stat = fs.lstatSync(link);
      if (stat.isSymbolicLink()) {
        await fs.promises.unlink(link);
        removed++;
      } else if (stat.isDirectory()) {
        hasDirectory = true;
      }
    } catch { /* not present */ }
  }
  return { removed, hasDirectory };
}

function isCorrectSymlink(link: string, target: string): boolean {
  try {
    if (!fs.lstatSync(link).isSymbolicLink()) { return false; }
    return fs.realpathSync(link) === fs.realpathSync(target);
  } catch {
    return false;
  }
}

// ── remote: background skills CLI ───────────────────────────────────────────

async function installViaNpx(skills: ResolvedSkill[]): Promise<void> {
  const first = skills[0];
  const source = npxAddArg(first.source);
  const args = ['add', source];
  const skillIds = Array.from(new Set(skills.map(skill => skill.skillId)));
  if (skillIds.length > 1 || looksLikeSubskill(source, skillIds[0])) {
    args.push('--skill', ...skillIds);
  }
  if (first.scope === 'global') { args.push('-g'); }
  args.push('-y');
  await runSkillsCli(args, first.scope);
}

async function uninstallViaNpx(skills: ResolvedSkill[]): Promise<void> {
  // The skills CLI scans with Dirent.isDirectory(), so externally managed
  // symlinks are invisible to it. Remove those directly before falling back
  // to the CLI for regular directories or lock-file entries.
  const cliSkills: ResolvedSkill[] = [];
  for (const skill of skills) {
    const entries = await removeSkillSymlinks(skill);
    if (entries.removed === 0 || entries.hasDirectory) { cliSkills.push(skill); }
  }
  if (cliSkills.length === 0) { return; }

  const args = ['remove', ...cliSkills.map(skill => skill.id)];
  if (cliSkills[0].scope === 'global') { args.push('-g'); }
  args.push('-y');
  await runSkillsCli(args, cliSkills[0].scope);
}

async function runSkillsCli(args: string[], scope: SkillScope): Promise<void> {
  const cwd = scope === 'project'
    ? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    : os.homedir();
  if (!cwd) { throw new Error('No workspace open for project-scope operation'); }

  const result = await execFileAsync('npx', ['--yes', 'skills', ...args], {
    cwd,
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
    timeout: 5 * 60 * 1000,
    windowsHide: true,
  });
  const output = `${result.stdout}\n${result.stderr}`;
  if (output.includes('No matching skills found for:')) {
    throw new Error(output.trim());
  }
}

function looksLikeSubskill(source: string, id: string): boolean {
  const repoName = source.replace(/\.git$/, '').replace(/.*\//, '').replace(/\/tree\/.*/, '');
  return id !== repoName || source.includes('/tree/');
}

function errorDetail(error: unknown): string {
  if (!error || typeof error !== 'object') { return String(error); }
  const processError = error as {
    message?: string;
    stdout?: string | Buffer;
    stderr?: string | Buffer;
  };
  const output = [processError.stderr, processError.stdout, processError.message]
    .map(value => value?.toString().trim())
    .find(Boolean);
  return output || 'Unknown error';
}

function writeFailures(operation: Operation, failures: OperationFailure[]): void {
  const channel = getOutputChannel();
  channel.appendLine(`[${new Date().toISOString()}] ${operation} failed`);
  for (const failure of failures) {
    channel.appendLine(`\n${failure.skill}\n${failure.detail}`);
  }
  channel.appendLine('');
}

function getOutputChannel(): vscode.OutputChannel {
  outputChannel ??= vscode.window.createOutputChannel('Skills Manager');
  return outputChannel;
}

export function disposeInstaller(): void {
  outputChannel?.dispose();
  outputChannel = undefined;
  onOperationCompletedEmitter.dispose();
}
