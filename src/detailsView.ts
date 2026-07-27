/**
 * Native details tree for the selected skill.
 *
 * The view intentionally uses TreeItem labels, descriptions, icons, tooltips,
 * selection, and keyboard navigation instead of recreating VS Code UI in HTML.
 */

import * as vscode from 'vscode';
import { DecoratedSkill, SkillStatus } from './types';
import { installedEmoji, STATUS_VISUALS, wantedEmoji } from './visuals';

type DetailsNodeKind = 'skill' | 'property' | 'placeholder';

class DetailsNode extends vscode.TreeItem {
  constructor(
    public readonly kind: DetailsNodeKind,
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
  ) {
    super(label, collapsibleState);
    this.contextValue = `skillDetails.${kind}`;
  }
}

interface PropertySpec {
  key: string;
  label: string;
  value: string;
  icon: string;
  color?: string;
}

export class DetailsTreeProvider implements vscode.TreeDataProvider<DetailsNode> {
  private readonly onDidChangeEmitter = new vscode.EventEmitter<DetailsNode | undefined>();
  readonly onDidChangeTreeData = this.onDidChangeEmitter.event;

  private current?: DecoratedSkill;

  show(skill: DecoratedSkill | undefined): void {
    this.current = skill;
    this.onDidChangeEmitter.fire(undefined);
  }

  getTreeItem(element: DetailsNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: DetailsNode): DetailsNode[] {
    if (!this.current) {
      return element ? [] : [this.placeholder()];
    }
    if (!element) {
      return [this.skillNode(this.current)];
    }
    if (element.kind === 'skill') {
      return this.propertyNodes(this.current);
    }
    return [];
  }

  private placeholder(): DetailsNode {
    const node = new DetailsNode(
      'placeholder',
      'Select a skill to view details',
      vscode.TreeItemCollapsibleState.None,
    );
    node.iconPath = new vscode.ThemeIcon('info');
    return node;
  }

  private skillNode(skill: DecoratedSkill): DetailsNode {
    const visual = STATUS_VISUALS[skill.status];
    const node = new DetailsNode(
      'skill',
      skill.name,
      vscode.TreeItemCollapsibleState.Expanded,
    );
    node.id = `details:${skill.scope}:${skill.repoId}:${skill.skillId}`;
    node.description = `${installedEmoji(skill.installedAgents.length > 0)} `
      + `${visual.desc}${visual.diff ? ' ★' : ''}`;
    node.iconPath = new vscode.ThemeIcon(
      statusIcon(skill.status),
      new vscode.ThemeColor(visual.color),
    );
    node.tooltip = [skill.name, skill.source || 'No source', skill.installedPath]
      .filter(Boolean)
      .join('\n');
    return node;
  }

  private propertyNodes(skill: DecoratedSkill): DetailsNode[] {
    const visual = STATUS_VISUALS[skill.status];
    const properties: PropertySpec[] = [
      {
        key: 'status',
        label: 'Status',
        value: `${installedEmoji(skill.installedAgents.length > 0)} `
          + `${visual.desc}${visual.diff ? ' ★' : ''}`,
        icon: statusIcon(skill.status),
        color: visual.color,
      },
      { key: 'source', label: 'Source', value: skill.source || '—', icon: 'link' },
      { key: 'type', label: 'Type', value: skill.sourceType, icon: 'symbol-enum' },
      { key: 'repository', label: 'Repository', value: skill.repository.name, icon: 'repo' },
      { key: 'skillId', label: 'Skill ID', value: skill.skillId, icon: 'symbol-key' },
      { key: 'installId', label: 'Install ID', value: skill.id, icon: 'folder' },
      { key: 'scope', label: 'Scope', value: skill.scope, icon: 'root-folder' },
      {
        key: 'agents',
        label: 'Agents',
        value: skill.installedAgents.length ? skill.installedAgents.join(', ') : '—',
        icon: 'organization',
      },
      {
        key: 'wanted',
        label: 'Wanted',
        value: `${wantedEmoji(skill.wanted)} ${skill.wanted ? 'yes' : 'no'}`,
        icon: skill.wanted ? 'check' : 'close',
      },
      { key: 'category', label: 'Category', value: skill.category, icon: 'tag' },
      { key: 'path', label: 'Path', value: skill.installedPath ?? '—', icon: 'folder-opened' },
    ];
    if (skill.note) {
      properties.push({ key: 'note', label: 'Note', value: skill.note, icon: 'note' });
    }
    if (skill.dateAdded) {
      properties.push({
        key: 'dateAdded',
        label: 'Added',
        value: formatLocalDate(skill.dateAdded),
        icon: 'calendar',
      });
    }

    return properties.map(property => {
      const node = new DetailsNode(
        'property',
        property.label,
        vscode.TreeItemCollapsibleState.None,
      );
      node.id = `details:${skill.scope}:${skill.repoId}:${skill.skillId}:${property.key}`;
      node.description = property.value;
      node.tooltip = `${property.value}\n\nClick to copy value`;
      node.command = {
        command: 'skillsDeck.copyDetailValue',
        title: 'Copy Value',
        arguments: [property.value],
      };
      node.iconPath = new vscode.ThemeIcon(
        property.icon,
        property.color ? new vscode.ThemeColor(property.color) : undefined,
      );
      return node;
    });
  }
}

function statusIcon(status: SkillStatus): string {
  switch (status) {
    case 'wanted-installed': return 'check';
    case 'wanted-missing': return 'arrow-down';
    case 'unwanted-installed': return 'close';
    case 'unwanted-missing': return 'circle-slash';
    case 'extra': return 'sparkle';
  }
}

function formatLocalDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) { return value; }
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  }).format(date);
}
