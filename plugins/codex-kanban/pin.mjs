import {openLocalPinner} from './local-read.mjs';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const failure=(message,status=409)=>Object.assign(Error(message),{status});
export async function pinLocalTask(params,board,{open=openLocalPinner,signal}={}){
  const {threadId,hostId,pinned}=params??{};
  if(hostId!=='local'||typeof threadId!=='string'||!uuid.test(threadId)||typeof pinned!=='boolean')
    throw failure('Invalid local pin request.',400);
  if(!board.tasks.some(t=>t.hostId==='local'&&t.id===threadId&&!t.sidebarOnly))throw failure('This task is no longer in the board. Refresh and try again.');
  const checkCanceled=()=>{if(signal?.aborted)throw failure('Pin change canceled before writing.',408);};
  checkCanceled();
  const client=await open();
  try{
    const readTask=async()=>{
      const {thread}=await client.request('thread/read',{threadId,includeTurns:false});
      if(thread?.id!==threadId||thread.ephemeral!==false||thread.parentThreadId!=null||thread.section===undefined||thread.archived||thread.isArchived)
        throw failure('This task cannot be pinned from the board.');
      return thread;
    };
    const thread=await readTask(),expectedSectionId=thread.section?.id??null;
    const sections=[];let cursor=null;const seen=new Set();
    do{
      const page=await client.request('threadSection/list',{limit:100,cursor});
      if(!Array.isArray(page?.data))throw failure('Pinned group is unavailable.');
      sections.push(...page.data);cursor=page.nextCursor??null;
      if(cursor!==null&&(typeof cursor!=='string'||seen.has(cursor)||sections.length>5000))throw failure('Pinned group is unavailable.');
      seen.add(cursor);
    }while(cursor!==null);
    const matches=sections.filter(s=>s.name==='Pinned');
    if(matches.length!==1||typeof matches[0].id!=='string')throw failure('A unique Pinned group is required.');
    const pinnedId=matches[0].id;
    if(!pinned&&thread.section?.id!==pinnedId)throw failure('This task has already left Pinned. Refresh and try again.');
    const sectionId=pinned?pinnedId:null;
    // Listing groups can span multiple RPCs. Preserve a Sidebar Flow move
    // observed since the first read instead of clearing its new membership.
    const adjacent=await readTask();
    if((adjacent.section?.id??null)!==expectedSectionId)
      throw failure('This task has changed groups. Refresh and try again.');
    checkCanceled();
    if(expectedSectionId!==sectionId)await client.request('thread/section/move',{threadId,sectionId});
    const verified=await readTask();
    if(verified?.id!==threadId||verified.section===undefined||(verified.section?.id??null)!==sectionId)
      throw failure('Pin change could not be confirmed. Refresh before trying again.',503);
    return {threadId,pinned,sectionId};
  }finally{client.close();}
}
