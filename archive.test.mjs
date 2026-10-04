import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script,createContext} from 'node:vm';
import {archiveLocalTask,restoreArchivedTask} from './archive.mjs';
import {createKanbanServer} from './serve.mjs';
import {createKanbanService} from './kanban-service.mjs';

const id='11111111-1111-4111-8111-111111111111';
const task={id,hostId:'local',title:'Fixture task'};
const params={threadId:id,hostId:'local'};
function fixture({invalid=false,confirmed=true,commandFails=false}={}){
  const calls=[];let closed=false;
  const client={close(){closed=true;},async request(method,p){
    calls.push({method,params:p});
    if(method==='thread/read')return {thread:{id,cwd:'/fixture',ephemeral:invalid,parentThreadId:null}};
    if(method==='thread/archive'){if(commandFails)throw Error('Unavailable');return {};}
    if(method==='thread/list')return p.cursor?{data:confirmed?[{id}]:[]}:{data:[],nextCursor:'next'};
    throw Error('Unexpected method');
  }};
  return {calls,client,get closed(){return closed;},open:async()=>client};
}
test('archive commands target only the exact local task and require paginated archived readback',async()=>{
  const f=fixture();
  assert.deepEqual(await archiveLocalTask(params,{tasks:[task]},f),{archived:true,threadId:id});
  assert.deepEqual(f.calls.map(c=>c.method),['thread/read','thread/archive','thread/list','thread/list']);
  assert.deepEqual(f.calls[1].params,{threadId:id});
  assert(f.calls.slice(2).every(c=>c.params.archived===true&&c.params.useStateDbOnly===true&&c.params.cwd==='/fixture'));
  assert(f.closed);
});
test('remote, malformed, missing and sidebar-only tasks never open a writer',async()=>{
  let opens=0;const open=async()=>{opens++;throw Error('Must not open');};
  for(const p of [{...params,hostId:'durable'},{...params,threadId:'bad'},null])await assert.rejects(archiveLocalTask(p,{tasks:[task]},{open}));
  await assert.rejects(archiveLocalTask(params,{tasks:[]},{open}));
  await assert.rejects(archiveLocalTask(params,{tasks:[{...task,sidebarOnly:true}]},{open}));
  assert.equal(opens,0);
});
test('ephemeral or subagent records are rejected before mutation',async()=>{
  const f=fixture({invalid:true});await assert.rejects(archiveLocalTask(params,{tasks:[task]},f));
  assert.deepEqual(f.calls.map(c=>c.method),['thread/read']);assert(f.closed);
  const sub=fixture();sub.client.request=async()=>({thread:{id,cwd:'/fixture',ephemeral:false,parentThreadId:'parent'}});
  await assert.rejects(archiveLocalTask(params,{tasks:[task]},sub));assert(sub.closed);
});
test('command errors and unconfirmed archives fail without claiming success and close the writer',async()=>{
  for(const options of [{commandFails:true},{confirmed:false}]){
    const f=fixture(options);await assert.rejects(archiveLocalTask(params,{tasks:[task]},f));assert(f.closed);
  }
});
test('HTTP archive requires local origin and CSRF; invalid native moves are rejected',async()=>{
  let calls=0;const server=createKanbanServer({port:8878,getBoard:async()=>({tasks:[task],sync:{connected:true}}),archiveTask:async()=>{calls++;return {archived:true,threadId:id};}});
  await new Promise(resolve=>server.listen(8878,'127.0.0.1',resolve));
  try{
    const url='http://127.0.0.1:8878',get=await (await fetch(url+'/api/board')).json();
    const headers={'Content-Type':'application/json','X-Kanban-Token':get.csrf};
    assert.equal(get.board.sync.archiveLocal,true);
    for(const bad of [{...headers,'X-Kanban-Token':'wrong'},{...headers,Origin:'http://evil.test'}])
      assert.equal((await fetch(url+'/api/archive',{method:'POST',headers:bad,body:JSON.stringify(params)})).status,403);
    assert.equal((await fetch(url+'/api/archive',{method:'POST',headers,body:'bad'})).status,400);
    assert.equal((await fetch(url+'/api/move',{method:'POST',headers,body:'{}'})).status,503);
    assert.equal(calls,0);
    const success=await fetch(url+'/api/archive',{method:'POST',headers,body:JSON.stringify(params)});
    assert.equal(success.status,200);assert.equal((await success.json()).archived,true);assert.equal(calls,1);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
test('polls wait for archive completion and concurrent archives cannot duplicate writes',async()=>{
  let finish,started;const began=new Promise(resolve=>started=resolve);
  let archived=false;
  const server=createKanbanServer({port:8879,getBoard:async()=>({tasks:archived?[]:[task],sync:{connected:true}}),
    archiveTask:async()=>{started();await new Promise(resolve=>finish=resolve);archived=true;return {archived:true,threadId:id};}});
  await new Promise(resolve=>server.listen(8879,'127.0.0.1',resolve));
  try{
    const url='http://127.0.0.1:8879',get=await (await fetch(url+'/api/board')).json();
    const options={method:'POST',headers:{'Content-Type':'application/json','X-Kanban-Token':get.csrf},body:JSON.stringify(params)};
    const write=fetch(url+'/api/archive',options);await began;
    assert.equal((await fetch(url+'/api/archive',options)).status,409);
    const poll=fetch(url+'/api/board');finish();
    assert.equal((await (await write).json()).board.tasks.length,0);
    assert.equal((await (await poll).json()).board.tasks.length,0);
  }finally{await new Promise(resolve=>server.close(resolve));}
});

const html=readFileSync(new URL('./ui.html',import.meta.url),'utf8');
function ui(fetch){
  const messages=[],renders=[],timers=new Map();let timerId=0;
  const context=createContext({nativeConnected:true,nativeToken:'csrf',nativeEpoch:0,nativePending:false,selectedTask:null,
    DATA:{tasks:[task],sync:{archiveLocal:true}},taskKey:t=>t.hostId+':'+t.id,taskUrl:t=>t.hostId==='local'?'codex://fixture':null,
    render:options=>renders.push(options),refreshSummary(){},refreshNativeBoard:async()=>{},
    $:()=>({replaceChildren(){},append(){}}),
    el:()=>({append(){},setAttribute(){}}),icon:()=>({}),
    setTimeout:(callback,delay)=>{const key=++timerId;timers.set(key,{callback,delay});return key;},clearTimeout:key=>timers.delete(key),
    applyNativeBoard:board=>context.DATA=board,announce:message=>messages.push(message),fetch});
  const api=new Script(html.match(/let archivingKey=null;[\s\S]*?(?=let nativeMessage)/)[0]+'\n({archiveTask,canArchive,get pending(){return archivingKey;}})').runInContext(context);
  return {api,context,messages,renders,timers};
}
test('confirmed archive overrides stale board reads and prevents a second archive write',async t=>{
  let visible=true,writes=0;
  const remote={...task,hostId:'durable'};
  const board=()=>({tasks:visible?[task,remote]:[remote],sections:[{sectionId:'review',itemKeys:['codex:thread:local:'+id,'codex:thread:durable:'+id]}],sync:{connected:true}});
  const service=createKanbanService({getBoard:async()=>board(),archiveTask:async()=>{writes++;return {archived:true,threadId:id};},
    restoreTask:async()=>({restored:true,threadId:id}),settingsStore:{read:async()=>({})}});
  t.after(()=>service.close());
  const result=await service.action('archive',params);
  assert.deepEqual(result.board.tasks,[remote]);
  assert.deepEqual(result.board.sections[0].itemKeys,['codex:thread:durable:'+id]);
  assert.deepEqual((await service.read()).board.tasks,[remote]);
  await assert.rejects(service.action('archive',params),{status:409});
  assert.equal(writes,1);assert.equal((await service.read()).undoArchives.length,1);
  visible=false;await service.read();
  visible=true; // An external restore after the reader caught up must be visible.
  assert.equal((await service.read()).board.tasks.length,2);
  const again=await service.action('archive',params);
  assert.equal(writes,2);assert.equal((await service.read()).undoArchives.length,1);
  await assert.rejects(service.action('unarchive',{undoToken:result.undoToken}),{status:409});
  await service.action('unarchive',{undoToken:again.undoToken});
  assert.equal((await service.read()).board.tasks.length,2);
});
test('verified Undo stays visible through stale reads, preserves metadata and follows later external archive',async t=>{
  const original={...task,nativeSectionId:'review',localSectionId:'review',projectId:'project',projectName:'Fixture project'};
  const remote={...original,hostId:'durable'};let visible=true,writes=0,restores=0;
  const service=createKanbanService({getBoard:async()=>({tasks:visible?[original,remote]:[remote],sections:[],sync:{connected:true}}),
    archiveTask:async()=>{writes++;return {archived:true,threadId:id};},restoreTask:async()=>{restores++;return {restored:true,threadId:id};},settingsStore:{read:async()=>({})}});
  t.after(()=>service.close());
  const archived=await service.action('archive',params);visible=false;await service.read();
  const result=await service.action('unarchive',{undoToken:archived.undoToken});
  assert.deepEqual(result.board.tasks,[remote,original]);assert.equal((await service.read()).undoArchives.length,0);
  assert.deepEqual((await service.read()).board.tasks,[remote,original]);
  await assert.rejects(service.action('unarchive',{undoToken:archived.undoToken}),{status:409});assert.equal(restores,1);
  const again=await service.action('archive',params);assert.deepEqual(again.board.tasks,[remote]);assert.equal(writes,2);
  await service.action('unarchive',{undoToken:again.undoToken});
  visible=true;assert.deepEqual((await service.read()).board.tasks,[original,remote]);
  visible=false;assert.deepEqual((await service.read()).board.tasks,[remote]);
});
test('a restored recovery snapshot cannot authorize metadata edits until the reader catches up',async t=>{
  let visible=true,renames=0;const service=createKanbanService({getBoard:async()=>({tasks:visible?[task]:[],sync:{connected:true}}),
    archiveTask:async()=>({archived:true,threadId:id}),restoreTask:async()=>({restored:true,threadId:id}),
    renameTask:async p=>{renames++;return {threadId:id,title:p.title,changed:true};},settingsStore:{read:async()=>({})}});
  t.after(()=>service.close());
  const archived=await service.action('archive',params);visible=false;await service.read();
  await service.action('unarchive',{undoToken:archived.undoToken});
  for(const action of ['rename','project','move','pin'])await assert.rejects(service.action(action,{...params,title:'New',expectedTitle:task.title}),{status:409,message:'The restored task is still syncing. Refresh and try again.'});
  assert.equal(renames,0);assert.equal((await service.read()).board.tasks[0].title,task.title);
  visible=true;await service.action('rename',{...params,title:'New',expectedTitle:task.title});assert.equal(renames,1);
});
test('UI removes the confirmed task even when the archive response board is stale',async()=>{
  let calls=0;const remote={...task,hostId:'durable'};
  const f=ui(async()=>{calls++;return {ok:true,json:async()=>({archived:true,threadId:id,undoToken:'token',board:{tasks:[task,remote],sync:{archiveLocal:true}}})};});
  await f.api.archiveTask(task);
  assert.equal(f.context.DATA.tasks.length,1);assert.equal(f.context.DATA.tasks[0].hostId,'durable');
  await f.api.archiveTask(task);assert.equal(calls,1);
});
test('Undo notices expire once without returning on polling; duplicate task tokens show one notice',async()=>{
  const f=ui(async()=>({ok:true,json:async()=>({archived:true,threadId:id,undoToken:'token'})}));
  await f.api.archiveTask(task);
  const notices=new Script('archiveNotices').runInContext(f.context);
  assert.equal(notices.size,1);assert.equal(f.timers.size,1);
  const timer=[...f.timers.values()][0];assert.equal(timer.delay,8000);
  new Script("syncArchiveNotices([{undoToken:'token',task:DATA.tasks[0]??{id:'"+id+"',hostId:'local',title:'Fixture task'}},{undoToken:'duplicate',task:{id:'"+id+"',hostId:'local',title:'Fixture task'}}])").runInContext(f.context);
  assert.equal(notices.size,1);assert.equal(f.timers.size,1);
  [...f.timers.values()][0].callback();assert.equal(notices.size,0);
  new Script("syncArchiveNotices([{undoToken:'duplicate',task:{id:'"+id+"',hostId:'local',title:'Fixture task'}}])").runInContext(f.context);
  assert.equal(notices.size,0);
});
test('Undo stays available while restoring and a failed Undo remains retryable',async()=>{
  let finish;
  const f=ui(async endpoint=>endpoint==='/api/archive'?{ok:true,json:async()=>({archived:true,threadId:id,undoToken:'token'})}:new Promise(resolve=>finish=resolve));
  await f.api.archiveTask(task);
  const undo=new Script('undoArchive').runInContext(f.context),notices=new Script('archiveNotices').runInContext(f.context);
  const restoring=undo('token');assert.equal(f.timers.size,0);assert.equal(notices.size,1);
  finish({ok:false,json:async()=>({error:'Retry Undo'})});await restoring;
  assert.equal(notices.size,1);assert.equal(f.timers.size,0);assert.equal(notices.get('token').error,'Retry Undo');
  const retry=undo('token');finish({ok:true,json:async()=>({restored:true,threadId:id})});await retry;
  assert.equal(notices.size,0);assert.equal(f.context.DATA.tasks.length,1);
});
test('UI keeps cards until confirmation, blocks duplicate clicks, and removes only the local identity',async()=>{
  let finish;const f=ui(async()=>await new Promise(resolve=>finish=resolve));
  f.context.DATA.tasks.push({...task,hostId:'durable'});
  const pending=f.api.archiveTask(task);await f.api.archiveTask(task);
  assert.equal(f.context.DATA.tasks.length,2);assert.equal(f.api.pending,'local:'+id);
  finish({ok:true,json:async()=>({archived:true,threadId:id})});await pending;
  assert.equal(f.context.DATA.tasks.length,1);assert.equal(f.context.DATA.tasks[0].hostId,'durable');
  assert.equal(f.api.pending,null);assert.equal(f.messages.at(-1),'Task archived');
});
test('Undo restores and verifies the task; retries do not repeat an already successful restore',async()=>{
  let restored=false;const calls=[];
  const client={close(){},async request(method,p){calls.push(method);
    if(method==='thread/read')return {thread:{id,cwd:'/fixture',ephemeral:false,parentThreadId:null}};
    if(method==='thread/list')return {data:restored?[{id}]:[]};
    if(method==='thread/unarchive'){restored=true;return {};}
    throw Error('Unexpected method');}};
  const options={open:async()=>client};
  assert.equal((await restoreArchivedTask(params,options)).restored,true);
  await restoreArchivedTask(params,options);
  assert.equal(calls.filter(c=>c==='thread/unarchive').length,1);
});
test('restore confirmation tolerates canonicalized workspace paths',async()=>{
  let restored=false;const client={close(){},async request(method,p){
    if(method==='thread/read')return {thread:{id,cwd:'/var/fixture',ephemeral:false,parentThreadId:null}};
    if(method==='thread/unarchive'){restored=true;return {};}
    if(method==='thread/list')return {data:restored&&p.cwd===undefined?[{id,cwd:'/private/var/fixture'}]:[]};
    throw Error('Unexpected method');}};
  assert.equal((await restoreArchivedTask(params,{open:async()=>client})).restored,true);
});
test('Undo tokens authorize only confirmed archives; failed Undo remains retryable and consumed tokens fail',async()=>{
  let fail=true;const calls=[];
  const server=createKanbanServer({port:8880,getBoard:async()=>({tasks:[task],sync:{connected:true}}),
    archiveTask:async()=>({archived:true,threadId:id}),restoreTask:async p=>{calls.push(p);if(fail)throw Error('Try again');return {restored:true,threadId:id};}});
  await new Promise(resolve=>server.listen(8880,'127.0.0.1',resolve));
  try{
    const base='http://127.0.0.1:8880',get=await (await fetch(base+'/api/board')).json();
    const post=(endpoint,body)=>fetch(base+endpoint,{method:'POST',headers:{'Content-Type':'application/json','X-Kanban-Token':get.csrf},body:JSON.stringify(body)});
    assert.equal((await post('/api/unarchive',{undoToken:'fake',threadId:id})).status,409);assert.equal(calls.length,0);
    const archived=await (await post('/api/archive',params)).json();assert.equal(typeof archived.undoToken,'string');
    const body={undoToken:archived.undoToken,threadId:'different',hostId:'durable'};
    assert.equal((await post('/api/unarchive',body)).status,503);
    fail=false;assert.equal((await post('/api/unarchive',body)).status,200);
    assert.deepEqual(calls[1],{threadId:id,hostId:'local'});
    assert.equal((await post('/api/unarchive',body)).status,409);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
test('UI keeps separate Undo notices through updates and errors; successful Undo restores the card',async()=>{
  let restoring=false,fail=false;
  const f=ui(async(endpoint,options)=>{
    if(endpoint==='/api/archive')return {ok:true,json:async()=>({archived:true,threadId:JSON.parse(options.body).threadId,undoToken:'token-'+JSON.parse(options.body).threadId})};
    restoring=true;return fail?{ok:false,json:async()=>({error:'Retry Undo'})}:{ok:true,json:async()=>({restored:true,threadId:id})};
  });
  const extra={...task,id:'22222222-2222-4222-8222-222222222222'};f.context.DATA.tasks.push(extra);
  await f.api.archiveTask(task);await f.api.archiveTask(extra);
  const notices=new Script('archiveNotices').runInContext(f.context);assert.equal(notices.size,2);
  const undo=new Script('undoArchive').runInContext(f.context);
  fail=true;await undo('token-'+id);assert(restoring);assert.equal(notices.size,2);assert.equal(notices.get('token-'+id).error,'Retry Undo');
  fail=false;await undo('token-'+id);assert.equal(notices.size,1);assert.equal(f.context.DATA.tasks[0].id,id);assert.equal(f.messages.at(-1),'Archive undone');
});
test('UI failures retain the card and report the error; remote tasks have no archive action',async()=>{
  const f=ui(async()=>({ok:false,json:async()=>({error:'Archive unavailable'})}));
  assert.equal(f.api.canArchive({...task,hostId:'durable'}),false);
  await f.api.archiveTask(task);assert.equal(f.context.DATA.tasks.length,1);assert.equal(f.api.pending,null);
  assert.equal(f.messages.at(-1),'Archive unavailable');
});
