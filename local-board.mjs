import {normalize} from './build.mjs';
import {readWorktreeProjects} from './worktree-projects.mjs';

export const runtimeSnapshotMaxAgeMs=15000;
export function runtimeSnapshotFresh(capturedAt,now){
  const observed=Date.parse(capturedAt),current=Date.parse(now);
  return Number.isFinite(observed)&&Number.isFinite(current)&&current>=observed&&current-observed<=runtimeSnapshotMaxAgeMs;
}

// Local section IDs and Desktop logical IDs are different namespaces. Local
// thread.section is authoritative for local task placement; never combine the IDs.
export function createLocalBoard(reader,desktopSnapshot,{clock=()=>new Date().toISOString(),unreadState={known:false},projectState={known:false}}={}){
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
    // Native project IDs differ from Desktop IDs. Match containers only by
    // exact registered roots; never infer a project from a task's cwd or title.
    const [nativeProjects,nativeSections,recent]=await Promise.all([
      pages('project/list',{limit:100}).catch(error=>{if(error.code===-32601)return null;throw error;}),
      pages('threadSection/list',{limit:100}),
      reader.request('thread/list',{archived:false,useStateDbOnly:true,limit:50,sortKey:'updated_at'})
    ]);
    if(nativeProjects!==null){
      if(nativeProjects.some(p=>typeof p.id!=='string'||!p.id||typeof p.name!=='string'||!p.name.trim()||!Array.isArray(p.roots)||p.roots.some(r=>typeof r?.path!=='string'))
        ||new Set(nativeProjects.map(p=>p.id)).size!==nativeProjects.length)throw Error('Invalid local project catalog.');
    }
    const projectCatalog=(nativeProjects??[]).map(p=>{
      const persisted=projectState.known?projectState.projects.filter(d=>d.nativeProjectId===p.id):[];
      const matches=(desktopSnapshot.projects??[]).filter(d=>d.hostId==='local'&&typeof d.path==='string'&&p.roots.some(r=>r.path===d.path));
      const unique=matches.length===1&&nativeProjects.filter(n=>n.roots.some(r=>r.path===matches[0].path)).length===1;
      const desktopProjectId=persisted.length===1?persisted[0].projectId:unique?matches[0].projectId:null;
      return {projectId:p.id,hostId:'local',label:p.name,...(desktopProjectId?{desktopProjectId}:{})};
    });
    const projectNames=[...(desktopSnapshot.projects??[]),...projectCatalog,
      ...projectCatalog.filter(p=>p.desktopProjectId).map(p=>({...p,projectId:p.desktopProjectId}))];
    if(nativeSections.some(s=>typeof s.id!=='string'||typeof s.name!=='string')
      ||new Set(nativeSections.map(s=>s.id)).size!==nativeSections.length)throw Error('Invalid local group identifiers.');
    if(!Array.isArray(recent?.data))throw Error('Incomplete local task data.');
    const grouped=await Promise.all(nativeSections.map(section=>pages('thread/list',{
      archived:false,useStateDbOnly:true,sectionId:section.id,limit:100,sortKey:'updated_at'
    })));
    const byId=new Map([...recent.data,...grouped.flat()].filter(t=>t.ephemeral===false&&t.parentThreadId==null).map(t=>[t.id,t]));
    // Project pinning does not put its children into threadSection/list pages.
    // Read older children through the unarchived listing; thread/read does not
    // expose an archive flag and cannot prove a task is still on the sidebar.
    const pinnedIds=projectState.known?Object.keys(projectState.assignments).filter(id=>!byId.has(id)
      &&!projectState.projectlessThreadIds.includes(id)&&projectState.pinnedProjectIds.includes(projectState.assignments[id])
      &&projectCatalog.some(p=>p.desktopProjectId===projectState.assignments[id])):[];
    if(pinnedIds.length>5000)throw Error('Pinned projects exceed the current read limit.');
    if(pinnedIds.length){
      const wanted=new Set(pinnedIds),older=await pages('thread/list',{archived:false,useStateDbOnly:true,limit:100,sortKey:'updated_at'});
      for(const t of older)if(wanted.has(t.id)&&t.ephemeral===false&&t.parentThreadId==null&&!t.archived&&!t.isArchived)byId.set(t.id,t);
    }
    const worktreeProjects=await readWorktreeProjects([...new Set([...byId.values()]
      .filter(t=>t.projectId===null&&typeof t.cwd==='string'&&t.cwd.startsWith('/')).map(t=>t.cwd))],nativeProjects??[]);
    const sections=nativeSections.map(s=>({sectionId:s.id,name:s.name,itemKeys:[]}));
    const tasksSection={sectionId:'chats',name:'Tasks',itemKeys:[]};
    const projectsSection={sectionId:'threads',name:'Projects',itemKeys:[]};
    const otherSection={sectionId:'other-hosts',name:'Other hosts (snapshot)',itemKeys:[]};
    const rows=[],capturedAt=clock();
    const runtimeFresh=runtimeSnapshotFresh(desktopSnapshot.capturedAt,capturedAt);
    for(const t of byId.values()){
      if(typeof t.id!=='string'||t.section===undefined)throw Error('Local task is missing its group field.');
      const desktop=desktopTasks.get(`local:${t.id}`);
      const pendingProject=projectState.known&&t.projectId===null&&projectState.pendingThreadIds.includes(t.id)
        &&!projectState.projectlessThreadIds.includes(t.id)
        ?projectCatalog.find(p=>p.desktopProjectId===projectState.assignments[t.id]):null;
      const inheritedProjectId=t.projectId===null?worktreeProjects.get(t.cwd):null;
      const resolvedProjectId=t.projectId??pendingProject?.projectId??inheritedProjectId;
      const nativeProject=projectCatalog.find(p=>p.projectId===resolvedProjectId);
      // Native assignment wins; only verified pending migration or a linked
      // worktree may fill null. A stale Desktop snapshot never does.
      const projectId=resolvedProjectId?(nativeProject?.desktopProjectId??resolvedProjectId)
        :t.projectId!==undefined?null:desktop?.projectId??null;
      let destination;
      if(t.section!==null){
        destination=sections.find(s=>s.sectionId===t.section.id);
        if(!destination)throw Error('Local group changed during reading. Try again.');
      }else if(projectId){
        // Project containers remain a Desktop concept. Use exact project keys,
        // never infer an association by title or folder name.
        const parents=projectState.known&&projectState.pinnedProjectIds.includes(projectId)?[{name:'Pinned'}]
          :(desktopSnapshot.sections??[]).filter(s=>(!projectState.known||s.name!=='Pinned')&&s.itemKeys.includes(`codex:project:${projectId}`));
        const matches=parents.length===1?sections.filter(s=>s.name===parents[0].name):[];
        destination=matches.length===1?matches[0]:projectsSection;
      }else destination=tasksSection;
      destination.itemKeys.push(`codex:thread:local:${t.id}`);
      const pinned=destination.name==='Pinned';
      rows.push({...desktop,id:t.id,kind:'codex',hostId:'local',
        title:t.name??desktop?.title??'Untitled task',summary:desktop?.summary??t.preview??'',
        summarySource:desktop?.summary!=null?'desktopSnapshot':t.preview!=null?'threadPreview':null,
        cwd:t.cwd,updatedAt:t.updatedAt,projectId,localProjectId:t.projectId??null,
        projectSource:t.projectId?'native':pendingProject?'desktopPendingMigration':inheritedProjectId?'worktree':projectId?'desktopSnapshot':null,
        isUnread:unreadState.known?unreadIds.has(t.id):desktop?.isUnread===true,
        unreadSource:unreadState.known?'desktopPersistedReadState':desktop?'desktopSnapshot':'unavailable',
        unreadCapturedAt:unreadState.known?unreadState.capturedAt:desktop?desktopSnapshot.capturedAt:null,
        pinnedIndex:pinned?(desktop?.pinnedIndex??1):undefined,
        nativeTaskPinned:pinned&&t.section!==null,localSectionId:t.section?.id??null,
        placementSource:t.section!==null?'localThreadSection':projectId?'desktopProject':'localDefault',
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
    const board=normalize({threads:rows,pinnedThreads:[],sections,capturedAt,projects:projectNames,
      sidebarCoverage:'Latest 50 unarchived local tasks + all readable grouped tasks · Other hosts use a desktop snapshot · Runtime is read separately'});
    board.source='Official read-only local App Server grouping API';
    board.runtimeCapturedAt=desktopSnapshot.capturedAt??null;
    board.runtimeSnapshotFresh=runtimeFresh;
    board.runtimeSnapshotMaxAgeMs=runtimeSnapshotMaxAgeMs;
    board.projects=projectCatalog;
    board.sync={connected:true,writable:false,scope:'localSections',runtimeLive:false,localUnreadConnected:unreadState.known,projectCatalogConnected:nativeProjects!==null};
    return board;
  }
  return {getBoard(){const next=queue.then(read);queue=next.catch(()=>{});return next;}};
}
