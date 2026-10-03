import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script,createContext} from 'node:vm';
import {moveLocalTask} from './move.mjs';
import {createKanbanServer} from './serve.mjs';

const id='11111111-1111-4111-8111-111111111111';
const task={id,hostId:'local',placementSource:'localThreadSection',localSectionId:'local-later',pinned:false};
const params={threadId:id,hostId:'local',sectionId:'local-progress',expectedSectionId:'local-later'};
const sections=[{id:'local-later',name:'For Later'},{id:'local-progress',name:'In Progress'},{id:'local-review',name:'For Review'},{id:'local-pin',name:'Pinned'}];
function fixture({section='local-later',ephemeral=false,parent=null,confirm=true,changeBeforeWrite=false}={}){
  let closed=false,reads=0;const calls=[];
  const thread={id,ephemeral,parentThreadId:parent,projectId:'original-project',status:'active',section:section?{id:section}:null};
  const client={close(){closed=true;},async request(method,p){
    calls.push({method,params:p});
    if(method==='threadSection/list')return p.cursor?{data:sections.slice(2)}:{data:sections.slice(0,2),nextCursor:'second'};
    if(method==='thread/read'){if(changeBeforeWrite&&++reads===2)thread.section={id:'local-review'};return {thread:structuredClone(thread)};}
    if(method==='thread/section/move'){if(confirm)thread.section=p.sectionId===null?null:{id:p.sectionId};return {};}
    throw Error('Unexpected RPC');
  }};
  return {calls,thread,open:async()=>client,get closed(){return closed;}};
}
test('explicit move uses the local ID, verifies membership, and preserves runtime and project',async()=>{
  const f=fixture();assert.deepEqual(await moveLocalTask(params,{tasks:[task]},f),{threadId:id,sectionId:'local-progress',changed:true});
  assert.deepEqual(f.calls.filter(c=>c.method==='thread/section/move'),[{method:'thread/section/move',params:{threadId:id,sectionId:'local-progress'}}]);
  assert.equal(f.thread.status,'active');assert.equal(f.thread.projectId,'original-project');assert(f.closed);
  // A later automatic classification is retained, without a corrective write.
  f.thread.section={id:'local-review'};assert.equal(f.calls.filter(c=>c.method==='thread/section/move').length,1);
});
test('Tasks default membership uses null instead of the synthetic display group ID',async()=>{
  const f=fixture({section:null});assert.equal((await moveLocalTask({...params,expectedSectionId:null},{tasks:[{...task,placementSource:'localDefault',localSectionId:null}]},f)).changed,true);
  const stale=fixture({section:null});await assert.rejects(moveLocalTask({...params,expectedSectionId:'chats'},{tasks:[task]},stale),/changed groups/);
  assert(!stale.calls.some(c=>c.method==='thread/section/move'));
});
test('remote, project-inherited, missing and malformed sources never open a writer',async()=>{
  let opens=0;const open=async()=>{opens++;throw Error('Must not open');};
  for(const p of [{...params,hostId:'durable'},{...params,threadId:'bad'},{...params,expectedSectionId:undefined},{...params,sectionId:undefined},null])await assert.rejects(moveLocalTask(p,{tasks:[task]},{open}));
  for(const tasks of [[],[{...task,sidebarOnly:true}],[{...task,placementSource:'desktopProject',pinned:true}]])await assert.rejects(moveLocalTask(params,{tasks},{open}));
  assert.equal(opens,0);
});
test('only supported real destinations are accepted; protected native tasks and stale sources do not move',async()=>{
  for(const options of [{ephemeral:true},{parent:'parent'},{section:'local-pin'},{changeBeforeWrite:true},{section:'local-review'}]){
    const f=fixture(options);await assert.rejects(moveLocalTask(params,{tasks:[task]},f));assert(f.closed);assert(!f.calls.some(c=>c.method==='thread/section/move'));
  }
  for(const sectionId of ['chats','desktop-logical-id']){
    const f=fixture();await assert.rejects(moveLocalTask({...params,sectionId},{tasks:[task]},f));assert(!f.calls.some(c=>c.method==='thread/section/move'));
  }
});
test('detail group edits can leave Pinned, pin a task, or clear its own group to Tasks',async()=>{
  for(const [source,destination] of [['local-pin','local-review'],['local-later','local-pin'],['local-pin',null],[null,null]]){
    const f=fixture({section:source});const current={...task,pinned:source==='local-pin',localSectionId:source};
    const result=await moveLocalTask({...params,sectionId:destination,expectedSectionId:source},{tasks:[current]},f);
    assert.equal(result.changed,source!==destination);assert.equal(f.thread.section?.id??null,destination);
    assert.equal(f.calls.filter(c=>c.method==='thread/section/move').length,source===destination?0:1);
    assert.equal(f.thread.projectId,'original-project');assert.equal(f.thread.status,'active');assert(f.closed);
  }
  const stale=fixture({section:'local-review'});
  await assert.rejects(moveLocalTask({...params,expectedSectionId:'local-pin'},{tasks:[{...task,pinned:true}]},stale),/changed groups/);
  assert(!stale.calls.some(c=>c.method==='thread/section/move'));
});
test('unconfirmed or cancelled moves never repeat the write or claim success',async()=>{
  const f=fixture({confirm:false});await assert.rejects(moveLocalTask(params,{tasks:[task]},f),/changed again/);assert.equal(f.calls.filter(c=>c.method==='thread/section/move').length,1);
  const abort=new AbortController();abort.abort();const cancelled=fixture();await assert.rejects(moveLocalTask(params,{tasks:[task]},{...cancelled,signal:abort.signal}),/cancelled/);assert.equal(cancelled.calls.length,0);
  const same=fixture();assert.equal((await moveLocalTask({...params,sectionId:'local-later'},{tasks:[task]},same)).changed,false);assert(!same.calls.some(c=>c.method==='thread/section/move'));
});
test('HTTP moves share action serialization, CSRF protection and authoritative subsequent polling',async()=>{
  let finish,started,section='local-later',writes=0;const began=new Promise(r=>started=r);
  const getBoard=async()=>({tasks:[{...task,localSectionId:section,nativeSectionId:section}],sections:sections.map(s=>({sectionId:s.id,name:s.name})),sync:{connected:true,scope:'localSections'}});
  const server=createKanbanServer({port:8893,getBoard,moveTask:async p=>{writes++;started();await new Promise(r=>finish=r);section=p.sectionId;return {threadId:id,sectionId:section,changed:true};}});
  await new Promise(r=>server.listen(8893,'127.0.0.1',r));
  try{
    const url='http://127.0.0.1:8893',get=await(await fetch(url+'/api/board')).json();assert.equal(get.board.sync.writable,true);
    const post=(path,body,headers={})=>fetch(url+path,{method:'POST',headers:{'Content-Type':'application/json','X-Kanban-Token':get.csrf,...headers},body:JSON.stringify(body)});
    assert.equal((await post('/api/move',params,{'X-Kanban-Token':'bad'})).status,403);
    assert.equal((await post('/api/move',params,{Origin:'http://evil.test'})).status,403);assert.equal(writes,0);
    const move=post('/api/move',params);await began;
    assert.equal((await post('/api/move',params)).status,409);assert.equal((await post('/api/archive',{threadId:id,hostId:'local'})).status,409);
    const poll=fetch(url+'/api/board');finish();assert.equal((await(await move).json()).board.tasks[0].nativeSectionId,'local-progress');
    assert.equal((await(await poll).json()).board.tasks[0].nativeSectionId,'local-progress');
    section='local-review';assert.equal((await(await fetch(url+'/api/board')).json()).board.tasks[0].nativeSectionId,'local-review');assert.equal(writes,1);
  }finally{await new Promise(r=>server.close(r));}
});
const html=readFileSync(new URL('./ui.html',import.meta.url),'utf8');
function ui(fetch){
  const messages=[],context=createContext({nativeConnected:true,nativeWritable:true,nativeToken:'csrf',nativeEpoch:0,nativePending:false,
    taskActionPending:()=>context.nativePending,nativeCanEditGroup:t=>t.hostId==='local',render(){},renderArchiveNotices(){},
    applyNativeBoard:b=>context.board=b,announce:m=>messages.push(m),fetch,refreshNativeBoard:async()=>{assert.equal(context.nativePending,false);context.refreshed=true;}});
  const move=new Script(html.match(/async function moveNative\([\s\S]*?(?=function taskKey)/)[0]+'\nmoveNative').runInContext(context);
  return {move,context,messages};
}
test('browser sends the direct local source, waits for confirmation and refreshes after failures',async()=>{
  let sent,finish;const f=ui(async(url,request)=>{sent=JSON.parse(request.body);return await new Promise(r=>finish=r);});
  const promise=f.move({...task,localSectionId:null,nativeSectionId:'chats'},'local-review');assert(f.context.nativePending);
  assert.equal(sent.expectedSectionId,null);finish({ok:true,json:async()=>({board:{revision:1}})});assert.equal(await promise,true);assert.equal(f.context.board.revision,1);assert(!f.context.nativePending);
  const failed=ui(async()=>({ok:false,json:async()=>({error:'Group changed again'})}));assert.equal(await failed.move(task,'local-review'),false);assert(failed.context.refreshed);assert.equal(failed.messages.at(-1),'Group changed again');
});
function detailUi(){
  const elements=new Map();
  const element=()=>({children:[],dataset:{},value:'',textContent:'',hidden:false,disabled:false,
    replaceChildren(){this.children=[];},append(...nodes){this.children.push(...nodes);},closest(){return this;}});
  const $=key=>{if(!elements.has(key))elements.set(key,element());return elements.get(key);};
  const pinned={...task,title:'Detail fixture',nativeSectionId:'local-pin',localSectionId:'local-pin',pinned:true};
  const context=createContext({$,el:(tag,cls,text)=>({...element(),tag,textContent:text}),
    DATA:{tasks:[pinned],sections:[...sections.map(s=>({sectionId:s.id,name:s.name})),{sectionId:'chats',name:'Tasks'}]},selectedTask:pinned,
    nativeConnected:true,nativeWritable:true,nativeToken:'csrf',nativePending:false,nativeMessage:'Connected',
    taskActionPending:()=>context.nativePending,taskKey:t=>t.hostId+':'+t.id,
    updateRuntimeDetail(){},workflowStage:()=> 'todo',hostName:()=> 'Local',date:()=> 'Now'});
  new Script(html.match(/function nativeCanEditGroup\([\s\S]*?(?=function nativeNotice)/)[0]
    +html.match(/function updateDetailProperties\([\s\S]*?(?=function showDetail)/)[0]
    +html.match(/async function changeDetailGroup\([\s\S]*?(?=\$\('detail-native'\).onchange)/)[0]).runInContext(context);
  const group=()=>{const nodes=$('detail-meta').children;return nodes[nodes.findIndex(n=>n.tag==='dt'&&n.textContent==='Group')+1]?.textContent;};
  return {context,$,group,pinned};
}
test('detail editing includes Pinned and Ungrouped, allows pinned task dragging, and retains the selector across polling',()=>{
  const f=detailUi(),{context,$,pinned}=f;context.updateDetailProperties(pinned);
  assert.equal($('detail-native').disabled,false);assert.equal(context.nativeCanMove(pinned),true);
  assert.equal(f.group(),'Pinned');assert.equal($('native-edit').hidden,false);
  assert.deepEqual($('detail-native').children.map(o=>o.value),['local-later','local-progress','local-review','local-pin','chats']);
  assert($('detail-native').children.every(o=>!o.disabled));
  const options=$('detail-native').children;context.updateDetailProperties(pinned);assert.equal($('detail-native').children,options);
  context.nativePending=true;context.updateDetailProperties(pinned);assert($('detail-native').disabled);assert.equal(context.nativeCanMove(pinned),false);
  context.nativePending=false;context.nativeConnected=false;context.updateDetailProperties(pinned);assert($('detail-native').disabled);
  context.nativeConnected=true;const inherited={...pinned,placementSource:'desktopProject'};context.updateDetailProperties(inherited);assert($('detail-native').disabled);assert.equal(context.nativeCanMove(inherited),false);
});
test('detail saves refresh displayed properties and failed saves revert to authoritative membership',async()=>{
  const f=detailUi(),{context,$,pinned}=f;context.updateDetailProperties(pinned);
  let sent;context.moveNative=async(t,destination)=>{sent=destination;context.DATA.tasks=[{...t,localSectionId:destination,nativeSectionId:destination??'chats',pinned:destination==='local-pin'}];$('workflow-toast').textContent='Group updated';return true;};
  $('detail-native').value='local-review';await context.changeDetailGroup();assert.equal(sent,'local-review');assert.equal(f.group(),'For Review');assert.equal($('detail-native').value,'local-review');
  $('detail-native').value='chats';await context.changeDetailGroup();assert.equal(sent,null);assert.equal(f.group(),'Ungrouped');assert.equal($('detail-native').value,'chats');
  context.moveNative=async()=>{$('workflow-toast').textContent='Group changed again';return false;};
  $('detail-native').value='local-pin';await context.changeDetailGroup();assert.equal(f.group(),'Ungrouped');assert.equal($('detail-native').value,'chats');assert.equal($('native-edit-hint').textContent,'Group changed again');
});
test('project-default details use the merged group label without enabling inherited membership writes',()=>{
  const f=detailUi(),{context,$,pinned}=f;
  context.DATA.sections.push({sectionId:'threads',name:'Projects'});
  const project={...pinned,nativeSectionId:'threads',localSectionId:null,pinned:false,projectName:'Tools',placementSource:'desktopProject'};
  context.DATA.tasks=[project];context.updateDetailProperties(project);
  assert.equal(f.group(),'Ungrouped');assert.equal($('detail-native').value,'chats');assert($('detail-native').disabled);
  assert.equal($('detail-native').children.filter(o=>o.textContent==='Ungrouped').length,1);
  assert($('detail-meta').children.some(n=>n.tag==='dd'&&n.textContent==='Tools'));
  assert.equal(project.nativeSectionId,'threads');assert.equal(project.localSectionId,null);
});
