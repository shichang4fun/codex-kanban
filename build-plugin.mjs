import {build} from 'esbuild';
import {mkdir,readFile,writeFile,copyFile,chmod,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname,join,resolve} from 'node:path';

const root=dirname(fileURLToPath(import.meta.url));
export async function buildPlugin(){
  const [{outputFiles},template]=await Promise.all([
    build({entryPoints:[join(root,'mcp-ui.mjs')],bundle:true,write:false,minify:true,format:'iife',platform:'browser',target:'es2022'}),
    readFile(join(root,'ui.html'),'utf8')
  ]);
  const script=outputFiles[0].text.replaceAll('</script','<\\/script');
  const html=template.replace('<script>',()=>`<script>${script}</script>\n<script>`);
  await mkdir(join(root,'dist'),{recursive:true});
  await writeFile(join(root,'dist','kanban-ui.html'),html);
  const plugin=join(root,'dist','plugin');
  await rm(plugin,{recursive:true,force:true});
  await mkdir(join(plugin,'dist'),{recursive:true});
  await mkdir(join(plugin,'assets'),{recursive:true});
  await mkdir(join(plugin,'skills','codex-kanban'),{recursive:true});
  await build({entryPoints:[join(root,'mcp-sdk.mjs')],outfile:join(plugin,'mcp-sdk.mjs'),bundle:true,
    minify:true,format:'esm',platform:'node',target:'node22',
    banner:{js:'import {createRequire} from "node:module"; const require=createRequire(import.meta.url);'}});
  const files=['mcp-server.mjs','kanban-service.mjs','local-read.mjs','local-board.mjs','build.mjs',
    'desktop-unread.mjs','desktop-runtime.mjs','desktop-proxy.mjs','desktop-archive.mjs','desktop-groups.mjs',
    'git-status.mjs','archive.mjs','pin.mjs','move.mjs','bridge-transport.mjs','setup-desktop-bridge.mjs',
    'plugin.json','mcp.json','launch-mcp','assets/kanban-icon.png','assets/kanban-icon-dark.png'];
  await Promise.all(files.map(file=>copyFile(join(root,file),join(plugin,file))));
  await chmod(join(plugin,'launch-mcp'),0o755);
  await copyFile(join(root,'skills','codex-kanban','SKILL.md'),join(plugin,'skills','codex-kanban','SKILL.md'));
  await writeFile(join(plugin,'dist','kanban-ui.html'),html);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await buildPlugin();
