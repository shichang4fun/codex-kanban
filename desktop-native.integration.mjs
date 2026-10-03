// Opt-in protocol lab: real bundled App Server, disposable CODEX_HOME, and a
// simulated Desktop MCP dispatcher. This does NOT certify the live Desktop UI.
import {spawn,execFileSync} from 'node:child_process';
import {mkdtemp,rm,appendFile,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {createDesktopRelay} from './desktop-proxy.mjs';
import {startDesktopArchiveBridge} from './desktop-archive.mjs';
import {openLocalReader,openLocalProjectEditor} from './local-read.mjs';
import {archiveLocalTask} from './archive.mjs';
import {setLocalProject} from './project.mjs';
import {createKanbanServer} from './serve.mjs';
import {createLocalBoard} from './local-board.mjs';

const fixtureHome=await realpath(await mkdtemp(join(tmpdir(),'kb-native-'))),previousHome=process.env.CODEX_HOME;
process.env.CODEX_HOME=fixtureHome;
const cli='/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex';
const child=spawn(cli,['--disable','hooks','app-server','--listen','stdio://'],{env:process.env,stdio:['pipe','pipe','pipe']});
child.stderr.on('data',()=>{});child.stdout.setEncoding('utf8');
let sequence=0,buffer='',desktopSequence=0,stop,server;const pending=new Map(),desktopPending=new Map();
child.stdout.on('data',chunk=>{buffer+=chunk;let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);let m;try{m=JSON.parse(line);}catch{continue;}
  const p=pending.get(m.id);if(!p)continue;pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);
}});
const nativeRpc=(method,params)=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error('Native RPC timeout: '+method));},15000);
  pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({id,method,params})+'\n');});
const relay=createDesktopRelay({toDesktop:message=>{const p=desktopPending.get(message.id);if(p){desktopPending.delete(message.id);message.error?p.reject(Error('Desktop fixture failed')):p.resolve(message.result);}},
  toServer:message=>{
    const isTool=message.method==='mcpServer/tool/call';
    const dispatch=async()=>{
      if(!isTool)return nativeRpc(message.method,message.params);
      const {tool,arguments:args}=message.params;
      if(tool==='set_thread_archived')return nativeRpc(args.archived?'thread/archive':'thread/unarchive',{threadId:args.threadId});
      const {data:groups}=await nativeRpc('threadSection/list',{limit:100});
      const desktopId=s=>s.name==='Pinned'?'pinned':'desktop:'+s.id;
      if(tool==='list_threads')return {sections:groups.map(s=>({sectionId:desktopId(s),name:s.name}))};
      assert.equal(tool,'move_thread_to_sidebar_section');assert.equal(args.hostId,'local');assert.equal(args.source,'codex');
      const destination=args.sectionId===null?null:groups.find(s=>desktopId(s)===args.sectionId);
      assert(args.sectionId===null||destination);
      return nativeRpc('thread/section/move',{threadId:args.threadId,sectionId:destination?.id??null});
    };
    dispatch().then(result=>relay.fromServer({id:message.id,result:isTool?{content:[{type:'text',text:JSON.stringify(result)}]}:result}),
      ()=>relay.fromServer({id:message.id,error:{code:-32603}}));
  }});
