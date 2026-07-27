/**
 * Details webview — shows the selected skill's reconciled state, source,
 * agents, and note. Simplified port of extensions-bookmark DetailsViewProvider.
 */

import * as vscode from 'vscode';
import { DecoratedSkill } from './types';
import { STATUS_VISUALS } from './visuals';

export class DetailsViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'skillsManager.details';
  private view?: vscode.WebviewView;
  private current?: DecoratedSkill;

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: false };
    view.webview.html = this.render(this.current);
  }

  show(skill: DecoratedSkill | undefined): void {
    this.current = skill;
    if (this.view) {
      this.view.webview.html = this.render(skill);
      this.view.show?.(true);
    }
  }

  private render(s: DecoratedSkill | undefined): string {
    if (!s) {
      return this.shell('<p class="hint">Select a skill to see its details.</p>');
    }
    const v = STATUS_VISUALS[s.status];
    const rows = [
      ['Status', `${v.desc}${v.diff ? ' ★' : ''}`],
      ['Source', s.source || '—'],
      ['Type', s.sourceType],
      ['Scope', s.scope],
      ['Agents', s.installedAgents.length ? s.installedAgents.join(', ') : '—'],
      ['Wanted', s.wanted ? 'yes' : 'no'],
      ['Path', s.installedPath ?? '—'],
    ];
    if (s.note) { rows.push(['Note', s.note]); }
    const body = `
      <h2>${escapeHtml(s.name)}</h2>
      <span class="badge ${v.diff ? 'diff' : 'ok'}">${escapeHtml(v.desc)}${v.diff ? ' ★' : ''}</span>
      <table>
        ${rows.map(([k, val]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(String(val))}</td></tr>`).join('')}
      </table>`;
    return this.shell(body);
  }

  private shell(body: string): string {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 12px; }
      h2 { margin: 0 0 8px; font-size: 16px; }
      .badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 12px; margin-bottom: 12px; }
      .badge.ok { background: var(--vscode-testing-iconPassed, #3fb950); color: #fff; }
      .badge.diff { background: var(--vscode-charts-yellow, #d29922); color: #000; }
      table { border-collapse: collapse; width: 100%; font-size: 13px; }
      th { text-align: left; padding: 4px 8px 4px 0; color: var(--vscode-descriptionForeground); white-space: nowrap; width: 1%; }
      td { padding: 4px 0; word-break: break-all; }
      .hint { color: var(--vscode-descriptionForeground); }
    </style></head><body>${body}</body></html>`;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]!));
}
