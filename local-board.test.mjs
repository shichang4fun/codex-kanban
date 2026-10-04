import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocalBoard,runtimeSnapshotFresh} from './local-board.mjs';

const id='11111111-1111-4111-8111-111111111111';

test('native project removal stays authoritative across stale snapshots and fresh readers',async()=>{
  const f=fixture();f.row.projectId='native-a';f.row.section=null;
  f.desktop.threads[0].projectId='desktop-a';f.desktop.projects=[{projectId:'desktop-a',hostId:'local',label:'Old project',path:'/a'}];
  let fail=false;
  const reader={request:(method,params)=>{
    if(method!=='project/list')return f.reader.request(method,params);
    if(fail)throw Error('Temporary project catalog disconnection');
    return {data:[{id:'native-a',name:'Project A',roots:[{path:'/a'}]}]};
  }};
  const controller=createLocalBoard(reader,f.desktop);
  assert.equal((await controller.getBoard()).tasks.find(t=>t.id===id).projectName,'Project A');
  f.row.projectId=null;
  for(const source of [controller,createLocalBoard(reader,f.desktop)]){
    const task=(await source.getBoard()).tasks.find(t=>t.id===id);
    assert.equal(task.projectId,null);assert.equal(task.projectName,null);assert.equal(task.nativeSectionId,'chats');
  }
  fail=true;await assert.rejects(controller.getBoard(),/Temporary project catalog/);
});

