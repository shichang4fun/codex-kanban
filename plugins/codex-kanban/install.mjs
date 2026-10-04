import {execFileSync} from 'node:child_process';
import {access,lstat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {homedir} from 'node:os';
import {join,isAbsolute,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';

// The official CLI owns plugin registration and cache paths. No config.toml editing.
export async function installKanban({app='/Applications/ChatGPT.app',home=process.env.CODEX_HOME||join(homedir(),'.codex'),
  marketplaceSource='shichang4fun/codex-kanban',ref='marketplace',launch=false,originalIcon=true,homeDir=homedir(),run=execFileSync}={}){
  if(!isAbsolute(app)||!isAbsolute(home))throw Error('Absolute app and CODEX_HOME paths are required.');
  const cli=join(app,'Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex');
  const nodePath=join(app,'Contents/Resources/cua_node/bin/node');
  for(const file of [cli,nodePath])await access(file,constants.X_OK);
  const options={env:{...process.env,CODEX_HOME:home},encoding:'utf8',stdio:['ignore','pipe','pipe']};
  const command=args=>JSON.parse(run(cli,['plugin',...args,'--json'],options));
  const market=command(['marketplace','add',marketplaceSource,...(ref?['--ref',ref]:[])]);
  if(market.marketplaceName!=='codex-kanban')throw Error('Unexpected marketplace name.');
  if(market.alreadyAdded&&!isAbsolute(marketplaceSource))command(['marketplace','upgrade','codex-kanban']);
  const plugin=command(['add','codex-kanban@codex-kanban']);
  if(plugin.pluginId!=='codex-kanban@codex-kanban'||typeof plugin.installedPath!=='string'||!isAbsolute(plugin.installedPath))
    throw Error('The CLI did not return the installed Kanban package.');
  const setup=await import(pathToFileURL(join(plugin.installedPath,'setup-desktop-bridge.mjs')));
  const root=join(home,'kanban-desktop');
  // A malformed existing installation must fail, rather than silently replace its CLI chain.
  const existing=await lstat(root).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  const previous=existing&&(await setup.readDesktopBridgeConfig(root));
  const config=await setup.installDesktopBridge({root,codexHome:home,app:previous?.app??app,
    nodePath:previous?.nodePath??nodePath,chainedCli:previous?.chainedCli,autoFlow:true,homeDir});
  let startup;
  if(originalIcon){
    const integration=await import(pathToFileURL(join(plugin.installedPath,'original-icon.mjs')));
    startup=await integration.installKanbanOriginalIcon({root,pluginPath:plugin.installedPath,pluginId:plugin.pluginId,homeDir},{run});
  }
  const launcher=join(root,'Launch Codex with Kanban.command');
  const result={version:plugin.version,pluginPath:plugin.installedPath,launcher,phase:'installed',startup};
  if(launch){
    Object.assign(result,await setup.launchDesktopBridge(config.root,{run}));
    if(result.phase==='restart-required'&&!originalIcon)run('/usr/bin/open',['-R',launcher],{stdio:'ignore'});
  }
  return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const {values}=parseArgs({options:{launch:{type:'boolean',default:false}}});
  try{
    console.log('Installing Codex Kanban and its Desktop bridge…');
    const result=await installKanban({launch:values.launch});
    console.log(`Codex Kanban ${result.version}: plugin and Desktop bridge installed.`);
    if(result.phase==='restart-required')console.log('Quit Codex normally, then reopen it using its original icon. Kanban and its integrated auto organize will be enabled automatically.');
    else if(result.phase==='launching')console.log('Codex is starting. Open a local chat, then open Codex Kanban in the sidebar.');
    else console.log('Open Codex using its original icon. No dedicated launcher is required.');
    console.log('No task ID or manual bridge configuration is required.');
  }catch(error){
    console.error(`Installation did not complete: ${error.message}`);
    if(error.stderr)console.error(String(error.stderr));
    process.exitCode=1;
  }
}
