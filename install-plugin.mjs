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
  const plugin=join(root,'codex-kanban'),stagedPlugin=join(stage,'plugin');
  const manifestPath=join(root,'.agents','plugins','marketplace.json');
  let previous,published=false;
  try{
    await cp(join(source,'dist','plugin'),stagedPlugin,{recursive:true});
    // Desktop need not inherit the interactive shell's Node search path.
    const config=JSON.parse(await readFile(join(stagedPlugin,'mcp.json'),'utf8'));
    config.mcpServers['codex-kanban'].command='./launch-mcp';
    config.mcpServers['codex-kanban'].args=[];
    const quote=value=>`'${value.replaceAll("'", "'\\''")}'`;
    await writeFile(join(stagedPlugin,'launch-mcp'),`#!/bin/sh\nexec ${quote(nodePath)} "$(dirname "$0")/mcp-server.mjs" "$@"\n`,{mode:0o700});
    await writeFile(join(stagedPlugin,'mcp.json'),JSON.stringify(config,null,2)+'\n');
    const marketplace={name:'codex-kanban-local',interface:{displayName:'Codex Kanban Local'},plugins:[{
      name:'codex-kanban',source:{source:'local',path:'./codex-kanban'},
      policy:{installation:'AVAILABLE',authentication:'ON_INSTALL'},category:'Productivity'
    }]};
    await mkdir(dirname(manifestPath),{recursive:true,mode:0o700});
    const stagedManifest=join(stage,'marketplace.json');
    await writeFile(stagedManifest,JSON.stringify(marketplace,null,2)+'\n',{mode:0o600});
    if(await lstat(plugin).catch(error=>{if(error.code==='ENOENT')return null;throw error;})){
      const backup=await mkdtemp(join(root,'.previous-'));await rm(backup,{recursive:true});
      await rename(plugin,backup);previous=backup;
    }
    await rename(stagedPlugin,plugin);published=true;
    // Publish the manifest last, atomically. Any earlier failure keeps it intact.
    await rename(stagedManifest,manifestPath);
    return {root,plugin,marketplace:'codex-kanban-local',previous};
  }catch(error){
    if(published)await rm(plugin,{recursive:true,force:true});
    if(previous)await rename(previous,plugin);
    throw error;
  }finally{await rm(stage,{recursive:true,force:true});}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  console.log(JSON.stringify(await preparePlugin({...(process.argv[2]?{root:process.argv[2]}:{})}),null,2));
}