test('invalid native project catalogs fail the read instead of restoring legacy project labels',async()=>{
  const f=fixture(),reader={request:(method,params)=>method==='project/list'?{data:[{id:'bad'}]}:f.reader.request(method,params)};
  await assert.rejects(createLocalBoard(reader,f.desktop).getBoard(),/Invalid local project catalog/);
});
function fixture(){
  const row={id,name:'Example',ephemeral:false,parentThreadId:null,section:{id:'local-review',name:'For Review'},status:{type:'notLoaded'},projectId:null};
  const desktop={capturedAt:'2026-10-03T00:00:00Z',threads:[{id,kind:'codex',hostId:'local',title:'Example',status:'active'}],pinnedThreads:[],sections:[{sectionId:'chats',name:'Tasks',itemKeys:[`codex:thread:local:${id}`]}]};
  const calls=[];
  const reader={request:async(method,p)=>{calls.push({method,params:p});
    if(method==='project/list')throw Object.assign(Error('Unsupported project catalog'),{code:-32601});
    if(method==='threadSection/list')return {data:[{id:'local-review',name:'For Review'}]};
    if(method==='thread/list')return {data:p.sectionId?[row,{...row,id:'old',name:'Older grouped task'}]:[row]};
    throw Error('Unexpected method');}};
  return {row,desktop,calls,reader};
}
test('projects, sections and recent tasks start together instead of waiting for one another',{timeout:1000},async()=>{
  const f=fixture(),started=new Set(),waiters=[];
  const reader={async request(method,params){
    if(!params.sectionId){
      started.add(method);await new Promise(resolve=>{waiters.push(resolve);if(started.size===3)waiters.forEach(done=>done());});
    }
    return f.reader.request(method,params);
  }};
  const board=await createLocalBoard(reader,f.desktop).getBoard();assert.equal(started.size,3);assert(board.tasks.length);
});
test('summary provenance survives normalization without claiming to be latest activity',async()=>{
  const f=fixture();f.row.preview='Local preview';f.desktop.threads[0].summary='Snapshot summary';
  let task=(await createLocalBoard(f.reader,f.desktop).getBoard()).tasks.find(t=>t.id===id);
  assert.equal(task.summary,'Snapshot summary');assert.equal(task.summarySource,'desktopSnapshot');
  delete f.desktop.threads[0].summary;
  task=(await createLocalBoard(f.reader,f.desktop).getBoard()).tasks.find(t=>t.id===id);
  assert.equal(task.summary,'Local preview');assert.equal(task.summarySource,'threadPreview');
  delete f.row.preview;
  task=(await createLocalBoard(f.reader,f.desktop).getBoard()).tasks.find(t=>t.id===id);
  assert.equal(task.summary,'');assert.equal(task.summarySource,null);
});
test('local placement wins over stale Desktop membership without inventing live runtime state',async()=>{
  const f=fixture(),board=await createLocalBoard(f.reader,f.desktop,{clock:()=> '2026-10-03T00:00:01Z'}).getBoard();
  const task=board.tasks.find(t=>t.id===id);
  assert.equal(task.nativeSectionId,'local-review');assert.equal(task.column,'running');
  assert.equal(board.tasks.find(t=>t.id==='old').column,'unknown');
  assert.equal(board.runtimeCapturedAt,f.desktop.capturedAt);assert.equal(board.sync.runtimeLive,false);
  assert.equal(board.sync.writable,false);
  assert(f.calls.filter(c=>c.method==='thread/list').every(c=>c.params.archived===false&&c.params.useStateDbOnly===true));
});
test('expired snapshots cannot keep completed tasks spinning as running',async()=>{
  const f=fixture(),board=await createLocalBoard(f.reader,f.desktop,{clock:()=> '2026-10-03T00:00:16Z'}).getBoard();
  const task=board.tasks.find(t=>t.id===id);
  assert.equal(task.column,'unknown');assert.equal(task.rawStatus,'unknown');assert.equal(task.runtimeStatusStale,true);
  assert.equal(task.lastObservedStatus,'active');assert.equal(task.lastObservedAt,f.desktop.capturedAt);
  assert.equal(task.nativeSectionId,'local-review');assert.equal(board.runtimeSnapshotFresh,false);
});
test('missing, invalid or future snapshot timestamps never establish current execution',()=>{
  for(const value of [undefined,'invalid','2026-10-03T00:01:00Z'])assert.equal(runtimeSnapshotFresh(value,'2026-10-03T00:00:00Z'),false);
  assert.equal(runtimeSnapshotFresh('2026-10-03T00:00:00Z','2026-10-03T00:00:15Z'),true);
  assert.equal(runtimeSnapshotFresh('2026-10-03T00:00:00Z','2026-10-03T00:00:15.001Z'),false);
});
test('a native section edit appears on the next read with no writes or model execution',async()=>{
  const f=fixture(),controller=createLocalBoard(f.reader,f.desktop);
  await controller.getBoard();f.row.section=null;
  const task=(await controller.getBoard()).tasks.find(t=>t.id===id);
  assert.equal(task.nativeSectionId,'chats');
  assert(f.calls.every(c=>['project/list','threadSection/list','thread/list'].includes(c.method)));
});
test('ephemeral and subagent records are excluded from native task columns',async()=>{
  const f=fixture();f.row.ephemeral=true;
  assert.equal((await createLocalBoard(f.reader,f.desktop).getBoard()).tasks.length,0);
});
test('formal project labels use exact host and project ID, never workspace basenames',async()=>{
  const f=fixture();f.row.cwd='/workspace/generated-prompt-slug';
  delete f.row.projectId; // Legacy readers lack the assignment field.
  f.desktop.threads[0].projectId='tools';
  f.desktop.projects=[{projectId:'tools',hostId:'remote-control:test',label:'Wrong host'},
    {projectId:'tools',hostId:'local',label:'Tools'}];
  const task=(await createLocalBoard(f.reader,f.desktop).getBoard()).tasks.find(t=>t.id===id);
  assert.equal(task.projectName,'Tools');assert.equal(task.cwd,f.row.cwd);
  f.desktop.threads[0].projectId=null;f.row.projectId='tools';
  assert.equal((await createLocalBoard(f.reader,f.desktop).getBoard()).tasks.find(t=>t.id===id).projectName,'Tools');
  f.row.projectId=null;
  f.desktop.threads[0].projectId='unregistered';
  assert.equal((await createLocalBoard(f.reader,f.desktop).getBoard()).tasks.find(t=>t.id===id).projectName,null);
});
test('current local unread markers override stale flags and the next read sees removals',async()=>{
  const f=fixture();f.desktop.threads[0].isUnread=false;
  f.desktop.threads.push({id,kind:'codex',hostId:'durable',title:'Cloud copy',isUnread:false});
  const state={known:true,ids:[id],capturedAt:'2026-10-03T00:01:00Z'};
  const first=await createLocalBoard(f.reader,f.desktop,{unreadState:state}).getBoard();
  assert.equal(first.tasks.find(t=>t.id===id&&t.hostId==='local').isUnread,true);
  assert.equal(first.tasks.find(t=>t.id===id&&t.hostId==='durable').isUnread,false);
  assert.equal(first.tasks.find(t=>t.id===id&&t.hostId==='local').unreadSource,'desktopPersistedReadState');
  state.ids=[];f.desktop.threads[0].isUnread=true;
  const next=await createLocalBoard(f.reader,f.desktop,{unreadState:state}).getBoard();
  assert.equal(next.tasks.find(t=>t.id===id&&t.hostId==='local').isUnread,false);
});

