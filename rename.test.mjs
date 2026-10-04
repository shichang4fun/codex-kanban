import test from 'node:test';
import assert from 'node:assert/strict';
import {renameLocalTask} from './rename.mjs';
import {createKanbanService} from './kanban-service.mjs';
import {createKanbanServer} from './serve.mjs';
import {createKanbanMcp} from './mcp-server.mjs';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {createMcpFetch} from './mcp-ui-transport.mjs';
import {createDesktopArchive,startDesktopArchiveBridge} from './desktop-archive.mjs';
import {createDesktopRelay} from './desktop-proxy.mjs';
import {desktopBridgeRequest} from './bridge-transport.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const id='11111111-1111-4111-8111-111111111111';
const params={threadId:id,hostId:'local',title:'新任务名称',expectedTitle:'Original'};
const board={tasks:[{id,hostId:'local',title:'Original'}],sections:[],sync:{connected:true}};
function fixture({confirm=true}={}){
  const thread={id,name:'Original',ephemeral:false,parentThreadId:null,projectId:'project',section:{id:'review'},cwd:'/fixture'},calls=[];
  let closed=false;
  const open=async()=>({request:async(method,p)=>{
    calls.push({method,params:p});
    if(method==='thread/list')return {data:[{id}],nextCursor:null};
    if(method==='thread/read')return {thread:{...thread}};
    assert.equal(method,'thread/name/set');if(confirm)thread.name=p.name;return {};
  },close(){closed=true;}});
  return {open,thread,calls,get closed(){return closed;}};
}
function desktopFixture(options={}){
  const f=fixture(options),writes=[];
  return {...f,get closed(){return f.closed;},writes,options:{openReader:f.open,call:async(tool,args)=>{
    assert.equal(tool,'set_thread_title');writes.push(args);
    if(options.confirm!==false)f.thread.name=args.title;return {};
  }}};
}
test('Desktop rename dispatches once through the client and verifies the title with a read-only reader',async()=>{
  const f=desktopFixture(),before={...f.thread},controller=createDesktopArchive(f.options);
  assert.equal(controller.status().renameActions,true);
  assert.deepEqual(await controller.rename(params),{threadId:id,title:params.title,changed:true});
  assert.deepEqual(f.writes,[{threadId:id,source:'codex',title:params.title}]);
  assert.deepEqual(f.calls.map(c=>c.method),['thread/list','thread/read','thread/read']);
  assert.deepEqual(f.thread,{...before,name:params.title});assert(f.closed);
});
test('Desktop rename rejects stale, archived and protected tasks; failure never dispatches a second write',async()=>{
  for(const fields of [{name:'Changed elsewhere'},{ephemeral:true},{parentThreadId:'parent'}]){
    const f=desktopFixture();Object.assign(f.thread,fields);
    await assert.rejects(createDesktopArchive(f.options).rename(params));assert.equal(f.writes.length,0);
  }
  const archived=desktopFixture();
  await assert.rejects(createDesktopArchive({...archived.options,openReader:async()=>({request:async()=>({data:[]}),close(){}})}).rename(params),/archived/);
  assert.equal(archived.writes.length,0);
  const failed=desktopFixture({confirm:false});await assert.rejects(createDesktopArchive(failed.options).rename(params),/confirmed/);
  assert.equal(failed.writes.length,1);
  const cancelled=desktopFixture(),abort=new AbortController();abort.abort();
  await assert.rejects(createDesktopArchive(cancelled.options).rename(params,{signal:abort.signal}),/cancelled/);
  assert.equal(cancelled.writes.length,0);assert.equal(cancelled.calls.length,0);
});
test('service selects Desktop rename without using the independent writer, including dispatch failure',async t=>{
  let fail=false;const calls=[];
  const service=createKanbanService({getBoard:async()=>board,desktopBridgeSocket:'fixture',settingsStore:{read:async()=>({})},
    renameTask:async()=>{assert.fail('Independent writer must not run');},bridgeRequest:async(_socket,method,p)=>{
      if(method==='status')return {connected:true,renameActions:true};
      assert.equal(method,'rename');calls.push(p);if(fail)throw Error('Disconnected after dispatch');
      return {threadId:id,title:params.title,changed:true};
    }});t.after(()=>service.close());
  assert.equal((await service.read()).board.sync.renameTransport,'desktop');
  assert.equal((await service.action('rename',params)).title,params.title);
  fail=true;await assert.rejects(service.action('rename',params),/could not be confirmed/);
  assert.deepEqual(calls,[params,params]);
});
test('private Desktop socket and relay permit only the explicit task-title operation',async t=>{
  const root=await mkdtemp(join(tmpdir(),'kb-rename-')),socketPath=join(root,'desktop.sock'),f=desktopFixture();
  const stop=await startDesktopArchiveBridge({socketPath,...f.options});
  t.after(async()=>{await stop();await rm(root,{recursive:true,force:true});});
  assert.equal((await desktopBridgeRequest(socketPath,'rename',params)).title,params.title);
  assert.equal(f.writes.length,1);
  const sent=[],forwarded=[],relay=createDesktopRelay({toServer:m=>sent.push(m),toDesktop:m=>forwarded.push(m)});t.after(()=>relay.close());
  relay.fromDesktop({id:1,method:'initialize'});relay.fromServer({id:1,result:{}});
  const renamed=relay.call('set_thread_title',{threadId:id,title:params.title,source:'codex'},'context'),request=sent.at(-1);
  assert.equal(request.params.arguments.threadId,id);assert.equal(request.params.threadId,'context');
  relay.fromServer({id:request.id,result:{content:[{type:'text',text:'{}'}]}});await renamed;
  const notification={method:'thread/name/updated',params:{threadId:id,name:params.title}};
  relay.fromServer(notification);assert.deepEqual(forwarded.at(-1),notification);
  await assert.rejects(relay.call('send_message_to_thread',{},'context'),/not allowed/);
});

