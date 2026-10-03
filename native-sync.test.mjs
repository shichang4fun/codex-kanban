import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeSync,nativeMemberKey,sectionFor} from './native-sync.mjs';
import {normalize} from './build.mjs';
import {createDesktopRelay} from './desktop-proxy.mjs';
const id='11111111-1111-4111-8111-111111111111';
function fixture(){
  const task={id,hostId:'local',kind:'codex',projectId:'project-a',status:'active',title:'Test task'};
  const snapshot={threads:[task,{...task,hostId:'durable'}],pinnedThreads:[],unavailableHosts:[],unavailableSources:[],sections:[
    {sectionId:'later',name:'For Later',itemKeys:[nativeMemberKey(task),'codex:project:project-a','codex:thread:local:client-new-thread:'+id]},
    {sectionId:'progress',name:'In Progress',itemKeys:[]},{sectionId:'review',name:'For Review',itemKeys:[nativeMemberKey({...task,hostId:'durable'})]},
    {sectionId:'pinned',name:'Pinned',itemKeys:[]}
  ]};
  const calls=[];let writable=true,writeFailure=false,readbackFailure=false,onDetail=()=>{};
  const controller=createNativeSync({canWrite:async()=>writable,call:async(method,args)=>{
    calls.push({method,args});
    if(method==='list_threads')return structuredClone(snapshot);
    if(method==='read_thread'){onDetail();return {thread:structuredClone(task)};}
    if(method==='move_thread_to_sidebar_section'){
      if(writeFailure)throw Error('transport disconnected');
      if(!readbackFailure){for(const s of snapshot.sections)s.itemKeys=s.itemKeys.filter(k=>k!==nativeMemberKey(task));snapshot.sections.find(s=>s.sectionId===args.sectionId).itemKeys.push(nativeMemberKey(task));}
      return {threadId:id,hostId:'local',sectionId:args.sectionId};
    }
    throw Error('Unexpected method');
  }});
  return {controller,task,snapshot,calls,params:{threadId:id,hostId:'local',sectionId:'progress',expectedSectionId:'later'},
    policyOff:()=>writable=false,failWrite:()=>writeFailure=true,failReadback:()=>readbackFailure=true,onDetail:callback=>onDetail=callback};
}
test('host identity, project keys and temporary task keys cannot mix memberships',()=>{
  const f=fixture(),board=normalize(f.snapshot);
  assert.equal(board.tasks.find(t=>t.hostId==='local').nativeSectionId,'later');
  assert.equal(board.tasks.find(t=>t.hostId==='durable').nativeSectionId,'review');
});
test('project children inherit the project section only when no explicit task membership exists',()=>{
  const f=fixture();f.snapshot.threads.push({id:'22222222-2222-4222-8222-222222222222',kind:'codex',hostId:'local',projectId:'project-a'});
  const board=normalize(f.snapshot),child=board.tasks.find(t=>t.id.startsWith('2222'));
  assert.equal(child.nativeSectionId,'later');assert.equal(child.nativeMembershipSource,'project');
  assert.equal(board.tasks.find(t=>t.id===id&&t.hostId==='durable').nativeSectionId,'review');
});
test('verified display aliases preserve runtime hosts and never match a different host with the same ID',()=>{
  const f=fixture();f.snapshot.sections[2].itemKeys=[];
  let cloud=normalize(f.snapshot).tasks.find(t=>t.hostId==='durable');
  assert.notEqual(cloud.nativeMembershipSource,'verifiedAlias');
  f.snapshot.sidebarAliases=[{threadId:id,hostId:'durable',memberKey:nativeMemberKey(f.task)}];
  cloud=normalize(f.snapshot).tasks.find(t=>t.hostId==='durable');
  assert.equal(cloud.hostId,'durable');assert.equal(cloud.nativeSectionId,'later');assert.equal(cloud.nativeMembershipSource,'verifiedAlias');
});
test('explicit pinning retains the native Pinned group without inventing an unknown runtime host',()=>{
  const f=fixture();f.snapshot.pinnedThreads.push({id:'22222222-2222-4222-8222-222222222222',kind:'codex',hostId:null,pinnedIndex:1});
  const pinned=normalize(f.snapshot).tasks.find(t=>t.pinned);
  assert.equal(pinned.nativeSectionId,'pinned');assert.equal(pinned.hostId,'unknown');assert.equal(pinned.nativeMembershipSource,'pinned');
});
test('unreadable sidebar members are reported separately and unmatched tasks never become For Later',()=>{
  const f=fixture();
  f.snapshot.threads.push({id:'22222222-2222-4222-8222-222222222222',hostId:'local',kind:'codex',status:'idle',title:'Unassigned'});
  f.snapshot.threads.push({id:'33333333-3333-4333-8333-333333333333',hostId:'local',kind:'codex',sidebarOnly:true,status:'unknown'});
  f.snapshot.sections[2].itemKeys.push('codex:thread:local:33333333-3333-4333-8333-333333333333');
  const board=normalize(f.snapshot);
  assert.equal(board.tasks.find(t=>t.title==='Unassigned').nativeSectionId,null);
  assert.equal(board.tasks.length,3);
  assert.equal(board.sidebarUnresolved.length,1);
  assert.equal(board.sidebarUnresolved[0].nativeSectionId,'review');
});
test('native move is freshly read, written once and read back without modifying runtime or project',async()=>{
  const f=fixture();const result=await f.controller.moveTask(f.params);
  assert.equal(result.board.tasks.find(t=>t.hostId==='local').nativeSectionId,'progress');
  assert.equal(f.task.status,'active');assert.equal(f.task.projectId,'project-a');
  assert.equal(f.calls.filter(c=>c.method==='move_thread_to_sidebar_section').length,1);
  assert.deepEqual(f.calls.map(c=>c.method),['list_threads','read_thread','list_threads','move_thread_to_sidebar_section','list_threads']);
});
test('native sidebar edits appear on the next read without write-back loops',async()=>{
  const f=fixture();await f.controller.getBoard();f.snapshot.sections[0].itemKeys=f.snapshot.sections[0].itemKeys.filter(k=>k!==nativeMemberKey(f.task));
  f.snapshot.sections[2].itemKeys.push(nativeMemberKey(f.task));
  assert.equal((await f.controller.getBoard()).tasks.find(t=>t.hostId==='local').nativeSectionId,'review');
  assert(!f.calls.some(c=>c.method==='move_thread_to_sidebar_section'));
});
test('remote writes and automatic policy conflicts fail closed',async()=>{
  const f=fixture();await assert.rejects(f.controller.moveTask({...f.params,hostId:'durable'}),{code:'HOST_UNSUPPORTED'});
  f.policyOff();await assert.rejects(f.controller.moveTask(f.params),{code:'POLICY_CONFLICT'});
  assert(!f.calls.some(c=>c.method==='move_thread_to_sidebar_section'));
});
test('a stale source or a sidebar change immediately before write cannot move a task',async()=>{
  const f=fixture();await assert.rejects(f.controller.moveTask({...f.params,expectedSectionId:'review'}),{code:'STALE_MOVE'});
  f.onDetail(()=>{f.snapshot.sections[0].itemKeys=f.snapshot.sections[0].itemKeys.filter(k=>k!==nativeMemberKey(f.task));f.snapshot.sections[2].itemKeys.push(nativeMemberKey(f.task));});
  await assert.rejects(f.controller.moveTask(f.params),{code:'STALE_MOVE'});
  assert(!f.calls.some(c=>c.method==='move_thread_to_sidebar_section'));
});
test('native write failures and readback conflicts never return success or retry writes',async()=>{
  const a=fixture();a.failWrite();await assert.rejects(a.controller.moveTask(a.params),{code:'WRITE_UNCONFIRMED'});
  assert.equal((await a.controller.getBoard()).tasks.find(t=>t.hostId==='local').nativeSectionId,'later');
  const b=fixture();b.failReadback();await assert.rejects(b.controller.moveTask(b.params),{code:'READBACK_MISMATCH'});
  assert.equal(b.calls.filter(c=>c.method==='move_thread_to_sidebar_section').length,1);
});
test('pinned and ambiguous membership are protected',async()=>{
  const a=fixture();a.snapshot.sections[0].itemKeys=[];a.snapshot.sections[3].itemKeys=[nativeMemberKey(a.task)];
  await assert.rejects(a.controller.moveTask({...a.params,expectedSectionId:'pinned'}),{code:'PROTECTED_TASK'});
  const b=fixture();b.snapshot.sections[2].itemKeys.push(nativeMemberKey(b.task));
  assert.throws(()=>sectionFor(b.snapshot,b.task),{code:'AMBIGUOUS_MEMBERSHIP'});
});
test('disconnected queued requests are cancelled before any native write',async()=>{
  const f=fixture(),abort=new AbortController();abort.abort();
  await assert.rejects(f.controller.moveTask(f.params,{signal:abort.signal}),{code:'MOVE_CANCELLED'});assert.equal(f.calls.length,0);
});
test('attached stdio relay preserves Desktop IDs, requires handshake, and allows no execution tools',async()=>{
  const server=[],desktop=[],relay=createDesktopRelay({toServer:m=>server.push(m),toDesktop:m=>desktop.push(m)});
  await assert.rejects(relay.call('list_threads',{},id),/handshake/);
  relay.fromDesktop({id:17,method:'initialize',params:{}});relay.fromServer({id:17,result:{}});
  assert.equal(desktop[0].id,17);await assert.rejects(relay.call('turn/start',{},id),/not allowed/);
  const promise=relay.call('list_threads',{limit:50},id),request=server.at(-1);
  relay.fromServer({id:request.id,result:{content:[{type:'text',text:'{"sections":[]}'}]}});
  assert.deepEqual(await promise,{sections:[]});assert.equal(desktop.length,1);relay.close();
});
