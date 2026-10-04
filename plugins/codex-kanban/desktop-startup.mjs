import {readFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {privateDirectory,regular,selectedChain,forward} from './startup-runtime.mjs';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
async function main(){
  await privateDirectory(root);await regular(join(root,'connection.json'),{privateFile:true});
  const config=JSON.parse(await readFile(join(root,'connection.json'),'utf8'));
  if(config.root!==root||config.proxy!==join(root,'codex-proxy')||await readFile(join(root,'.owner'),'utf8')!=='codex-kanban-desktop-v1')throw Error('Invalid bridge installation');
  const chain=await selectedChain(config),args=process.argv.slice(2);let proxy;
  try{proxy=await import('./desktop-proxy.mjs');}
  catch{process.stderr.write('KANBAN_RUNTIME_UNAVAILABLE: using validated CLI chain\n');forward(chain,args,{...process.env,CODEX_CLI_PATH:chain});return;}
  process.env.KANBAN_REAL_CODEX=chain;process.env.KANBAN_BRIDGE_SOCKET=config.socketPath;
  await proxy.startDesktopProxy();
}
main().catch(()=>{process.stderr.write('KANBAN_STARTUP_FAILED\n');process.exitCode=1;});
