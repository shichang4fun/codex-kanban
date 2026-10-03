import {openLocalArchiver} from './local-read.mjs';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function failure(message,status=409){return Object.assign(Error(message),{status});}
function checkCanceled(signal){if(signal?.aborted)throw failure('Task action canceled before writing.',408);}
function localId(params){
  const {threadId,hostId}=params??{};
  if(hostId!=='local'||typeof threadId!=='string'||!uuid.test(threadId))throw failure('Only local task IDs can be changed.',400);
  return threadId;
}
async function isListed(client,threadId,cwd,archived){
  let cursor=null,count=0;const seen=new Set();
  do{
    const page=await client.request('thread/list',{archived,useStateDbOnly:true,cwd,sourceKinds:[],limit:100,sortKey:'updated_at',cursor});
    if(!Array.isArray(page?.data))break;
    if(page.data.some(t=>t.id===threadId))return true;
    count+=page.data.length;cursor=page.nextCursor??null;
    if(cursor!==null&&(typeof cursor!=='string'||seen.has(cursor)))break;
    seen.add(cursor);
  }while(cursor!==null&&count<5000);
  return false;
}

export async function archiveLocalTask(params,currentBoard,{open=openLocalArchiver,signal}={}){
  const threadId=localId(params);
  const task=currentBoard.tasks.find(t=>t.id===threadId&&t.hostId==='local'&&!t.sidebarOnly);
  if(!task)throw failure('This task is no longer in the current board. Refresh and try again.');
  checkCanceled(signal);
  const client=await open();
  try{
    const {thread}=await client.request('thread/read',{threadId,includeTurns:false});
    if(thread?.id!==threadId||thread.ephemeral!==false||thread.parentThreadId!=null||typeof thread.cwd!=='string')
      throw failure('This task cannot be archived from the board.');
    checkCanceled(signal);
    await client.request('thread/archive',{threadId});
    // An empty archive response only acknowledges the command. Confirm the
    // exact ID in the archived listing before reporting success to the UI.
    if(await isListed(client,threadId,thread.cwd,true))return {archived:true,threadId};
    throw failure('Archive was requested, but confirmation is unavailable. Refresh before trying again.',503);
  }finally{client.close();}
}

export async function restoreArchivedTask(params,{open=openLocalArchiver,signal}={}){
  const threadId=localId(params);checkCanceled(signal);
  const client=await open();
  try{
    const {thread}=await client.request('thread/read',{threadId,includeTurns:false});
    if(thread?.id!==threadId||thread.ephemeral!==false||thread.parentThreadId!=null||typeof thread.cwd!=='string')
      throw failure('This task cannot be restored from the board.');
    // Retry safely when a previous restore succeeded but its response was lost.
    // Unarchive canonicalizes workspace paths (for example /var -> /private/var).
    // Match the exact task ID without filtering by an old path spelling.
    if(!await isListed(client,threadId,undefined,false)){
      checkCanceled(signal);
      await client.request('thread/unarchive',{threadId});
    }
    if(!await isListed(client,threadId,undefined,false))throw failure('Restore was requested, but confirmation is unavailable. Try Undo again.',503);
    return {restored:true,threadId};
  }finally{client.close();}
}
