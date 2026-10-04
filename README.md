# Codex Kanban 0.4.54

Installable GitHub marketplace for the local Codex task board. This branch contains the built plugin; source and tests are on [main](https://github.com/shichang4fun/codex-kanban/tree/main).

## Install

Requires macOS and the current ChatGPT desktop app with Codex installed at /Applications/ChatGPT.app. The installer uses the app's bundled CLI and Node; no global CLI, separate Node installation or npm install is needed.

1. [Download the marketplace ZIP](https://github.com/shichang4fun/codex-kanban/archive/refs/heads/marketplace.zip) and extract it.
2. Double-click **Install Codex Kanban.command**. It installs or upgrades the plugin, Desktop bridge, integrated auto organization and original-icon integration together, preserving classification settings.
3. If Codex is running, quit it normally (⌘Q) and reopen its original icon. Open a local chat, then open Codex Kanban in the sidebar. Continue using the original Dock/Finder/Spotlight entry on later starts; no separate launcher is required.

If macOS blocks the downloaded script, right-click it and select Open, then follow the system prompt. Disable an existing codex-kanban@codex-kanban-local development copy before installing to avoid duplicate entries. No task ID, path configuration or config-file editing is needed. The installer never stops a running client.

This package includes the current Sidebar Flow Desktop classification engine; no separate Sidebar Flow installation is required. It excludes legacy Hooks, model heartbeats, instruction injection and old installers. Existing effective policies migrate to CODEX_HOME/kanban-desktop/flow.json without changing their scope, exclusions, interval or destination mapping. Previous installation files remain as backups, but the new chain does not run the standalone classifier. The board no longer exposes automatic-grouping settings. Existing classification policy remains effective; its enabled boolean is stored in the private flow.json. After changing that file, quit normally and reopen Codex. On startup or enable, open a local chat: missing In Progress, For Review and For Later groups are created automatically, and unique existing groups are reused. Duplicate names pause classification; resolve duplicate group names before continuing. Unconfirmed creates are journaled and never automatically replayed; check Codex and create a missing group manually if needed. Explicit migrated UUID mappings are preserved and must be repaired if their original groups are missing or renamed.

A single user LaunchAgent restores the original-icon CLI route at login. An existing Sidebar Flow agent is reused with its manifest/plist preserved and its helper backed up. The app bundle, signature and Dock icon are unchanged. The startup chain is Kanban (including auto organization) → official CLI, with one native child. An unavailable optional classification engine leaves manual features active; core pre-start failures use the official CLI without reactivating the old classifier or replaying started requests. The first normal restart and GUI login ordering still require live acceptance on your desktop.

To detach Kanban, run **Disable Kanban Original Icon.command** in ~/Library/Application Support/Codex Sidebar Flow Original Icon (or Codex Kanban Original Icon without Sidebar Flow). It restores the prior Sidebar Flow integration or removes Kanban's own agent. **Emergency Disable Original Icon.command** works without Node and disables the whole original-icon integration, preserving all files and data. Quit normally and reopen afterward. Re-running the installer restores the route; after an older Sidebar Flow updater overwrites its own helper, re-run the Kanban installer. Foreign or modified startup settings are preserved and reported.

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

Reload MCP configuration or restart the desktop app, then open Codex Kanban in the sidebar. If you already installed codex-kanban@codex-kanban-local, disable that copy before enabling this one to avoid duplicate entries.

## Update

```sh
codex plugin marketplace upgrade codex-kanban
codex plugin add codex-kanban@codex-kanban
```

## Capabilities and data

The plugin reads local Codex task metadata and provides a board, list, search and project controls. Explicit UI actions support renaming, archive/Undo and project assignment. Live status, pinning and group changes require the Desktop bridge, which the double-click installer configures automatically. The bridge activates after the client successfully loads a local chat. CLI-only installation does not configure the bridge. See the [source README](https://github.com/shichang4fun/codex-kanban#readme) for setup and verification limits.

User data is stored outside the installed plugin, at $CODEX_HOME/kanban (default ~/.codex/kanban), or KANBAN_DATA_DIR. This distribution contains no task snapshots, connection settings or credentials. PR metadata lookups use the user's existing gh authentication and send repository/branch/commit identifiers to GitHub. Default New task links open Codex's native page without dispatching a model task. The retained app-only creation adapter can explicitly start a new task through the Desktop bridge; it is not called by these links.

This is a self-hosted GitHub marketplace, not an official directory listing. Successful CLI installation does not establish that all Desktop integrations work in every client version.
