import {mkdir,readFile,writeFile,readdir,lstat,cp,mkdtemp,rename,rm} from 'node:fs/promises';
import {homedir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildPlugin} from './build-plugin.mjs';

const source=dirname(fileURLToPath(import.meta.url));
export async function preparePlugin({root=join(homedir(),'.codex','kanban-plugin-marketplace'),nodePath=process.execPath,build=true}={}){
  root=resolve(root);
  if(build)await buildPlugin();
  await mkdir(root,{recursive:true,mode:0o700});
  const info=await lstat(root);
  if(!info.isDirectory()||info.isSymbolicLink()||info.uid!==process.getuid()||(info.mode&0o077)!==0)throw Error('Use a private installation directory owned by the current user.');
  const ownerPath=join(root,'.owner');
  const owner=await readFile(ownerPath,'utf8').catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  if(owner!==null&&owner!=='codex-kanban-marketplace-v1')throw Error('This directory belongs to another installation.');
  if(owner===null&&(await readdir(root)).length)throw Error('Use an empty installation directory.');
  await writeFile(ownerPath,'codex-kanban-marketplace-v1',{mode:0o600});
  const stage=await mkdtemp(join(root,'.stage-'));
  const plugin=join(root,'codex-kanban');
  let previous;
  try{
    await cp(join(source,'dist','plugin'),stage,{recursive:true});
    // Desktop need not inherit the interactive shell's Node search path.
    const config=JSON.parse(await readFile(join(stage,'mcp.json'),'utf8'));
    config.mcpServers['codex-kanban'].command='./launch-mcp';
    config.mcpServers['codex-kanban'].args=[];
    const quote=value=>`'${value.replaceAll("'", "'\\''")}'`;
    await writeFile(join(stage,'launch-mcp'),`#!/bin/sh\nexec ${quote(nodePath)} "$(dirname "$0")/mcp-server.mjs" "$@"\n`,{mode:0o700});
    await writeFile(join(stage,'mcp.json'),JSON.stringify(config,null,2)+'\n');
    if(await lstat(plugin).catch(()=>null)){
      previous=await mkdtemp(join(root,'.previous-'));await rm(previous,{recursive:true});await rename(plugin,previous);
    }
    try{await rename(stage,plugin);}
    catch(error){if(previous)await rename(previous,plugin);throw error;}
    const marketplace={name:'codex-kanban-local',interface:{displayName:'Codex Kanban Local'},plugins:[{
      name:'codex-kanban',source:{source:'local',path:'./codex-kanban'},
      policy:{installation:'AVAILABLE',authentication:'ON_INSTALL'},category:'Productivity'
    }]};
    await mkdir(join(root,'.agents','plugins'),{recursive:true,mode:0o700});
    await writeFile(join(root,'.agents','plugins','marketplace.json'),JSON.stringify(marketplace,null,2)+'\n',{mode:0o600});
    return {root,plugin,marketplace:'codex-kanban-local',previous};
  }finally{await rm(stage,{recursive:true,force:true});}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  console.log(JSON.stringify(await preparePlugin({...(process.argv[2]?{root:process.argv[2]}:{})}),null,2));
}
