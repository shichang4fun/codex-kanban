# Codex Kanban 0.4.42

Installable GitHub marketplace for the local Codex task board. This branch contains the built plugin; source and tests are on [main](https://github.com/shichang4fun/codex-kanban/tree/main).

## Install

Requires macOS and the current ChatGPT desktop app with Codex installed at /Applications/ChatGPT.app. The installer uses the app's bundled CLI and Node; no global CLI, separate Node installation or npm install is needed.

1. [Download the marketplace ZIP](https://github.com/shichang4fun/codex-kanban/archive/refs/heads/marketplace.zip) and extract it.
2. Double-click **Install Codex Kanban.command**. It installs or upgrades the plugin and Desktop bridge together, preserving an existing CLI chain.
3. If Codex is running, quit it normally and double-click **Launch Codex with Kanban.command**, selected in Finder by the installer. Open a local chat, then open Codex 看板 in the sidebar. Use this launcher on later starts too; the normal app entry does not enable the bridge.

If macOS blocks the downloaded script, right-click it and select Open, then follow the system prompt. Disable an existing codex-kanban@codex-kanban-local development copy before installing to avoid duplicate entries. No task ID, path configuration or config-file editing is needed. The installer never stops a running client.

For the basic plugin without the Desktop bridge, the official CLI also works:

```sh
codex plugin marketplace add shichang4fun/codex-kanban --ref marketplace
codex plugin add codex-kanban@codex-kanban
```

If your global Codex CLI is unavailable, use the desktop app's bundled executable for both commands:

```sh
CODEX_CLI='/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex'
"$CODEX_CLI" plugin marketplace add shichang4fun/codex-kanban --ref marketplace
"$CODEX_CLI" plugin add codex-kanban@codex-kanban
```

Reload MCP configuration or restart the desktop app, then open Codex 看板 in the sidebar. If you already installed codex-kanban@codex-kanban-local, disable that copy before enabling this one to avoid duplicate entries.

## Update

```sh
codex plugin marketplace upgrade codex-kanban
codex plugin add codex-kanban@codex-kanban
```

## Capabilities and data

The plugin reads local Codex task metadata and provides a board, list, search and project controls. Explicit UI actions support archive/Undo and project assignment. Live status, pinning and group changes require the Desktop bridge, which the double-click installer configures automatically. The bridge activates after the client successfully loads a local chat. CLI-only installation does not configure the bridge. See the [source README](https://github.com/shichang4fun/codex-kanban#readme) for setup and verification limits.

User data is stored outside the installed plugin, at $CODEX_HOME/kanban (default ~/.codex/kanban), or KANBAN_DATA_DIR. This distribution contains no task snapshots, connection settings or credentials. PR metadata lookups use the user's existing gh authentication and send repository/branch/commit identifiers to GitHub. Default New task links open Codex's native page without dispatching a model task. The retained app-only creation adapter can explicitly start a new task through the Desktop bridge; it is not called by these links.

This is a self-hosted GitHub marketplace, not an official directory listing. Successful CLI installation does not establish that all Desktop integrations work in every client version.
