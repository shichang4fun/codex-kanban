import {readFile,writeFile,mkdir,lstat,copyFile,chmod,readdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {homedir} from 'node:os';
import {dirname,join,isAbsolute,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {fallbackShell} from './startup-runtime.mjs';
import {installFlowSettings,prepareFlowSettings} from './flow-config.mjs';

const source=dirname(fileURLToPath(import.meta.url));
const defaultRoot=join(process.env.CODEX_HOME||join(homedir(),'.codex'),'kanban-desktop');
const appPath='/Applications/ChatGPT.app';
const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
const files=['desktop-startup.mjs','startup-runtime.mjs','desktop-proxy.mjs','desktop-archive.mjs','desktop-groups.mjs','desktop-runtime.mjs','desktop-creation.mjs','creation-store.mjs','creation-options.mjs','build.mjs','local-board.mjs','bridge-transport.mjs','archive.mjs','rename.mjs','move.mjs','pin.mjs','local-read.mjs','flow-config.mjs','flow-runtime.mjs','flow-initialization.mjs'];
export async function installDesktopBridge({root=defaultRoot,app=appPath,chainedCli,nodePath,
  autoFlow=false,legacyFlowRoot,homeDir=homedir(),codexHome=process.env.CODEX_HOME||join(homedir(),'.codex')}={}){
  if(!isAbsolute(root)||Buffer.byteLength(join(root,'desktop.sock'))>100)throw Error('A short, absolute installation directory is required.');
  if(!isAbsolute(app))throw Error('An absolute Codex app path is required.');
  if(!isAbsolute(codexHome))throw Error('An absolute CODEX_HOME is required.');
  nodePath??=join(app,'Contents/Resources/cua_node/bin/node');
  const native=join(app,'Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex');
  if(!chainedCli){
    const sidebar=join(homeDir,'Applications','Codex Sidebar Flow','codex-proxy');
    const s=await lstat(sidebar).catch(()=>null);
    chainedCli=s?.isFile()&&!s.isSymbolicLink()&&s.uid===process.getuid()&&(await readFile(sidebar,'utf8')).includes('SIDEBAR_FLOW_REAL_CODEX=')?sidebar:native;
  }
  for(const path of [nodePath,chainedCli]){
    if(!isAbsolute(path))throw Error('Absolute runtime paths are required.');
    const s=await lstat(path);if(!s.isFile()||!(s.mode&0o111))throw Error('The selected runtime is not executable.');
  }
  if(autoFlow){
    if(!legacyFlowRoot&&chainedCli!==native){
      const candidate=dirname(chainedCli);
      if(await readFile(join(candidate,'.owner'),'utf8').catch(()=>null)==='codex-sidebar-flow-desktop-v1')legacyFlowRoot=candidate;
      else throw Error('Cannot replace an unknown CLI chain with integrated auto organize.');
    }
    // Validate all policy data before claiming a fresh installation directory.
    prepareFlowSettings(root,{legacyRoot:legacyFlowRoot});
  }
  await mkdir(root,{recursive:true,mode:0o700});const s=await lstat(root);
  if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==process.getuid()||(s.mode&0o077)!==0)throw Error('Private installation directory required.');
  const ownerPath=join(root,'.owner'),owner=await readFile(ownerPath,'utf8').catch(()=>null);
  if(owner!==null&&owner!=='codex-kanban-desktop-v1')throw Error('This directory belongs to another installation.');
  if(owner===null&&(await readdir(root)).length)throw Error('Use an empty installation directory.');
  await writeFile(ownerPath,'codex-kanban-desktop-v1',{mode:0o600});
  if(autoFlow){
    await installFlowSettings(root,{legacyRoot:legacyFlowRoot});
    chainedCli=native;
  }
  const runtime=join(root,'runtime');await mkdir(runtime,{recursive:true,mode:0o700});
  for(const file of files){await copyFile(join(source,file),join(runtime,file));await chmod(join(runtime,file),0o600);}
  await mkdir(join(runtime,'flow'),{recursive:true,mode:0o700});
  for(const file of await readdir(join(source,'flow'))){
    if(!file.endsWith('.mjs'))continue;
    await copyFile(join(source,'flow',file),join(runtime,'flow',file));await chmod(join(runtime,'flow',file),0o600);
  }
  const config={version:1,root,app,nodePath,chainedCli,codexHome,...(autoFlow?{autoFlow:true}:{}),socketPath:join(root,'desktop.sock'),proxy:join(root,'codex-proxy')};
  await writeFile(join(root,'connection.json'),JSON.stringify(config,null,2)+'\n',{mode:0o600});
  await writeFile(config.proxy,'#!/bin/sh\n# codex-kanban-desktop-v1\n'+
    `export CODEX_HOME=${quote(codexHome)}\n`+
    `# Selected chain: ${quote(chainedCli)}\n`+
    `if [ -x ${quote(nodePath)} ] && [ -r ${quote(join(runtime,'desktop-startup.mjs'))} ] && [ -r ${quote(join(runtime,'startup-runtime.mjs'))} ]; then exec ${quote(nodePath)} ${quote(join(runtime,'desktop-startup.mjs'))} "$@"; fi\n`+
    fallbackShell(app),{mode:0o700});
  await copyFile(join(source,'setup-desktop-bridge.mjs'),join(root,'setup-desktop-bridge.mjs'));
  await copyFile(join(source,'startup-runtime.mjs'),join(root,'startup-runtime.mjs'));
  await copyFile(join(source,'flow-config.mjs'),join(root,'flow-config.mjs'));
  await mkdir(join(root,'flow'),{recursive:true,mode:0o700});
  await copyFile(join(source,'flow','desktop-proxy-config.mjs'),join(root,'flow','desktop-proxy-config.mjs'));
  await writeFile(join(root,'Launch Codex with Kanban.command'),'#!/bin/sh\n'+
    `export CODEX_HOME=${quote(codexHome)}\n`+
    `exec ${quote(nodePath)} ${quote(join(root,'setup-desktop-bridge.mjs'))} --root ${quote(root)} --launch\n`,{mode:0o700});
  return config;
}
export async function readDesktopBridgeConfig(root=defaultRoot){
  const s=await lstat(root);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==process.getuid()||(s.mode&0o077)!==0)throw Error('Invalid installation directory.');
  if(await readFile(join(root,'.owner'),'utf8')!=='codex-kanban-desktop-v1')throw Error('Unknown installation.');
  const file=await lstat(join(root,'connection.json'));
  if(!file.isFile()||file.isSymbolicLink()||file.uid!==process.getuid()||(file.mode&0o077)!==0)throw Error('Private connection settings required.');
  const config=JSON.parse(await readFile(join(root,'connection.json'),'utf8'));
  if(config.version!==1||config.root!==root||config.proxy!==join(root,'codex-proxy')||config.socketPath!==join(root,'desktop.sock')||!isAbsolute(config.app))throw Error('Invalid installation settings.');
  if(config.codexHome!==undefined&&(typeof config.codexHome!=='string'||!isAbsolute(config.codexHome)))throw Error('Invalid CODEX_HOME setting.');
  return config;
}
export async function launchDesktopBridge(root=defaultRoot,{run=execFileSync}={}){
  const config=await readDesktopBridgeConfig(root);
  const processes=run('/bin/ps',['-axo','args='],{encoding:'utf8'}).trim().split('\n');
  if(processes.some(p=>p.trim().startsWith(join(config.app,'Contents/MacOS/'))))
    return {phase:'restart-required',message:'Quit Codex normally, then run this launcher again. No process was stopped.'};
  run('/usr/bin/open',['--env',`CODEX_CLI_PATH=${config.proxy}`,'--env',
    `CODEX_HOME=${config.codexHome??process.env.CODEX_HOME??join(homedir(),'.codex')}`,'-a',config.app],{stdio:'ignore'});
  return {phase:'launching',message:'Codex is starting with the Kanban desktop bridge.'};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const {values}=parseArgs({options:{root:{type:'string'},context:{type:'string'},launch:{type:'boolean',default:false}}});
  // Accept the old --context flag for existing launch scripts; context is now learned from Desktop.
  const result=values.launch?await launchDesktopBridge(values.root):await installDesktopBridge({root:values.root});
  console.log(JSON.stringify(result));
}
