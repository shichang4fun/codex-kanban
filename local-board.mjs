import {normalize} from './build.mjs';

export const runtimeSnapshotMaxAgeMs=15000;
export function runtimeSnapshotFresh(capturedAt,now){
  const observed=Date.parse(capturedAt),current=Date.parse(now);
  return Number.isFinite(observed)&&Number.isFinite(current)&&current>=observed&&current-observed<=runtimeSnapshotMaxAgeMs;
}

// Local section IDs and Desktop logical IDs are different namespaces. Local
// thread.section is authoritative for local task placement; never combine the IDs.
export function createLocalBoard(reader,desktopSnapshot,{clock=()=>new Date().toISOString(),unreadState={known:false}}={}){
  let queue=Promise.resolve();
  const unreadIds=new Set(unreadState.ids??[]);
  const desktopTasks=new Map([...desktopSnapshot.threads??[],...desktopSnapshot.pinnedThreads??[]]
    .filter(t=>t.kind==='codex'&&!t.sidebarOnly).map(t=>[`${t.hostId}:${t.id}`,t]));
  async function pages(method,params){
    const rows=[],seen=new Set();let cursor=null;
    do{
      const page=await reader.request(method,{...params,cursor});
      if(!Array.isArray(page?.data))throw Error('Incomplete local group data.');
      rows.push(...page.data);cursor=page.nextCursor??null;
      if(cursor!==null&&(typeof cursor!=='string'||seen.has(cursor)))throw Error('Invalid local pagination.');
      seen.add(cursor);
      if(rows.length>5000)throw Error('Local groups exceed the current read limit.');
    }while(cursor!==null);
    return rows;
  }
  async function read(){
    const nativeSections=await pages('threadSection/list',{limit:100});
    if(nativeSections.some(s=>typeof s.id!=='string'||typeof s.name!=='string')
      ||new Set(nativeSections.map(s=>s.id)).size!==nativeSections.length)throw Error('Invalid local group identifiers.');
    const recent=await reader.request('thread/list',{archived:false,useStateDbOnly:true,limit:50,sortKey:'updated_at'});
    if(!Array.isArray(recent?.data))throw Error('Incomplete local task data.');
    const grouped=await Promise.all(nativeSections.map(section=>pages('thread/list',{
      archived:false,useStateDbOnly:true,sectionId:section.id,limit:100,sortKey:'updated_at'
    })));
    const byId=new Map([...recent.data,...grouped.flat()].filter(t=>t.ephemeral===false&&t.parentThreadId==null).map(t=>[t.id,t]));
    const sections=nativeSections.map(s=>({sectionId:s.id,name:s.name,itemKeys:[]}));
    const tasksSection={sectionId:'chats',name:'Tasks',itemKeys:[]};
    const projectsSection={sectionId:'threads',name:'Projects',itemKeys:[]};
    const otherSection={sectionId:'other-hosts',name:'Other hosts (snapshot)',itemKeys:[]};
    const rows=[],capturedAt=clock();
    const runtimeFresh=runtimeSnapshotFresh(desktopSnapshot.capturedAt,capturedAt);
    for(const t of byId.values()){
      if(typeof t.id!=='string'||t.section===undefined)throw Error('Local task is missing its group field.');
      const desktop=desktopTasks.get(`local:${t.id}`);
      let destination;
      if(t.section!==null){
        destination=sections.find(s=>s.sectionId===t.section.id);
        if(!destination)throw Error('Local group changed during reading. Try again.');
      }else if(desktop?.projectId){
        // Project containers remain a Desktop concept. Use exact project keys,
        // never infer an association by title or folder name.
        const parents=(desktopSnapshot.sections??[]).filter(s=>s.itemKeys.includes(`codex:project:${desktop.projectId}`));
        const matches=parents.length===1?sections.filter(s=>s.name===parents[0].name):[];
        destination=matches.length===1?matches[0]:projectsSection;
      }else destination=tasksSection;
      destination.itemKeys.push(`codex:thread:local:${t.id}`);
      const pinned=destination.name==='Pinned';
      rows.push({...desktop,id:t.id,kind:'codex',hostId:'local',
        title:t.name??desktop?.title??'Untitled task',summary:desktop?.summary??t.preview??'',
        cwd:t.cwd,updatedAt:t.updatedAt,projectId:desktop?.projectId??null,
        isUnread:unreadState.known?unreadIds.has(t.id):desktop?.isUnread===true,
        unreadSource:unreadState.known?'desktopPersistedReadState':desktop?'desktopSnapshot':'unavailable',
        unreadCapturedAt:unreadState.known?unreadState.capturedAt:desktop?desktopSnapshot.capturedAt:null,
        pinnedIndex:pinned?(desktop?.pinnedIndex??1):undefined,
        nativeTaskPinned:pinned&&t.section!==null,localSectionId:t.section?.id??null,
        placementSource:t.section!==null?'localThreadSection':desktop?.projectId?'desktopProject':'localDefault',
        // A separate reader cannot observe the active writer's execution state.
        status:desktop&&runtimeFresh?desktop.status:'unknown',runtimeStatusSource:desktop?'desktopSnapshot':'unavailable',
        runtimeStatusStale:!!desktop&&!runtimeFresh,lastObservedStatus:desktop?.status,lastObservedAt:desktop?desktopSnapshot.capturedAt:null});
    }
    for(const t of desktopTasks.values()){
      if(t.hostId==='local'||!t.hostId)continue;
      rows.push({...t,unreadSource:'desktopSnapshot',unreadCapturedAt:desktopSnapshot.capturedAt,status:runtimeFresh?t.status:'unknown',placementSource:'desktopSnapshot',runtimeStatusSource:'desktopSnapshot',
        runtimeStatusStale:!runtimeFresh,lastObservedStatus:t.status,lastObservedAt:desktopSnapshot.capturedAt});
      otherSection.itemKeys.push(`codex:thread:${t.hostId}:${t.id}`);
    }
    sections.push(tasksSection);
    if(projectsSection.itemKeys.length)sections.push(projectsSection);
    if(otherSection.itemKeys.length)sections.push(otherSection);
    const board=normalize({threads:rows,pinnedThreads:[],sections,capturedAt,projects:desktopSnapshot.projects,
      sidebarCoverage:'Latest 50 unarchived local tasks + all readable grouped tasks · Other hosts use a desktop snapshot · Runtime is read separately'});
    board.source='Official read-only local App Server grouping API';
    board.runtimeCapturedAt=desktopSnapshot.capturedAt??null;
    board.runtimeSnapshotFresh=runtimeFresh;
    board.runtimeSnapshotMaxAgeMs=runtimeSnapshotMaxAgeMs;
    board.sync={connected:true,writable:false,scope:'localSections',runtimeLive:false,localUnreadConnected:unreadState.known};
    return board;
  }
  return {getBoard(){const next=queue.then(read);queue=next.catch(()=>{});return next;}};
}
