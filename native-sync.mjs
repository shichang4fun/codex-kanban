import {normalize} from './build.mjs';

export const nativeGroupNames=['For Later','In Progress','For Review'];
export function syncError(code,message){return Object.assign(new Error(message),{code});}
export function nativeMemberKey(task){return `codex:thread:${task.hostId}:${task.id}`;}
export function sectionFor(snapshot,task){
  const matches=snapshot.sections.filter(section=>section.itemKeys?.includes(nativeMemberKey(task)));
  if(matches.length>1)throw syncError('AMBIGUOUS_MEMBERSHIP','任务同时出现在多个原生分组，已停止同步。');
  return matches[0]?.sectionId??null;
}
export function createNativeSync({call,canWrite=async()=>false,clock=()=>new Date().toISOString()}){
  let queue=Promise.resolve(),revision=0;
  const serial=operation=>{const next=queue.then(operation);queue=next.catch(()=>{});return next;};
  async function read(){
    const snapshot=await call('list_threads',{limit:50});
    if(!Array.isArray(snapshot?.threads)||!Array.isArray(snapshot.pinnedThreads)||!Array.isArray(snapshot.sections)
      ||snapshot.unavailableHosts?.includes('local')||snapshot.unavailableSources?.length)
      throw syncError('DESKTOP_UNAVAILABLE','无法读取本机 Codex 分组，未执行移动。');
    for(const section of snapshot.sections){
      if(typeof section.sectionId!=='string'||typeof section.name!=='string'||!Array.isArray(section.itemKeys))
        throw syncError('INVALID_SNAPSHOT','原生分组数据不完整，已停止同步。');
    }
    const ids=snapshot.sections.map(s=>s.sectionId);
    if(new Set(ids).size!==ids.length)throw syncError('INVALID_SNAPSHOT','原生分组 ID 重复，已停止同步。');
    return {...snapshot,capturedAt:clock()};
  }
  async function board(snapshot){
    const data=normalize(snapshot);
    data.sync={...data.sync,connected:true,writable:await canWrite(),revision:++revision};
    return data;
  }
  function find(snapshot,id,hostId){
    const matches=[...snapshot.threads,...snapshot.pinnedThreads].filter(t=>t.kind==='codex'&&t.id===id&&t.hostId===hostId);
    const tasks=new Map(matches.map(t=>[nativeMemberKey(t),t]));
    if(tasks.size!==1)throw syncError('TASK_NOT_VISIBLE','该任务不在当前快照中，请刷新后重试。');
    const task=[...tasks.values()][0];
    if(task.archived||task.isArchived||task.ephemeral||task.parentThreadId)
      throw syncError('PROTECTED_TASK','此类任务暂不支持原生分组移动。');
    return task;
  }
  return {
    getBoard:()=>serial(async()=>board(await read())),
    moveTask:(params,{signal}={})=>serial(async()=>{
      const checkCancellation=()=>{if(signal?.aborted)throw syncError('MOVE_CANCELLED','请求已结束，未继续写入原生分组。');};
      checkCancellation();
      const {threadId,hostId,sectionId,expectedSectionId}=params??{};
      if(hostId!=='local')throw syncError('HOST_UNSUPPORTED','第一版本仅支持本机任务的原生分组同步。');
      if(typeof threadId!=='string'||!/^[0-9a-f-]{36}$/i.test(threadId)||typeof sectionId!=='string'
        ||(expectedSectionId!==null&&typeof expectedSectionId!=='string'))
        throw syncError('INVALID_MOVE','任务或分组参数无效。');
      if(!await canWrite())throw syncError('POLICY_CONFLICT','Sidebar Flow 的自动分类策略尚未协调，原生拖拽已禁用。');
      const before=await read(),task=find(before,threadId,hostId),current=sectionFor(before,task);
      const destination=before.sections.filter(s=>s.sectionId===sectionId&&nativeGroupNames.includes(s.name));
      if(destination.length!==1)throw syncError('DESTINATION_CHANGED','目标原生分组已变化，请刷新后重试。');
      if(current==='pinned'||before.pinnedThreads.some(t=>t.id===threadId&&t.hostId===hostId))
        throw syncError('PROTECTED_TASK','置顶任务暂不支持拖拽到原生分组。');
      if(current!==expectedSectionId)throw syncError('STALE_MOVE','任务已在侧边栏移动，请查看最新分组后重试。');
      if(current===sectionId)return {board:await board(before),changed:false};
      const detail=await call('read_thread',{threadId,hostId:'local',turnLimit:1,includeOutputs:false,maxOutputCharsPerItem:1});
      const latest=detail?.thread;
      if(latest?.id!==threadId||latest.hostId!=='local'||latest.kind!=='codex'
        ||latest.archived||latest.isArchived||latest.ephemeral||latest.parentThreadId
        ||(Object.hasOwn(latest,'projectId')&&latest.projectId!==task.projectId))
        throw syncError('IDENTITY_CHANGED','无法确认该本机任务的身份，未执行移动。');
      const adjacent=await read(),adjacentTask=find(adjacent,threadId,hostId);
      if(sectionFor(adjacent,adjacentTask)!==current||adjacentTask.projectId!==task.projectId
        ||!adjacent.sections.some(s=>s.sectionId===sectionId&&s.name===destination[0].name)||!await canWrite())
        throw syncError('STALE_MOVE','分组或自动分类策略已变化，未执行移动。');
      let acknowledgement;
      checkCancellation();
      try{acknowledgement=await call('move_thread_to_sidebar_section',{threadId,hostId:'local',source:'codex',sectionId});}
      catch{throw syncError('WRITE_UNCONFIRMED','未能确认原生移动结果，请刷新检查；不会自动重试写入。');}
      const after=await read(),afterTask=find(after,threadId,hostId);
      if(acknowledgement?.threadId!==threadId||acknowledgement.hostId!=='local'||acknowledgement.sectionId!==sectionId
        ||sectionFor(after,afterTask)!==sectionId||afterTask.projectId!==task.projectId)
        throw syncError('READBACK_MISMATCH','原生分组未确认或被自动分类覆盖，已恢复权威分组显示。');
      return {board:await board(after),changed:true};
    })
  };
}
