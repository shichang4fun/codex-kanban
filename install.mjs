import {execFileSync} from 'node:child_process';
import {access,lstat,writeFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {homedir} from 'node:os';
import {join,isAbsolute,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {readDesktopBridgeConfig} from './setup-desktop-bridge.mjs';
import {readFlowSettings} from './flow-config.mjs';
import {desktopBridgeRequest} from './bridge-transport.mjs';
import {quote} from './startup-runtime.mjs';

// Read-only checks: never launch the client, enable policies, or create groups.
export async function checkKanbanInstallation({app='/Applications/ChatGPT.app',home=process.env.CODEX_HOME||join(homedir(),'.codex'),
  run=execFileSync,request=desktopBridgeRequest}={}){
  if(!isAbsolute(app)||!isAbsolute(home))throw Error('Absolute app and CODEX_HOME paths are required.');
  const root=join(home,'kanban-desktop'),cli=join(app,'Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex');
  let identity={};
  const result=(phase,message,details={})=>({phase,message,...identity,...details,guiVerified:false});
  try{
    const catalog=JSON.parse(run(cli,['plugin','list','--json'],{env:{...process.env,CODEX_HOME:home},
      encoding:'utf8',timeout:10000,stdio:['ignore','pipe','pipe']}));
    if(!Array.isArray(catalog.installed))throw Error('The CLI returned an invalid plugin catalog.');
    const plugins=catalog.installed.filter(plugin=>plugin.name==='codex-kanban');
    if(!plugins.length)return result('needs-attention','Codex Kanban is not installed. Run the installer.');
    const enabled=plugins.filter(plugin=>plugin.enabled===true);
    if(enabled.length>1)return result('needs-attention','Multiple Kanban copies are enabled. Disable the development copy in Codex plugin settings.');
    if(!enabled.length)return result('needs-attention','Codex Kanban is disabled. Enable it in Codex plugin settings.');
    identity={pluginId:enabled[0].pluginId,version:enabled[0].version};
    const config=await readDesktopBridgeConfig(root),settings=readFlowSettings(root);
    if(config.codexHome!==home)return result('needs-attention','The bridge uses a different CODEX_HOME. Reinstall using the intended Codex home.');
    if(typeof identity.version!=='string'||config.pluginVersion!==identity.version)
      return result('needs-attention','Plugin and bridge configuration versions differ. Run the installer again.');
    let status;
    try{status=await request(config.socketPath,'status',{},3000);}
    catch(error){return result(error.status===503?'waiting-for-chat':'needs-attention',`${error.message} Open Codex using its original icon, then open a local chat. After an update, quit normally and reopen first.`);}
    if(status?.bridgeVersion!==identity.version)
      return result('restart-required','The running bridge is an older version. Quit Codex normally and reopen its original icon.');
    if(status.connected!==true)return result('waiting-for-chat','Open a persistent local chat in Codex to connect the bridge.');
    if(status.groupActions!==true||status.runtimeAvailable!==true)
      return result('needs-attention','The connected bridge is missing task capabilities. Reinstall, then restart Codex.');
    if(!settings.enabled)return result('ready','Desktop bridge ready; automatic grouping remains disabled. Open the sidebar board to verify the UI.',{autoOrganize:'disabled'});
    if(status.autoFlow?.available!==true||status.autoFlow.enabled!==true)
      return result('needs-attention','Automatic grouping is configured but its runtime is unavailable. Reinstall, then restart Codex.');
    const initialization=status.autoFlow.initialization;
    if(initialization?.state==='error')return result('needs-attention',initialization.message||'Workflow groups could not be initialized. Check group names and saved mappings.');
    if(initialization?.state!=='ready')return result('waiting-for-groups',initialization?.message||'Workflow groups are initializing. Open a local chat and check again.');
    return result('ready','Desktop bridge and workflow groups ready. Open Codex Kanban in the sidebar to verify the UI.',{autoOrganize:'enabled'});
  }catch(error){return result('needs-attention',`Installation could not be verified: ${error.message}`);}
}

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
  const checker=join(root,'Check Codex Kanban.command');
  await writeFile(checker,'#!/bin/sh\n# codex-kanban-installation-check-v1\n'+
    `export CODEX_HOME=${quote(home)}\n${quote(nodePath)} ${quote(join(plugin.installedPath,'install.mjs'))} --check "$@"\n`+
    'KANBAN_CHECK_STATUS=$?\nif [ -t 0 ]; then printf "\\nPress Return to close this window. "; read -r KANBAN_CHECK_REPLY; fi\nexit "$KANBAN_CHECK_STATUS"\n',{mode:0o700});
  const result={version:plugin.version,pluginPath:plugin.installedPath,launcher,checker,phase:'installed',startup};
  if(launch){
    Object.assign(result,await setup.launchDesktopBridge(config.root,{run}));
    if(result.phase==='restart-required'&&!originalIcon)run('/usr/bin/open',['-R',launcher],{stdio:'ignore'});
  }
  result.verification=await checkKanbanInstallation({app:config.app,home,run});
  const needsRestart=result.phase==='restart-required'||(result.phase==='installed'&&startup?.restartRequired===true);
  if(needsRestart&&result.verification.phase==='ready')
    result.verification={...result.verification,phase:'restart-required',message:'Installation updated the startup route. Quit Codex normally and reopen its original icon.'};
  return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const {values}=parseArgs({options:{launch:{type:'boolean',default:false},check:{type:'boolean',default:false},json:{type:'boolean',default:false}}});
  try{
    if(values.check&&values.launch)throw Error('--check is read-only and cannot be combined with --launch.');
    if(!values.check&&!values.json)console.log('Installing Codex Kanban and its Desktop bridge…');
    const installed=values.check?null:await installKanban({launch:values.launch});
    const verification=installed?.verification??await checkKanbanInstallation();
    if(values.json)console.log(JSON.stringify(installed?{...installed,verification}:verification,null,2));
    else{
      if(installed)console.log(`Codex Kanban ${installed.version}: plugin and Desktop bridge installed.`);
      console.log(`Status: ${verification.phase}\n${verification.message}`);
      if(installed)console.log(`After restarting, double-click ${installed.checker} to check again.`);
    }
    if(values.check&&verification.phase!=='ready')process.exitCode=verification.phase==='needs-attention'?1:2;
  }catch(error){
    console.error(`Installation did not complete: ${error.message}`);
    if(error.stderr)console.error(String(error.stderr));
    process.exitCode=1;
  }
}
