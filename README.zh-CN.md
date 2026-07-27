# Skills Deck

[English](README.md) · [中文](#中文)

![Skills Deck demo](media/demo.gif)

## 中文

Skills Deck 用于解决 Agent Skills 数量增多后、各 Agent 之间安装状态不一致、难以统一管理的问题。

核心思路：**先声明期望拥有的 skill 清单，再与磁盘上的实际安装情况对比，仅标记需要处理的差异**。声明状态与实际状态相互独立，互不干扰。

### 功能特性

- **想要与已装分离**：将"是否需要"（Wanted / Unwanted）与"是否已装"（Installed / Missing）拆开管理，便于识别该装未装、该删未删的情况。
- **一份清单，多 Agent 生效**：维护一次声明，即可同步至 Claude Code、Codex、Pi、OpenCode、Cursor、GitHub Copilot、Gemini CLI、Windsurf、Roo、Kilo、Kiro、Continue、Goose、Trae、Amp，或自定义 Agent。
- **全局技能库作为唯一来源**：所有 skill 实体统一存放在 `~/.agents/skills`，各 Agent 通过受管软链接引用——删除链接不影响文件本身，切换 Agent 也不会丢失 skill。
- **支持多种来源**：可从 GitHub 仓库、`skills.sh` 命令、skillhub.cn 或本地目录添加 skill。
- **多 skill 仓库管理**：自动发现仓库中的 skill，支持按单个 skill 或整个仓库进行选择、更新与删除。
- **VS Code 原生界面**：提供 TreeView 分组、搜索、多选、右键菜单、详情面板、tooltip 与通知，耗时操作在后台执行，不阻塞界面。
- **Agent 间差异检查**：识别缺失链接、失效链接、被本地 override 的内容，以及 Agent 自行安装的 skill——仅作只读对账，不覆盖本地文件。
- **skill 备注**：可在详情中为每个 skill 记录个人评价或提醒，便于后续取舍。
- **快捷导航**：一键打开 GitHub 仓库、本地源目录、`SKILL.md`、指定 Agent 的 skills 目录，或 `data.json` 本身。
- **声明可迁移**：期望状态保存在精简的 `data.json` 中，实际安装状态始终由磁盘实时计算，不重复存储。

### 快速上手

1. 从侧边栏打开 **Skills Deck**。
2. 在 **Agents** 视图中勾选需要启用的 Agent。
3. 使用 **Add Skill** 添加 skill，或使用 **Sync to Data (Install State → List)** 将磁盘上的现有状态写入声明清单。
4. 使用 **Sync from Data (List → Install)** 按清单一次性对齐全局技能库与各 Agent。

远程的安装、更新、删除操作通过 `skills` CLI 在后台执行，本地来源使用软链接。为保持全局模型清晰，当前版本暂不管理项目目录中的 skills。
