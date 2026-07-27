import { RepositorySkill } from './types';

export function parseSkillList(output: string): RepositorySkill[] {
  const clean = stripAnsi(output).replace(/\r/g, '\n');
  const lines = clean.split('\n');
  const skills: RepositorySkill[] = [];
  for (let index = 0; index < lines.length; index++) {
    const match = lines[index].match(/^│ {4}([a-z0-9][a-z0-9._-]*)\s*$/i);
    if (!match) { continue; }
    const skillId = match[1];
    let description: string | undefined;
    for (let next = index + 1; next < Math.min(lines.length, index + 5); next++) {
      const descriptionMatch = lines[next].match(/^│ {6}(.+?)\s*$/);
      if (descriptionMatch) {
        description = descriptionMatch[1];
        break;
      }
    }
    skills.push({ skillId, name: skillId, description });
  }
  return skills;
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001b\\))/g, '');
}
