import {classify} from './build.mjs';
import {bridgeError,desktopBridgeRequest} from './bridge-transport.mjs';
import {runtimeSnapshotFresh} from './local-board.mjs';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validRuntimeStatus(status){
  return status&&typeof status==='object'&&(['idle','notLoaded','systemError'].includes(status.type)
    ||status.type==='active'&&Array.isArray(status.activeFlags)
      &&status.activeFlags.every(flag=>['waitingOnApproval','waitingOnUserInput'].includes(flag)));
}

// Read through the owning Desktop connection, never an independent App Server.
// Only IDs and runtime flags cross the bridge; no task content or model calls.
export function createDesktopRuntime({request,ready=()=>true,clock=()=>new Date().toISOString()}){
  return {
    async read(params,{signal}={}){
      const ids=params?.threadIds;
      if(!Array.isArray(ids)||ids.length>100||ids.some(id=>typeof id!=='string'||!uuid.test(id))
        ||new Set(ids).size!==ids.length)throw bridgeError('Invalid local runtime request.',400);
      if(!ready()||signal?.aborted)throw bridgeError('Desktop runtime is disconnected.');
      const capturedAt=clock(),statuses=[];let index=0;
      await Promise.all(Array.from({length:Math.min(4,ids.length)},async()=>{
        while(index<ids.length){
          if(!ready()||signal?.aborted)throw bridgeError('Desktop runtime disconnected during reading.');
          const threadId=ids[index++];
          try{
            const {thread}=await request('thread/read',{threadId,includeTurns:false});
            if(thread?.id===threadId&&thread.ephemeral===false&&thread.parentThreadId==null&&validRuntimeStatus(thread.status))
              statuses.push({threadId,status:thread.status.type==='active'
                ?{type:'active',activeFlags:[...thread.status.activeFlags]}:{type:thread.status.type}});
          }catch{} // Failed reads stay unknown; never infer idle or completion.
        }
      }));
      if(!ready()||signal?.aborted)throw bridgeError('Desktop runtime disconnected during reading.');
      return {connected:true,capturedAt,statuses};
    }
  };
}

export async function readBoardRuntime(board,socketPath,{request=desktopBridgeRequest,clock=()=>new Date().toISOString()}={}){
  const ids=board.tasks.filter(t=>t.hostId==='local'&&!t.sidebarOnly&&uuid.test(t.id)).map(t=>t.id);
  const observations=new Map();let latest=null;
  try{
    for(let index=0;index<ids.length;index+=100){
      const batch=ids.slice(index,index+100),reply=await request(socketPath,'runtime',{threadIds:batch},10000);
      if(reply?.connected!==true||!runtimeSnapshotFresh(reply.capturedAt,clock())||!Array.isArray(reply.statuses))throw Error('Invalid runtime reply');
      const seen=new Set();
      for(const row of reply.statuses){
        if(!batch.includes(row.threadId)||seen.has(row.threadId)||!validRuntimeStatus(row.status))throw Error('Invalid runtime status');
        seen.add(row.threadId);observations.set(row.threadId,{...row,capturedAt:reply.capturedAt});
      }
      latest=reply.capturedAt;
    }
  }catch{return board;}
  // A failed or partial observation cannot renew an older execution claim.
  return {...board,runtimeLiveCapturedAt:latest,sync:{...board.sync,runtimeLive:observations.size>0},tasks:board.tasks.map(task=>{
    const row=task.hostId==='local'?observations.get(task.id):null;
    return row?{...task,rawStatus:row.status,column:classify(row.status),runtimeStatusSource:'desktopRuntime',
      runtimeCapturedAt:row.capturedAt,runtimeStatusStale:false,lastObservedStatus:row.status,lastObservedAt:row.capturedAt}:task;
  })};
}
