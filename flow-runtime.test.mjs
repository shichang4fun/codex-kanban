import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,chmod,lstat,rm,symlink} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {installFlowSettings,prepareFlowSettings,readFlowSettings,updateFlowSettings} from './flow-config.mjs';
import {startAutoFlow,createTransactionGate} from './flow-runtime.mjs';
import {createDesktopRelay} from './desktop-proxy.mjs';
import {installDesktopBridge} from './setup-desktop-bridge.mjs';

const mapping={inProgress:{desktopId:'10000000-0000-4000-8000-000000000001',localId:'20000000-0000-4000-8000-000000000001'},
  forReview:{desktopId:'10000000-0000-4000-8000-000000000002',localId:'20000000-0000-4000-8000-000000000002'}};
const policy={version:1,mode:'allowlist',threadIds:['task','excluded-task'],excludedThreadIds:['excluded-task'],
  reconcileIntervalSeconds:600,forceStatusSections:mapping};
const later=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};}
async function put(file,text,mode=0o600){await mkdir(dirname(file),{recursive:true,mode:0o700});await writeFile(file,text,{mode});await chmod(file,mode);}
async function fixture(t){const dir=await mkdtemp('/tmp/kf-');t.after(()=>rm(dir,{recursive:true,force:true}));
  const root=join(dir,'bridge'),legacyRoot=join(dir,'legacy'),app=join(dir,'Codex.app');
  const native=join(app,'Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex');
  await put(native,'#!/bin/sh\nexit 0\n',0o700);
  await put(join(legacyRoot,'.owner'),'codex-sidebar-flow-desktop-v1');
  await put(join(legacyRoot,'config.json'),JSON.stringify(policy));
  await put(join(legacyRoot,'codex-proxy'),'#!/bin/sh\nexit 0\n',0o700);
  return {dir,root,legacyRoot,app,native};
}

test('integrated bridge imports only effective policy and selects one native CLI chain',async t=>{
  const f=await fixture(t);
  const config=await installDesktopBridge({...f,nodePath:process.execPath,chainedCli:join(f.legacyRoot,'codex-proxy'),autoFlow:true,codexHome:join(f.dir,'home')});
  assert.equal(config.autoFlow,true);assert.equal(config.chainedCli,f.native);
  assert.deepEqual(readFlowSettings(f.root),{version:1,enabled:true,policy});
  assert.equal((await lstat(join(f.root,'flow.json'))).mode&0o777,0o600);
  assert.equal((await lstat(f.root)).mode&0o777,0o700);
  const wrapper=await readFile(config.proxy,'utf8');
  assert.ok(!wrapper.includes(join(f.legacyRoot,'codex-proxy')));
  assert.equal(await readFile(join(f.legacyRoot,'config.json'),'utf8'),JSON.stringify(policy));
});

test('toggle and reinstall preserve exclusions, interval, mappings and the user switch',async t=>{
  const f=await fixture(t);
  await installDesktopBridge({...f,nodePath:process.execPath,chainedCli:f.native,legacyFlowRoot:f.legacyRoot,autoFlow:true,codexHome:join(f.dir,'home')});
  assert.deepEqual((await updateFlowSettings(f.root,false)).policy,policy);
  await updateFlowSettings(f.root,false);
  await put(join(f.legacyRoot,'config.json'),JSON.stringify({version:1,mode:'all-local'}));
  await installDesktopBridge({...f,nodePath:process.execPath,chainedCli:f.native,autoFlow:true,codexHome:join(f.dir,'home')});
  assert.deepEqual(readFlowSettings(f.root),{version:1,enabled:false,policy});
  await installDesktopBridge({...f,nodePath:process.execPath,chainedCli:f.native,autoFlow:true,codexHome:join(f.dir,'home')});
  assert.deepEqual(readFlowSettings(f.root),{version:1,enabled:false,policy});
  await assert.rejects(updateFlowSettings(f.root,'true'),/explicit/i);
});

test('disabled legacy policy migrates to a separate off switch with the original allowlist intact',async t=>{
  const f=await fixture(t);await mkdir(f.root,{mode:0o700});
  await put(join(f.legacyRoot,'config.json'),JSON.stringify({...policy,mode:'disabled'}));
  await installFlowSettings(f.root,{legacyRoot:f.legacyRoot});
  assert.deepEqual(readFlowSettings(f.root),{version:1,enabled:false,policy});
  assert.deepEqual((await updateFlowSettings(f.root,true)).policy,policy);
});