const desktopRpc=(method,params)=>new Promise((resolve,reject)=>{const id='desktop-'+(++desktopSequence);desktopPending.set(id,{resolve,reject});relay.fromDesktop({id,method,params});});
try{
  await desktopRpc('initialize',{clientInfo:{name:'kanban_isolated_desktop_archive_lab',version:'1'},capabilities:{experimentalApi:true}});
  const {project}=await desktopRpc('project/create',{idempotencyKey:randomUUID(),name:'Disposable Kanban project',roots:[{path:fixtureHome}]});
  const secondRoot=await realpath(await mkdtemp(join(fixtureHome,'project-b-')));
  const {project:secondProject}=await desktopRpc('project/create',{idempotencyKey:randomUUID(),name:'Disposable second Kanban project',roots:[{path:secondRoot}]});
  assert.notEqual(project.id,secondProject.id);
  const {thread}=await desktopRpc('thread/start',{cwd:fixtureHome,ephemeral:false,projectId:project.id});
  assert.equal(thread.projectId,project.id);
  assert(/^[0-9a-f-]{36}$/.test(thread.id));
  await desktopRpc('thread/inject_items',{threadId:thread.id,items:[{type:'message',role:'user',content:[{type:'input_text',text:'Disposable offline bridge test. No model turn.'}]}]});
  await desktopRpc('thread/name/set',{threadId:thread.id,name:'Disposable desktop archive bridge test'});
  // Only the isolated lab's log and DB are seeded so an offline blank thread
  // appears in listings. Real task storage is never edited by this test.
  assert(thread.path.startsWith(fixtureHome));
  await appendFile(thread.path,JSON.stringify({timestamp:new Date().toISOString(),type:'event_msg',payload:{type:'user_message',message:'Disposable bridge fixture',images:[],local_images:[],text_elements:[]}})+'\n');
  await desktopRpc('thread/list',{archived:false,useStateDbOnly:false,limit:100});
  execFileSync('/usr/bin/sqlite3',[join(fixtureHome,'state_5.sqlite'),"UPDATE threads SET preview='Disposable bridge fixture', first_user_message='Disposable bridge fixture', has_user_event=1 WHERE id='"+thread.id+"'"]);
  const params={threadId:thread.id,hostId:'local'},task={id:thread.id,hostId:'local',title:'Disposable bridge fixture'};
  let desktopSnapshot={threads:[],pinnedThreads:[],sections:[]};
  const getBoard=async()=>{const reader=await openLocalReader();try{
    return await createLocalBoard(reader,desktopSnapshot).getBoard();
  }finally{reader.close();}};
  assert.equal((await getBoard()).tasks.length,1);
  await assert.rejects(archiveLocalTask(params,{tasks:[task]}),error=>error.status===409);
  const socketPath=join(fixtureHome,'desktop.sock');
  stop=await startDesktopArchiveBridge({socketPath,ready:()=>relay.ready,call:(tool,args)=>relay.call(tool,args,relay.contextThreadId),
    request:(method,params)=>relay.request(method,params)});
  const projectWrites=[];
  server=createKanbanServer({port:0,getBoard,desktopBridgeSocket:socketPath,setProject:(params,board,{signal})=>setLocalProject(params,board,{signal,open:async()=>{
    const client=await openLocalProjectEditor();
    return {...client,request(method,params){
      assert(['project/list','thread/read','thread/metadata/update'].includes(method));
      if(method==='thread/metadata/update')projectWrites.push(structuredClone(params));
      return client.request(method,params);
    }};
  }})});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const port=server.address().port;
  const base='http://127.0.0.1:'+port,get=await(await fetch(base+'/api/board')).json();assert.equal(get.board.sync.archiveTransport,'desktop');assert.equal(get.board.sync.moveTransport,'desktop');
  assert.equal(get.board.sync.runtimeLive,true);assert.equal(get.board.tasks[0].runtimeStatusSource,'desktopRuntime');
  assert.equal(get.board.tasks[0].rawStatus.type,'idle');
  const post=(path,body)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json','X-Kanban-Token':get.csrf},body:JSON.stringify(body)});
  const existingSections=(await desktopRpc('threadSection/list',{limit:100})).data;
  const flow={};for(const name of ['For Later','In Progress','For Review','Pinned']){
    const matches=existingSections.filter(s=>s.name===name);assert(matches.length<=1);
    flow[name]=matches[0]?.id??(await desktopRpc('threadSection/create',{name})).section.id;
  }
  // Exercise the actual project endpoint with the App Server's initial project
  // assignment. Keep a non-default section throughout to catch side effects.
  await desktopRpc('thread/section/move',{threadId:thread.id,sectionId:flow['For Review']});
  const beforeProject=(await nativeRpc('thread/read',{threadId:thread.id,includeTurns:true})).thread;
  let expectedProjectId=beforeProject.projectId;
  assert.equal(expectedProjectId,project.id);
  for(const projectId of [null,project.id,secondProject.id,null,project.id]){
    const writesBefore=projectWrites.length,response=await post('/api/project',{...params,projectId,expectedProjectId}),changed=await response.json();
    assert.equal(response.status,200,JSON.stringify(changed));assert.equal(changed.projectId,projectId);assert.equal(changed.changed,true);
    assert.equal(projectWrites.length,writesBefore+1);
    assert.deepEqual(projectWrites.at(-1),{threadId:thread.id,projectId:projectId??''});
    const after=(await nativeRpc('thread/read',{threadId:thread.id,includeTurns:true})).thread;
    assert.equal(after.projectId,projectId);assert.equal(after.cwd,beforeProject.cwd);assert.deepEqual(after.section,beforeProject.section);
    assert.deepEqual(after.status,beforeProject.status);assert.deepEqual(after.turns,beforeProject.turns);
    assert.equal(changed.board.tasks[0].localProjectId,projectId);assert.equal(changed.board.tasks[0].projectId,projectId);
    const polled=(await(await fetch(base+'/api/board')).json()).board.tasks[0];
    assert.equal(polled.localProjectId,projectId);assert.equal(polled.projectId,projectId);
    assert.equal(polled.localSectionId,flow['For Review']);expectedProjectId=projectId;
  }
  const same=await post('/api/project',{...params,projectId:project.id,expectedProjectId:project.id});
  assert.equal(same.status,200);assert.equal((await same.json()).changed,false);assert.equal(projectWrites.length,5);
  await desktopRpc('thread/section/move',{threadId:thread.id,sectionId:null});
  // Native group writes do not require taking over the active thread writer.
  let expectedSectionId=null;
  for(const name of ['For Later','In Progress','For Review']){
    const sectionId=flow[name],response=await post('/api/move',{...params,sectionId,expectedSectionId});
    const moved=await response.json();assert.equal(response.status,200,JSON.stringify(moved));assert.equal(moved.board.tasks[0].localSectionId,sectionId);expectedSectionId=sectionId;
  }
  for(const sectionId of [flow.Pinned,flow['For Review'],flow.Pinned,null]){
    const response=await post('/api/move',{...params,sectionId,expectedSectionId}),moved=await response.json();
    assert.equal(response.status,200,JSON.stringify(moved));assert.equal(moved.board.tasks[0].localSectionId,sectionId);
    assert.equal(moved.board.tasks[0].pinned,sectionId===flow.Pinned);expectedSectionId=sectionId;
  }
  const pinResponse=await post('/api/pin',{...params,pinned:true}),pinned=await pinResponse.json();
  assert.equal(pinResponse.status,200,JSON.stringify(pinned));assert.equal(pinned.sectionId,flow.Pinned);
  const unpinResponse=await post('/api/pin',{...params,pinned:false}),unpinned=await unpinResponse.json();
  assert.equal(unpinResponse.status,200,JSON.stringify(unpinned));assert.equal(unpinned.sectionId,null);
  // Desktop project placement is a fixture; task section writes and their
  // readbacks use the real App Server in this disposable home.
  desktopSnapshot={threads:[{id:thread.id,kind:'codex',hostId:'local',projectId:project.id,title:task.title}],pinnedThreads:[],
    projects:[{projectId:project.id,hostId:'local',label:'Lab project'}],
    sections:[{sectionId:'pinned',name:'Pinned',itemKeys:['codex:project:'+project.id]}]};
  const originalSnapshot=structuredClone(desktopSnapshot);
  const inherited=(await getBoard()).tasks[0];
  assert.equal(inherited.placementSource,'desktopProject');assert.equal(inherited.localSectionId,null);assert.equal(inherited.nativeSectionId,flow.Pinned);
  const reviewResponse=await post('/api/move',{...params,sectionId:flow['For Review'],expectedSectionId:null}),review=await reviewResponse.json();
  assert.equal(reviewResponse.status,200,JSON.stringify(review));assert.equal(review.board.tasks[0].localSectionId,flow['For Review']);
  assert.equal(review.board.tasks[0].projectId,project.id);assert.equal(review.board.tasks[0].projectName,project.name);
  const clearedResponse=await post('/api/move',{...params,sectionId:null,expectedSectionId:flow['For Review']}),cleared=await clearedResponse.json();
  assert.equal(clearedResponse.status,200,JSON.stringify(cleared));assert.equal(cleared.board.tasks[0].localSectionId,null);
  assert.equal(cleared.board.tasks[0].nativeSectionId,flow.Pinned);assert.equal(cleared.board.tasks[0].nativeTaskPinned,false);
  assert.deepEqual(desktopSnapshot,originalSnapshot);
  assert.equal((await nativeRpc('thread/read',{threadId:thread.id,includeTurns:false})).thread.projectId,project.id);
  desktopSnapshot={threads:[],pinnedThreads:[],sections:[]};
  // Simulate a later native auto-classification, then confirm polling follows
  // it without replaying the earlier manual move.
  await desktopRpc('thread/section/move',{threadId:thread.id,sectionId:flow['For Later']});
  assert.equal((await(await fetch(base+'/api/board')).json()).board.tasks[0].localSectionId,flow['For Later']);
  const archived=await(await post('/api/archive',params)).json();assert.equal(archived.archived,true);assert.equal(archived.board.tasks.length,0);
  const restored=await(await post('/api/unarchive',{undoToken:archived.undoToken})).json();assert.equal(restored.restored,true);assert.equal(restored.board.tasks[0].id,thread.id);
  assert.equal(projectWrites.length,5);
  console.log(JSON.stringify({isolated:true,realAppServer:true,simulatedDesktopMcp:true,simulatedProjectSnapshot:true,realNativeProjectPreserved:true,realNativeProjectSetChangeClearVerified:true,projectMetadataWrites:projectWrites.length,projectCwdSectionRuntimePreserved:true,occupiedWriterReproduced:true,desktopGroupTransportVerified:true,desktopRuntimeReadVerified:true,nativeGroupMovesVerified:true,desktopPinUnpinVerified:true,projectInheritedTaskMoveVerified:true,clearedTaskRestoresProjectPlacement:true,detailPinnedAndTasksMovesVerified:true,laterNativeMoveFollowed:true,bridgeArchiveVerified:true,bridgeUndoVerified:true,modelTurnsStarted:0}));
}finally{
  if(server)await new Promise(r=>server.close(r));if(stop)await stop();relay.close();
  for(const p of pending.values())clearTimeout(p.timer);
  if(child.exitCode===null&&child.signalCode===null){const exited=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await exited;}
  if(previousHome===undefined)delete process.env.CODEX_HOME;else process.env.CODEX_HOME=previousHome;
  await rm(fixtureHome,{recursive:true,force:true});
}
