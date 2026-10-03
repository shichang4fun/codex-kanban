import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {openLocalReader} from './local-read.mjs';
import {createLocalBoard} from './local-board.mjs';
import {readLocalUnread} from './desktop-unread.mjs';
import {archiveLocalTask,restoreArchivedTask} from './archive.mjs';
import {desktopBridgeRequest} from './bridge-transport.mjs';
import {readBoardRuntime} from './desktop-runtime.mjs';
import {createGitStatusReader} from './git-status.mjs';
import {setLocalProject} from './project.mjs';
import {defaultCreationSettingsStore} from './creation-store.mjs';
import {creationSettings} from './creation-options.mjs';

// Installed plugins keep user data outside the immutable plugin package.
export function createBoardSource({snapshotPath=new URL('./snapshot.json',import.meta.url),openReader=openLocalReader,
  readUnread=readLocalUnread,allowMissingSnapshot=false}={}){
  let reader,reading,closed=false;const gitStatus=createGitStatusReader();
  return {
    getBoard(){
      if(closed)return Promise.reject(Error('The board connection is closed.'));
      return reading??=(async()=>{
        reader??=await openReader();
        if(closed){reader.close();throw Error('The board connection is closed.');}
        const [snapshot,unreadState]=await Promise.all([
          readFile(snapshotPath,'utf8').then(JSON.parse).catch(error=>{
            if(allowMissingSnapshot&&error.code==='ENOENT')return {capturedAt:null,threads:[],pinnedThreads:[],sections:[],projects:[]};
            throw error;
          }),readUnread()
        ]);
        return gitStatus.enrich(await createLocalBoard(reader,snapshot,{unreadState}).getBoard());
      })().catch(error=>{reader?.close();reader=null;throw error;}).finally(()=>reading=null);
    },
    async close(){closed=true;reader?.close();await reading?.catch(()=>{});reader?.close();reader=null;}
  };
}

const failure=(message,status)=>Object.assign(Error(message),{status});

