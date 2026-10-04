// Select fallbacks before protocol input is consumed; never replay a started proxy.
import {lstat,readFile,realpath} from 'node:fs/promises';
import {execFileSync,spawn} from 'node:child_process';
import {join,dirname,isAbsolute,resolve} from 'node:path';
export const validPath=value=>typeof value==='string'&&isAbsolute(value)&&resolve(value)===value&&!/[\x00-\x1f\x7f]/.test(value);
export async function regular(file,{executable=false,privateFile=false}={}){
  const s=await lstat(file);
  if(!s.isFile()||s.isSymbolicLink()||(executable&&!(s.mode&0o111))||(privateFile&&(s.uid!==process.getuid()||(s.mode&0o077))))throw Error('Unsafe startup file: '+file);
  return s;
}
export async function privateDirectory(dir){
  const s=await lstat(dir);
  if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==process.getuid()||(s.mode&0o077))throw Error('Private owned directory required: '+dir);
}
export async function nativeCli(app){
  if(!validPath(app))throw Error('Invalid application path');
  for(const file of [join(app,'Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex'),join(app,'Contents/Resources/codex-cli/bin/codex')]){
    try{await regular(file,{executable:true});if(!(await realpath(file)).startsWith((await realpath(app))+'/'))continue;return file;}catch{}
  }
  throw Error('Official CLI unavailable in the selected application');
}
async function moduleFiles(entry,seen=new Set()){
  if(seen.has(entry))return;seen.add(entry);if(seen.size>128)throw Error('Unexpected startup module graph');
  await regular(entry);
  for(const match of (await readFile(entry,'utf8')).matchAll(/(?:from\s*|import\s*(?:\(\s*)?)['"]([^'"]+)['"]/g)){
    if(match[1].startsWith('node:'))continue;
    if(!match[1].startsWith('.')||!match[1].endsWith('.mjs'))throw Error('Unsupported startup dependency');
    await moduleFiles(resolve(dirname(entry),match[1]),seen);
  }
  return seen;
}
// Linking catches missing exports without evaluating any application module.
// Keep this in a subprocess so its VM flag and stdin never affect the live protocol.
const linkCheck=`
import {SourceTextModule,SyntheticModule,createContext} from 'node:vm';
import {dirname,resolve} from 'node:path';
let input='';for await(const chunk of process.stdin)input+=chunk;
const context=createContext(),builtins=new Map();
const modules=new Map(JSON.parse(input).map(([file,code])=>[file,new SourceTextModule(code,{context,identifier:file})]));
async function linker(specifier,referencing){
  if(specifier.startsWith('node:')){
    if(!builtins.has(specifier))builtins.set(specifier,import(specifier).then(namespace=>new SyntheticModule(Object.keys(namespace),()=>{},{context,identifier:specifier})));
    return builtins.get(specifier);
  }
  const module=modules.get(resolve(dirname(referencing.identifier),specifier));
  if(!module||!specifier.startsWith('.'))throw Error('Unsupported startup dependency: '+specifier);
  return module;
}
for(const module of modules.values())if(module.status==='unlinked')await module.link(linker);
`;
export async function preflight(node,entry){
  await regular(node,{executable:true});const files=await moduleFiles(resolve(entry));
  const sources=await Promise.all([...files].map(async file=>[file,await readFile(file,'utf8')]));
  execFileSync(node,['--experimental-vm-modules','--input-type=module','--eval',linkCheck],{input:JSON.stringify(sources),timeout:10000,stdio:'pipe'});
}
export async function sidebarCli(root,app){
  const native=await nativeCli(app);
  try{
    await privateDirectory(root);
    if(await readFile(join(root,'.owner'),'utf8')!=='codex-sidebar-flow-desktop-v1')return native;
    const state=JSON.parse(await readFile(join(root,'installation.json'),'utf8')),proxy=join(root,'codex-proxy');
    if(state.owner!=='codex-sidebar-flow-desktop-v1'||state.proxy!==proxy||!validPath(state.nodePath)||!(/^[a-f0-9]{64}$/.test(state.release))
      ||await realpath(state.realCodex)!==await realpath(native))return native;
    await regular(proxy,{executable:true});await regular(join(root,'config.json'));
    const config=JSON.parse(await readFile(join(root,'config.json'),'utf8'));
    if(!config||typeof config!=='object'||Array.isArray(config))return native;
    const entry=join(root,'releases',state.release,'experimental/stdio-observer-proxy.mjs'),wrapper=await readFile(proxy,'utf8');
    const expected=`export SIDEBAR_FLOW_REAL_CODEX=${quote(state.realCodex)}\nexport SIDEBAR_FLOW_CONFIG_FILE=${quote(join(root,'config.json'))}\nexec ${quote(state.nodePath)} ${quote(entry)} "$@"`;
    if(wrapper.split('\n').filter(line=>line.trim()&&!line.trim().startsWith('#')).join('\n')!==expected)return native;
    await preflight(state.nodePath,entry);return proxy;
  }catch{return native;}
}
export async function selectedChain(config){
  const native=await nativeCli(config.app);
  if(config.autoFlow===true)return native;
  if(config.chainedCli===native)return native;
  if(!validPath(config.chainedCli)||config.chainedCli===config.proxy)return native;
  return sidebarCli(dirname(config.chainedCli),config.app);
}
export async function pluginActive(route){
  try{
    await regular(join(route.pluginPath,'plugin.json'));
    if(JSON.parse(await readFile(join(route.pluginPath,'plugin.json'),'utf8')).name!=='codex-kanban')return false;
    const text=await readFile(join(route.codexHome,'config.toml'),'utf8').catch(error=>{if(error.code==='ENOENT')return '';throw error;});
    let selected=false;
    for(const line of text.split('\n')){
      const section=line.match(/^\s*\[([^\]]+)\]/);
      if(section){selected=section[1].replaceAll(' ','')===`plugins."${route.pluginId}"`;continue;}
      if(selected&&/^\s*enabled\s*=\s*false\b/.test(line))return false;
    }
    return true;
  }catch{return false;}
}
export function forward(executable,args,env=process.env){
  const child=spawn(executable,args,{env,stdio:'inherit'});
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>child.kill(signal));
  child.once('error',()=>{process.stderr.write('CODEX_STARTUP_FAILED\n');process.exitCode=1;});
  child.once('exit',(code,signal)=>{process.exitCode=code??(signal?1:0);});
}
export const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
export function fallbackShell(app){
  return 'unset KANBAN_REAL_CODEX KANBAN_BRIDGE_SOCKET SIDEBAR_FLOW_REAL_CODEX SIDEBAR_FLOW_CONFIG_FILE\n'+
    `TASK_APP_PHYSICAL="$(CDPATH= cd -P -- ${quote(app)} 2>/dev/null && pwd)"\n`+
    [join(app,'Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex'),join(app,'Contents/Resources/codex-cli/bin/codex')]
    .map(file=>`TASK_CLI_PARENT="$(CDPATH= cd -P -- ${quote(dirname(file))} 2>/dev/null && pwd)"\ncase "$TASK_CLI_PARENT/" in "$TASK_APP_PHYSICAL/"*)\nif [ -n "$TASK_APP_PHYSICAL" ] && [ -f ${quote(file)} ] && [ ! -L ${quote(file)} ] && [ -x ${quote(file)} ]; then export CODEX_CLI_PATH=${quote(file)}; exec ${quote(file)} "$@"; fi;;\nesac\n`).join('')+
    'echo "CODEX_NATIVE_CLI_UNAVAILABLE" >&2\nexit 1\n';
}
