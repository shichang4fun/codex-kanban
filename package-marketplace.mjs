import {cp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildPlugin} from './build-plugin.mjs';

const root=dirname(fileURLToPath(import.meta.url));
// buildPlugin copies an explicit file list; user data and local settings never enter this tree.
export async function packageMarketplace(){
  await buildPlugin();
  const output=join(root,'dist','marketplace');
  await rm(output,{recursive:true,force:true});
  await mkdir(join(output,'.agents','plugins'),{recursive:true});
  await cp(join(root,'dist','plugin'),join(output,'plugins','codex-kanban'),{recursive:true});
  const manifest=JSON.parse(await readFile(join(root,'plugin.json'),'utf8'));
  const marketplace={name:'codex-kanban',interface:{displayName:'Codex Kanban'},plugins:[{
    name:'codex-kanban',source:{source:'local',path:'./plugins/codex-kanban'},
    policy:{installation:'AVAILABLE',authentication:'ON_INSTALL'},category:'Productivity'
  }]};
  await writeFile(join(output,'.agents','plugins','marketplace.json'),JSON.stringify(marketplace,null,2)+'\n');
  await writeFile(join(output,'README.md'),`# Codex Kanban ${manifest.version}

Installable GitHub marketplace for the local Codex task board. This branch contains the built plugin; source and tests are on [main](https://github.com/shichang4fun/codex-kanban/tree/main).

## Install

Requires macOS, the current ChatGPT desktop app with Codex installed at /Applications/ChatGPT.app, and Node.js 22 or newer. The plugin can use the app's bundled Node when a compatible Node is not on PATH. Runtime dependencies are bundled; no npm install is needed.

\`\`\`sh
codex plugin marketplace add shichang4fun/codex-kanban --ref marketplace
codex plugin add codex-kanban@codex-kanban
\`\`\`

If your global Codex CLI is unavailable, use the desktop app's bundled executable for both commands:

\`\`\`sh
CODEX_CLI='/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex'
"$CODEX_CLI" plugin marketplace add shichang4fun/codex-kanban --ref marketplace
"$CODEX_CLI" plugin add codex-kanban@codex-kanban
\`\`\`

Reload MCP configuration or restart the desktop app, then open Codex 看板 in the sidebar. If you already installed codex-kanban@codex-kanban-local, disable that copy before enabling this one to avoid duplicate entries.

## Update

\`\`\`sh
codex plugin marketplace upgrade codex-kanban
codex plugin add codex-kanban@codex-kanban
\`\`\`

## Capabilities and data

The plugin reads local Codex task metadata and provides a board, list, search and project controls. Explicit UI actions support archive/Undo and project assignment. Live status, pinning and group changes require the separately configured Desktop bridge; without it, those controls remain unavailable. Installation does not configure or grant access to that bridge. See the [source README](https://github.com/shichang4fun/codex-kanban#readme) for setup and verification limits.

User data is stored outside the installed plugin, at $CODEX_HOME/kanban (default ~/.codex/kanban), or KANBAN_DATA_DIR. This distribution contains no task snapshots, connection settings or credentials. PR metadata lookups use the user's existing gh authentication and send repository/branch/commit identifiers to GitHub. No model tasks are started by the board.

This is a self-hosted GitHub marketplace, not an official directory listing. Successful CLI installation does not establish that all Desktop integrations work in every client version.
`);
  return {output,marketplace:marketplace.name,version:manifest.version};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await packageMarketplace(),null,2));
