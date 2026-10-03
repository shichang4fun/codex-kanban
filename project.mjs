import {openLocalProjectEditor} from './local-read.mjs';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const failure=(message,status=409)=>Object.assign(Error(message),{status});

// Explicit assignment changes only the native project field. It never changes
// cwd, starts execution, or edits a project container or its sidebar position.
export async function setLocalProject(params,board,{open=openLocalProjectEditor,signal}={}){
  const {threadId,hostId,projectId,expectedProjectId}=params??{};
  if(hostId!=='local'||typeof threadId!=='string'||!uuid.test(threadId)
    ||(projectId!==null&&(typeof projectId!=='string'||!projectId||projectId.length>128))
    ||(expectedProjectId!==null&&(typeof expectedProjectId!=='string'||!expectedProjectId||expectedProjectId.length>128)))
    throw failure('Invalid local project request.',400);
  const task=board.tasks.find(t=>t.id===threadId&&t.hostId==='local'&&!t.sidebarOnly);
  if(!task)
    throw failure('This task is no longer in the board. Refresh and try again.');
  const checkCancellation=()=>{if(signal?.aborted)throw failure('Project change cancelled before writing.');};
  checkCancellation();const client=await open();
  try{
    if(projectId!==null){
      const projects=[];let cursor=null;const seen=new Set();
      do{
        const page=await client.request('project/list',{limit:100,cursor});
        if(!Array.isArray(page?.data))throw failure('Local projects are unavailable.');
        projects.push(...page.data);cursor=page.nextCursor??null;
        if(cursor!==null&&(typeof cursor!=='string'||seen.has(cursor)||projects.length>5000))throw failure('Local projects are unavailable.');
        seen.add(cursor);
      }while(cursor!==null);
      if(projects.filter(p=>p.id===projectId).length!==1)throw failure('This project is no longer available. Refresh and try again.');
    }
    const readTask=async()=>{
      const {thread}=await client.request('thread/read',{threadId,includeTurns:false});
      if(thread?.id!==threadId||thread.ephemeral!==false||thread.parentThreadId!=null||thread.projectId===undefined||thread.archived||thread.isArchived)
        throw failure('This task cannot change projects from the board.');
      if((thread.projectId??null)!==expectedProjectId)throw failure('This task has changed projects. Refresh and try again.');
      return thread;
    };
    await readTask();
    if(projectId===expectedProjectId)return {threadId,projectId,changed:false};
    await readTask();checkCancellation();
    // The native protocol uses an empty string to clear the project; null means
    // leave it unchanged. The HTTP/UI contract uses null for No project.
    await client.request('thread/metadata/update',{threadId,projectId:projectId??''});
    const {thread}=await client.request('thread/read',{threadId,includeTurns:false});
    if(thread?.id!==threadId||thread.projectId!==projectId)throw failure('Project change could not be confirmed. Refresh before trying again.');
    return {threadId,projectId,changed:true};
  }finally{client.close();}
}