test('malformed first legacy policy leaves no claimed root and corrected retry installs successfully',async t=>{
  const f=await fixture(t);await put(join(f.legacyRoot,'config.json'),'{broken');
  const options={...f,nodePath:process.execPath,chainedCli:f.native,legacyFlowRoot:f.legacyRoot,autoFlow:true,codexHome:join(f.dir,'home')};
  await assert.rejects(installDesktopBridge(options));
  await assert.rejects(lstat(f.root),{code:'ENOENT'});
  await put(join(f.legacyRoot,'config.json'),JSON.stringify(policy));
  await installDesktopBridge(options);
  assert.deepEqual(readFlowSettings(f.root).policy,policy);
});

test('public or linked settings and unowned legacy directories are rejected without import',async t=>{
  const f=await fixture(t);await mkdir(f.root,{mode:0o700});
  await installFlowSettings(f.root,{legacyRoot:f.legacyRoot});
  const file=join(f.root,'flow.json');await chmod(file,0o644);
  assert.throws(()=>readFlowSettings(f.root),/Private/);await chmod(file,0o600);
  const saved=await readFile(file,'utf8');await rm(file);await put(join(f.dir,'target'),saved);await symlink(join(f.dir,'target'),file);
  assert.throws(()=>readFlowSettings(f.root),/Private/);await rm(file);
  await put(join(f.legacyRoot,'.owner'),'foreign-owner');
  assert.throws(()=>prepareFlowSettings(f.root,{legacyRoot:f.legacyRoot}),/Unknown/);
});

test('flow relay preserves original handshake IDs, server requests and notification order',async()=>{
  const wire=[],desktop=[],observed=[];
  const relay=createDesktopRelay({toServer:m=>wire.push(m),toDesktop:m=>desktop.push(m)});
  try{
    relay.subscribe(m=>observed.push(m));
    const before={method:'turn/started',params:{threadId:'task'}};relay.fromServer(before);assert.equal(observed.length,0);
    const init={id:'desktop-initialize',method:'initialize',params:{clientInfo:{name:'desktop'}}};
    relay.fromDesktop(init);assert.equal(relay.ready,false);
    const response={id:init.id,result:{serverInfo:{name:'native'}}};relay.fromServer(response);assert.equal(relay.ready,true);
    const approval={id:123,method:'item/commandExecution/requestApproval',params:{}};relay.fromServer(approval);
    const event={method:'turn/completed',params:{threadId:'task',turn:{id:'turn',status:'completed'}}};relay.fromServer(event);
    assert.deepEqual(wire,[init]);assert.deepEqual(desktop,[before,response,approval,event]);assert.deepEqual(observed,[event]);
  }finally{relay.close();}
});

test('flow relay restricts its RPC surface and returns raw MCP envelopes without exposing injected responses',async()=>{
  const wire=[],desktop=[],relay=createDesktopRelay({toServer:m=>wire.push(m),toDesktop:m=>desktop.push(m)});
  try{
    await assert.rejects(relay.flowRequest('thread/loaded/list'),/handshake/);
    relay.fromDesktop({id:9,method:'initialize'});relay.fromServer({id:9,result:{}});
    for(const method of ['turn/start','thread/start','thread/resume','thread/archive','thread/section/move'])
      await assert.rejects(relay.flowRequest(method,{}),/not allowed/);
    for(const tool of ['create_thread','set_thread_archived','send_message_to_thread'])
      await assert.rejects(relay.flowRequest('mcpServer/tool/call',{server:'codex_app',threadId:'task',tool,arguments:{}}),/not allowed/);
    await assert.rejects(relay.flowRequest('thread/read',{threadId:'task',includeTurns:true}),/not allowed/);
    for(const [method,params] of [['thread/read',{threadId:'task',includeTurns:false}],['thread/list',{archived:false}],
      ['threadSection/list',{limit:100}],['thread/loaded/list',{limit:1000}]]){
      const pending=relay.flowRequest(method,params),request=wire.at(-1);assert.deepEqual(request.params,params);
      relay.fromServer({id:request.id,result:{data:[]}});assert.deepEqual(await pending,{data:[]});
    }
    const pending=relay.flowRequest('mcpServer/tool/call',{server:'codex_app',threadId:'task',tool:'read_thread',arguments:{threadId:'task'}});
    const request=wire.at(-1),envelope={isError:false,content:[{type:'text',text:'{"thread":{"id":"task"}}'}]};
    relay.fromServer({id:request.id,result:envelope});assert.deepEqual(await pending,envelope);
    assert.deepEqual(desktop,[{id:9,result:{}}]);
  }finally{relay.close();}
});

