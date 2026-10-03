import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,lstat,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {request as httpRequest} from 'node:http';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {createKanbanMcp} from './mcp-server.mjs';
import {createKanbanService} from './kanban-service.mjs';
import {createJsonStore,defaultCreationSettingsStore} from './creation-store.mjs';
import {createDesktopCreation} from './desktop-creation.mjs';
import {startDesktopArchiveBridge} from './desktop-archive.mjs';
import {desktopBridgeRequest,startLocalBridge} from './bridge-transport.mjs';
import {createKanbanServer} from './serve.mjs';

const threadId='11111111-1111-4111-8111-111111111111';
const otherToken='99999999-9999-4999-8999-999999999999';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const creationParams=()=>({requestId:randomUUID(),sectionId:'native-review',prompt:'Build the requested feature',settings:{projectId:'project'}});
const payload=reply=>reply.structuredContent;

async function harness(t,options){
  const service=createKanbanService(options),app=createKanbanMcp({service,readUi:async()=>'<html>Test board</html>'});
  const client=new Client({name:'creation-integration-test',version:'1'},{capabilities:{}});
  const [serverTransport,clientTransport]=InMemoryTransport.createLinkedPair();
  await app.server.connect(serverTransport);await client.connect(clientTransport);
  t.after(async()=>{await client.close();await app.close();});
  return {client,service,app,call:(name,args={})=>client.callTool({name,arguments:args}),
    write:(name,args,token=service.csrf)=>client.callTool({name,arguments:{...args,actionToken:token}})};
}

