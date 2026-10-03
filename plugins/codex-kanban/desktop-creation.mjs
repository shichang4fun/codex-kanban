import {createHash} from 'node:crypto';
import {openLocalReader} from './local-read.mjs';
import {createDesktopGroups} from './desktop-groups.mjs';
import {bridgeError} from './bridge-transport.mjs';
import {creationSettings,creationArguments} from './creation-options.mjs';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const publicOperation=record=>({requestId:record.requestId,state:record.state,threadId:record.threadId??null,
  clientThreadId:record.clientThreadId??null,hostId:'local',sectionId:record.sectionId,projectId:record.projectId,
  groupAssigned:record.groupAssigned===true,message:record.message??'',title:record.title,updatedAt:record.updatedAt});

export function createDesktopCreation({call,ready=()=>true,openReader=openLocalReader,store,clock=()=>new Date().toISOString()}){
  const groups=createDesktopGroups({call,ready,openReader,allowedGroupNames:null});
  let busy=false;
  const check=signal=>{if(signal?.aborted)throw bridgeError('Creation cancelled before dispatch.',409);if(!ready())throw bridgeError('Launch Codex with the updated Kanban launcher and open a local task.');};
  async function catalog(){
    check();
    const [projectReply,desktop]=await Promise.all([call('list_projects',{}),call('list_threads',{limit:1})]);
    if(!Array.isArray(projectReply?.projects)||!Array.isArray(desktop?.sections)||desktop.unavailableHosts?.includes('local')||desktop.unavailableSources?.length)
      throw bridgeError('Desktop project or group catalog is unavailable.');
    const projects=projectReply.projects.filter(p=>p.projectKind==='local'&&p.hostId==='local');
    if(projects.some(p=>typeof p.projectId!=='string'||!p.projectId||typeof p.label!=='string')||new Set(projects.map(p=>p.projectId)).size!==projects.length)
      throw bridgeError('Desktop project catalog could not be verified.');
    const reader=await openReader();
    async function pages(method){
      const rows=[],seen=new Set();let cursor=null;
      do{
        const page=await reader.request(method,{limit:100,cursor});
        if(!Array.isArray(page?.data))throw bridgeError('Native creation catalog is unavailable.');
        rows.push(...page.data);cursor=page.nextCursor??null;
        if(rows.length>5000||cursor!==null&&(typeof cursor!=='string'||seen.has(cursor)))throw bridgeError('Invalid native creation catalog.');
        seen.add(cursor);
      }while(cursor!==null);
      return rows;
    }
    let native,nativeProjects;
    try{[native,nativeProjects]=await Promise.all([pages('threadSection/list'),pages('project/list')]);}finally{reader.close();}
    if(nativeProjects.some(p=>typeof p.id!=='string'||!p.id||!Array.isArray(p.roots)||p.roots.some(r=>typeof r?.path!=='string'))
      ||new Set(nativeProjects.map(p=>p.id)).size!==nativeProjects.length)throw bridgeError('Native project catalog could not be verified.');
    if(native.some(s=>typeof s.id!=='string'||!s.id||s.id.length>128||typeof s.name!=='string')||new Set(native.map(s=>s.id)).size!==native.length)
      throw bridgeError('Native group catalog could not be verified.');
    const sections=native.filter(s=>{
      if(native.filter(n=>n.name===s.name).length!==1)return false;
      if(s.name==='Pinned')return desktop.sections.some(d=>d.sectionId==='pinned'&&d.name==='Pinned');
      const matches=desktop.sections.filter(d=>d.name===s.name);
      return matches.length===1&&typeof matches[0].sectionId==='string'&&!['pinned','chats','threads'].includes(matches[0].sectionId);
    }).map(s=>({sectionId:s.id,name:s.name}));
    sections.push({sectionId:null,name:'Ungrouped'});
    return {projects:projects.map(({projectId,label,path,isGitRepository})=>{
      const matches=typeof path==='string'?nativeProjects.filter(p=>p.roots.some(r=>r.path===path)):[];
      const nativeProjectId=matches.length===1&&projects.filter(p=>matches[0].roots.some(r=>r.path===p.path)).length===1?matches[0].id:null;
      return {projectId,label,path,nativeProjectId,isGitRepository:isGitRepository===true};
    }),sections};
  }
  const record=async(requestId)=>{
    if(typeof requestId!=='string'||!uuid.test(requestId))throw bridgeError('A creation request ID is required.',400);
    const value=(await store.read())[requestId];if(!value)throw bridgeError('Creation request was not found.',404);return value;
  };
  const save=async value=>{value.updatedAt=clock();await store.update(entries=>{entries[value.requestId]=value;});return publicOperation(value);};
  async function assign(value,context={}){
    try{
      check(context.signal);
      const reader=await openReader();let thread;
      try{thread=(await reader.request('thread/read',{threadId:value.threadId,includeTurns:false})).thread;}finally{reader.close();}
      if(thread?.id!==value.threadId||thread.ephemeral!==false||thread.parentThreadId!=null||thread.archived||thread.isArchived||thread.section===undefined||thread.projectId!==value.nativeProjectId)
        throw bridgeError('Created task identity or project could not be confirmed.',409);
      await groups.move({threadId:value.threadId,hostId:'local',sectionId:value.sectionId,expectedSectionId:thread.section?.id??null},context);
      value.groupAssigned=true;value.message='Task created and group verified.';
    }catch(error){value.groupAssigned=false;value.message='Task created. Group was not confirmed: '+error.message;}
    return save(value);
  }
  return {
    catalog,
    operations:async()=>Object.values(await store.read()).filter(r=>r.state!=='cancelled'&&!r.groupAssigned).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).slice(0,20).map(publicOperation),
    operation:async params=>publicOperation(await record(params?.requestId)),
    async create(params,context={}){
      if(busy)throw bridgeError('Another creation action is in progress.',409);
      busy=true;
      try{
        const {requestId,sectionId}=params??{};
        if(typeof requestId!=='string'||!uuid.test(requestId)||(sectionId!==null&&(typeof sectionId!=='string'||!sectionId)))throw bridgeError('Invalid creation request.',400);
        const settings=creationSettings(params.settings),args=creationArguments(settings,params.prompt);
        if(Buffer.byteLength(JSON.stringify({...args,sectionId}))>7000)throw bridgeError('Creation request is too large.',400);
        const fingerprint=createHash('sha256').update(JSON.stringify({args,sectionId})).digest('hex'),existing=(await store.read())[requestId];
        if(existing){if(existing.fingerprint!==fingerprint)throw bridgeError('This request ID belongs to another task. Check its status before creating another.',409);return publicOperation(existing);}
        check(context.signal);
        const options=await catalog();
        if(!options.sections.some(s=>s.sectionId===sectionId))throw bridgeError('Choose a verified local group.',409);
        const project=settings.projectId?options.projects.find(p=>p.projectId===settings.projectId):null;
        if(settings.projectId&&!project)throw bridgeError('This local project is no longer available.',409);
        if(project&&!project.nativeProjectId)throw bridgeError('This project could not be mapped to its native identity. Create the task in Codex.',409);
        if(settings.environment==='worktree'&&!project?.isGitRepository)throw bridgeError('Worktree creation requires a verified Git project.',400);
        check(context.signal);
        const value={requestId,fingerprint,sectionId,projectId:settings.projectId,nativeProjectId:project?.nativeProjectId??null,title:params.prompt.trim().slice(0,100),state:'unknown',groupAssigned:false,
          message:'Creation was dispatched. Check Codex before starting another task.'};
        // Persist before the non-idempotent tool. A crash or timeout leaves a
        // frozen unknown operation, never a request that may safely create again.
        await save(value);
        try{check(context.signal);}catch(error){value.state='cancelled';value.message='No task was created. '+error.message;return save(value);}
        let reply;
        try{reply=await call('create_thread',args);}catch{return publicOperation(value);}
        if(typeof reply?.hostId==='string'&&reply.hostId!=='local')return publicOperation(value);
        if(typeof reply?.threadId==='string'&&uuid.test(reply.threadId)){
          value.state='created';value.threadId=reply.threadId;value.message='Task created; group verification is pending.';
          await save(value);return assign(value,context);
        }
        if(typeof reply?.clientThreadId==='string'&&reply.clientThreadId){
          value.state='pending';value.clientThreadId=reply.clientThreadId;
          value.message='Worktree setup is queued in Codex. After setup, assign its group in the Codex sidebar. Creation will not be repeated.';
          return save(value);
        }
        return publicOperation(value);
      }finally{busy=false;}
    },
    async retryGroup(params,context={}){
      if(busy)throw bridgeError('Another creation action is in progress.',409);
      busy=true;try{
        const value=await record(params?.requestId);
        if(value.state!=='created'||!value.threadId)throw bridgeError('A confirmed task ID is required before assigning a group.',409);
        if(value.groupAssigned)return publicOperation(value);
        return assign(value,context);
      }finally{busy=false;}
    }
  };
}