// HTTP and MCP share one write lock and one token-bound Undo registry.
export function createKanbanService({getBoard,archiveTask=archiveLocalTask,restoreTask=restoreArchivedTask,
  pinTask=null,moveTask=null,setProject=setLocalProject,settingsStore=defaultCreationSettingsStore(),desktopBridgeSocket=null,bridgeRequest=desktopBridgeRequest}={}){
  const csrf=randomUUID(),undoArchives=new Map(),lifetime=new AbortController();let mutating=null,closed=false;
  const desktopStatus=async()=>{
    if(desktopBridgeSocket)try{return await bridgeRequest(desktopBridgeSocket,'status',{},1500);}catch{}
    return {connected:false};
  };
  const creationCatalog=async()=>{
    const status=await desktopStatus();
    if(status.connected!==true||status.taskCreation!==true)throw failure('Task creation settings require the updated Kanban launcher and a local task opened in Codex.',503);
    const catalog=await bridgeRequest(desktopBridgeSocket,'creationCatalog');
    if(!Array.isArray(catalog?.projects)||!Array.isArray(catalog?.sections))throw failure('Creation options are unavailable.',503);
    return catalog;
  };
  const connectedBoard=async()=>{
    let value=await getBoard();const status=await desktopStatus(),desktopArchiveConnected=status.connected===true,
      desktopGroupsConnected=desktopArchiveConnected&&status.groupActions===true;
    if(desktopArchiveConnected&&status.runtimeAvailable===true)value=await readBoardRuntime(value,desktopBridgeSocket,{request:bridgeRequest});
    let defaults={},settingsError=null;
    try{defaults=await settingsStore.read();}catch{settingsError='Creation defaults could not be read. Repair their storage before editing settings.';}
    const nativeCreationDefaults=Object.fromEntries(Object.entries(defaults).map(([key,settings])=>[key,{projectId:settings?.projectId??null,template:settings?.template??''}]));
    return {...value,nativeCreationDefaults,creationOperations:status.creationOperations??[],sync:{...value.sync,writable:true,moveWritable:desktopGroupsConnected,archiveLocal:true,pinLocal:desktopGroupsConnected,projectLocal:value.sync?.projectCatalogConnected===true,
      createWritable:desktopArchiveConnected&&status.taskCreation===true&&!settingsError,creationError:settingsError??status.creationError??null,
      moveTransport:desktopGroupsConnected?'desktop':null,desktopGroupsConnected,
      archiveTransport:desktopArchiveConnected?'desktop':'local',desktopArchiveConnected}};
  };
  return {
    csrf,
    async creationOptions(){
      if(closed)throw failure('The board connection is closed.',503);
      if(mutating)await mutating.catch(()=>{});
      return {...await creationCatalog(),settings:await settingsStore.read()};
    },
    async creationStatus(params){
      if(closed)throw failure('The board connection is closed.',503);
      if(typeof params?.requestId!=='string'||! /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.requestId))throw failure('A creation request ID is required.',400);
      const status=await desktopStatus();
      if(status.connected!==true||status.taskCreation!==true)throw failure('Creation status requires a connected Desktop bridge.',503);
      return bridgeRequest(desktopBridgeSocket,'creationStatus',{requestId:params.requestId});
    },
    async read(){
      if(closed)throw failure('The board connection is closed.',503);
      if(mutating)await mutating.catch(()=>{});
      return {board:await connectedBoard(),csrf,undoArchives:[...undoArchives].map(([undoToken,entry])=>({undoToken,task:entry.task}))};
    },
    async action(name,params,{signal:requestSignal}={}){
      if(closed)throw failure('The board connection is closed.',503);
      const signal=requestSignal?AbortSignal.any([requestSignal,lifetime.signal]):lifetime.signal;
      if(!['project','move','pin','archive','unarchive','create','creation-group','group-settings'].includes(name))throw failure('Unknown task action.',400);
      if(mutating)throw failure('Another task action is in progress.',409);
      const undo=name==='unarchive'?undoArchives.get(params?.undoToken):null;
      if(name==='unarchive'&&!undo)throw failure('Undo is no longer available here. Restore this task from Codex archived tasks.',409);
      let archiveTransport='local';
      let archivedTask;
      const checkCanceled=()=>{if(signal?.aborted)throw failure('Task action canceled before dispatch.',408);};
      mutating=(async()=>{
        const write=async()=>{
          checkCanceled();
          if(['create','creation-group','group-settings'].includes(name)){
            if(name==='group-settings'){
              const options=await creationCatalog(),settings=creationSettings(params?.settings);
              if(!options.sections.some(s=>s.sectionId===params?.sectionId))throw failure('Choose a verified local group.',400);
              const project=settings.projectId?options.projects.find(p=>p.projectId===settings.projectId):null;
              if(settings.projectId&&!project||settings.environment==='worktree'&&!project?.isGitRepository)throw failure('Choose a valid local project and execution environment.',400);
              checkCanceled();
              await settingsStore.update(entries=>{checkCanceled();entries[JSON.stringify(params.sectionId)]=settings;});
              return {saved:true,sectionId:params.sectionId,settings};
            }
            const status=await desktopStatus();checkCanceled();
            if(status.connected!==true||status.taskCreation!==true)throw failure('Task creation requires the updated Kanban launcher and a local task opened in Codex.',503);
            return bridgeRequest(desktopBridgeSocket,name==='create'?'create':'retryCreationGroup',params,60000,{signal});
          }
          if(undo)return undo.transport==='desktop'
            ?bridgeRequest(desktopBridgeSocket,'archive',{threadId:undo.threadId,hostId:'local',archived:false})
            :restoreTask({threadId:undo.threadId,hostId:'local'},{signal});
          const current=await getBoard();
          checkCanceled();
          if(name==='project'){
            if(current.sync?.projectCatalogConnected!==true)throw failure('Local projects are unavailable. Refresh and try again.',503);
            return setProject(params,current,{signal});
          }
          archivedTask=current.tasks.find(t=>t.id===params?.threadId&&t.hostId==='local');
          const status=await desktopStatus();
          checkCanceled();
          if(name==='move'||name==='pin'){
            if(status.connected!==true||status.groupActions!==true)
              throw failure('Group changes require the updated Codex Kanban launcher. Launch Codex with it and open a local task.',503);
            if(!current.tasks.some(t=>t.id===params?.threadId&&t.hostId==='local'&&!t.sidebarOnly)||params?.hostId!=='local')
              throw failure('This local task is no longer in the board. Refresh and try again.',409);
            const handler=name==='move'?moveTask:pinTask;
            return handler?handler(params,current,{signal}):bridgeRequest(desktopBridgeSocket,name,params);
          }
          if(status.connected!==true)return archiveTask(params,current,{signal});
          archiveTransport='desktop';
          if(!current.tasks.some(t=>t.id===params?.threadId&&t.hostId==='local'&&!t.sidebarOnly)||params?.hostId!=='local')
            throw failure('This local task is no longer in the board. Refresh and try again.',409);
          return bridgeRequest(desktopBridgeSocket,'archive',{threadId:params.threadId,hostId:'local',archived:true});
        };
        let result;
        try{
          result=await write();
          if(name==='move'&&(result.threadId!==params.threadId||result.sectionId!==params.sectionId||typeof result.changed!=='boolean'))throw Error('Move not verified');
          if(name==='project'){
            if(result.threadId!==params.threadId||result.projectId!==params.projectId||typeof result.changed!=='boolean')throw Error('Project not verified');
          }
          if(undo){
            if(result.restored!==true||result.threadId!==undo.threadId)throw Error('Restore not verified');
            undoArchives.delete(params.undoToken);
          }else if(name==='archive'){
            if(result.archived!==true||result.threadId!==params.threadId)throw Error('Archive not verified');
            const undoToken=randomUUID();undoArchives.set(undoToken,{threadId:result.threadId,transport:archiveTransport,
              task:{id:result.threadId,hostId:'local',title:archivedTask?.title??'Archived task'}});
            result={...result,undoToken};
          }
        }catch(error){throw failure(error.status?error.message:'Task action could not be confirmed. Refresh before trying again.',error.status??503);}
        // A confirmed write stays successful even if the following read fails.
        let next;try{next=await connectedBoard();}catch{}
        return {...result,...(next?{board:next}:{}),csrf};
      })();
      try{return await mutating;}
      finally{mutating=null;}
    },
    async close(){closed=true;lifetime.abort();await mutating?.catch(()=>{});undoArchives.clear();}
  };
}
