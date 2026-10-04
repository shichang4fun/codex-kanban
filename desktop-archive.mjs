import {openLocalReader} from './local-read.mjs';
import {archiveLocalTask,restoreArchivedTask} from './archive.mjs';
import {renameLocalTask} from './rename.mjs';
import {startLocalBridge,bridgeError} from './bridge-transport.mjs';
import {createDesktopGroups} from './desktop-groups.mjs';
import {createDesktopRuntime} from './desktop-runtime.mjs';
import {createDesktopCreation} from './desktop-creation.mjs';
import {createJsonStore} from './creation-store.mjs';
import {dirname,join} from 'node:path';

// Mutations run on the attached Desktop MCP connection. Exact-ID verification
// still uses the official read-only local protocol; it never opens another writer.
export function createDesktopArchive({call,ready=()=>true,openReader=openLocalReader}){
  let busy=false;
  const openFor=signal=>async()=>{
    const reader=await openReader();
    return {close:()=>reader.close(),request:async(method,params)=>{
      if(method==='thread/archive'||method==='thread/unarchive'){
        if(signal?.aborted)throw bridgeError('Archive request was cancelled before writing.',409);
        await call('set_thread_archived',{threadId:params.threadId,hostId:'local',source:'codex',archived:method==='thread/archive'});
        return {};
      }
      if(method==='thread/name/set'){
        if(signal?.aborted)throw bridgeError('Rename cancelled before writing.',409);
        await call('set_thread_title',{threadId:params.threadId,source:'codex',title:params.name});
        return {};
      }
      return reader.request(method,params);
    }};
  };
  return {
    status:()=>({connected:ready(),archiveTransport:'desktop',renameActions:true}),
    async rename(params,{signal}={}){
      if(!ready())throw bridgeError('Codex is still connecting. Try again after it opens.');
      if(busy)throw bridgeError('Another desktop task action is in progress.',409);
      busy=true;
      try{
        return await renameLocalTask(params,{tasks:[{id:params?.threadId,hostId:params?.hostId,title:params?.expectedTitle}]},
          {open:openFor(signal),signal});
      }finally{busy=false;}
    },
    async change(params,{signal}={}){
      if(!ready())throw bridgeError('Codex is still connecting. Try again after it opens.');
      if(busy)throw bridgeError('Another desktop archive action is in progress.',409);
      if(typeof params?.archived!=='boolean')throw bridgeError('An explicit archive or restore action is required.',400);
      if(signal?.aborted)throw bridgeError('Archive request was cancelled before it started.',409);
      busy=true;
      try{
        const open=openFor(signal);
        // Validate local IDs and ephemeral/subagent protections before any call.
        if(params.archived)return await archiveLocalTask(params,{tasks:[{id:params.threadId,hostId:params.hostId}]},{open});
        return await restoreArchivedTask(params,{open});
      }finally{busy=false;}
    }
  };
}
export async function startDesktopArchiveBridge({socketPath,...options}){
  const controller=createDesktopArchive(options);
  const groups=createDesktopGroups(options),runtime=typeof options.request==='function'?createDesktopRuntime(options):null;let busy=false;
  const creation=createDesktopCreation({...options,store:options.creationStore??createJsonStore(join(dirname(socketPath),'creation-operations.json'))});
  return startLocalBridge({socketPath,dispatch:async(method,params,context)=>{
    if(method==='status'){
      const status={...controller.status(),groupActions:true,runtimeAvailable:runtime!==null,autoFlow:options.autoFlow?.status()??{available:false}};
      try{return {...status,taskCreation:true,creationOperations:await creation.operations()};}
      catch{return {...status,taskCreation:false,creationError:'Creation history could not be read. Task creation is disabled until its storage is repaired.'};}
    }
    if(method==='runtime'&&runtime)return runtime.read(params,context);
    if(method==='creationCatalog')return creation.catalog();
    if(method==='creationStatus')return creation.operation(params);
    if(method==='flowSettings'){
      if(typeof params?.enabled!=='boolean'||!options.autoFlow)throw bridgeError('An available auto organize runtime and explicit switch are required.',400);
      return {autoFlow:await options.autoFlow.change(params.enabled)};
    }
    if(!['archive','rename','move','pin','create','retryCreationGroup'].includes(method))throw bridgeError('This bridge only supports status, runtime, archive, restore, rename, task group changes and explicit task creation.',400);
    if(busy)throw bridgeError('Another desktop task action is in progress.',409);
    busy=true;
    const change=()=>method==='archive'?controller.change(params,context):method==='rename'?controller.rename(params,context):method==='create'?creation.create(params,context):method==='retryCreationGroup'?creation.retryGroup(params,context):groups[method](params,context);
    try{return await (options.runExclusive?options.runExclusive(change):change());}
    finally{busy=false;}
  }});
}