test('flow list coalescing shares only identical unresolved requests, never a settled snapshot',async()=>{
  const wire=[],relay=createDesktopRelay({toServer:m=>wire.push(m),toDesktop(){}});
  try{
    relay.fromDesktop({id:1,method:'initialize'});relay.fromServer({id:1,result:{}});
    const params={server:'codex_app',threadId:'task',tool:'list_threads',arguments:{limit:50}};
    const a=relay.flowRequest('mcpServer/tool/call',params),b=relay.flowRequest('mcpServer/tool/call',params);
    assert.equal(a,b);const first=wire.at(-1);relay.fromServer({id:first.id,result:{content:[]}});await a;
    const c=relay.flowRequest('mcpServer/tool/call',params);assert.notEqual(c,a);assert.notEqual(wire.at(-1).id,first.id);
    relay.fromServer({id:wire.at(-1).id,result:{content:[]}});await c;
  }finally{relay.close();}
});

async function liveFixture(t,{enabled=true,ready=true}={}){
  const f=await fixture(t);await mkdir(f.root,{mode:0o700});await installFlowSettings(f.root);await updateFlowSettings(f.root,enabled);
  const calls=[],moves=[],listeners=new Set(),task={id:'task',kind:'codex',hostId:'local',projectId:null,status:{type:'active',activeFlags:[]}};
  let section='chats',held;
  const relay={ready,contextThreadId:'task',subscribe(listener){listeners.add(listener);return ()=>listeners.delete(listener);},async flowRequest(method,p){
    if(method==='thread/read')return {thread:{...task,ephemeral:false,parentThreadId:null}};
    assert.equal(method,'mcpServer/tool/call');calls.push(p.tool);
    let result;
    if(p.tool==='list_threads')result={threads:[task],pinnedThreads:[],sections:[['chats','Tasks'],['progress','In Progress'],['review','For Review'],['later','For Later']]
      .map(([sectionId,name])=>({sectionId,name,itemKeys:sectionId===section?['codex:thread:local:task']:[]}))};
    else if(p.tool==='read_thread')result={thread:task};
    else if(p.tool==='move_thread_to_sidebar_section'){section=p.arguments.sectionId;moves.push(section);result=p.arguments;}
    else assert.fail(p.tool);
    const envelope={content:[{type:'text',text:JSON.stringify(result)}]};
    if(held?.tool===p.tool){const block=held;held=null;block.entered.resolve();await block.released.promise;}
    return envelope;
  }};
  const runtime=await startAutoFlow({root:f.root,relay,runExclusive:createTransactionGate()});t.after(()=>runtime.stop());
  await runtime.initialize();calls.length=0;
  return {...f,runtime,relay,calls,moves,task,listeners,
    emit:message=>Promise.all([...listeners].map(listener=>listener(message))),
    block(tool){const entered=deferred(),released=deferred();held={tool,entered,released};return {entered:entered.promise,release:()=>released.resolve()};},
    start:{method:'turn/started',params:{threadId:'task',turn:{id:'one',status:'inProgress'}}},
  };
}

test('rapid off then on during a held read never revives old lifecycle evidence',async t=>{
  const f=await liveFixture(t),block=f.block('list_threads');
  const old=f.emit(f.start);await block.entered;
  const off=f.runtime.change(false),on=f.runtime.change(true);
  assert.equal((await off).enabled,false);assert.equal((await on).enabled,true);
  await old;assert.deepEqual(f.moves,[]);
  block.release();await later();assert.deepEqual(f.moves,[]);
  await f.emit(f.start);assert.deepEqual(f.moves,['progress']);
  assert.equal((await f.runtime.change(false)).enabled,false);
});