test('native project changes override stale Desktop labels and map inherited containers only through exact registered roots',async()=>{
  const f=fixture();f.row.projectId='native-b';f.row.section=null;
  f.desktop.threads[0].projectId='desktop-a';
  f.desktop.projects=[{projectId:'desktop-a',hostId:'local',label:'Same name',path:'/a'},
    {projectId:'desktop-b',hostId:'local',label:'Stale label',path:'/b'},
    {projectId:'remote-b',hostId:'durable',label:'Wrong host',path:'/b'}];
  f.desktop.sections=[{sectionId:'desktop-review',name:'For Review',itemKeys:['codex:project:desktop-b']}];
  const reader={request:async(method,p)=>method==='project/list'?p.cursor?{data:[{id:'native-b',name:'New project',roots:[{path:'/b'}]}]}:
    {data:[{id:'native-a',name:'Same name',roots:[{path:'/a'}]}],nextCursor:'next'}:f.reader.request(method,p)};
  const controller=createLocalBoard(reader,f.desktop),first=await controller.getBoard(),task=first.tasks.find(t=>t.id===id);
  assert.equal(task.projectId,'desktop-b');assert.equal(task.localProjectId,'native-b');assert.equal(task.projectName,'New project');
  assert.equal(task.nativeSectionId,'local-review');assert(first.sync.projectCatalogConnected);
  assert.equal(first.projects.find(p=>p.projectId==='native-b').desktopProjectId,'desktop-b');
  f.row.projectId='native-a';const next=(await controller.getBoard()).tasks.find(t=>t.id===id);
  assert.equal(next.projectName,'Same name');assert.equal(next.localProjectId,'native-a');
  f.desktop.projects.push({projectId:'duplicate-root',hostId:'local',label:'Another name',path:'/b'});
  assert.equal((await controller.getBoard()).projects.find(p=>p.projectId==='native-b').desktopProjectId,undefined);
});
test('a pinned project container does not imply that its task is individually pinned',async()=>{
  const f=fixture();f.row.section=null;f.row.projectId='tools';f.desktop.threads[0].projectId='tools';
  f.desktop.sections=[{sectionId:'pinned',name:'Pinned',itemKeys:['codex:project:tools']}];
  const reader={request:async(method)=>method==='project/list'?{data:[{id:'tools',name:'Tools',roots:[]}]}:method==='threadSection/list'?{data:[{id:'local-pinned',name:'Pinned'}]}:{data:[f.row]}};
  const task=(await createLocalBoard(reader,f.desktop).getBoard()).tasks[0];
  assert.equal(task.nativeSectionId,'local-pinned');assert.equal(task.pinned,true);
  assert.equal(task.nativeTaskPinned,false);assert.equal(task.placementSource,'desktopProject');
  f.row.section={id:'local-pinned',name:'Pinned'};
  assert.equal((await createLocalBoard(reader,f.desktop).getBoard()).tasks[0].nativeTaskPinned,true);
});
test('an individual group overrides project placement and clearing it restores project inheritance',async()=>{
  const f=fixture();f.row.section=null;f.row.projectId='tools';f.desktop.threads[0].projectId='tools';
  f.desktop.projects=[{projectId:'tools',hostId:'local',label:'Tools'}];
  f.desktop.sections=[{sectionId:'pinned',name:'Pinned',itemKeys:['codex:project:tools']}];
  const reader={request:async(method)=>method==='project/list'?{data:[{id:'tools',name:'Tools',roots:[]}]}:method==='threadSection/list'?{data:[{id:'local-pinned',name:'Pinned'},{id:'local-review',name:'For Review'}]}:{data:[f.row]}};
  const controller=createLocalBoard(reader,f.desktop),before=structuredClone(f.desktop);
  assert.equal((await controller.getBoard()).tasks[0].nativeSectionId,'local-pinned');
  f.row.section={id:'local-review',name:'For Review'};
  const moved=(await controller.getBoard()).tasks[0];
  assert.equal(moved.nativeSectionId,'local-review');assert.equal(moved.placementSource,'localThreadSection');
  assert.equal(moved.projectId,'tools');assert.equal(moved.projectName,'Tools');assert.equal(moved.pinned,false);
  f.row.section=null;
  const cleared=(await controller.getBoard()).tasks[0];
  assert.equal(cleared.nativeSectionId,'local-pinned');assert.equal(cleared.placementSource,'desktopProject');
  assert.equal(cleared.nativeTaskPinned,false);assert.deepEqual(f.desktop,before);
});
