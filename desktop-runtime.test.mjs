import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDesktopRuntime,readBoardRuntime} from './desktop-runtime.mjs';
import {createDesktopRelay} from './desktop-proxy.mjs';
import {startDesktopArchiveBridge} from './desktop-archive.mjs';
import {createKanbanServer} from './serve.mjs';
import {desktopBridgeRequest} from './bridge-transport.mjs';

const id='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const capturedAt='2026-10-04T00:00:00Z';
const thread=(id,status={type:'active',activeFlags:[]})=>({id,status,ephemeral:false,parentThreadId:null});
const base=()=>({tasks:[{id,hostId:'local',nativeSectionId:'progress',column:'unknown'},
  {id,hostId:'durable',column:'unknown'}],sync:{runtimeLive:false},runtimeCapturedAt:'2026-10-03T00:00:00Z'});

test('runtime reads use the Desktop connection, retain waits and disclose only IDs and status flags',async()=>{
  const calls=[];
  const runtime=createDesktopRuntime({clock:()=>capturedAt,request:async(method,params)=>{
    calls.push({method,params});return {thread:{...thread(params.threadId,{type:'active',activeFlags:['waitingOnUserInput'],extra:'private'}),name:'private',turns:['private']}};
  }});
  const reply=await runtime.read({threadIds:[id]});
  assert.deepEqual(calls,[{method:'thread/read',params:{threadId:id,includeTurns:false}}]);
  assert.deepEqual(reply,{connected:true,capturedAt,statuses:[{threadId:id,status:{type:'active',activeFlags:['waitingOnUserInput']}}]});
});
test('malformed, protected, mismatched and failed reads do not invent execution or completion',async()=>{
  for(const value of [{...thread(id),ephemeral:true},{...thread(id),parentThreadId:other},thread(other),
    thread(id,{type:'active'}),thread(id,{type:'active',activeFlags:['newFlag']}),null]){
    const runtime=createDesktopRuntime({request:async()=>({thread:value})});
    assert.deepEqual((await runtime.read({threadIds:[id]})).statuses,[]);
  }
  const failed=createDesktopRuntime({request:async()=>{throw Error('closed');}});
  assert.deepEqual((await failed.read({threadIds:[id]})).statuses,[]);
  for(const threadIds of [[id,id],['bad'],[...Array(101)].map(()=>id),null])
    await assert.rejects(failed.read({threadIds}),/Invalid local/);
});
test('runtime requests are bounded and reject disconnection or cancellation during observation',async()=>{
  let connected=true,active=0,peak=0;
  const ids=Array.from({length:10},(_,i)=>`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`);
  const runtime=createDesktopRuntime({ready:()=>connected,request:async(_,p)=>{
    active++;peak=Math.max(peak,active);await new Promise(r=>setImmediate(r));active--;return {thread:thread(p.threadId)};
  }});
  assert.equal((await runtime.read({threadIds:ids})).statuses.length,10);assert.equal(peak,4);
  connected=false;await assert.rejects(runtime.read({threadIds:[id]}),/disconnected/);
  const abort=new AbortController();abort.abort();connected=true;
  await assert.rejects(runtime.read({threadIds:[id]},{signal:abort.signal}),/disconnected/);
  const interrupted=createDesktopRuntime({ready:()=>connected,request:async()=>{connected=false;return {thread:thread(id)};}});
  await assert.rejects(interrupted.read({threadIds:[id]}),/disconnected/);
});
test('native relay reads are whitelisted and preserve original Desktop replies',async()=>{
  const sent=[],forwarded=[],relay=createDesktopRelay({toServer:m=>sent.push(m),toDesktop:m=>forwarded.push(m)});
  await assert.rejects(relay.request('thread/read',{threadId:id,includeTurns:false}),/handshake/);
  relay.fromDesktop({id:1,method:'initialize'});relay.fromServer({id:1,result:{}});
  const pending=relay.request('thread/read',{threadId:id,includeTurns:false}),query=sent.at(-1);
  assert.equal(query.method,'thread/read');assert.deepEqual(query.params,{threadId:id,includeTurns:false});
  relay.fromServer({id:query.id,result:{thread:thread(id)}});assert.equal((await pending).thread.id,id);
  relay.fromServer({method:'thread/status/changed',params:{threadId:id,status:{type:'idle'}}});
  assert.equal(forwarded.length,2);
  for(const method of ['thread/start','thread/resume','turn/start','thread/list','thread/section/move','mcpServer/tool/call'])
    await assert.rejects(relay.request(method,{threadId:id,includeTurns:false}),/not allowed/);
  await assert.rejects(relay.request('thread/read',{threadId:id,includeTurns:true}),/not allowed/);
  const lost=relay.request('thread/read',{threadId:id,includeTurns:false});relay.close();
  await assert.rejects(lost,/closed/);
});
test('fresh runtime overlays only exact local identities and never changes grouping',async()=>{
  const board=base(),before=JSON.stringify(board);
  const read=status=>readBoardRuntime(board,'fixture',{clock:()=>capturedAt,request:async(_,method,params)=>{
    assert.equal(method,'runtime');assert.deepEqual(params,{threadIds:[id]});
    return {connected:true,capturedAt,statuses:[{threadId:id,status}]};
  }});
  const running=await read({type:'active',activeFlags:[]});
  assert.equal(running.tasks[0].column,'running');assert.equal(running.tasks[0].nativeSectionId,'progress');
  assert.equal(running.tasks[0].runtimeStatusSource,'desktopRuntime');assert.equal(running.tasks[0].runtimeCapturedAt,capturedAt);
  assert.equal(running.tasks[1].column,'unknown');assert.equal(JSON.stringify(board),before);
  assert.equal((await read({type:'active',activeFlags:['waitingOnApproval']})).tasks[0].column,'attention');
  assert.equal((await read({type:'idle'})).tasks[0].column,'idle');
});
test('old, future, malformed, duplicate and disconnected replies cannot renew running status',async()=>{
  const board=base(),reply={connected:true,capturedAt,statuses:[{threadId:id,status:{type:'active',activeFlags:[]}}]};
  for(const value of [{...reply,capturedAt:'2026-10-03T00:00:00Z'},{...reply,capturedAt:'2026-10-05T00:00:00Z'},
    {...reply,connected:false},{...reply,statuses:[...reply.statuses,...reply.statuses]},
    {...reply,statuses:[{threadId:other,status:{type:'idle'}}]},
    {...reply,statuses:[{threadId:id,status:{type:'active',activeFlags:['unknown']}}]}]){
    assert.equal(await readBoardRuntime(board,'fixture',{clock:()=>capturedAt,request:async()=>value}),board);
  }
  assert.equal(await readBoardRuntime(board,'fixture',{request:async()=>{throw Error('disconnected');}}),board);
});
test('HTTP polling reads live status through the private bridge across running, waiting and idle transitions',async()=>{
  const root=await mkdtemp(join(tmpdir(),'kb-runtime-')),socketPath=join(root,'d.sock');
  let status={type:'active',activeFlags:[]},connected=true;const calls=[];
  const stop=await startDesktopArchiveBridge({socketPath,ready:()=>connected,call:async()=>{throw Error('No MCP tools needed');},
    request:async(method,params)=>{calls.push(method);return {thread:thread(params.threadId,status)};}});
  // Bind a free port, then use the same listener with its origin check configured.
  const {createServer}=await import('node:net');const probe=createServer();
  await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
  const http=createKanbanServer({port,desktopBridgeSocket:socketPath,getBoard:async()=>({...base(),sync:{connected:true,runtimeLive:false}})});
  await new Promise(r=>http.listen(port,'127.0.0.1',r));
  try{
    const read=async()=> (await(await fetch(`http://127.0.0.1:${port}/api/board`)).json()).board;
    const running=await read();assert.equal(running.tasks[0].column,'running');assert.equal(running.sync.runtimeLive,true);
    assert.equal(running.sync.desktopGroupsConnected,true);assert.equal(running.sync.moveWritable,true);assert.equal(running.sync.pinLocal,true);
    status={type:'active',activeFlags:['waitingOnUserInput']};assert.equal((await read()).tasks[0].column,'attention');
    status={type:'idle'};assert.equal((await read()).tasks[0].column,'idle');
    connected=false;const lost=await read();assert.equal(lost.sync.runtimeLive,false);assert.equal(lost.tasks[0].column,'unknown');
    assert.equal(lost.sync.moveWritable,false);assert.equal(lost.sync.pinLocal,false);assert.equal(lost.sync.archiveTransport,'local');
    assert(calls.every(method=>method==='thread/read'));
    await assert.rejects(desktopBridgeRequest(socketPath,'turn/start'),/only supports/);
  }finally{await new Promise(r=>http.close(r));await stop();await rm(root,{recursive:true,force:true});}
});
