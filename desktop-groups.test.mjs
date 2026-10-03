import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDesktopGroups} from './desktop-groups.mjs';
import {startDesktopArchiveBridge} from './desktop-archive.mjs';
import {createKanbanServer} from './serve.mjs';
import {desktopBridgeRequest} from './bridge-transport.mjs';
import {createDesktopRelay} from './desktop-proxy.mjs';

const id='11111111-1111-4111-8111-111111111111';
const params={threadId:id,hostId:'local',sectionId:'native-review',expectedSectionId:'native-pin'};
function fixture(){
  const native=[{id:'native-pin',name:'Pinned'},{id:'native-review',name:'For Review'},{id:'native-progress',name:'In Progress'},{id:'native-later',name:'For Later'}];
  const desktop=[{sectionId:'pinned',name:'Pinned'},{sectionId:'desktop-review',name:'For Review'},
    {sectionId:'desktop-progress',name:'In Progress'},{sectionId:'desktop-later',name:'For Later'}];
  const thread={id,section:{id:'native-pin'},projectId:'project-one',ephemeral:false,parentThreadId:null,status:'idle'};
  const calls=[];let closed=0,ready=true;
  const f={native,desktop,thread,calls,lookup:()=>{},afterMove:()=>{},fail:false,confirm:true,
    options:{ready:()=>ready,openReader:async()=>({close(){closed++;},request:async(method,p)=>{
      calls.push({method,params:p});
      if(method==='thread/read')return {thread:structuredClone(thread)};
      if(method==='threadSection/list')return {data:structuredClone(native)};
      throw Error('Reader cannot write');
    }}),call:async(tool,args)=>{
      calls.push({tool,args});
      if(tool==='list_threads'){await f.lookup();return {sections:desktop};}
      assert.equal(tool,'move_thread_to_sidebar_section');if(f.fail)throw Error('Desktop refused');
      if(f.confirm){const name=desktop.find(s=>s.sectionId===args.sectionId)?.name;thread.section=args.sectionId===null?null:{id:native.find(s=>s.name===name).id};}
      f.afterMove();return {};
    }},disconnect:()=>ready=false,get closed(){return closed;}};
  return f;
}
const writes=f=>f.calls.filter(c=>c.tool==='move_thread_to_sidebar_section');
test('Desktop receives its own group ID while native membership, project and runtime are preserved',async()=>{
  const f=fixture();assert.equal((await createDesktopGroups(f.options).move(params)).changed,true);
  assert.deepEqual(writes(f),[{tool:'move_thread_to_sidebar_section',args:{threadId:id,hostId:'local',source:'codex',sectionId:'desktop-review'}}]);
  assert.equal(f.thread.section.id,'native-review');assert.equal(f.thread.projectId,'project-one');assert.equal(f.thread.status,'idle');assert.equal(f.closed,1);
  assert(!f.calls.some(c=>c.method==='thread/section/move'));
});
test('Pinned uses only the reserved desktop ID; clearing an inherited or assigned task sends null',async()=>{
  const f=fixture();f.desktop.unshift({sectionId:'custom-pin',name:'Pinned'});
  f.thread.section=null;const groups=createDesktopGroups(f.options);
  await groups.move({...params,sectionId:'native-pin',expectedSectionId:null});assert.equal(writes(f)[0].args.sectionId,'pinned');
  await groups.pin({threadId:id,hostId:'local',pinned:false});assert.equal(writes(f)[1].args.sectionId,null);assert.equal(f.thread.projectId,'project-one');
  await groups.move({...params,expectedSectionId:null});assert.equal(f.thread.section.id,'native-review');
  await groups.move({...params,sectionId:null,expectedSectionId:'native-review'});assert.equal(writes(f).at(-1).args.sectionId,null);
});
test('ambiguous, reserved and missing mappings cannot reach a Desktop write',async()=>{
  for(const mutate of [f=>f.native.push({...f.native[1],id:'duplicate-native'}),f=>f.desktop.push({...f.desktop[1],sectionId:'duplicate-desktop'}),
    f=>f.desktop.splice(1,1),f=>f.desktop[1].sectionId='chats']){
    const f=fixture();mutate(f);await assert.rejects(createDesktopGroups(f.options).move(params));assert.equal(writes(f).length,0);assert.equal(f.closed,1);
  }
  const f=fixture();f.desktop[0].sectionId='custom-pin';f.thread.section=null;
  await assert.rejects(createDesktopGroups(f.options).pin({threadId:id,hostId:'local',pinned:true}),/Pinned group/);assert.equal(writes(f).length,0);
  const duplicate=fixture();duplicate.native.push({...duplicate.native[0],id:'other-pin'});duplicate.thread.section=null;
  await assert.rejects(createDesktopGroups(duplicate.options).pin({threadId:id,hostId:'local',pinned:true}));assert.equal(writes(duplicate).length,0);
});
test('Desktop lookup races recheck native source, project, protection, readiness and cancellation before writing',async()=>{
  for(const mutate of [f=>f.thread.section={id:'native-progress'},f=>f.thread.projectId='other-project',f=>f.thread.ephemeral=true,
    f=>f.thread.parentThreadId='parent',f=>f.thread.archived=true,f=>delete f.thread.projectId,f=>f.disconnect()]){
    const f=fixture();f.lookup=()=>mutate(f);await assert.rejects(createDesktopGroups(f.options).move(params));assert.equal(writes(f).length,0);assert.equal(f.closed,1);
  }
  const f=fixture(),abort=new AbortController();f.lookup=()=>abort.abort();
  await assert.rejects(createDesktopGroups(f.options).move(params,{signal:abort.signal}),/cancelled/);assert.equal(writes(f).length,0);
});
test('destination rename, replacement and duplication during Desktop lookup are rejected before writing',async()=>{
  for(const mutate of [f=>f.native[1].name='Renamed',f=>{f.native[1].name='Renamed';f.native.push({id:'replacement',name:'For Review'});},
    f=>f.native.push({id:'duplicate-review',name:'For Review'})]){
    const f=fixture();f.lookup=()=>mutate(f);
    await assert.rejects(createDesktopGroups(f.options).move(params),/destination group changed/);assert.equal(writes(f).length,0);assert.equal(f.closed,1);
  }
});
test('unknown native project, nonlocal IDs and protected tasks fail without a Desktop mutation',async()=>{
  for(const mutate of [f=>delete f.thread.projectId,f=>f.thread.ephemeral=true,f=>f.thread.parentThreadId='parent']){
    const f=fixture();mutate(f);await assert.rejects(createDesktopGroups(f.options).move(params));assert.equal(writes(f).length,0);
  }
  const f=fixture();for(const p of [null,{...params,hostId:'durable'},{...params,threadId:'bad'},{...params,expectedSectionId:undefined}])await assert.rejects(createDesktopGroups(f.options).move(p));
  assert.equal(f.calls.length,0);
});
test('Desktop refusal, unconfirmed readback, later classification or changed project never repeat a write',async()=>{
  for(const mutate of [f=>f.fail=true,f=>f.confirm=false,f=>f.afterMove=()=>f.thread.section={id:'native-progress'},f=>f.afterMove=()=>f.thread.projectId='changed']){
    const f=fixture();mutate(f);await assert.rejects(createDesktopGroups(f.options).move(params));assert.equal(writes(f).length,1);assert.equal(f.closed,1);
  }
  const f=fixture();assert.equal((await createDesktopGroups(f.options).move({...params,sectionId:'native-pin'})).changed,false);assert.equal(writes(f).length,0);
});
test('bridge advertises group capability and serializes archive, pin and move without exposing arbitrary RPCs',async()=>{
  const root=await mkdtemp(join(tmpdir(),'kb-g-')),socketPath=join(root,'d.sock'),f=fixture();let finish,started;
  const began=new Promise(r=>started=r);f.lookup=async()=>{started();await new Promise(r=>finish=r);};
  const stop=await startDesktopArchiveBridge({socketPath,...f.options});
  try{
    assert.equal((await desktopBridgeRequest(socketPath,'status')).groupActions,true);
    const moving=desktopBridgeRequest(socketPath,'move',params);await began;
    for(const method of ['pin','archive'])await assert.rejects(desktopBridgeRequest(socketPath,method,params),/in progress/);
    for(const method of ['turn/start','move_project_to_sidebar_section','tool/call'])await assert.rejects(desktopBridgeRequest(socketPath,method,params),/only supports/);
    finish();assert.equal((await moving).sectionId,'native-review');assert.equal(writes(f).length,1);
  }finally{await stop();await rm(root,{recursive:true,force:true});}
});
test('HTTP requires new capability, dispatches Desktop moves and never falls back after failure',async()=>{
  const port=8894,task={id,hostId:'local',placementSource:'localThreadSection',localSectionId:'native-pin'};
  let status={connected:false},fail=false,localWrites=0;const calls=[];
  const server=createKanbanServer({port,desktopBridgeSocket:'/fixture/desktop.sock',getBoard:async()=>({tasks:[task],sections:[],sync:{connected:true,scope:'localSections'}}),
    pinTask:()=>{localWrites++;},bridgeRequest:async(socket,method,p)=>{if(method==='status')return status;calls.push({method,params:p});
      if(fail)throw Error('Desktop disconnected');return {threadId:id,sectionId:p.sectionId,changed:true};}});
  await new Promise(r=>server.listen(port,'127.0.0.1',r));
  try{
    const url='http://127.0.0.1:'+port,get=async()=> (await(await fetch(url+'/api/board')).json()),csrf=(await get()).csrf;
    const post=(path,body,token=csrf)=>fetch(url+path,{method:'POST',headers:{'Content-Type':'application/json','X-Kanban-Token':token},body:JSON.stringify(body)});
    for(const value of [{connected:false},{connected:true}]){
      status=value;const payload=await get();assert.equal(payload.board.sync.moveWritable,false);assert.equal(payload.board.sync.pinLocal,false);
      assert.equal((await post('/api/move',params)).status,503);assert.equal((await post('/api/pin',{threadId:id,hostId:'local',pinned:true})).status,503);
    }
    assert.equal(calls.length,0);assert.equal(localWrites,0);
    status={connected:true,groupActions:true};assert.equal((await get()).board.sync.moveWritable,true);
    assert.equal((await post('/api/move',params,'wrong')).status,403);assert.equal(calls.length,0);
    assert.equal((await post('/api/move',params)).status,200);assert.equal(calls.length,1);assert.equal(calls[0].method,'move');
    fail=true;assert.equal((await post('/api/move',params)).status,503);assert.equal(calls.length,2);assert.equal(localWrites,0);
  }finally{await new Promise(r=>server.close(r));}
});
test('relay adds only the Desktop task-move tool and preserves context',async()=>{
  const messages=[],relay=createDesktopRelay({toDesktop(){},toServer:m=>messages.push(m)});
  relay.fromDesktop({id:1,method:'initialize'});relay.fromServer({id:1,result:{}});
  const promise=relay.call('move_thread_to_sidebar_section',{threadId:id,hostId:'local',source:'codex',sectionId:null},id),request=messages.at(-1);
  assert.equal(request.params.tool,'move_thread_to_sidebar_section');assert.equal(request.params.arguments.sectionId,null);
  relay.fromServer({id:request.id,result:{content:[{type:'text',text:'{}'}]}});await promise;
  for(const tool of ['move_project_to_sidebar_section','turn/start'])await assert.rejects(relay.call(tool,{},id));
  relay.close();
});
