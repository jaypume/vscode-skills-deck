/**
 * Native details tree for the selected skill.
 *
 * The view intentionally uses TreeItem labels, descriptions, icons, tooltips,
 * selection, and keyboard navigation instead of recreating VS Code UI in HTML.
 */

import * as vscode from 'vscode';
import {
  AgentSkillObservation,
  DecoratedSkill,
  ResolvedAgent,
  SkillStatus,
} from './types';
import { installedEmoji, STATUS_VISUALS, wantedEmoji } from './visuals';
import { compactPath } from './known-agents';

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
  command?: vscode.Command;
}

type DetailsTarget =
  | { kind: 'skill'; value: DecoratedSkill }
  | { kind: 'agent'; value: ResolvedAgent }
  | { kind: 'agentSkill'; value: AgentSkillObservation; agent: ResolvedAgent };

export class DetailsTreeProvider implements vscode.TreeDataProvider<DetailsNode> {
  private readonly onDidChangeEmitter = new vscode.EventEmitter<DetailsNode | undefined>();
  readonly onDidChangeTreeData = this.onDidChangeEmitter.event;

  private current?: DetailsTarget;

  show(skill: DecoratedSkill | undefined): void {
    this.current = skill ? { kind: 'skill', value: skill } : undefined;
    this.onDidChangeEmitter.fire(undefined);
  }

  showAgent(agent: ResolvedAgent | undefined): void {
    this.current = agent ? { kind: 'agent', value: agent } : undefined;
    this.onDidChangeEmitter.fire(undefined);
  }

  showAgentSkill(
    observation: AgentSkillObservation | undefined,
    agent: ResolvedAgent | undefined,
  ): void {
    this.current = observation && agent
      ? { kind: 'agentSkill', value: observation, agent }
      : undefined;
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
      return [this.rootNode(this.current)];
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

  private rootNode(target: DetailsTarget): DetailsNode {
    if (target.kind === 'agent') {
      const agent = target.value;
      const node = new DetailsNode(
        'skill',
        agent.displayName,
        vscode.TreeItemCollapsibleState.Expanded,
      );
      node.id = `details:agent:${agent.id}`;
      node.description = agent.enabled ? '✅ enabled' : '🚫 disabled';
      node.iconPath = new vscode.ThemeIcon('robot');
      node.tooltip = compactPath(agent.rootDir);
      return node;
    }
    if (target.kind === 'agentSkill') {
      const item = target.value;
      const node = new DetailsNode(
        'skill',
        item.name,
        vscode.TreeItemCollapsibleState.Expanded,
      );
      node.id = `details:agent-skill:${item.agentId}:${item.scope}:${item.skillId}`;
      node.description = item.state;
      node.iconPath = new vscode.ThemeIcon(item.state === 'agent-owned' ? 'folder' : 'link');
      node.tooltip = compactPath(item.path);
      return node;
    }
    return this.skillNode(target.value);
  }

  private skillNode(skill: DecoratedSkill): DetailsNode {
    const visual = STATUS_VISUALS[skill.status];
    const node = new DetailsNode(
      'skill',
      skill.name,
      vscode.TreeItemCollapsibleState.Expanded,
    );
    node.id = `details:${skill.scope}:${skill.repoId}:${skill.skillId}`;
    node.description = `${installedEmoji(skill.installed)} `
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

  private propertyNodes(target: DetailsTarget): DetailsNode[] {
    if (target.kind === 'agent') {
      const agent = target.value;
      return this.toPropertyNodes(`agent:${agent.id}`, [
        { key: 'status', label: 'Status', value: agent.enabled ? '✅ enabled' : '🚫 disabled', icon: agent.enabled ? 'check' : 'circle-slash' },
        { key: 'id', label: 'Agent ID', value: agent.id, icon: 'symbol-key' },
        { key: 'type', label: 'Type', value: agent.custom ? 'custom' : 'built-in', icon: 'symbol-enum' },
        { key: 'detected', label: 'Detected', value: agent.detected ? 'yes' : 'no', icon: 'search' },
        { key: 'root', label: 'Parent', value: compactPath(agent.rootDir), icon: 'folder' },
        { key: 'global', label: 'Global Skills', value: compactPath(agent.globalSkillsDir), icon: 'globe' },
      ]);
    }
    if (target.kind === 'agentSkill') {
      const item = target.value;
      return this.toPropertyNodes(
        `agent-skill:${item.agentId}:${item.scope}:${item.skillId}`,
        [
          { key: 'status', label: 'Status', value: item.state, icon: 'info' },
          { key: 'agent', label: 'Agent', value: target.agent.displayName, icon: 'robot' },
          { key: 'skillId', label: 'Skill ID', value: item.skillId, icon: 'symbol-key' },
          { key: 'scope', label: 'Scope', value: item.scope, icon: 'root-folder' },
          { key: 'path', label: 'Path', value: compactPath(item.path), icon: 'folder-opened' },
          { key: 'target', label: 'Link Target', value: item.linkTarget ? compactPath(item.linkTarget) : '—', icon: 'link' },
        ],
      );
    }
    return this.skillPropertyNodes(target.value);
  }

  private skillPropertyNodes(skill: DecoratedSkill): DetailsNode[] {
    const visual = STATUS_VISUALS[skill.status];
    const properties: PropertySpec[] = [
      {
        key: 'status',
        label: 'Status',
        value: `${installedEmoji(skill.installed)} `
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
        key: 'missingAgents',
        label: 'Missing Agents',
        value: skill.missingAgents.length ? skill.missingAgents.join(', ') : '—',
        icon: 'warning',
      },
      {
        key: 'overrideAgents',
        label: 'Overrides',
        value: skill.overrideAgents.length ? skill.overrideAgents.join(', ') : '—',
        icon: 'shield',
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
    if (!skill.extra) {
      properties.push({
        key: 'note',
        label: 'Notes',
        value: skill.note || '—',
        icon: 'note',
        command: {
          command: 'skillsDeck.editSkillNote',
          title: 'Edit Notes',
          arguments: [{
            scope: skill.scope,
            repoId: skill.repoId,
            skillId: skill.skillId,
          }],
        },
      });
    }
    if (skill.dateAdded) {
      properties.push({
        key: 'dateAdded',
        label: 'Added',
        value: formatLocalDate(skill.dateAdded),
        icon: 'calendar',
      });
    }
    if (skill.updatedAt) {
      properties.push({
        key: 'updatedAt',
        label: 'Updated',
        value: formatLocalDate(skill.updatedAt),
        icon: 'history',
      });
    }
    return this.toPropertyNodes(
      `${skill.scope}:${skill.repoId}:${skill.skillId}`,
      properties,
    );
  }

  private toPropertyNodes(prefix: string, properties: PropertySpec[]): DetailsNode[] {
    return properties.map(property => {
      const node = new DetailsNode(
        'property',
        property.label,
        vscode.TreeItemCollapsibleState.None,
      );
      node.id = `details:${prefix}:${property.key}`;
      node.description = property.value;
      node.tooltip = `${property.value}\n\n`
        + (property.command ? 'Click to edit' : 'Click to copy value');
      node.command = property.command ?? {
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
