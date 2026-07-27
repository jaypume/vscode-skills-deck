import { execFile } from 'child_process';
import * as os from 'os';
import { promisify } from 'util';
import * as vscode from 'vscode';
import { RepositorySkill } from './types';
import { npxAddArg } from './source';
import { parseSkillList } from './skillList';

const execFileAsync = promisify(execFile);

export async function discoverRepositorySkills(source: string): Promise<RepositorySkill[]> {
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Window,
      title: 'Discovering repository skills',
      cancellable: false,
    },
    async () => {
      const result = await execFileAsync(
        'npx',
        ['--yes', 'skills', 'add', npxAddArg(source), '--list'],
        {
          cwd: os.homedir(),
          env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
          encoding: 'utf8',
          maxBuffer: 8 * 1024 * 1024,
          timeout: 5 * 60 * 1000,
          windowsHide: true,
        },
      );
      const skills = parseSkillList(`${result.stdout}\n${result.stderr}`);
      if (skills.length === 0) {
        throw new Error('No skills were discovered in this repository.');
      }
      return skills;
    },
  );
}
