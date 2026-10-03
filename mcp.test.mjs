import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,mkdir,readdir,lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {Script} from 'node:vm';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {createKanbanMcp,boardResourceUri} from './mcp-server.mjs';
import {createKanbanService,createBoardSource} from './kanban-service.mjs';
import {preparePlugin} from './install-plugin.mjs';

const id='11111111-1111-4111-8111-111111111111';
const task={id,hostId:'local',title:'Fixture task',cwd:'/fixture'};
const board=()=>({tasks:[task],sections:[],sync:{connected:true}});
async function harness(options={}){
  const service=createKanbanService({getBoard:async()=>board(),...options});
  const app=createKanbanMcp({service,readUi:async()=>'<html>Fixture UI</html>'});
  const client=new Client({name:'kanban-test',version:'1'},{capabilities:{}});
  const [serverTransport,clientTransport]=InMemoryTransport.createLinkedPair();
  await app.server.connect(serverTransport);await client.connect(clientTransport);
  return {app,client,service,async close(){await client.close();await app.close();}};
}
test('MCP lists the sidebar entry, app-only tools and independent UI resource',async()=>{
  const f=await harness({getBoard:async()=>{throw Error('private diagnostic');}});
  try{
    const tools=(await f.client.listTools()).tools;
    assert.equal(tools.length,6);
    assert(tools.every(t=>t._meta.ui.visibility.length===1&&t._meta.ui.visibility[0]==='app'));
    assert.deepEqual(tools[0]._meta['openai/ui'].entrypoints,[{type:'global'}]);
    assert.equal(tools[0]._meta.ui.resourceUri,boardResourceUri);
    assert.equal((await f.client.listResources()).resources[0].mimeType,'text/html;profile=mcp-app');
    const resource=(await f.client.readResource({uri:boardResourceUri})).contents[0];
    assert.equal(resource.text,'<html>Fixture UI</html>');
    assert.deepEqual(resource._meta.ui.csp.connectDomains,[]);
    const failed=await f.client.callTool({name:'get_board',arguments:{}});
    assert.equal(failed.isError,true);assert(!JSON.stringify(failed).includes('private diagnostic'));
  }finally{await f.close();}
});
test('MCP shares Desktop group capability guards and owning-connection runtime with HTTP',async()=>{
  let connected=true,groupActions=true,writes=0;
  const f=await harness({getBoard:async()=>({...board(),sync:{connected:true,scope:'localSections'}}),
    desktopBridgeSocket:'fixture',bridgeRequest:async(_socket,method,params)=>{
      if(method==='status')return {connected,groupActions,runtimeAvailable:true};
      if(method==='runtime')return {connected:true,capturedAt:new Date().toISOString(),
        statuses:[{threadId:id,status:{type:'active',activeFlags:[]}}]};
      writes++;assert.equal(method,'move');assert.equal(params.threadId,id);
      return {threadId:id,sectionId:params.sectionId,changed:true};
    }});
  try{
    const read=async()=> (await f.client.callTool({name:'get_board',arguments:{}})).structuredContent;
    const live=await read();assert.equal(live.board.tasks[0].column,'running');
    assert.equal(live.board.tasks[0].runtimeStatusSource,'desktopRuntime');assert.equal(live.board.sync.moveWritable,true);
    const params={threadId:id,hostId:'local',sectionId:'review',expectedSectionId:null,actionToken:live.csrf};
    assert.equal((await f.client.callTool({name:'move_task',arguments:params})).structuredContent.changed,true);
    assert.equal(writes,1);
    groupActions=false;
    assert.equal((await read()).board.sync.pinLocal,false);
    assert.equal((await f.client.callTool({name:'move_task',arguments:params})).isError,true);
    connected=false;groupActions=true;
    const lost=await read();assert.equal(lost.board.sync.moveWritable,false);assert.notEqual(lost.board.sync.runtimeLive,true);
    assert.equal((await f.client.callTool({name:'pin_task',arguments:{threadId:id,hostId:'local',pinned:true,actionToken:live.csrf}})).isError,true);
    assert.equal(writes,1);
  }finally{await f.close();}
});
test('MCP validates inputs, session token and token-only Undo before writes',async()=>{
  let writes=0,restores=0;
  const f=await harness({archiveTask:async()=>{writes++;return {threadId:id,archived:true};},
    restoreTask:async params=>{restores++;assert.deepEqual(params,{threadId:id,hostId:'local'});return {threadId:id,restored:true};}});
  try{
    const csrf=(await f.client.callTool({name:'get_board',arguments:{}})).structuredContent.csrf;
    const params={threadId:id,hostId:'local',actionToken:csrf};
    for(const input of [{...params,hostId:'remote'},{...params,threadId:'bad'},{...params,extra:'unsupported'},
      {...params,actionToken:'22222222-2222-4222-8222-222222222222'}]){
      assert.equal((await f.client.callTool({name:'archive_task',arguments:input})).isError,true);
    }
    assert.equal(writes,0);
    const archived=(await f.client.callTool({name:'archive_task',arguments:params})).structuredContent;
    assert.equal(writes,1);assert(archived.undoToken);
    assert.equal((await f.client.callTool({name:'undo_archive',arguments:{actionToken:csrf,undoToken:archived.undoToken,threadId:id}})).isError,true);
    const restored=await f.client.callTool({name:'undo_archive',arguments:{actionToken:csrf,undoToken:archived.undoToken}});
    assert.equal(restored.structuredContent.restored,true);assert.equal(restores,1);
    assert.equal((await f.client.callTool({name:'undo_archive',arguments:{actionToken:csrf,undoToken:archived.undoToken}})).isError,true);
    assert.equal((await f.client.callTool({name:'missing',arguments:{}})).isError,true);
  }finally{await f.close();}
});
test('shared write lock includes the verification snapshot and blocks another app',async()=>{
  let finish,started,reads=0,writes=0;
  const began=new Promise(resolve=>started=resolve);
  const service=createKanbanService({getBoard:async()=>{
    if(++reads===2){started();await new Promise(resolve=>finish=resolve);}return board();
  },archiveTask:async()=>{writes++;return {threadId:id,archived:true};}});
  const first=service.action('archive',{threadId:id,hostId:'local'});await began;
  await assert.rejects(service.action('archive',{threadId:id,hostId:'local'}),error=>error.status===409);
  finish();const payload=await first;assert.equal(writes,1);assert(payload.undoToken);await service.close();
});
test('lost archive responses remain recoverable on the next read; consumed Undo disappears',async()=>{
  const service=createKanbanService({getBoard:async()=>board(),archiveTask:async()=>({threadId:id,archived:true}),
    restoreTask:async()=>({threadId:id,restored:true})});
  await service.action('archive',{threadId:id,hostId:'local'}); // Simulate a dropped client response.
  const entries=(await service.read()).undoArchives;
  assert.equal(entries.length,1);assert.deepEqual(entries[0].task,{id,hostId:'local',title:'Fixture task'});
  await service.action('unarchive',{undoToken:entries[0].undoToken});
  assert.deepEqual((await service.read()).undoArchives,[]);await service.close();
});
test('cancellation during the preflight read never dispatches a write',async()=>{
  let finish,started,writes=0;const controller=new AbortController();
  const began=new Promise(resolve=>started=resolve);
  const service=createKanbanService({getBoard:async()=>{started();await new Promise(resolve=>finish=resolve);return board();},
    archiveTask:async()=>{writes++;return {threadId:id,archived:true};}});
  const action=service.action('archive',{threadId:id,hostId:'local'},{signal:controller.signal});
  await began;controller.abort();finish();await assert.rejects(action,error=>error.status===408);assert.equal(writes,0);await service.close();
});
test('missing plugin snapshot still reads local tasks, and close releases the reader',async()=>{
  const root=await mkdtemp(join(tmpdir(),'kanban-data-'));let closes=0;
  const source=createBoardSource({snapshotPath:join(root,'snapshot.json'),allowMissingSnapshot:true,readUnread:async()=>({known:false}),
    openReader:async()=>({close(){closes++;},async request(method){
      if(method==='threadSection/list')return {data:[]};
      return {data:[{id,name:'Local fixture',ephemeral:false,parentThreadId:null,section:null,updatedAt:1,cwd:'/fixture'}]};
    }})});
  try{const value=await source.getBoard();assert.equal(value.tasks[0].id,id);assert.equal(value.tasks[0].column,'unknown');}
  finally{await source.close();await rm(root,{recursive:true});}
  assert(closes>=1);await assert.rejects(source.getBoard());
});
test('MCP app shutdown prevents a waiting tool call from dispatching its archive',async()=>{
  let release,started,writes=0;const began=new Promise(resolve=>started=resolve);
  const f=await harness({getBoard:async()=>{
    started();await new Promise(resolve=>release=resolve);return board();
  },archiveTask:async()=>{writes++;return {threadId:id,archived:true};}});
  try{
    const request=f.client.callTool({name:'archive_task',arguments:{threadId:id,hostId:'local',actionToken:f.service.csrf}});
    await began;const closing=f.app.close();release();
    const response=await request;await closing;
    assert.equal(response.structuredContent.status,408);assert.equal(response.isError,true);assert.equal(writes,0);
  }finally{await f.close();}
});
test('installed package runs outside its directory without node_modules and serves the built UI',async()=>{
  const root=await mkdtemp(join(tmpdir(),'kanban-install-'));
  const client=new Client({name:'installed-probe',version:'1'},{capabilities:{}});let transport;
  try{
    const installed=await preparePlugin({root});
    const manifest=JSON.parse(await readFile(join(installed.plugin,'plugin.json'),'utf8'));
    const presentation=manifest.extensions['com.openai'].interface;
    assert.equal(presentation.logo,'./assets/kanban-icon.png');
    assert.equal(presentation.composerIcon,presentation.logo);
    const icon=await readFile(join(installed.plugin,presentation.logo));
    assert.deepEqual(icon,await readFile(new URL('./assets/kanban-icon.png',import.meta.url)));
    assert.equal(icon.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
    const width=icon.readUInt32BE(16),height=icon.readUInt32BE(20);
    assert.equal(width,height);assert(width>=48&&width<=4096);assert(icon.length<=5*1024*1024);
    const config=JSON.parse(await readFile(join(installed.plugin,'mcp.json'),'utf8'));
    assert.equal(config.mcpServers['codex-kanban'].command,'./launch-mcp');
    assert.equal(config.mcpServers['codex-kanban'].cwd,'./');
    transport=new StdioClientTransport({command:join(installed.plugin,'launch-mcp'),args:[],cwd:tmpdir(),stderr:'pipe'});
    await client.connect(transport);
    assert.equal((await client.listTools()).tools[0].name,'open_board');
    const resource=(await client.readResource({uri:boardResourceUri})).contents[0];
    assert(resource.text.includes('background:var(--bg);color:var(--ink);display:flex'));
    assert(resource.text.includes('Connecting to local Codex tasks'));
    assert(!resource.text.includes('<script src='));
    const scripts=[...resource.text.matchAll(/<script>([\s\S]*?)<\/script>/g)];
    assert.equal(scripts.length,2);
    for(const script of scripts)new Script(script[1]);
    await client.close();
    const child=spawn(process.execPath,[join(installed.plugin,'mcp-server.mjs')],{cwd:tmpdir(),stdio:['pipe','pipe','pipe']});
    let stdout='';child.stdout.on('data',chunk=>stdout+=chunk);const exit=once(child,'exit');child.stdin.end();
    const timeout=setTimeout(()=>child.kill('SIGKILL'),5000);
    const [code,signal]=await exit;clearTimeout(timeout);assert.equal(code,0);assert.equal(signal,null);assert.equal(stdout,'');
  }finally{await client.close();await transport?.close();await rm(root,{recursive:true});}
});
test('failed marketplace publication restores the previous installed package',async()=>{
  const root=await mkdtemp(join(tmpdir(),'kanban-install-rollback-'));
  try{
    const original=await preparePlugin({root,build:false});
    await writeFile(join(original.plugin,'previous-marker'),'old installation');
    const launcher=await readFile(join(original.plugin,'launch-mcp'),'utf8');
    const manifest=join(root,'.agents','plugins','marketplace.json');
    await rm(manifest);await mkdir(manifest);
    await assert.rejects(preparePlugin({root,nodePath:'/replacement/node',build:false}),error=>['EISDIR','ENOTEMPTY','EEXIST'].includes(error.code));
    assert.equal(await readFile(join(original.plugin,'previous-marker'),'utf8'),'old installation');
    assert.equal(await readFile(join(original.plugin,'launch-mcp'),'utf8'),launcher);
    assert((await lstat(manifest)).isDirectory());
    assert(!(await readdir(root)).some(name=>name.startsWith('.stage-')||name.startsWith('.previous-')));
    // A subsequent valid update publishes both artifacts and preserves its backup.
    await rm(manifest,{recursive:true});
    const updated=await preparePlugin({root,build:false});
    assert.equal(await readFile(join(updated.previous,'previous-marker'),'utf8'),'old installation');
    assert.equal(JSON.parse(await readFile(manifest,'utf8')).plugins[0].source.path,'./codex-kanban');
    await assert.rejects(readFile(join(updated.plugin,'previous-marker'),'utf8'),error=>error.code==='ENOENT');
  }finally{await rm(root,{recursive:true,force:true});}
});
test('failed first marketplace publication leaves no active plugin or staged package',async()=>{
  const root=await mkdtemp(join(tmpdir(),'kanban-install-first-'));
  try{
    // This is an owned installation root with an obstructed manifest destination.
    await writeFile(join(root,'.owner'),'codex-kanban-marketplace-v1');
    await mkdir(join(root,'.agents','plugins','marketplace.json'),{recursive:true});
    await assert.rejects(preparePlugin({root,build:false}));
    await assert.rejects(lstat(join(root,'codex-kanban')),error=>error.code==='ENOENT');
    assert(!(await readdir(root)).some(name=>name.startsWith('.stage-')||name.startsWith('.previous-')));
  }finally{await rm(root,{recursive:true,force:true});}
});
