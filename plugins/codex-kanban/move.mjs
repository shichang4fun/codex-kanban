import {openLocalPinner} from './local-read.mjs';

export const moveGroupNames=['For Later','In Progress','For Review'];
const editableGroupNames=[...moveGroupNames,'Pinned'];
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const failure=(message,status=409)=>Object.assign(Error(message),{status});

// An explicit move is a single native section write. Sidebar Flow remains free
// to classify later; no policy override, retry loop, or model turn is created.
export async function moveLocalTask(params,board,{open=openLocalPinner,signal}={}){
  const {threadId,hostId,sectionId,expectedSectionId}=params??{};
  if(hostId!=='local'||typeof threadId!=='string'||!uuid.test(threadId)
    ||(sectionId!==null&&(typeof sectionId!=='string'||!sectionId||sectionId.length>128))
    ||(expectedSectionId!==null&&(typeof expectedSectionId!=='string'||!expectedSectionId||expectedSectionId.length>128)))
    throw failure('Invalid local group request.',400);
  const task=board.tasks.find(t=>t.id===threadId&&t.hostId==='local'&&!t.sidebarOnly);
  if(!task)throw failure('This task is no longer in the board. Refresh and try again.');
  const inheritedProject=task.placementSource==='desktopProject'&&task.localSectionId===null
    &&typeof task.projectId==='string'&&task.projectId.length>0&&expectedSectionId===null;
  if(!['localThreadSection','localDefault'].includes(task.placementSource)&&!inheritedProject)
    throw failure('Move this task from its project in Codex.');
  const checkCancellation=()=>{if(signal?.aborted)throw failure('Move cancelled before writing.');};
  checkCancellation();
  const client=await open();
  try{
    const sections=[];let cursor=null;const seen=new Set();
    do{
      const page=await client.request('threadSection/list',{limit:100,cursor});
      if(!Array.isArray(page?.data))throw failure('Local groups are unavailable.');
      sections.push(...page.data);cursor=page.nextCursor??null;
      if(cursor!==null&&(typeof cursor!=='string'||seen.has(cursor)||sections.length>5000))throw failure('Local groups are unavailable.');
      seen.add(cursor);
    }while(cursor!==null);
    const destination=sections.filter(s=>s.id===sectionId);
    if(sectionId!==null&&(destination.length!==1||!editableGroupNames.includes(destination[0].name)))
      throw failure('Choose Tasks, Pinned, For Later, In Progress, or For Review.');
    const readTask=async()=>{
      const {thread}=await client.request('thread/read',{threadId,includeTurns:false});
      if(thread?.id!==threadId||thread.ephemeral!==false||thread.parentThreadId!=null||thread.section===undefined||thread.archived||thread.isArchived)
        throw failure('This task cannot be moved from the board.');
      return thread;
    };
    const current=await readTask();
    if((current.section?.id??null)!==expectedSectionId)throw failure('This task has changed groups. Refresh and try again.');
    if(expectedSectionId===sectionId)return {threadId,sectionId,changed:false};
    // Read again immediately before the one write; never overwrite an already
    // observed Sidebar Flow move with the browser's stale source group.
    const adjacent=await readTask();
    if((adjacent.section?.id??null)!==expectedSectionId)throw failure('This task has changed groups. Refresh and try again.');
    checkCancellation();
    await client.request('thread/section/move',{threadId,sectionId});
    const verified=await readTask();
    if((verified.section?.id??null)!==sectionId)
      throw failure('The group changed again before confirmation. The board will show the latest Codex group.',409);
    return {threadId,sectionId,changed:true};
  }finally{client.close();}
}
