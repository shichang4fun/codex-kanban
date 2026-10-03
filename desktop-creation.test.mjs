import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createDesktopCreation} from './desktop-creation.mjs';
import {createJsonStore} from './creation-store.mjs';
import {creationSettings,creationArguments} from './creation-options.mjs';
import {startDesktopArchiveBridge} from './desktop-archive.mjs';
import {desktopBridgeRequest} from './bridge-transport.mjs';
import {createKanbanServer} from './serve.mjs';
import {createDesktopRelay} from './desktop-proxy.mjs';

const threadId='11111111-1111-4111-8111-111111111111';
async function fixture(t){
  const root=await mkdtemp(join(tmpdir(),'kb-create-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const storePath=join(root,'operations.json'),store=createJsonStore(storePath),calls=[];
  const native=[{id:'native-review',name:'For Review'},{id:'native-custom',name:'Research'}];
  const desktop=[{sectionId:'desktop-review',name:'For Review'},{sectionId:'desktop-custom',name:'Research'}];
  const projects=[{projectId:'project',hostId:'local',projectKind:'local',label:'Project',path:'/fixture/project',isGitRepository:true},
    {projectId:'nongit',hostId:'local',projectKind:'local',label:'Notes',path:'/fixture/notes',isGitRepository:false},
    {projectId:'remote',hostId:'remote-control:fixture',projectKind:'remote',label:'Remote',isGitRepository:true}];
  const thread={id:threadId,ephemeral:false,parentThreadId:null,section:{id:'native-custom'},projectId:'native-project',status:{type:'active'}};
  const params={requestId:randomUUID(),sectionId:'native-review',prompt:'Build a feature',settings:{projectId:'project'}};
  const nativeProjects=[{id:'native-project',roots:[{path:'/fixture/project'}]},{id:'native-notes',roots:[{path:'/fixture/notes'}]}];
  const f={root,storePath,store,params,calls,native,desktop,projects,nativeProjects,thread,moveFails:false,createReply:{threadId,hostId:'local'},beforeCreate:async()=>{}};
  f.options={store,openReader:async()=>({close(){},request:async(method)=>{
    if(method==='threadSection/list')return {data:structuredClone(native)};
    if(method==='project/list')return {data:structuredClone(nativeProjects)};
    if(method==='thread/read')return {thread:structuredClone(thread)};
    throw Error('Reader cannot write');
  }}),call:async(tool,args)=>{
    calls.push({tool,args});
    if(tool==='list_projects')return {projects};
    if(tool==='list_threads')return {sections:desktop};
    if(tool==='create_thread'){await f.beforeCreate();return f.createReply;}
    assert.equal(tool,'move_thread_to_sidebar_section');if(f.moveFails)throw Error('Desktop disconnected');
    const name=desktop.find(s=>s.sectionId===args.sectionId)?.name;
    thread.section=args.sectionId===null?null:{id:native.find(s=>s.name===name).id};return {};
  }};
  f.service=createDesktopCreation(f.options);return f;
}
const creates=f=>f.calls.filter(c=>c.tool==='create_thread');
const moves=f=>f.calls.filter(c=>c.tool==='move_thread_to_sidebar_section');
test('multi-root projects with multiple Desktop containers fail closed before creating',async t=>{
  const f=await fixture(t);f.nativeProjects[0].roots.push({path:'/fixture/notes'});f.nativeProjects.splice(1);
  assert((await f.service.catalog()).projects.every(p=>p.nativeProjectId===null));
  await assert.rejects(f.service.create(f.params),/project/i);assert.equal(creates(f).length,0);
});

test('creation uses native defaults, reads actual source, verifies grouping and preserves execution/project',async t=>{
  const f=await fixture(t),result=await f.service.create(f.params);
  assert.equal(result.state,'created');assert.equal(result.groupAssigned,true);
  assert.deepEqual(creates(f)[0].args,{prompt:'Build a feature',target:{type:'project',projectId:'project',environment:{type:'local'}}});
  assert.equal(moves(f)[0].args.sectionId,'desktop-review');assert.equal(f.thread.projectId,'native-project');assert.equal(f.thread.status.type,'active');
  await f.service.create(f.params);assert.equal(creates(f).length,1);assert.equal(moves(f).length,1);
  assert.equal((await lstat(f.storePath)).mode&0o777,0o600);
});
test('custom groups and projectless Ungrouped are verified without modifying a project container',async t=>{
  const f=await fixture(t);f.thread.section=null;
  assert.equal((await f.service.create({...f.params,sectionId:'native-custom'})).groupAssigned,true);
  assert.equal(moves(f)[0].args.sectionId,'desktop-custom');
  f.thread.projectId=null;
  const result=await f.service.create({...f.params,requestId:randomUUID(),sectionId:null,settings:{}});
  assert.equal(result.groupAssigned,true);assert.deepEqual(creates(f)[1].args.target,{type:'projectless'});
  assert.equal(moves(f)[1].args.sectionId,null);
});
test('unverified destinations, remote/missing projects, non-Git worktrees and oversized UTF-8 prompts cannot create',async t=>{
  const f=await fixture(t);
  for(const params of [
    {...f.params,sectionId:'other-hosts'},{...f.params,sectionId:'chats'},{...f.params,settings:{projectId:'remote'}},
    {...f.params,settings:{projectId:'deleted'}},{...f.params,settings:{projectId:'nongit',environment:'worktree'}},
    {...f.params,prompt:'汉'.repeat(1700)},{...f.params,settings:{projectId:'project',branch:'main'}},
  ])await assert.rejects(f.service.create(params));
  f.desktop.push({sectionId:'duplicate',name:'For Review'});await assert.rejects(f.service.create(f.params));
  assert.equal(creates(f).length,0);assert.deepEqual(await f.store.read(),{});
});
test('journal is persisted before dispatch; timeout and restart freeze the same operation without another creation',async t=>{
  const f=await fixture(t);
  f.beforeCreate=async()=>{
    const saved=JSON.parse(await readFile(f.storePath,'utf8')).entries[f.params.requestId];assert.equal(saved.state,'unknown');throw Error('Timeout');
  };
  const result=await f.service.create(f.params);assert.equal(result.state,'unknown');assert.equal(result.threadId,null);
  const restarted=createDesktopCreation({...f.options,store:createJsonStore(f.storePath)});
  assert.equal((await restarted.create(f.params)).state,'unknown');assert.equal(creates(f).length,1);
  await assert.rejects(restarted.create({...f.params,prompt:'Different task'}),/another task/);
  await assert.rejects(restarted.retryGroup({requestId:f.params.requestId}),/confirmed task ID/);
});
test('simultaneous submissions and cancellations cannot duplicate the native create tool',async t=>{
  const f=await fixture(t);let began,finish;const started=new Promise(r=>began=r);
  f.beforeCreate=async()=>{began();await new Promise(r=>finish=r);};
  const first=f.service.create(f.params);await started;
  await assert.rejects(f.service.create(f.params),/in progress/);finish();await first;assert.equal(creates(f).length,1);
  const signal=AbortSignal.abort();await assert.rejects(f.service.create({...f.params,requestId:randomUUID()},{signal}),/cancelled/);assert.equal(creates(f).length,1);
});
test('cancellation during durable journal write is checked immediately before dispatch',async t=>{
  const f=await fixture(t),abort=new AbortController();
  const service=createDesktopCreation({...f.options,store:{read:()=>f.store.read(),update:async change=>{const result=await f.store.update(change);abort.abort();return result;}}});
  const result=await service.create(f.params,{signal:abort.signal});
  assert.equal(result.state,'cancelled');assert.equal(creates(f).length,0);assert.match(result.message,/No task was created/);
});
test('group failures preserve a confirmed task; retry performs only grouping with project verification',async t=>{
  const f=await fixture(t);f.moveFails=true;
  const result=await f.service.create(f.params);assert.equal(result.state,'created');assert.equal(result.threadId,threadId);assert.equal(result.groupAssigned,false);
  f.moveFails=false;assert.equal((await f.service.retryGroup({requestId:f.params.requestId})).groupAssigned,true);assert.equal(creates(f).length,1);
  await f.service.retryGroup({requestId:f.params.requestId});assert.equal(moves(f).length,2);
  const changed=await fixture(t);changed.thread.projectId='another-project';
  assert.equal((await changed.service.create(changed.params)).groupAssigned,false);assert.equal(moves(changed).length,0);
});
test('queued Worktree client IDs are never used as real tasks or grouped',async t=>{
  const f=await fixture(t);f.createReply={clientThreadId:'client-local-fixture',threadId:null};
  const result=await f.service.create({...f.params,settings:{projectId:'project',environment:'worktree',branch:'codex/base',model:'fixture-model',thinking:'high',template:'Review carefully.'}});
  assert.equal(result.state,'pending');assert.equal(result.threadId,null);assert.equal(moves(f).length,0);
  assert.equal(creates(f)[0].args.prompt,'Review carefully.\n\nBuild a feature');
  assert.deepEqual(creates(f)[0].args.target.environment,{type:'worktree',startingState:{type:'branch',branchName:'codex/base'}});
  await assert.rejects(f.service.retryGroup({requestId:f.params.requestId}),/confirmed task ID/);
});
test('corrupt storage fails before any native creation and concurrent setting writes remain intact',async t=>{
  const f=await fixture(t);await writeFile(f.storePath,'broken');await assert.rejects(f.service.create(f.params));assert.equal(creates(f).length,0);
  const store=createJsonStore(join(f.root,'settings.json'));
  await Promise.all([store.update(entries=>entries.a=1),store.update(entries=>entries.b=2)]);assert.deepEqual(await store.read(),{a:1,b:2});
  assert.deepEqual(creationSettings({}),{projectId:null,environment:'local',branch:'',model:'',thinking:'',template:''});
  assert(!Object.hasOwn(creationArguments(creationSettings({}),'Prompt'),'model'));
  const socketPath=join(f.root,'corrupt.sock'),stop=await startDesktopArchiveBridge({socketPath,...f.options,creationStore:f.store});t.after(stop);
  const status=await desktopBridgeRequest(socketPath,'status');assert.equal(status.connected,true);assert.equal(status.groupActions,true);assert.equal(status.taskCreation,false);
});
test('real private socket/HTTP flow enforces capability, CSRF, settings readback, creation recovery and project labels',async t=>{
  const f=await fixture(t),socketPath=join(f.root,'d.sock');
  const stop=await startDesktopArchiveBridge({socketPath,...f.options,creationStore:f.store});t.after(stop);
  let connected=true;
  const server=createKanbanServer({port:0,desktopBridgeSocket:socketPath,settingsStore:createJsonStore(join(f.root,'settings.json')),
    bridgeRequest:(socket,method,params,timeout)=>method==='status'&&!connected?{connected:true,groupActions:true}:desktopBridgeRequest(socket,method,params,timeout),
    getBoard:async()=>({tasks:creates(f).length?[{id:threadId,hostId:'local',projectId:'project',localProjectId:'native-project',projectName:'Project'}]:[],sections:[],sync:{connected:true,scope:'localSections'}})});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const url='http://127.0.0.1:'+server.address().port,csrf=(await(await fetch(url+'/api/board')).json()).csrf;
  const post=(path,body,token=csrf,origin=url)=>fetch(url+path,{method:'POST',headers:{'Content-Type':'application/json','X-Kanban-Token':token,Origin:origin},body:JSON.stringify(body)});
  assert.equal((await post('/api/create',f.params,'wrong')).status,403);
  assert.equal((await post('/api/create',f.params,csrf,'https://example.com')).status,403);
  connected=false;assert.equal((await post('/api/create',f.params)).status,503);assert.equal(creates(f).length,0);
  connected=true;
  const saved=await(await post('/api/group-settings',{sectionId:'native-review',settings:{projectId:'project',thinking:'high'}})).json();assert.equal(saved.saved,true);
  const options=await(await fetch(url+'/api/creation-options')).json();assert.equal(options.settings['"native-review"'].thinking,'high');assert.equal(options.projects.length,2);
  connected=false;
  const nativeBoard=(await(await fetch(url+'/api/board')).json()).board;
  assert.deepEqual(nativeBoard.nativeCreationDefaults['"native-review"'],{projectId:'project',template:''});
  assert.equal(nativeBoard.sync.createWritable,false);
  connected=true;
  const result=await(await post('/api/create',f.params)).json();assert.equal(result.groupAssigned,true);assert.equal(result.board.tasks[0].projectName,'Project');
  assert.equal((await(await post('/api/create',f.params)).json()).threadId,threadId);assert.equal(creates(f).length,1);
  assert.equal((await(await fetch(url+'/api/creation-status?requestId='+f.params.requestId)).json()).groupAssigned,true);
});
test('relay permits explicit creation/project listing but rejects other execution and project writes',async()=>{
  const messages=[],relay=createDesktopRelay({toDesktop(){},toServer:m=>messages.push(m)});
  relay.fromDesktop({id:1,method:'initialize'});relay.fromServer({id:1,result:{}});
  for(const tool of ['list_projects','create_thread']){
    const request=relay.call(tool,{},threadId),message=messages.at(-1);
    relay.fromServer({id:message.id,result:{content:[{type:'text',text:'{}'}]}});await request;
  }
  for(const tool of ['turn/start','send_message_to_thread','move_project_to_sidebar_section'])await assert.rejects(relay.call(tool,{},threadId));relay.close();
});
