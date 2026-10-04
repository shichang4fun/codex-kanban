import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,chmod,lstat,readFile,writeFile,mkdir,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {createDesktopArchive,startDesktopArchiveBridge} from './desktop-archive.mjs';
import {desktopBridgeRequest} from './bridge-transport.mjs';
import {createDesktopRelay} from './desktop-proxy.mjs';
import {createKanbanServer} from './serve.mjs';
import {installDesktopBridge,launchDesktopBridge} from './setup-desktop-bridge.mjs';

const id='11111111-1111-4111-8111-111111111111',contextId='22222222-2222-4222-8222-222222222222';
const params={threadId:id,hostId:'local',archived:true};
function fixture({ephemeral=false,confirmed=true}={}){
  let archived=false,reads=0,closed=0;const calls=[];
  const options={call:async(tool,args)=>{calls.push({tool,args});if(confirmed)archived=args.archived;return {};},openReader:async()=>{
    reads++;return {close(){closed++;},async request(method,p){
      if(method==='thread/read')return {thread:{id,ephemeral,parentThreadId:null,cwd:'/fixture'}};
      if(method==='thread/list')return {data:archived===p.archived?[{id}]:[]};
      throw Error('A read-only connection cannot archive');
    }};
  }};
  return {options,calls,get archived(){return archived;},get reads(){return reads;},get closed(){return closed;}};
}
test('Desktop owns both mutations; readback verifies the exact local ID without opening a writer',async()=>{
  const f=fixture(),service=createDesktopArchive(f.options);
  assert.deepEqual(await service.change(params),{archived:true,threadId:id});
  assert.deepEqual(await service.change({...params,archived:false}),{restored:true,threadId:id});
  await service.change({...params,archived:false});
  assert.deepEqual(f.calls,[{tool:'set_thread_archived',args:{threadId:id,hostId:'local',source:'codex',archived:true}},
    {tool:'set_thread_archived',args:{threadId:id,hostId:'local',source:'codex',archived:false}}]);
  assert.equal(f.closed,3);
});
test('unconfirmed Desktop writes never claim success; invalid and protected tasks never reach Desktop',async()=>{
  const f=fixture({confirmed:false});await assert.rejects(createDesktopArchive(f.options).change(params),/confirmation/);assert.equal(f.closed,1);
  const protectedTask=fixture({ephemeral:true});await assert.rejects(createDesktopArchive(protectedTask.options).change(params));assert.equal(protectedTask.calls.length,0);
  const invalid=fixture(),service=createDesktopArchive(invalid.options);
  for(const p of [{...params,hostId:'durable'},{...params,threadId:'bad'},{...params,archived:'true'}])await assert.rejects(service.change(p));
  assert.equal(invalid.reads,0);
});
test('cancellation and duplicate requests cannot trigger additional archive calls',async()=>{
  const f=fixture(),abort=new AbortController();abort.abort();
  await assert.rejects(createDesktopArchive(f.options).change(params,{signal:abort.signal}));assert.equal(f.reads,0);
  let resolve,began;const started=new Promise(r=>began=r);const service=createDesktopArchive({...f.options,
    call:async(...args)=>{began();await new Promise(r=>resolve=r);return f.options.call(...args);}});
  const first=service.change(params);await started;
  await assert.rejects(service.change(params),/in progress/);resolve();await first;assert.equal(f.calls.length,1);
});
test('private bridge rejects arbitrary RPC and model execution while keeping verified task actions',async()=>{
  const root=await mkdtemp(join(tmpdir(),'kb-')),socketPath=join(root,'d.sock'),f=fixture();
  const stop=await startDesktopArchiveBridge({socketPath,...f.options});
  try{
    assert.equal((await lstat(socketPath)).mode&0o777,0o600);
    assert.equal((await desktopBridgeRequest(socketPath,'status')).connected,true);
    for(const method of ['moveTask','turn/start','tool/call'])await assert.rejects(desktopBridgeRequest(socketPath,method,params),/only supports/);
    await desktopBridgeRequest(socketPath,'archive',params);assert(f.archived);
    await desktopBridgeRequest(socketPath,'archive',{...params,archived:false});assert(!f.archived);
    await assert.rejects(startDesktopArchiveBridge({socketPath,...f.options}));
  }finally{await stop();await rm(root,{recursive:true,force:true});}
});
test('unsafe socket directories and symlinks are rejected before connecting',async()=>{
  const root=await mkdtemp(join(tmpdir(),'kb-')),socketPath=join(root,'d.sock'),f=fixture();
  try{
    await chmod(root,0o755);await assert.rejects(startDesktopArchiveBridge({socketPath,...f.options}),/private/);
    await chmod(root,0o700);await symlink('/tmp/not-a-socket',socketPath);await assert.rejects(desktopBridgeRequest(socketPath,'status'),/not connected/);
  }finally{await rm(root,{recursive:true,force:true});}
});
test('HTTP Archive and token-scoped Undo travel through Desktop; failures keep the token retryable',async()=>{
  const root=await mkdtemp(join(tmpdir(),'kb-')),socketPath=join(root,'d.sock'),f=fixture();let failRestore=false;
  const stop=await startDesktopArchiveBridge({socketPath,...f.options,call:async(tool,args)=>{
    if(!args.archived&&failRestore)throw Error('Disconnected');return f.options.call(tool,args);
  }});
  const port=8891,task={id,hostId:'local',title:'Desktop fixture'};
  const server=createKanbanServer({port,desktopBridgeSocket:socketPath,getBoard:async()=>({tasks:f.archived?[]:[task],sync:{connected:true}}),
    archiveTask:async()=>{throw Error('Independent archive must not run');},restoreTask:async()=>{throw Error('Independent restore must not run');}});
  await new Promise(r=>server.listen(port,'127.0.0.1',r));
  try{
    const base='http://127.0.0.1:'+port,get=await(await fetch(base+'/api/board')).json();
    assert.equal(get.board.sync.archiveTransport,'desktop');assert.equal(get.board.sync.desktopArchiveConnected,true);
    const post=(path,body)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json','X-Kanban-Token':get.csrf},body:JSON.stringify(body)});
    const archived=await(await post('/api/archive',params)).json();assert.equal(archived.archived,true);assert.equal(archived.board.tasks.length,0);
    assert.equal((await post('/api/unarchive',{undoToken:'wrong'})).status,409);
    failRestore=true;assert.equal((await post('/api/unarchive',{undoToken:archived.undoToken})).status,503);
    failRestore=false;const restored=await(await post('/api/unarchive',{undoToken:archived.undoToken,threadId:contextId})).json();
    assert.equal(restored.threadId,id);assert.equal(restored.board.tasks.length,1);
    assert.equal((await post('/api/unarchive',{undoToken:archived.undoToken})).status,409);
  }finally{await new Promise(r=>server.close(r));await stop();await rm(root,{recursive:true,force:true});}
});
test('relay restricts added tools in the existing context and preserves Desktop messages',async()=>{
  const server=[],desktop=[],relay=createDesktopRelay({toServer:m=>server.push(m),toDesktop:m=>desktop.push(m)});
  relay.fromDesktop({id:17,method:'initialize',params:{}});relay.fromServer({id:17,result:{}});assert(relay.ready);
  const promise=relay.call('set_thread_archived',{threadId:id,hostId:'local',archived:true},contextId),request=server.at(-1);
  assert.equal(request.params.threadId,contextId);assert.equal(request.params.arguments.threadId,id);assert.equal(request.method,'mcpServer/tool/call');
  relay.fromServer({id:request.id,result:{content:[{type:'text',text:'{}'}]}});await promise;
  for(const tool of ['turn/start','send_message_to_thread','move_project_to_sidebar_section'])await assert.rejects(relay.call(tool,{},contextId));
  assert.deepEqual(desktop,[{id:17,result:{}}]);relay.close();
});
test('relay tracks only a successful Desktop-loaded context and does not change the archive target',async()=>{
  const relay=createDesktopRelay({toServer(){},toDesktop(){}});
  relay.fromDesktop({id:1,method:'thread/resume',params:{threadId:contextId}});
  relay.fromServer({id:1,result:{thread:{id:contextId}}});assert.equal(relay.contextThreadId,contextId);
  relay.fromDesktop({id:2,method:'thread/resume',params:{threadId:id}});
  relay.fromServer({id:2,error:{code:1}});assert.equal(relay.contextThreadId,contextId);relay.close();
});
test('installer preserves the selected CLI chain and refuses to stop a running Codex',async()=>{
  const root=await mkdtemp(join(tmpdir(),'kb-')),runtimeRoot=await mkdtemp(join(tmpdir(),'kb-r-')),app=join(runtimeRoot,'ChatGPT.app');
  const chainedCli=join(runtimeRoot,'existing-cli'),nodePath=join(runtimeRoot,'node');
  await mkdir(app);for(const p of [chainedCli,nodePath])await writeFile(p,'#!/bin/sh\nexit 0\n',{mode:0o700});
  try{
    const config=await installDesktopBridge({root,app,chainedCli,nodePath});
    assert((await readFile(config.proxy,'utf8')).includes(chainedCli));assert.equal((await lstat(config.proxy)).mode&0o777,0o700);
    const installed=await import(join(root,'runtime','desktop-archive.mjs'));
    assert.equal(typeof installed.startDesktopArchiveBridge,'function');
    for(const file of ['desktop-groups.mjs','desktop-runtime.mjs','desktop-creation.mjs','creation-store.mjs','creation-options.mjs','build.mjs','local-board.mjs','rename.mjs'])
      assert.equal((await readFile(join(root,'runtime',file),'utf8')),await readFile(new URL('./'+file,import.meta.url),'utf8'));
    const calls=[];const run=(bin,args)=>{calls.push({bin,args});return bin==='/bin/ps'?join(app,'Contents/MacOS/ChatGPT'):'';};
    assert.equal((await launchDesktopBridge(root,{run})).phase,'restart-required');assert.equal(calls.length,1);
    const launches=[];assert.equal((await launchDesktopBridge(root,{run:(bin,args)=>{launches.push({bin,args});return '';}})).phase,'launching');
    assert(launches[1].args.includes('CODEX_CLI_PATH='+config.proxy));
  }finally{await rm(root,{recursive:true,force:true});await rm(runtimeRoot,{recursive:true,force:true});}
});
test('proxy starts without a configured task ID and waits for Desktop to load a context',async t=>{
  const root=await mkdtemp(join(tmpdir(),'kb-p-')),driver=join(root,'app-server'),socketPath=join(root,'desktop.sock');
  await writeFile(driver,`#!${process.execPath}
import readline from 'node:readline';
for await (const line of readline.createInterface({input:process.stdin})){
  const request=JSON.parse(line);
  console.log(JSON.stringify({id:request.id,result:request.method==='thread/resume'?{thread:{id:request.params.threadId}}:{}}));
}
`,{mode:0o700});
  const env={...process.env,KANBAN_REAL_CODEX:driver,KANBAN_BRIDGE_SOCKET:socketPath};delete env.KANBAN_CONTEXT_THREAD;
  const child=spawn(process.execPath,[fileURLToPath(new URL('./desktop-proxy.mjs',import.meta.url)),'app-server'],{env,stdio:['pipe','pipe','pipe']});
  const lines=[];let output='',diagnostic='';
  child.stdout.on('data',data=>{output+=data;let end;while((end=output.indexOf('\n'))>=0){lines.push(JSON.parse(output.slice(0,end)));output=output.slice(end+1);}});
  child.stderr.on('data',data=>diagnostic+=data);
  t.after(async()=>{if(child.exitCode===null){const ended=once(child,'exit');child.stdin.end();child.kill();await ended;}await rm(root,{recursive:true,force:true});});
  // Full-suite parallelism can delay the child process beyond two seconds.
  // Keep a bounded startup budget and still fail immediately if it exits.
  async function until(check){const deadline=Date.now()+10000;while(Date.now()<deadline){if(await check())return;assert.equal(child.exitCode,null,diagnostic);await new Promise(r=>setTimeout(r,20));}assert.fail('Proxy condition timed out: '+diagnostic);}
  await until(async()=>!!(await lstat(socketPath).catch(()=>null)));
  child.stdin.write(JSON.stringify({id:1,method:'initialize',params:{}})+'\n');await until(()=>lines.some(m=>m.id===1));
  assert.equal((await desktopBridgeRequest(socketPath,'status')).connected,false);
  child.stdin.write(JSON.stringify({id:2,method:'thread/resume',params:{threadId:contextId}})+'\n');await until(()=>lines.some(m=>m.id===2));
  assert.equal((await desktopBridgeRequest(socketPath,'status')).connected,true);
});
