# Codex Kanban 0.4.56

[English](README.md) · [简体中文](README.zh-CN.md)

**All your Codex tasks. One clear board.**

Codex Kanban brings a task board to your Codex sidebar. See what’s running and ready for review, organize tasks, and jump straight back into a chat without leaving Codex.

[See the demo on X](https://x.com/shichangliao/status/2106664558463254596)

## Features

- **Status at a glance:** see running tasks and tasks awaiting input or review.
- **Automatic grouping:** organize observed local task activity into In Progress and For Review; create missing workflow groups and reuse existing ones.
- **Drag and drop:** move tasks between native groups and arrange cards in your preferred order.
- **Board and list views:** browse by project, search tasks, and filter unread chats.
- **Direct chat links:** click a card to continue the conversation; New task opens Codex’s native creation page.

Also includes pinning, rename, archive with Undo, project assignment, branch and matched PR information, and light/dark themes.

## Install

Currently supports **macOS** with Codex in the ChatGPT desktop app installed at `/Applications/ChatGPT.app`.

1. [Download the installation ZIP](https://github.com/shichang4fun/codex-kanban/archive/refs/heads/marketplace.zip) and extract it.
2. Double-click **Install Codex Kanban.command**.
3. Quit Codex normally (⌘Q) and reopen it using its original icon. Open any local chat, then select **Codex Kanban** in the sidebar.

The installer includes the plugin, Desktop bridge, automatic grouping engine, and original-icon integration. No terminal commands, separate Node installation, manual bridge configuration, or separate Sidebar Flow installation are needed. Continue using Dock, Finder, or Spotlight as usual.

If macOS blocks the script, right-click it and choose **Open**. Disable an existing `codex-kanban@codex-kanban-local` development copy before installing the public package to avoid duplicate entries. This is a self-hosted GitHub marketplace, not an official OpenAI directory listing.

## Install with an agent

Ask an agent with terminal access to run this on the supported Mac. Use the public `marketplace` package, not the source development commands; no global Codex CLI or npm is required. Keep the user’s existing `CODEX_HOME` environment.

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

**Before installing:** check existing plugins. If `codex-kanban@codex-kanban-local` is enabled, disable that development copy in Codex’s plugin settings before enabling the public copy. Re-running the installer upgrades the public plugin and preserves existing classification settings, including an intentionally disabled policy. Do not delete user data or replace an unknown startup integration.

**After installing:** if the installer reports that Codex is already running, report **installed — restart required**. Let the user quit normally and reopen the original icon; do not force-quit their active session. Open a local chat to connect the bridge and initialize missing workflow groups.

Run these read-only checks after restarting and opening a local chat:

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

Report **ready** only when `codex-kanban@codex-kanban` is installed and enabled, `connected` and `groupActions` are true, and the sidebar board opens. For automatic grouping, also require `autoFlow.available`, `autoFlow.enabled`, and `autoFlow.initialization.state === "ready"`; confirm In Progress, For Review, and For Later are visible. An existing disabled policy stays disabled and must be reported as such.

If the bridge is disconnected, initialization is waiting or failed, or GUI checks cannot be performed, report the specific remaining step instead of claiming full setup. Read initialization errors before retrying; resolve duplicate group names or invalid saved mappings without blindly creating more groups.

## Update

Download the latest ZIP and run the same installer again, then quit and reopen Codex. Existing classification settings are preserved.

## Scope and privacy

- Live status, pinning, and group moves need a connected Desktop bridge. Open a local chat after restarting to establish the connection.
- Automatic grouping uses observed local activity, preserves pinned tasks and custom groups under the default policy, and does not start model tasks.
- Task data stays outside the plugin cache in `$CODEX_HOME/kanban` (default `~/.codex/kanban`). GitHub PR lookups use your existing `gh` authentication and send repository, branch, or commit identifiers, not task titles or summaries.
- Automatic grouping settings live in `$CODEX_HOME/kanban-desktop/flow.json`. For configuration, CLI-only installation, bridge recovery, and disabling original-icon integration, see the [technical reference](https://github.com/shichang4fun/codex-kanban/blob/main/docs/technical-reference.md).

## Development

Use the source repository’s `main` branch with Node.js 22+:

```sh
npm ci
npx playwright install chromium
npm run test:regression
npm run build:plugin
```

See [testing and native acceptance](https://github.com/shichang4fun/codex-kanban/blob/main/TESTING.md) and the [technical reference](https://github.com/shichang4fun/codex-kanban/blob/main/docs/technical-reference.md) for local preview, development installation, and publishing.
