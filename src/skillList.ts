import { RepositorySkill } from './types';

export function parseSkillList(output: string): RepositorySkill[] {
  const clean = stripAnsi(output).replace(/\r\n?/g, '\n');
  const lines = clean.split('\n');
  const hasListHeading = lines.some(line => /Available Skills/i.test(line));
  let inSkillList = !hasListHeading;
  const skills: RepositorySkill[] = [];
  for (let index = 0; index < lines.length; index++) {
    if (/Available Skills/i.test(lines[index])) {
      inSkillList = true;
      continue;
    }
    if (!inSkillList) { continue; }
    if (/Use --skill|Run without --list/i.test(lines[index])) { break; }
    const skillId = parseSkillId(lines[index]);
    if (!skillId) { continue; }
    let description: string | undefined;
    for (let next = index + 1; next < Math.min(lines.length, index + 5); next++) {
      const parsedDescription = parseDescription(lines[next]);
      if (parsedDescription) {
        description = parsedDescription;
        break;
      }
    }
    skills.push({ skillId, name: skillId, description });
  }
  return skills;
}

function parseSkillId(line: string): string | undefined {
  return line.match(/^[│|] {4}([a-z0-9][a-z0-9._-]*)\s*$/i)?.[1]
    ?? line.match(/^ {2}([a-z0-9][a-z0-9._-]*)\s*$/i)?.[1];
}

function parseDescription(line: string): string | undefined {
  return line.match(/^[│|] {6}(.+?)\s*$/)?.[1]
    ?? line.match(/^ {4}(.+?)\s*$/)?.[1];
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001b\\))/g, '');
}
