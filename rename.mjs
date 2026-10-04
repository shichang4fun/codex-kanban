import {openLocalRenamer} from './local-read.mjs';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const failure=(message,status=409)=>Object.assign(Error(message),{status});

export async function renameLocalTask(params,board,{open=openLocalRenamer,signal}={}){
  const {threadId,hostId,title,expectedTitle}=params??{};
  if(hostId!=='local'||typeof threadId!=='string'||!uuid.test(threadId)
    ||typeof title!=='string'||!title.trim()||title!==title.trim()||title.length>256||/[\u0000-\u001f\u007f]/.test(title)
    ||typeof expectedTitle!=='string'||!expectedTitle)
    throw failure('Invalid local rename request.',400);
  const task=board.tasks.find(t=>t.id===threadId&&t.hostId==='local'&&!t.sidebarOnly);
  if(!task||task.title!==expectedTitle)throw failure('This task has changed. Refresh and try again.');
  const checkCancellation=()=>{if(signal?.aborted)throw failure('Rename cancelled before writing.');};
  checkCancellation();const client=await open();
  try{
    // thread/read has no archive flag. Confirm membership in the native active
    // catalog instead of trusting the board snapshot or nonexistent fields.
    let cursor=null,found=false,count=0;const seen=new Set();
    do{
      const page=await client.request('thread/list',{archived:false,useStateDbOnly:true,limit:100,cursor});
      if(!Array.isArray(page?.data)||count+page.data.length>5000)throw failure('Active task membership could not be verified.');
      count+=page.data.length;found=page.data.some(t=>t.id===threadId);
      cursor=page.nextCursor??null;
      if(cursor!==null&&(typeof cursor!=='string'||!cursor||seen.has(cursor)))throw failure('Active task membership could not be verified.');
      seen.add(cursor);checkCancellation();
    }while(!found&&cursor!==null);
    if(!found)throw failure('This task is archived or no longer available. Refresh and try again.');
    const {thread}=await client.request('thread/read',{threadId,includeTurns:false});
    if(thread?.id!==threadId||thread.ephemeral!==false||thread.parentThreadId!=null||thread.archived||thread.isArchived)
      throw failure('This task cannot be renamed from the board.');
    if((thread.name??task.title)!==expectedTitle)throw failure('This task was renamed elsewhere. Refresh and try again.');
    checkCancellation();
    if(title===expectedTitle)return {threadId,title,changed:false};
    await client.request('thread/name/set',{threadId,name:title});
    const confirmation=await client.request('thread/read',{threadId,includeTurns:false});
    if(confirmation.thread?.id!==threadId||confirmation.thread.name!==title)
      throw failure('Rename could not be confirmed. Refresh before trying again.');
    return {threadId,title,changed:true};
  }finally{client.close();}
}