test('disabling after move dispatch completes readonly readback before returning',async t=>{
  const f=await liveFixture(t),block=f.block('move_thread_to_sidebar_section');
  const event=f.emit(f.start);await block.entered;
  let finished=false;const off=f.runtime.change(false).then(value=>{finished=true;return value;});
  const deadline=Date.now()+2000;
  while(readFlowSettings(f.root).enabled&&Date.now()<deadline)await later();
  assert.equal(readFlowSettings(f.root).enabled,false);assert.equal(finished,false);
  const before=f.calls.length;block.release();await event;
  assert.equal((await off).enabled,false);
  assert.deepEqual(f.calls.slice(before),['list_threads','read_thread']);
  assert.deepEqual(f.moves,['progress']);
  await f.emit(f.start);assert.deepEqual(f.moves,['progress']);
});

test('persisted disabled runtime stays available but makes no automatic RPC calls',async t=>{
  const f=await liveFixture(t,{enabled:false});assert.equal(f.runtime.status().available,true);assert.equal(f.runtime.status().enabled,false);assert.equal(f.runtime.status().mode,'all-local');
  await f.emit(f.start);assert.deepEqual(f.calls,[]);
  await assert.rejects(f.runtime.change('true'),/explicit/);
  assert.equal((await f.runtime.change(true)).enabled,true);await f.emit(f.start);assert.deepEqual(f.moves,['progress']);
});

test('lifecycle evidence received before initialization is replayed after verified groups become ready',async t=>{
  const f=await liveFixture(t,{ready:false});await f.emit(f.start);assert.deepEqual(f.calls,[]);assert.deepEqual(f.moves,[]);
  f.relay.ready=true;await f.runtime.initialize();
  const deadline=Date.now()+2000;while(f.moves.length===0&&Date.now()<deadline)await later();
  assert.deepEqual(f.moves,['progress']);
});

test('bootstrap relay permits only the three exact group names with no extra create arguments',async()=>{
  const wire=[],relay=createDesktopRelay({toServer:message=>wire.push(message),toDesktop:()=>{}});
  try{
    relay.fromDesktop({id:1,method:'initialize'});relay.fromServer({id:1,result:{}});
    for(const args of [{name:'Custom'},{name:'For Review',extra:true},{},null])
      await assert.rejects(relay.flowRequest('mcpServer/tool/call',{server:'codex_app',threadId:'task',tool:'create_sidebar_section',arguments:args}),/not allowed/);
    assert.equal(wire.length,1);
    for(const name of ['In Progress','For Review','For Later']){
      const pending=relay.flowRequest('mcpServer/tool/call',{server:'codex_app',threadId:'task',tool:'create_sidebar_section',arguments:{name}});
      const outgoing=wire.at(-1);relay.fromServer({id:outgoing.id,result:{content:[{type:'text',text:'{}'}]}});await pending;
    }
  }finally{relay.close();}
});

test('shared transaction gate serializes whole operations and recovers after failure',async()=>{
  const gate=createTransactionGate(),held=deferred(),order=[];
  const first=gate(async()=>{order.push('manual-read');await held.promise;order.push('manual-write');throw Error('failed');});
  const second=gate(async()=>{order.push('auto-read');order.push('auto-write');order.push('auto-readback');});
  const failed=assert.rejects(first,/failed/);await later();assert.deepEqual(order,['manual-read']);held.resolve();
  await failed;await second;assert.deepEqual(order,['manual-read','manual-write','auto-read','auto-write','auto-readback']);
});

