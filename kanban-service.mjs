import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {openLocalReader} from './local-read.mjs';
import {createLocalBoard} from './local-board.mjs';
import {readLocalUnread} from './desktop-unread.mjs';
import {archiveLocalTask,restoreArchivedTask} from './archive.mjs';
import {desktopBridgeRequest} from './bridge-transport.mjs';
import {readBoardRuntime} from './desktop-runtime.mjs';
import {createGitStatusReader} from './git-status.mjs';

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
  pinTask=null,moveTask=null,desktopBridgeSocket=null,bridgeRequest=desktopBridgeRequest}={}){
  const csrf=randomUUID(),undoArchives=new Map(),lifetime=new AbortController();let mutating=null,closed=false;
  const desktopStatus=async()=>{
    if(desktopBridgeSocket)try{return await bridgeRequest(desktopBridgeSocket,'status',{},1500);}catch{}
    return {connected:false};
  };
  const connectedBoard=async()=>{
    let value=await getBoard();const status=await desktopStatus(),desktopArchiveConnected=status.connected===true,
      desktopGroupsConnected=desktopArchiveConnected&&status.groupActions===true;
    if(desktopArchiveConnected&&status.runtimeAvailable===true)value=await readBoardRuntime(value,desktopBridgeSocket,{request:bridgeRequest});
    return {...value,sync:{...value.sync,writable:true,moveWritable:desktopGroupsConnected,archiveLocal:true,pinLocal:desktopGroupsConnected,
      moveTransport:desktopGroupsConnected?'desktop':null,desktopGroupsConnected,
      archiveTransport:desktopArchiveConnected?'desktop':'local',desktopArchiveConnected}};
  };
  return {
    csrf,
    async read(){
      if(closed)throw failure('The board connection is closed.',503);
      if(mutating)await mutating.catch(()=>{});
      return {board:await connectedBoard(),csrf,undoArchives:[...undoArchives].map(([undoToken,entry])=>({undoToken,task:entry.task}))};
    },
    async action(name,params,{signal:requestSignal}={}){
      if(closed)throw failure('The board connection is closed.',503);
      const signal=requestSignal?AbortSignal.any([requestSignal,lifetime.signal]):lifetime.signal;
      if(!['move','pin','archive','unarchive'].includes(name))throw failure('Unknown task action.',400);
      if(mutating)throw failure('Another task action is in progress.',409);
      const undo=name==='unarchive'?undoArchives.get(params?.undoToken):null;
      if(name==='unarchive'&&!undo)throw failure('Undo is no longer available here. Restore this task from Codex archived tasks.',409);
      let archiveTransport='local';
      let archivedTask;
      const checkCanceled=()=>{if(signal?.aborted)throw failure('Task action canceled before dispatch.',408);};
      mutating=(async()=>{
        const write=async()=>{
          checkCanceled();
          if(undo)return undo.transport==='desktop'
            ?bridgeRequest(desktopBridgeSocket,'archive',{threadId:undo.threadId,hostId:'local',archived:false})
            :restoreTask({threadId:undo.threadId,hostId:'local'},{signal});
          const current=await getBoard();
          checkCanceled();
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