async function fixture(t){
  const root=await mkdtemp(join(tmpdir(),'kb-ci-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const calls=[],journalPath=join(root,'operations.json'),settingsPath=join(root,'settings.json');
  const store=createJsonStore(journalPath),settingsStore=createJsonStore(settingsPath);
  const sections=[{id:'native-review',name:'For Review'},{id:'native-custom',name:'Research'}];
  const desktopSections=[{sectionId:'desktop-review',name:'For Review'},{sectionId:'desktop-custom',name:'Research'}];
  const projects=[{projectId:'project',hostId:'local',projectKind:'local',label:'Project',path:'/fixture/project',isGitRepository:true},
    {projectId:'notes',hostId:'local',projectKind:'local',label:'Notes',path:'/fixture/notes',isGitRepository:false},
    {projectId:'remote',hostId:'remote-control:test',projectKind:'remote',label:'Remote',path:'/remote',isGitRepository:true}];
  const thread={id:threadId,ephemeral:false,parentThreadId:null,section:{id:'native-custom'},projectId:'native-project'};
  const f={root,calls,store,journalPath,settingsPath,settingsStore,sections,projects,thread,moveFails:false,reply:{threadId,hostId:'local'},capability:true};
  f.options={creationStore:store,store,openReader:async()=>({close(){},async request(method){
    if(method==='threadSection/list')return {data:structuredClone(sections)};
    if(method==='project/list')return {data:[{id:'native-project',roots:[{path:'/fixture/project'}]},{id:'native-notes',roots:[{path:'/fixture/notes'}]}]};
    if(method==='thread/read')return {thread:structuredClone(thread)};
    throw Error('Native fixture is read-only');
  }}),async call(name,args){
    calls.push({name,args:structuredClone(args)});
    if(name==='list_projects')return {projects};
    if(name==='list_threads')return {sections:desktopSections};
    if(name==='create_thread')return f.reply;
    assert.equal(name,'move_thread_to_sidebar_section');
    if(f.moveFails)throw Error('Simulated Desktop disconnection');
    const destination=desktopSections.find(s=>s.sectionId===args.sectionId);
    thread.section=destination?{id:sections.find(s=>s.name===destination.name).id}:null;
    return {};
  }};
  const socketPath=join(root,'d.sock'),stop=await startDesktopArchiveBridge({socketPath,...f.options});t.after(stop);
  f.serviceOptions={desktopBridgeSocket:socketPath,settingsStore,
    getBoard:async()=>({tasks:calls.some(c=>c.name==='create_thread')?[{id:threadId,hostId:'local',title:'Created fixture',localProjectId:thread.projectId,projectName:'Project'}]:[],sections:[],sync:{connected:true,scope:'localSections'}}),
    bridgeRequest:(socket,method,...args)=>method==='status'&&!f.capability?{connected:true,groupActions:true,taskCreation:false}:desktopBridgeRequest(socket,method,...args)};
  f.mcp=await harness(t,f.serviceOptions);
  f.creates=()=>calls.filter(c=>c.name==='create_thread');f.moves=()=>calls.filter(c=>c.name==='move_thread_to_sidebar_section');
  return f;
}

test('creation MCP tools remain app-only and expose strict local creation schemas',async t=>{
  const f=await fixture(t),tools=(await f.mcp.client.listTools()).tools;
  assert.equal(tools.length,12);assert(tools.every(tool=>JSON.stringify(tool._meta.ui.visibility)==='["app"]'));
  for(const name of ['get_creation_options','get_creation_status'])assert.equal(tools.find(tool=>tool.name===name).annotations.readOnlyHint,true);
  for(const name of ['save_group_settings','create_task','retry_creation_group']){
    const tool=tools.find(tool=>tool.name===name);assert.equal(tool.inputSchema.additionalProperties,false);
    assert.equal(tool.annotations.readOnlyHint,false);assert.equal(tool.annotations.idempotentHint,false);
    assert(tool.inputSchema.required.includes('actionToken'));
  }
  assert.deepEqual(tools.find(tool=>tool.name==='open_board')._meta['openai/ui'].entrypoints,[{type:'global'}]);
});

test('MCP creation reads cross the private socket without dispatching native writes',async t=>{
  const f=await fixture(t),options=payload(await f.mcp.call('get_creation_options'));
  assert.deepEqual(options.projects.map(p=>p.projectId),['project','notes']);
  assert.deepEqual(options.sections.map(s=>s.sectionId),['native-review','native-custom',null]);
  assert.deepEqual(options.settings,{});
  const requestId=randomUUID(),missing=await f.mcp.call('get_creation_status',{requestId});
  assert.equal(missing.isError,true);assert.equal(payload(missing).status,404);
  await f.store.update(entries=>entries[requestId]={requestId,state:'unknown',sectionId:'native-review',projectId:'project',title:'Recorded task',updatedAt:new Date().toISOString()});
  const status=payload(await f.mcp.call('get_creation_status',{requestId}));
  assert.equal(status.state,'unknown');assert.equal(status.hostId,'local');assert.equal(status.threadId,null);
  assert.equal(f.creates().length,0);assert.equal(f.moves().length,0);
});

test('MCP settings require the session token and live capability, then persist complete normalized defaults',async t=>{
  const f=await fixture(t),params={sectionId:'native-review',settings:{projectId:'project',environment:'worktree',branch:' codex/base ',model:' fixture-model ',thinking:'high',template:' Review carefully. '}};
  assert.equal(payload(await f.mcp.write('save_group_settings',params,otherToken)).status,403);
  assert.deepEqual(await f.settingsStore.read(),{});
  f.capability=false;assert.equal(payload(await f.mcp.write('save_group_settings',params)).status,503);
  assert.deepEqual(await f.settingsStore.read(),{});f.capability=true;
  const saved=payload(await f.mcp.write('save_group_settings',params));assert.equal(saved.saved,true);
  const expected={projectId:'project',environment:'worktree',branch:'codex/base',model:'fixture-model',thinking:'high',template:'Review carefully.'};
  assert.deepEqual((await createJsonStore(f.settingsPath).read())['"native-review"'],expected);
  assert.deepEqual(payload(await f.mcp.call('get_creation_options')).settings['"native-review"'],expected);
  assert.deepEqual(payload(await f.mcp.call('get_board')).board.nativeCreationDefaults['"native-review"'],{projectId:'project',template:'Review carefully.'});
  assert.equal(f.creates().length,0);
});

test('MCP settings reject unavailable groups, remote projects, non-Git worktrees and unknown fields before storage',async t=>{
  const f=await fixture(t);
  for(const params of [
    {sectionId:'deleted',settings:{}},{sectionId:'native-review',settings:{projectId:'remote'}},
    {sectionId:'native-review',settings:{projectId:'notes',environment:'worktree'}},
    {sectionId:'native-review',settings:{projectId:'project',branch:'main'}},
    {sectionId:'native-review',settings:{projectId:'project',hostId:'remote'}},
  ])assert.equal((await f.mcp.write('save_group_settings',params)).isError,true);
  assert.deepEqual(await f.settingsStore.read(),{});assert.equal(f.creates().length,0);
});

test('MCP create passes explicit execution arguments and retries grouping without another creation',async t=>{
  const f=await fixture(t);f.moveFails=true;
  const params={...creationParams(),settings:{projectId:'project',environment:'worktree',branch:'codex/base',model:'fixture-model',thinking:'high',template:'Review carefully.'}};
  const created=payload(await f.mcp.write('create_task',params));
  assert.equal(created.state,'created');assert.equal(created.groupAssigned,false);assert.equal(created.board.tasks[0].projectName,'Project');
  assert.deepEqual(f.creates()[0].args,{prompt:'Review carefully.\n\nBuild the requested feature',target:{type:'project',projectId:'project',environment:{type:'worktree',startingState:{type:'branch',branchName:'codex/base'}}},model:'fixture-model',thinking:'high'});
  assert.equal(f.moves()[0].args.hostId,'local');assert.equal(f.moves()[0].args.sectionId,'desktop-review');
  f.moveFails=false;
  const retried=payload(await f.mcp.write('retry_creation_group',{requestId:params.requestId}));assert.equal(retried.groupAssigned,true);
  assert.equal(payload(await f.mcp.call('get_creation_status',{requestId:params.requestId})).groupAssigned,true);
  await f.mcp.write('create_task',params);await f.mcp.write('retry_creation_group',{requestId:params.requestId});
  assert.equal(f.creates().length,1);assert.equal(f.moves().length,2);
});

test('MCP local host boundary rejects foreign inputs and freezes a foreign Desktop create response',async t=>{
  const f=await fixture(t),params=creationParams();
  for(const [name,args] of [
    ['create_task',{...params,hostId:'remote-control:test'}],
    ['create_task',{...params,settings:{projectId:'remote'}}],
    ['retry_creation_group',{requestId:params.requestId,hostId:'remote-control:test'}],
    ['create_task',{...params,actionToken:otherToken}],
  ])assert.equal((await f.mcp.call(name,{actionToken:f.mcp.service.csrf,...args})).isError,true);
  assert.equal(f.creates().length,0);
  f.reply={threadId,hostId:'remote-control:test'};
  assert.equal(payload(await f.mcp.write('create_task',params)).state,'unknown');
  assert.equal((await f.mcp.write('retry_creation_group',{requestId:params.requestId})).isError,true);
  await f.mcp.write('create_task',params);assert.equal(f.creates().length,1);assert.equal(f.moves().length,0);
});

test('queued worktree outcomes survive MCP reads and cannot be grouped or automatically recreated',async t=>{
  const f=await fixture(t);f.reply={clientThreadId:'queued-client-id'};
  const params={...creationParams(),settings:{projectId:'project',environment:'worktree'}};
  const created=payload(await f.mcp.write('create_task',params));assert.equal(created.state,'pending');assert.equal(created.threadId,null);
  assert.equal(payload(await f.mcp.call('get_creation_status',{requestId:params.requestId})).clientThreadId,'queued-client-id');
  assert.equal((await f.mcp.write('retry_creation_group',{requestId:params.requestId})).isError,true);
  await f.mcp.write('create_task',params);assert.equal(f.creates().length,1);assert.equal(f.moves().length,0);
});

test('shared creation lock lasts through board readback and options wait for the saved result',async t=>{
  const f=await fixture(t),entered=deferred(),release=deferred(),board=f.serviceOptions.getBoard;
  const second=await harness(t,{...f.serviceOptions,getBoard:async()=>{entered.resolve();await release.promise;return board();}});
  const first=second.write('save_group_settings',{sectionId:null,settings:{template:'Saved default'}});
  await entered.promise;
  assert.equal(payload(await second.write('create_task',creationParams())).status,409);
  assert.equal(payload(await second.write('retry_creation_group',{requestId:randomUUID()})).status,409);
  let optionsDone=false;const options=second.call('get_creation_options').then(reply=>{optionsDone=true;return reply;});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(optionsDone,false);
  release.resolve();assert.equal(payload(await first).saved,true);
  assert.equal(payload(await options).settings.null.template,'Saved default');assert.equal(f.creates().length,0);
});

test('MCP request cancellation during creation capability preflight prevents socket dispatch',async t=>{
  const entered=deferred(),release=deferred(),controller=new AbortController();let dispatches=0;
  const f=await harness(t,{getBoard:async()=>({tasks:[],sections:[],sync:{}}),desktopBridgeSocket:'fixture',settingsStore:{read:async()=>({})},
    bridgeRequest:async(_socket,method)=>{
      if(method==='status'){entered.resolve();await release.promise;return {connected:true,taskCreation:true};}
      dispatches++;throw Error('Creation must not be dispatched');
    }});
  const request=f.client.callTool({name:'create_task',arguments:{...creationParams(),actionToken:f.service.csrf}},undefined,{signal:controller.signal});
  const rejected=assert.rejects(request);await entered.promise;controller.abort();await rejected;release.resolve();
  await f.service.close();assert.equal(dispatches,0);
});

test('service.close cancels MCP creation and settings before their preflight can write',async t=>{
  for(const name of ['create_task','save_group_settings']){
    const entered=deferred(),release=deferred();let writes=0;
    const f=await harness(t,{getBoard:async()=>({tasks:[],sections:[],sync:{}}),desktopBridgeSocket:'fixture',settingsStore:{read:async()=>({}),update:async()=>{writes++;}},
      bridgeRequest:async(_socket,method)=>{
        if(method==='status'){entered.resolve();await release.promise;return {connected:true,taskCreation:true};}
        if(method==='creationCatalog')return {projects:[],sections:[{sectionId:null}]};
        writes++;throw Error('Closed service must not create');
      }});
    const args=name==='create_task'?{...creationParams(),sectionId:null,settings:{}}:{sectionId:null,settings:{}};
    const request=f.write(name,args);await entered.promise;const closing=f.service.close();release.resolve();
    const response=await request;await closing;assert.equal(payload(response).status,408);assert.equal(writes,0);
  }
});

test('private creation socket cancellation during native catalog preflight leaves no journal or native write',async t=>{
  const root=await mkdtemp(join(tmpdir(),'kb-cancel-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const entered=deferred(),release=deferred(),cancelled=deferred(),finished=deferred(),store=createJsonStore(join(root,'operations.json'));
  let creates=0;
  const creation=createDesktopCreation({store,call:async name=>{
    if(name==='list_projects')return {projects:[]};if(name==='list_threads')return {sections:[]};
    creates++;throw Error('Cancellation must prevent native dispatch');
  },openReader:async()=>({close(){},async request(method){
    if(method==='threadSection/list'){entered.resolve();await release.promise;}return {data:[]};
  }})});
  const socketPath=join(root,'d.sock'),stop=await startLocalBridge({socketPath,dispatch:async(method,params,context)=>{
    assert.equal(method,'create');context.signal.addEventListener('abort',()=>cancelled.resolve(),{once:true});
    try{return await creation.create(params,context);}finally{finished.resolve();}
  }});t.after(stop);
  assert.equal((await lstat(socketPath)).mode&0o777,0o600);
  const controller=new AbortController(),request=desktopBridgeRequest(socketPath,'create',{requestId:randomUUID(),sectionId:null,settings:{},prompt:'Test task'},60000,{signal:controller.signal});
  const rejected=assert.rejects(request,error=>error.status===408);await entered.promise;controller.abort();await rejected;await cancelled.promise;
  release.resolve();await finished.promise;assert.equal(creates,0);assert.deepEqual(await store.read(),{});
});

test('HTTP request.destroy cancels creation during status and native catalog preflight without dispatching a task',{timeout:5000},async t=>{
  for(const phase of ['status','catalog']){
    const root=await mkdtemp(join(tmpdir(),'kb-http-cancel-'));t.after(()=>rm(root,{recursive:true,force:true}));
    const entered=deferred(),release=deferred(),responseClosed=deferred(),socketCancelled=deferred();let armed=false,creates=0;
    const store=createJsonStore(join(root,'operations.json'));
    const creation=createDesktopCreation({store,call:async name=>{
      if(name==='list_projects')return {projects:[]};if(name==='list_threads')return {sections:[]};
      creates++;return {threadId,hostId:'local'};
    },openReader:async()=>({close(){},async request(method){
      if(armed&&phase==='catalog'&&method==='threadSection/list'){entered.resolve();await release.promise;}
      return {data:[]};
    }})});
    const socketPath=join(root,'d.sock'),stop=await startLocalBridge({socketPath,dispatch:async(method,params,context)=>{
      if(method==='status'){
        if(armed&&phase==='status'){entered.resolve();await release.promise;}
        return {connected:true,taskCreation:true};
      }
      assert.equal(method,'create');context.signal.addEventListener('abort',()=>socketCancelled.resolve(),{once:true});
      return creation.create(params,context);
    }});t.after(stop);
    const server=createKanbanServer({port:0,desktopBridgeSocket:socketPath,settingsStore:createJsonStore(join(root,'settings.json')),
      getBoard:async()=>({tasks:[],sections:[],sync:{}})});
    server.on('request',(req,res)=>{if(req.url==='/api/create')res.once('close',()=>responseClosed.resolve());});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
    const url='http://127.0.0.1:'+server.address().port,csrf=(await(await fetch(url+'/api/board')).json()).csrf;
    armed=true;
    const request=httpRequest(url+'/api/create',{method:'POST',headers:{'Content-Type':'application/json','X-Kanban-Token':csrf,Origin:url}});
    const requestClosed=deferred();request.on('error',error=>{assert.equal(error.code,'ECONNRESET');requestClosed.resolve();});
    request.end(JSON.stringify({requestId:randomUUID(),sectionId:null,settings:{},prompt:'Cancelled test task'}));
    await entered.promise;request.destroy();await requestClosed.promise;await responseClosed.promise;
    if(phase==='catalog')await socketCancelled.promise;
    armed=false;release.resolve();
    // A subsequent board read waits for the shared action lock, proving that
    // the abandoned request has finished before checking its write effects.
    assert.equal((await fetch(url+'/api/board')).status,200);
    assert.equal(creates,0,phase+' cancellation dispatched a native task');assert.deepEqual(await store.read(),{});
  }
});

test('MCP fails closed on corrupt defaults and does not overwrite user storage',async t=>{
  const f=await fixture(t);await writeFile(f.settingsPath,'corrupt user defaults');
  assert.equal(payload(await f.mcp.call('get_board')).board.sync.createWritable,false);
  const options=await f.mcp.call('get_creation_options');assert.equal(options.isError,true);assert.equal(payload(options).status,503);
  const saved=await f.mcp.write('save_group_settings',{sectionId:null,settings:{}});assert.equal(saved.isError,true);
  assert.equal(await readFile(f.settingsPath,'utf8'),'corrupt user defaults');assert.equal(f.creates().length,0);
});

test('default creation settings stay in user data outside the plugin package',async t=>{
  const root=await mkdtemp(join(tmpdir(),'kb-user-data-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const oldHome=process.env.CODEX_HOME,oldData=process.env.KANBAN_DATA_DIR;
  try{
    process.env.CODEX_HOME=join(root,'user');delete process.env.KANBAN_DATA_DIR;
    await defaultCreationSettingsStore().update(entries=>entries.null={template:'User default'});
    const path=join(root,'user','kanban','group-creation-settings.json');
    assert.equal(JSON.parse(await readFile(path,'utf8')).entries.null.template,'User default');
    assert.equal((await lstat(path)).mode&0o777,0o600);
    process.env.KANBAN_DATA_DIR=join(root,'override');
    await defaultCreationSettingsStore().update(entries=>entries.group={projectId:null});
    assert.deepEqual(await readdir(join(root,'override')),['group-creation-settings.json']);
  }finally{
    if(oldHome===undefined)delete process.env.CODEX_HOME;else process.env.CODEX_HOME=oldHome;
    if(oldData===undefined)delete process.env.KANBAN_DATA_DIR;else process.env.KANBAN_DATA_DIR=oldData;
  }
});

test('independent creation stores serialize concurrent read-modify-write without dropping records',async t=>{
  const root=await mkdtemp(join(tmpdir(),'kb-store-race-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const path=join(root,'shared.json'),stores=Array.from({length:4},()=>createJsonStore(path)),entered=deferred(),release=deferred();
  const first=stores[0].update(async entries=>{entered.resolve();await release.promise;entries.first={state:'unknown'};});
  await entered.promise;
  const writers=Array.from({length:24},(_,i)=>stores[i%stores.length].update(async entries=>{
    await new Promise(resolve=>setImmediate(resolve));entries['request-'+i]={state:'created',sequence:i};
  }));
  release.resolve();await Promise.all([first,...writers]);
  const entries=await createJsonStore(path).read();assert.equal(Object.keys(entries).length,25);
  for(let i=0;i<24;i++)assert.deepEqual(entries['request-'+i],{state:'created',sequence:i});
  assert.deepEqual(entries.first,{state:'unknown'});assert.deepEqual(await readdir(root),['shared.json']);
});