async function bootstrapFixture(t,{context=null,thread,read}={}){
  const f=await fixture(t);await mkdir(f.root,{mode:0o700});await installFlowSettings(f.root);
  const contexts=new Set(),listeners=new Set(),calls=[],groups=[];
  const relay={ready:true,contextThreadId:context,subscribe:fn=>{listeners.add(fn);return ()=>listeners.delete(fn);},
    subscribeContext:fn=>{contexts.add(fn);return ()=>contexts.delete(fn);},async flowRequest(method,p){
      calls.push({method,params:p});
      if(method==='thread/read')return {thread:await read?.(p.threadId)??{id:p.threadId,ephemeral:false,parentThreadId:null,...thread}};
      assert.equal(method,'mcpServer/tool/call');
      if(p.tool==='create_sidebar_section')groups.push({name:p.arguments.name,sectionId:p.arguments.name});
      else assert.equal(p.tool,'list_threads');
      return {content:[{type:'text',text:JSON.stringify({sections:groups})}]};
    }};
  const runtime=await startAutoFlow({root:f.root,relay,runExclusive:createTransactionGate()});t.after(()=>runtime.stop());
  return {...f,relay,runtime,calls,groups,connect:async id=>{relay.contextThreadId=id;await Promise.all([...contexts].map(fn=>fn(id)));}};
}
test('bootstrap waits without a local context and initializes only when a local chat is loaded',async t=>{
  const f=await bootstrapFixture(t);assert.equal(f.runtime.status().initialization.state,'waiting');assert.deepEqual(f.calls,[]);
  await f.connect('local');assert.equal(f.runtime.status().initialization.state,'ready');assert.equal(f.groups.length,3);
  await f.connect('another');assert.equal(f.groups.length,3);
});
test('remote, ephemeral and child contexts never create groups or start an observer',async t=>{
  for(const thread of [{hostId:'remote'},{ephemeral:true},{parentThreadId:'parent'}]){
    const f=await bootstrapFixture(t,{context:'unsuitable',thread});await f.runtime.initialize();
    assert.equal(f.runtime.status().initialization.state,'waiting');assert.equal(f.calls.length,1);assert.equal(f.groups.length,0);
  }
});
test('a local context arriving during a held remote read is retried after the old operation',async t=>{
  const held=deferred(),begun=deferred();
  const f=await bootstrapFixture(t,{context:'remote',read:async id=>{if(id==='remote'){begun.resolve();await held.promise;}
    return {id,ephemeral:false,parentThreadId:null,hostId:id==='remote'?'remote':'local'};}});
  await begun.promise;const changed=f.connect('local');held.resolve();await changed;
  await later();await f.runtime.initialize();assert.equal(f.runtime.status().initialization.state,'ready');assert.equal(f.groups.length,3);
});
test('corrupted settings during a queued context retry do not escape into native transport',async t=>{
  const held=deferred(),begun=deferred();
  const f=await bootstrapFixture(t,{context:'remote',read:async id=>{begun.resolve();await held.promise;return {id,ephemeral:false,hostId:'remote'};}});
  await begun.promise;const changed=f.connect('local');await put(join(f.root,'flow.json'),'{broken');held.resolve();
  await changed;await later();assert.equal((await f.runtime.initialize()).available,false);assert.equal(f.groups.length,0);
});
test('disabling during bootstrap drains an already dispatched create without creating further groups',async t=>{
  const f=await bootstrapFixture(t),held=deferred(),begun=deferred(),original=f.relay.flowRequest;
  f.relay.flowRequest=async(method,p)=>{const result=await original(method,p);if(p.tool==='create_sidebar_section'){begun.resolve();await held.promise;}return result;};
  const init=f.connect('local');await begun.promise;const off=f.runtime.change(false);
  while(readFlowSettings(f.root).enabled)await later();held.resolve();await init;
  assert.equal((await off).enabled,false);assert.equal(f.groups.length,1);
  await f.connect('another');assert.equal(f.groups.length,1);
});
test('initialization errors roll back an enable switch and leave manual bridge capabilities available',async t=>{
  const f=await bootstrapFixture(t);await f.runtime.change(false);
  f.groups.push({name:'For Review',sectionId:'one'},{name:'For Review',sectionId:'two'});await f.connect('local');
  await assert.rejects(f.runtime.change(true),/More than one group/);
  assert.equal(f.runtime.status().enabled,false);assert.equal(f.runtime.status().available,true);assert.equal(f.groups.length,2);
});
test('a context loaded before initialize acknowledgment is delivered once transport becomes ready',async()=>{
  const relay=createDesktopRelay({toServer:()=>{},toDesktop:()=>{}}),contexts=[];
  try{
    relay.subscribeContext(id=>contexts.push(id));
    relay.fromDesktop({id:1,method:'initialize'});relay.fromDesktop({id:2,method:'thread/resume',params:{threadId:'task'}});
    relay.fromServer({id:2,result:{thread:{id:'task'}}});assert.deepEqual(contexts,[]);
    relay.fromServer({id:1,result:{}});assert.deepEqual(contexts,['task']);
  }finally{relay.close();}
});
