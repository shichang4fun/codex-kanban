// Kanban's optional routing hook for a single, user-owned original-icon LaunchAgent.
// The legacy Sidebar Flow helper/state/plist remain compatible; no signed app is changed.
import {execFileSync} from 'node:child_process';
import {lstat,mkdir,readFile,writeFile,rename,unlink} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {homedir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {validPath,regular,privateDirectory,nativeCli,preflight,selectedChain,sidebarCli,pluginActive,forward,quote,fallbackShell} from './startup-runtime.mjs';

const OWNER='codex-kanban-original-icon-v1',LEGACY='codex-sidebar-flow-original-icon-v1';
const source=fileURLToPath(import.meta.url),hash=text=>createHash('sha256').update(text).digest('hex');
const run=(bin,args)=>execFileSync(bin,args,{encoding:'utf8',timeout:10000,stdio:['ignore','pipe','pipe']}).trim();
const systemFor=deps=>({platform:process.platform,uid:process.getuid(),...deps,
  run:(bin,args)=>String((deps.run??run)(bin,args,{encoding:'utf8',timeout:10000,stdio:['ignore','pipe','pipe']})).trim()});
const xml=text=>text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const stat=file=>lstat(file).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
async function atomic(file,text,mode=0o600){
  if(await stat(file))await regular(file,{privateFile:true});
  const temp=file+'.'+randomUUID()+'.tmp';
  try{await writeFile(temp,text,{flag:'wx',mode});await rename(temp,file);}finally{await unlink(temp).catch(()=>{});}
}
function context(support,legacy,system){
  const home=resolve(support,'../../..'),label=legacy?'io.github.codex-sidebar-flow.original-icon':'io.github.codex-kanban.original-icon';
  return {support,legacy,label,system,shim:join(support,'codex-original-icon'),helper:join(support,legacy?'original-icon.mjs':'kanban-original-icon.mjs'),
    module:join(support,'kanban-original-icon.mjs'),core:join(support,'startup-runtime.mjs'),route:join(support,'kanban-route.json'),
    plist:join(home,'Library/LaunchAgents',label+'.plist'),job:`gui/${system.uid}/${label}`,domain:`gui/${system.uid}`,home};
}
async function userParents(home,target){
  if(!validPath(home)||!target.startsWith(home+'/'))throw Error('Invalid user integration location');
  let dir=home;
  for(const part of ['',...target.slice(home.length+1).split('/')]){
    dir=join(dir,part);const s=await stat(dir);
    if(s&&(!s.isDirectory()||s.isSymbolicLink()||s.uid!==process.getuid()))throw Error('Unsafe integration parent');
    if(!s)await mkdir(dir,{mode:0o700});
  }
}
function expectedPlist(c,route){
  const args=c.legacy?[route.agentNode,c.helper,'--refresh','--home',c.home]:[route.agentNode,c.helper,'--refresh','--support',c.support];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict>
<key>Label</key><string>${c.label}</string>
<key>ProgramArguments</key><array>${args.map(arg=>`<string>${xml(arg)}</string>`).join('')}</array>
<key>RunAtLoad</key><true/><key>LimitLoadToSessionType</key><string>Aqua</string>
</dict></plist>\n`;
}
async function checkAgent(c,route){
  if(await stat(c.plist)&&await readFile(c.plist,'utf8')!==expectedPlist(c,route))throw Error('Modified LaunchAgent; left unchanged');
  let text;try{text=c.system.run('/bin/launchctl',['print',c.job]);}catch{return false;}
  const args=text.match(/^\targuments = \{\n([\s\S]*?)^\t\}/m)?.[1].split('\n').filter(Boolean).map(line=>line.replace(/^\t\t/,''));
  const expected=c.legacy?[route.agentNode,c.helper,'--refresh','--home',c.home]:[route.agentNode,c.helper,'--refresh','--support',c.support];
  if(text.match(/^\tpath = (.*)$/m)?.[1]!==c.plist||text.match(/^\tprogram = (.*)$/m)?.[1]!==route.agentNode
    ||JSON.stringify(args)!==JSON.stringify(expected))throw Error('Foreign registered LaunchAgent; left unchanged');
  return true;
}
async function readRoute(support){
  await privateDirectory(support);await regular(join(support,'kanban-route.json'),{privateFile:true});
  const route=JSON.parse(await readFile(join(support,'kanban-route.json'),'utf8'));
  if(route.owner!==OWNER||![route.root,route.app,route.nodePath,route.agentNode,route.codexHome,route.pluginPath].every(validPath)
    ||typeof route.pluginId!=='string'||!/^[\w-]+@[\w-]+$/.test(route.pluginId))throw Error('Invalid Kanban startup route');
  return route;
}
function shim(c,route){
  const check=`import {preflight} from ${JSON.stringify(pathToFileURL(c.core).href)}; await preflight(${JSON.stringify(route.nodePath)},${JSON.stringify(c.module)});`;
  return `#!/bin/sh\n# ${OWNER}\nexport CODEX_HOME=${quote(route.codexHome)}\n`+
    `if [ -x ${quote(route.nodePath)} ] && [ -r ${quote(c.module)} ] && [ -r ${quote(c.core)} ] && ${quote(route.nodePath)} --input-type=module --eval ${quote(check)} >/dev/null 2>&1; then exec ${quote(route.nodePath)} ${quote(c.module)} --dispatch ${quote(c.support)} --app ${quote(route.app)} -- "$@"; fi\n`+
    fallbackShell(route.app);
}
// This recovery path must remain usable even if Node or the routing files are broken.
// It disables the whole original-icon integration, preserving its files for reinstall.
export function emergencyDisableScript({support,legacy,label,uid,agentNode,helper,plist,shim,home},launchctl='/bin/launchctl'){
  const c={support,legacy,label,system:{uid},helper,plist,shim,home};
  const route={agentNode};
  const args=legacy?[agentNode,helper,'--refresh','--home',home]:[agentNode,helper,'--refresh','--support',support];
  const signature=[plist,agentNode,...args].join('\n');
  const plistHash=hash(expectedPlist(c,route));
  return `#!/bin/sh
set -eu
TASK_SUPPORT=${quote(support)}
TASK_PLIST=${quote(plist)}
TASK_SHIM=${quote(shim)}
TASK_JOB=${quote(`gui/${uid}/${label}`)}
TASK_LAUNCHCTL=${quote(launchctl)}
fail() { echo 'Original-icon integration changed; emergency disable left it unchanged.' >&2; exit 1; }
[ ! -L "$TASK_SUPPORT" ] && [ -d "$TASK_SUPPORT" ] || fail
[ "$(/usr/bin/stat -f '%u:%Lp' "$TASK_SUPPORT")" = ${quote(uid+':700')} ] || fail
[ ! -L "$TASK_SUPPORT/.owner" ] && [ "$(/bin/cat "$TASK_SUPPORT/.owner")" = ${quote(legacy?LEGACY:OWNER)} ] || fail
if [ -e "$TASK_PLIST" ] || [ -L "$TASK_PLIST" ]; then
  [ -f "$TASK_PLIST" ] && [ ! -L "$TASK_PLIST" ] || fail
  [ "$(/usr/bin/shasum -a 256 "$TASK_PLIST" | /usr/bin/awk '{print $1}')" = ${quote(plistHash)} ] || fail
fi
if [ -e "$TASK_PLIST.disabled" ] || [ -L "$TASK_PLIST.disabled" ]; then
  [ -f "$TASK_PLIST.disabled" ] && [ ! -L "$TASK_PLIST.disabled" ] || fail
  [ "$(/usr/bin/shasum -a 256 "$TASK_PLIST.disabled" | /usr/bin/awk '{print $1}')" = ${quote(plistHash)} ] || fail
fi
if TASK_JOB_TEXT="$("$TASK_LAUNCHCTL" print "$TASK_JOB" 2>/dev/null)"; then
  TASK_SIGNATURE="$(printf '%s\\n' "$TASK_JOB_TEXT" | /usr/bin/awk '
    /^\\tpath = / {sub(/^\\tpath = /, ""); print}
    /^\\tprogram = / {sub(/^\\tprogram = /, ""); print}
    /^\\targuments = \\{/ {args=1; next}
    args && /^\\t\\}/ {args=0; next}
    args && /^\\t\\t/ {sub(/^\\t\\t/, ""); print}')"
  [ "$TASK_SIGNATURE" = ${quote(signature)} ] || fail
  "$TASK_LAUNCHCTL" bootout "$TASK_JOB"
fi
if [ -f "$TASK_PLIST" ]; then /bin/mv "$TASK_PLIST" "$TASK_PLIST.disabled"; fi
if [ "$("$TASK_LAUNCHCTL" getenv CODEX_CLI_PATH)" = "$TASK_SHIM" ]; then "$TASK_LAUNCHCTL" unsetenv CODEX_CLI_PATH; fi
echo 'Original-icon automatic integration disabled. Quit Codex normally and reopen its original icon. No plugin data was removed.'
`;
}
export async function routeOriginalIconShim({support,baseShim}){
  if(!await stat(join(support,'kanban-route.json')))return baseShim;
  const route=await readRoute(support);
  return shim(context(support,route.legacy,{uid:process.getuid()}),route);
}
function patchLegacy(helper){
  if(helper.includes('// '+OWNER+' hook'))return helper;
  for(const anchor of ['export async function refreshOriginalIcon','  await regular(c.shim);','  await atomic(c.shim, shim, 0o700);'])
    if(helper.split(anchor).length!==2)throw Error('Unrecognized Sidebar Flow helper; refusing to patch');
  const hook=`// ${OWNER} hook\nasync function kanbanOriginalShim(c, baseShim) {
  const file = path.join(c.support, 'kanban-original-icon.mjs');
  const s = await stat(file);
  if (!s?.isFile() || s.uid !== process.getuid() || (s.mode & 0o077)) throw Error('Unsafe Kanban routing helper');
  const module = await import(file);
  return module.routeOriginalIconShim({support: c.support, baseShim});
}\n\n`;
  return helper.replace('export async function refreshOriginalIcon',hook+'export async function refreshOriginalIcon')
    .replace('  await regular(c.shim);',`  await regular(c.shim);
  if (await stat(path.join(c.support, 'kanban-route.json'))) await atomic(c.shim, await kanbanOriginalShim(c, await regular(c.shim)), 0o700);`)
    .replace('  await atomic(c.shim, shim, 0o700);','  await atomic(c.shim, await kanbanOriginalShim(c, shim), 0o700);');
}
export async function installKanbanOriginalIcon({root,pluginPath,pluginId,homeDir=homedir()}={},deps={}){
  const system=systemFor(deps);
  if(system.platform!=='darwin'||system.uid===0||!validPath(homeDir))throw Error('Original-icon integration requires a macOS GUI user');
  await privateDirectory(root);await regular(join(root,'connection.json'),{privateFile:true});
  const config=JSON.parse(await readFile(join(root,'connection.json'),'utf8'));
  if(await readFile(join(root,'.owner'),'utf8')!=='codex-kanban-desktop-v1'||config.root!==root||!validPath(pluginPath)
    ||!(/^[\w-]+@[\w-]+$/.test(pluginId)))throw Error('Invalid Kanban installation');
  await nativeCli(config.app);
  const legacySupport=join(homeDir,'Library/Application Support/Codex Sidebar Flow Original Icon');
  const ownSupport=join(homeDir,'Library/Application Support/Codex Kanban Original Icon');
  const hasLegacy=!!(await stat(legacySupport)),hasOwn=!!(await stat(ownSupport));
  // launchd can retain a job after its support directory disappears. Check both labels.
  for(const [support,label,selected] of [[legacySupport,'io.github.codex-sidebar-flow.original-icon',hasLegacy],
    [ownSupport,'io.github.codex-kanban.original-icon',!hasLegacy]]){
    if(selected)continue;
    let registered=false;try{system.run('/bin/launchctl',['print',`gui/${system.uid}/${label}`]);registered=true;}catch{}
    if(registered||await stat(join(homeDir,'Library/LaunchAgents',label+'.plist')))throw Error('Another original-icon LaunchAgent exists; left unchanged');
  }
  if(hasLegacy&&hasOwn&&await stat(join(ownSupport,'kanban-route.json')))throw Error('Two original-icon installations found; inspect before changing');
  const c=context(hasLegacy?legacySupport:ownSupport,hasLegacy,system);
  let legacyState;
  if(hasLegacy){
    await privateDirectory(c.support);await regular(join(c.support,'installation.json'),{privateFile:true});
    legacyState=JSON.parse(await readFile(join(c.support,'installation.json'),'utf8'));
    if(await readFile(join(c.support,'.owner'),'utf8')!==LEGACY||legacyState.owner!==LEGACY||![legacyState.root,legacyState.nodePath,legacyState.realCodex].every(validPath))throw Error('Invalid Sidebar Flow integration');
    if(!await stat(c.plist)&&!await stat(c.route))throw Error('Sidebar Flow original-icon integration is disabled; left unchanged');
  }else if(hasOwn){await privateDirectory(c.support);if(await readFile(join(c.support,'.owner'),'utf8')!==OWNER)throw Error('Unowned integration directory');}
  const previous=await stat(c.route)?await readRoute(c.support):null;
  const route={owner:OWNER,root,pluginPath,pluginId,app:config.app,nodePath:config.nodePath,codexHome:config.codexHome,
    legacy:hasLegacy,agentNode:legacyState?.nodePath??config.nodePath,sidebarRoot:legacyState?.root??join(homeDir,'Applications/Codex Sidebar Flow')};
  if(![route.nodePath,route.agentNode,route.codexHome].every(validPath))throw Error('Invalid startup paths');
  if(config.chainedCli===c.shim||config.chainedCli===config.proxy||config.chainedCli===c.module)throw Error('Proxy cycle refused');
  const current=system.run('/bin/launchctl',['getenv','CODEX_CLI_PATH']);
  if(current&&current!==c.shim)throw Error('Conflicting CODEX_CLI_PATH; left unchanged');
  const loaded=await checkAgent(c,route);
  if(!await stat(c.plist)&&await stat(c.plist+'.disabled')&&await readFile(c.plist+'.disabled','utf8')!==expectedPlist(c,route))
    throw Error('Modified disabled LaunchAgent; left unchanged');
  await userParents(homeDir,dirname(c.support));await userParents(homeDir,dirname(c.plist));
  if(!await stat(c.support)){await mkdir(c.support,{mode:0o700});await atomic(join(c.support,'.owner'),OWNER);}
  const originals=new Map();
  const paths=[c.helper,c.shim,c.module,c.core,c.route,c.plist,join(c.support,'Disable Kanban Original Icon.command'),join(c.support,'Emergency Disable Original Icon.command'),join(c.support,'kanban-helper.before'),join(c.support,'kanban-shim.before')];
  for(const file of new Set(paths)){
    const s=await stat(file);if(s){await regular(file,{privateFile:true});originals.set(file,{text:await readFile(file,'utf8'),mode:s.mode&0o777});}else originals.set(file,null);
  }
  if(previous){
    const unchanged=(!originals.get(c.helper)&&!hasLegacy||hash(originals.get(c.helper)?.text??'')===previous.helperHash)
      &&(!originals.get(c.shim)||hash(originals.get(c.shim).text)===previous.shimHash);
    const legacyReinstalled=hasLegacy&&hash(originals.get(c.helper).text)===previous.beforeHelperHash
      &&hash(originals.get(c.shim).text)===previous.beforeShimHash;
    if(!unchanged&&!legacyReinstalled)throw Error('Original-icon files changed after Kanban install; preserved for inspection');
    for(const [file,expected] of [[c.module,previous.moduleHash],[c.core,previous.coreHash],
      [join(c.support,'Disable Kanban Original Icon.command'),previous.disableHash],
      [join(c.support,'Emergency Disable Original Icon.command'),previous.emergencyHash]]){
      const value=originals.get(file);
      if(value&&hash(value.text)!==expected)throw Error('Modified integration files; preserved for inspection');
    }
  }else if(hasLegacy){
    for(const [backup,original] of [[join(c.support,'kanban-helper.before'),c.helper],[join(c.support,'kanban-shim.before'),c.shim]]){
      const value=originals.get(backup);
      if(value&&value.text!==originals.get(original).text)throw Error('Modified integration backup; preserved');
    }
  }
  let bootstrapped=false;
  try{
    const moduleText=await readFile(source,'utf8'),coreText=await readFile(new URL('./startup-runtime.mjs',import.meta.url),'utf8');
    if(hasLegacy&&!previous){
      await atomic(join(c.support,'kanban-helper.before'),originals.get(c.helper).text);
      await atomic(join(c.support,'kanban-shim.before'),originals.get(c.shim).text,0o700);
      route.beforeHelperHash=hash(originals.get(c.helper).text);route.beforeShimHash=hash(originals.get(c.shim).text);
    }else if(previous){route.beforeHelperHash=previous.beforeHelperHash;route.beforeShimHash=previous.beforeShimHash;}
    const helperText=hasLegacy?patchLegacy(originals.get(c.helper).text):moduleText;
    const shimText=shim(c,route);
    const disableText=`#!/bin/sh\nexec ${quote(route.nodePath)} ${quote(c.module)} --disable --support ${quote(c.support)}\n`;
    const emergencyText=emergencyDisableScript({...c,uid:system.uid,agentNode:route.agentNode});
    route.helperHash=hash(helperText);route.shimHash=hash(shimText);route.moduleHash=hash(moduleText);route.coreHash=hash(coreText);
    route.disableHash=hash(disableText);route.emergencyHash=hash(emergencyText);
    await atomic(c.module,moduleText);await atomic(c.core,coreText);
    if(hasLegacy)await atomic(c.helper,helperText);
    await atomic(c.shim,shimText,0o700);
    await atomic(join(c.support,'Disable Kanban Original Icon.command'),disableText,0o700);
    await atomic(join(c.support,'Emergency Disable Original Icon.command'),emergencyText,0o700);
    await atomic(c.route,JSON.stringify(route,null,2)+'\n');
    if(!hasLegacy||!await stat(c.plist))await atomic(c.plist,expectedPlist(c,route));
    if(!loaded){system.run('/bin/launchctl',['bootstrap',c.domain,c.plist]);bootstrapped=true;}
    system.run('/bin/launchctl',['setenv','CODEX_CLI_PATH',c.shim]);
    return {enabled:true,adoptedSidebarFlow:hasLegacy,shim:c.shim,support:c.support,plist:c.plist,restartRequired:true,lifecycleVerified:false};
  }catch(error){
    if(bootstrapped)system.run('/bin/launchctl',['bootout',c.job]);
    for(const [file,value] of originals)if(value)await atomic(file,value.text,value.mode);else await unlink(file).catch(()=>{});
    if(system.run('/bin/launchctl',['getenv','CODEX_CLI_PATH'])===c.shim&&!current)system.run('/bin/launchctl',['unsetenv','CODEX_CLI_PATH']);
    throw error;
  }
}
export async function refreshKanbanOriginalIcon({support},deps={}){
  const system=systemFor(deps),route=await readRoute(support),c=context(support,route.legacy,system);
  if(!await stat(c.plist))throw Error('Original-icon integration is disabled');
  await checkAgent(c,route);
  const current=system.run('/bin/launchctl',['getenv','CODEX_CLI_PATH']);
  if(current&&current!==c.shim)throw Error('Conflicting CODEX_CLI_PATH; preserved');
  await regular(c.shim,{privateFile:true});
  if(hash(await readFile(c.shim,'utf8'))!==route.shimHash)throw Error('Modified original-icon shim; preserved');
  system.run('/bin/launchctl',['setenv','CODEX_CLI_PATH',c.shim]);return {enabled:true,restartRequired:true};
}
export async function disableKanbanOriginalIcon({support},deps={}){
  const system=systemFor(deps),route=await readRoute(support),c=context(support,route.legacy,system);
  const loaded=await checkAgent(c,route);
  for(const [file,expected] of [[c.helper,route.helperHash],[c.shim,route.shimHash],[c.module,route.moduleHash],[c.core,route.coreHash],
    [join(support,'Disable Kanban Original Icon.command'),route.disableHash],[join(support,'Emergency Disable Original Icon.command'),route.emergencyHash]]){
    await regular(file,{privateFile:true});if(hash(await readFile(file,'utf8'))!==expected)throw Error('Modified integration files; uninstall left them unchanged');
  }
  if(c.legacy){
    await regular(join(support,'kanban-helper.before'),{privateFile:true});await regular(join(support,'kanban-shim.before'),{privateFile:true});
    const helper=await readFile(join(support,'kanban-helper.before'),'utf8'),originalShim=await readFile(join(support,'kanban-shim.before'),'utf8');
    if(hash(helper)!==route.beforeHelperHash||hash(originalShim)!==route.beforeShimHash)throw Error('Modified integration backup; preserved');
    await atomic(c.helper,helper);await atomic(c.shim,originalShim,0o700);
  }else{
    if(await stat(c.plist+'.disabled')){
      await regular(c.plist+'.disabled',{privateFile:true});
      if(await readFile(c.plist+'.disabled','utf8')!==expectedPlist(c,route))throw Error('Modified disabled LaunchAgent; preserved');
    }
    if(loaded)system.run('/bin/launchctl',['bootout',c.job]);
    if(system.run('/bin/launchctl',['getenv','CODEX_CLI_PATH'])===c.shim)system.run('/bin/launchctl',['unsetenv','CODEX_CLI_PATH']);
    await unlink(c.plist).catch(error=>{if(error.code!=='ENOENT')throw error;});
    await unlink(c.plist+'.disabled').catch(error=>{if(error.code!=='ENOENT')throw error;});await unlink(c.shim);
  }
  for(const file of [c.route,c.module,c.core,join(support,'Disable Kanban Original Icon.command'),join(support,'Emergency Disable Original Icon.command')])await unlink(file);
  return {disabled:true,sidebarFlowPreserved:c.legacy,backupsPreserved:true,restartRequired:true};
}
export async function dispatchOriginalIcon(support,args,{app}={}){
  let route;
  try{route=await readRoute(support);}catch(error){
    if(!app)throw error;
    process.stderr.write('KANBAN_ROUTE_UNAVAILABLE: using official CLI\n');
    const native=await nativeCli(app),env={...process.env,CODEX_CLI_PATH:native};
    for(const key of Object.keys(env))if(key.startsWith('KANBAN_')||key.startsWith('SIDEBAR_FLOW_'))delete env[key];
    forward(native,args,env);return;
  }
  const native=await nativeCli(route.app);
  let selected=await sidebarCli(route.sidebarRoot,route.app);
  if(await pluginActive(route)){
    try{
      await privateDirectory(route.root);await regular(join(route.root,'connection.json'),{privateFile:true});
      const config=JSON.parse(await readFile(join(route.root,'connection.json'),'utf8'));
      if(await readFile(join(route.root,'.owner'),'utf8')!=='codex-kanban-desktop-v1'||config.root!==route.root||config.proxy!==join(route.root,'codex-proxy')
        ||config.chainedCli===join(support,'codex-original-icon')||config.chainedCli===config.proxy)throw Error('Invalid or cyclic bridge');
      await regular(config.proxy,{executable:true});await preflight(config.nodePath,join(route.root,'runtime/desktop-startup.mjs'));
      await preflight(config.nodePath,join(route.root,'runtime/desktop-proxy.mjs'));
      selected=config.proxy;
    }catch{process.stderr.write('KANBAN_STARTUP_FALLBACK: using Sidebar Flow or official CLI\n');}
  }
  const env={...process.env,CODEX_HOME:route.codexHome,CODEX_CLI_PATH:selected};
  for(const key of Object.keys(env))if(key.startsWith('KANBAN_')||key.startsWith('SIDEBAR_FLOW_'))delete env[key];
  forward(selected||native,args,env);
}
if(process.argv[1]&&resolve(process.argv[1])===source){
  const args=process.argv.slice(2);
  if(args[0]==='--dispatch'){
    const app=args[2]==='--app'?args[3]:undefined;
    dispatchOriginalIcon(args[1],args.slice(app?5:3),{app}).catch(()=>{process.stderr.write('ORIGINAL_ICON_STARTUP_FAILED\n');process.exitCode=1;});
  }
  else{
    const {values}=parseArgs({options:{support:{type:'string'},refresh:{type:'boolean'},disable:{type:'boolean'}}});
    const action=values.disable?disableKanbanOriginalIcon:refreshKanbanOriginalIcon;
    action({support:values.support}).then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(error.message);process.exitCode=1;});
  }
}
