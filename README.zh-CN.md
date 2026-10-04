# Codex Kanban

[English](README.md) · [简体中文](README.zh-CN.md)

**让 Codex 的并行任务，一目了然。**

Codex Kanban 把聊天任务变成侧栏看板：查看进行中与待审阅任务，拖拽整理分组，点击卡片继续对话。无需离开 Codex，就能掌握整个工作流。

[在 X 查看演示](https://x.com/shichangliao/status/2106664558463254596)

## 核心功能

- **任务状态一目了然**：查看运行中的任务，以及等待输入或审阅的任务。
- **自动分组**：根据观察到的本机任务活动归入 In Progress 和 For Review；自动补建缺失的流程分组，复用已有分组。
- **拖拽整理**：在原生分组间移动任务，按自己的习惯排列卡片。
- **看板与列表**：按项目浏览、搜索任务、筛选未读聊天。
- **直接返回聊天**：点击卡片继续对话；New task 打开 Codex 原生新建页面。

同时支持置顶、重命名、归档与 Undo、项目设置、分支及匹配的 PR 信息、浅色与深色主题。

## 安装

目前支持 **macOS**，需要安装在 `/Applications/ChatGPT.app` 的 ChatGPT 桌面应用中的 Codex。

1. [下载安装包 ZIP](https://github.com/shichang4fun/codex-kanban/archive/refs/heads/marketplace.zip)，解压。
2. 双击 **Install Codex Kanban.command**。
3. 正常退出 Codex（⌘Q），从原来的图标重新打开。打开任意本机聊天，再从侧栏进入 **Codex Kanban**。

安装器包含插件、Desktop 桥接、自动分组引擎及原图标接入。无需终端命令、单独安装 Node、手动配置桥接，也无需另装 Sidebar Flow。日常照常通过 Dock、Finder 或 Spotlight 启动即可。

如果 macOS 拦截脚本，右键选择「打开」。安装公开版本前，请禁用已有的 `codex-kanban@codex-kanban-local` 开发副本，避免重复入口。这是自托管的 GitHub marketplace，并非 OpenAI 官方公开目录。

## 让 agent 安装

让具备终端权限的 agent 在受支持的 Mac 上执行下面的命令。使用公开的 `marketplace` 安装包，不要使用源码开发命令；无需全局 Codex CLI 或 npm。保留用户已有的 `CODEX_HOME` 环境。

```sh
(
  set -eu
  KANBAN_NODE="/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node"
  test -x "$KANBAN_NODE"
  KANBAN_TMP="$(mktemp -d "${TMPDIR:-/tmp}/codex-kanban.XXXXXX")"
  trap 'rm -rf "$KANBAN_TMP"' EXIT
  curl --fail --location --retry 3 \
    https://github.com/shichang4fun/codex-kanban/archive/refs/heads/marketplace.zip \
    -o "$KANBAN_TMP/kanban.zip"
  unzip -q "$KANBAN_TMP/kanban.zip" -d "$KANBAN_TMP"
  "$KANBAN_NODE" "$KANBAN_TMP/codex-kanban-marketplace/plugins/codex-kanban/install.mjs" --launch
)
```

**安装前**：检查已有插件。如果启用了 `codex-kanban@codex-kanban-local`，先在 Codex 插件设置中禁用这个开发副本，再启用公开版本。再次运行安装器会升级公开插件并保留分类设置，包括用户主动关闭的策略。不要删除用户数据或覆盖不认识的启动接入。

**安装后**：如果安装器提示 Codex 正在运行，报告「**已安装，等待重启**」。由用户正常退出并从原图标打开，不要强制关闭正在使用的会话。打开本机聊天后，桥接才会连接并初始化缺失的流程分组。

重启并打开本机聊天后，执行以下只读检查：

```sh
"/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex" plugin list --json
"/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node" --input-type=module <<'JS'
import {homedir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=join(process.env.CODEX_HOME||join(homedir(),'.codex'),'kanban-desktop');
const {desktopBridgeRequest}=await import(pathToFileURL(join(root,'runtime','bridge-transport.mjs')));
const {connected,groupActions,autoFlow}=await desktopBridgeRequest(join(root,'desktop.sock'),'status');
console.log(JSON.stringify({connected,groupActions,autoFlow},null,2));
JS
```

只有 `codex-kanban@codex-kanban` 已安装且启用、`connected` 和 `groupActions` 为 true、侧栏看板可以打开，才能报告「**可用**」。自动分类还需确认 `autoFlow.available`、`autoFlow.enabled` 为 true，`autoFlow.initialization.state === "ready"`，并看到 In Progress、For Review、For Later 三个分组。已有策略若处于关闭状态，保持关闭并如实说明。

桥接断连、初始化等待或失败、无法进行 GUI 检查时，报告具体待完成步骤，不能宣称全部配置成功。重试前先读取初始化错误；重名分组或失效映射应先修复，不要盲目重复创建分组。

## 更新

下载最新 ZIP，再次运行同一个安装器，随后正常退出并重新打开 Codex。已有自动分类设置会保留。

## 适用范围与隐私

- 实时状态、置顶和跨组移动需要 Desktop 桥接连接。重启后打开一个本机聊天以建立连接。
- 自动分组依据观察到的本机任务活动；默认策略保留置顶任务与自定义分组，不启动模型任务。
- 任务数据存储在插件缓存之外的 `$CODEX_HOME/kanban`（默认 `~/.codex/kanban`）。GitHub PR 查询使用已有的 `gh` 登录，只发送仓库、分支或提交标识，不发送任务标题和摘要。
- 自动分类设置位于 `$CODEX_HOME/kanban-desktop/flow.json`。配置、仅 CLI 安装、桥接恢复和撤销原图标接入，见[技术说明](docs/technical-reference.md)。

## 开发

使用源码仓库的 `main` 分支，需要 Node.js 22+：

```sh
npm ci
npx playwright install chromium
npm run test:regression
npm run build:plugin
```

本地预览、开发安装与发布流程见[技术说明](docs/technical-reference.md)；回归测试及原生客户端验收见[测试标准](TESTING.md)。
