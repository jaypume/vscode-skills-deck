import * as os from 'os';
import * as vscode from 'vscode';
import { RepositorySkill } from './types';
import { npxAddArg } from './source';
import { parseSkillList } from './skillList';
import { runNpx } from './npx';

export async function discoverRepositorySkills(source: string): Promise<RepositorySkill[]> {
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Window,
      title: 'Discovering repository skills',
      cancellable: false,
    },
    async () => {
      const result = await runNpx(
        ['--yes', 'skills', 'add', npxAddArg(source), '--list'],
        {
          cwd: os.homedir(),
          env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
          maxBuffer: 8 * 1024 * 1024,
          timeout: 5 * 60 * 1000,
        },
      );
      const output = `${result.stdout}\n${result.stderr}`;
      const skills = parseSkillList(output);
      if (skills.length === 0) {
        const summary = discoveryOutputSummary(output);
        throw new Error(
          `No skills were discovered from ${npxAddArg(source)}.`
          + (summary ? ` CLI output: ${summary}` : ''),
        );
      }
      return skills;
    },
  );
}

function discoveryOutputSummary(output: string): string {
  const lines = output
    .replace(/\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001b\\))/g, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.replace(/^[^\p{L}\p{N}]+/u, '').trim())
    .filter(Boolean);
  const statusLines = lines.filter(line =>
    /found|no valid skills|no skills|error|failed/i.test(line));
  const summary = (statusLines.length > 0 ? statusLines : lines.slice(-3)).slice(-3).join(' | ');
  return summary.length > 500 ? `${summary.slice(0, 497)}...` : summary;
}
