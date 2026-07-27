# Skills Deck

Declarative Agent Skills management, directly inside VS Code.

[English](#english) · [中文](#中文)

![Skills Deck demo](media/demo.gif)

## English

Skills Deck keeps one desired-state list of Agent Skills, compares it with the
global library on disk, and shows exactly what needs attention.

### Features

- **Declarative state** — track Wanted/Unwanted separately from
  Installed/Missing.
- **Multi-Agent sync** — enable Claude Code, Codex, Pi, OpenCode, Cursor,
  GitHub Copilot, Gemini CLI, Windsurf, Roo, Kilo, Kiro, Continue, Goose, Trae,
  Amp, or a custom Agent.
- **Safe global library** — use `~/.agents/skills` as the source of truth and
  create managed symlinks for enabled Agents.
- **Multiple sources** — add skills from GitHub, `skills.sh` commands,
  skillhub.cn, or local directories.
- **Multi-skill repositories** — discover, select, update, and remove skills at
  skill or repository level.
- **Native VS Code UI** — TreeView grouping, search, multi-select, context
  menus, Details, tooltips, notifications, and background operations.
- **Agent differences** — identify missing links, broken links, overrides, and
  Agent-owned skills without overwriting local content.
- **Skill notes** — add personal evaluations or reminders from Details.
- **Quick navigation** — open GitHub repositories, local source directories,
  `SKILL.md`, Agent skill directories, or `data.json`.
- **Portable declarations** — keep desired state in a compact `data.json`;
  runtime installation state is always derived from disk.

### Quick Start

1. Open **Skills Deck** from the Activity Bar.
2. Configure enabled Agents in the **Agents** view.
3. Use **Add Skill** or **Sync to Data (Install State → List)** to build your
   declarations.
4. Use **Sync from Data (List → Install)** to reconcile the global library and
   enabled Agents.

Remote operations run through the `skills` CLI in the background. Local sources
use symlinks. Project-local skill management is currently disabled to keep the
global model predictable.

## 中文

Skills Deck 使用一份声明式列表记录 Agent Skills 的期望状态，并与磁盘上的全局
技能库对比，只展示真正需要处理的差异。

### 功能特性

- **声明式状态** — Wanted/Unwanted 与 Installed/Missing 独立管理。
- **多 Agent 同步** — 支持 Claude Code、Codex、Pi、OpenCode、Cursor、
  GitHub Copilot、Gemini CLI、Windsurf、Roo、Kilo、Kiro、Continue、Goose、
  Trae、Amp 以及自定义 Agent。
- **安全的全局技能库** — 以 `~/.agents/skills` 为唯一来源，为启用的 Agent
  创建受管软链接。
- **多种来源** — 从 GitHub、`skills.sh` 命令、skillhub.cn 或本地目录添加
  skill。
- **多 Skill 仓库** — 支持发现、选择、更新和删除单个 skill 或整个仓库。
- **VS Code 原生界面** — 提供 TreeView 分组、搜索、多选、右键菜单、Details、
  tooltip、通知和后台操作。
- **Agent 差异检查** — 识别缺失链接、失效链接、override 和 Agent 自有 skill，
  不覆盖本地内容。
- **Skill 备注** — 直接在 Details 中记录个人评价或提醒。
- **快捷导航** — 打开 GitHub 仓库、本地来源目录、`SKILL.md`、Agent skills
  目录或 `data.json`。
- **可迁移声明** — 期望状态保存在精简的 `data.json` 中，实际安装状态始终从
  磁盘计算。

### 快速开始

1. 从 Activity Bar 打开 **Skills Deck**。
2. 在 **Agents** 视图配置需要启用的 Agent。
3. 使用 **Add Skill** 或 **Sync to Data (Install State → List)** 创建声明列表。
4. 使用 **Sync from Data (List → Install)** 同步全局技能库和已启用的 Agent。

远程操作通过 `skills` CLI 在后台执行，本地来源使用软链接。为保持全局模型清晰，
当前版本暂不管理项目目录中的 skills。

## Requirements

- VS Code 1.93 or later
- Node.js and npm for remote install, update, and uninstall operations

## License

[Apache License 2.0](LICENSE)