test('rename uses only the native name setter, verifies persistence and leaves other metadata intact',async()=>{
  const f=fixture(),before={...f.thread};
  assert.deepEqual(await renameLocalTask(params,board,f),{threadId:id,title:params.title,changed:true});
  assert.deepEqual(f.calls.map(c=>c.method),['thread/list','thread/read','thread/name/set','thread/read']);
  assert.deepEqual(f.calls[2].params,{threadId:id,name:params.title});
  assert.deepEqual(f.thread,{...before,name:params.title});assert(f.closed);
  const same=fixture();assert.equal((await renameLocalTask({...params,title:'Original'},board,same)).changed,false);
  assert.equal(same.calls.length,2);assert(same.closed);
});
test('stale titles and protected tasks refuse renaming before dispatch',async()=>{
  for(const fields of [{name:'Renamed elsewhere'},{id:'other'},{ephemeral:true},{parentThreadId:'parent'},{archived:true}]){
    const f=fixture();Object.assign(f.thread,fields);
    await assert.rejects(renameLocalTask(params,board,f));assert(f.closed);
    assert(!f.calls.some(c=>c.method==='thread/name/set'));
  }
  let opens=0;const open=async()=>{opens++;throw Error('Unexpected open');};
  for(const change of [{hostId:'durable'},{threadId:'bad'},{title:''},{title:'   '},{title:' trailing '},{title:'a\nb'},{title:'x'.repeat(257)},{expectedTitle:'Stale'}])
    await assert.rejects(renameLocalTask({...params,...change},board,{open}));
  await assert.rejects(renameLocalTask(params,{tasks:[{...board.tasks[0],sidebarOnly:true}]},{open}));assert.equal(opens,0);
});
test('unconfirmed writes are never retried; cancellation before writing closes the writer',async()=>{
  const f=fixture({confirm:false});await assert.rejects(renameLocalTask(params,board,f),/could not be confirmed/);
  assert.equal(f.calls.filter(c=>c.method==='thread/name/set').length,1);assert(f.closed);
  const cancelled=fixture(),abort=new AbortController();
  const open=async()=>{const client=await cancelled.open();return {...client,async request(method,p){const result=await client.request(method,p);abort.abort();return result;}};};
  await assert.rejects(renameLocalTask(params,board,{open,signal:abort.signal}),/cancelled/);
  assert(cancelled.closed);assert.equal(cancelled.calls.length,1);
});
test('schema-shaped archived reads cannot bypass authoritative active membership',async()=>{
  for(const page of [{data:[],nextCursor:null},{data:null},{data:[],nextCursor:'repeat'}]){
    const f=fixture();let lists=0;
    const open=async()=>{const client=await f.open();return {...client,request:async(method,p)=>method==='thread/list'?(lists++,page):client.request(method,p)};};
    await assert.rejects(renameLocalTask(params,board,{open}),/archived|membership/);
    assert(!f.calls.some(c=>c.method==='thread/name/set'));assert(f.closed);assert(lists<=2);
  }
});
test('active membership pagination finds the exact task before reading and writing its title',async()=>{
  const f=fixture(),pages=[];
  const open=async()=>{const client=await f.open();return {...client,request:async(method,p)=>{
    if(method==='thread/list'){pages.push(p);return p.cursor===null?{data:[{id:'other'}],nextCursor:'next'}:{data:[{id}],nextCursor:null};}
    return client.request(method,p);
  }};};
  assert.equal((await renameLocalTask(params,board,{open})).changed,true);
  assert.deepEqual(pages.map(p=>p.cursor),[null,'next']);assert(pages.every(p=>p.archived===false));
});
test('cancellation after dispatch still confirms the single write',async()=>{
  const f=fixture(),abort=new AbortController();
  const open=async()=>{const client=await f.open();return {...client,async request(method,p){const result=await client.request(method,p);if(method==='thread/name/set')abort.abort();return result;}};};
  assert.equal((await renameLocalTask(params,board,{open,signal:abort.signal})).changed,true);
  assert.equal(f.calls.filter(c=>c.method==='thread/name/set').length,1);assert(f.closed);
});
test('rename shares the mutation lock and rejects mismatched confirmation without retry',async()=>{
  let release,entered;const started=new Promise(resolve=>entered=resolve);let writes=0;
  const service=createKanbanService({getBoard:async()=>board,renameTask:async()=>{
    writes++;entered();await new Promise(resolve=>release=resolve);return {threadId:id,title:'Wrong title',changed:true};
  }});
  try{
    const pending=service.action('rename',params),rejected=assert.rejects(pending,/could not be confirmed/);await started;
    for(const action of ['archive','rename','project'])await assert.rejects(service.action(action,params),error=>error.status===409);
    release();await rejected;assert.equal(writes,1);assert((await service.read()).board.sync.renameLocal);
  }finally{release?.();await service.close();}
});
test('HTTP rename requires the session token and returns the confirmed title',async()=>{
  let writes=0;const server=createKanbanServer({port:0,getBoard:async()=>board,renameTask:async()=>{writes++;return {threadId:id,title:params.title,changed:true};}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const base='http://127.0.0.1:'+server.address().port,{csrf}=await(await fetch(base+'/api/board')).json();
    const post=token=>fetch(base+'/api/rename',{method:'POST',headers:{'Content-Type':'application/json','X-Kanban-Token':token},body:JSON.stringify(params)});
    assert.equal((await post('wrong')).status,403);assert.equal(writes,0);
    const response=await post(csrf);assert.equal(response.status,200);assert.equal((await response.json()).title,params.title);assert.equal(writes,1);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
test('MCP rename travels through the UI transport, requires the token and rejects nonlocal targets',async()=>{
  let writes=0;const service=createKanbanService({getBoard:async()=>board,renameTask:async p=>{writes++;return {threadId:id,title:p.title,changed:true};}});
  const app=createKanbanMcp({service}),client=new Client({name:'rename-test',version:'1'},{});
  const [serverTransport,clientTransport]=InMemoryTransport.createLinkedPair();await app.server.connect(serverTransport);await client.connect(clientTransport);
  const transport=createMcpFetch({callServerTool:p=>client.callTool(p)},Promise.resolve());
  try{
    const post=(token,body=params)=>transport('/api/rename',{method:'POST',headers:{'X-Kanban-Token':token},body:JSON.stringify(body)});
    assert.equal((await post('99999999-9999-4999-8999-999999999999')).status,403);assert.equal(writes,0);
    assert.equal((await client.callTool({name:'rename_task',arguments:{...params,hostId:'durable',actionToken:service.csrf}})).isError,true);assert.equal(writes,0);
    const response=await post(service.csrf);assert(response.ok);assert.equal((await response.json()).title,params.title);assert.equal(writes,1);
  }finally{await client.close();await app.close();}
});
