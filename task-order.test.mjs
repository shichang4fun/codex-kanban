import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script,createContext} from 'node:vm';

const html=readFileSync(new URL('./ui.html',import.meta.url),'utf8');
const helpers=html.match(/const taskOrderStoragePrefix=[\s\S]*?(?=function el)/)[0];
const key=t=>t.hostId+':'+t.id;
const tasks=[
  {id:'a',hostId:'local',updatedAt:30,group:'review',workflow:'todo',column:'idle'},
  {id:'b',hostId:'local',updatedAt:20,group:'review',workflow:'todo',column:'idle'},
  {id:'a',hostId:'cloud',updatedAt:10,group:'review',workflow:'todo',column:'idle'},
  {id:'p',hostId:'local',updatedAt:5,group:'pinned',workflow:'done',column:'unknown'}
];
function harness(storage=new Map()){
  const data={tasks:structuredClone(tasks)},nodes={grouping:{value:'native'},order:{value:'manual'}};
  let blocked=false,renders=0,message='';
  const context=createContext({DATA:data,$:id=>nodes[id],taskKey:key,currentGroups:()=>[],nativeStage:t=>t.group,workflowStage:t=>t.workflow,
    localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>{if(blocked)throw Error('quota exceeded');storage.set(k,v);}},
    announce:text=>message=text,render:()=>renders++});
  const api=new Script(helpers+'\n({orderedTasks,moveTaskOrder,taskOrderKey,restoreSortPreference,changeSort})').runInContext(context);
  return {api,data,nodes,storage,block:()=>blocked=true,renders:()=>renders,message:()=>message};
}
const ids=rows=>Array.from(rows,key);
const review=h=>h.data.tasks.filter(t=>t.group==='review');

test('manual order survives updates and reload; new tasks append rather than jump to the top',()=>{
  const h=harness();h.api.orderedTasks(review(h),'review');
  assert.equal(h.api.moveTaskOrder('local:b','local:a'),true);
  const reloaded=harness(h.storage);
  reloaded.data.tasks[0].updatedAt=1000;
  const added={id:'new',hostId:'local',group:'review',updatedAt:2000};reloaded.data.tasks.push(added);
  const incoming=review(reloaded).sort((a,b)=>b.updatedAt-a.updatedAt);
  assert.deepEqual(ids(reloaded.api.orderedTasks(incoming,'review')),['local:b','local:a','cloud:a','local:new']);
  const again=harness(reloaded.storage);
  assert.deepEqual(ids(again.api.orderedTasks(review(again),'review')),['local:b','local:a','cloud:a']);
});
test('before and after moves preserve hidden tasks and never change memberships or runtime state',()=>{
  const h=harness(),before=JSON.stringify(h.data);
  h.api.orderedTasks(review(h),'review');
  // Only b and cloud:a need to be visible; the full data set still preserves local:a.
  assert.equal(h.api.moveTaskOrder('local:b','cloud:a',true),true);
  assert.deepEqual(ids(h.api.orderedTasks(review(h),'review')),['local:a','cloud:a','local:b']);
  assert.equal(JSON.stringify(h.data),before);
  assert.equal(h.api.moveTaskOrder('local:b','local:p'),false);
  assert.equal(h.api.moveTaskOrder('local:b','missing'),false);
  assert.equal(h.api.moveTaskOrder('local:b','local:b'),false);
});
test('group and mode namespaces are independent and same task IDs on different hosts stay distinct',()=>{
  const h=harness();h.api.orderedTasks(review(h),'review');h.api.moveTaskOrder('cloud:a','local:a');
  assert.deepEqual(ids(h.api.orderedTasks(review(h),'review')),['cloud:a','local:a','local:b']);
  h.nodes.grouping.value='workflow';
  assert.deepEqual(ids(h.api.orderedTasks(review(h),'todo')),['local:a','local:b','cloud:a']);
  assert.notEqual(h.api.taskOrderKey('review','native'),h.api.taskOrderKey('review','runtime'));
  assert.notEqual(h.api.taskOrderKey('review','native'),h.api.taskOrderKey('pinned','native'));
  h.nodes.grouping.value='native';
  assert.deepEqual(ids(h.api.orderedTasks(review(h),'review')),['cloud:a','local:a','local:b']);
});
test('malformed orders, duplicate keys and missing tasks are reconciled safely',()=>{
  const h=harness(),storageKey=h.api.taskOrderKey('review');
  h.storage.set(storageKey,'{"bad":true}');
  assert.deepEqual(ids(h.api.orderedTasks(review(h),'review')),['local:a','local:b','cloud:a']);
  h.storage.set(storageKey,'["local:b","local:b",null,"removed"]');
  assert.deepEqual(ids(h.api.orderedTasks(review(h),'review')),['local:b','local:a','cloud:a']);
  assert.deepEqual(JSON.parse(h.storage.get(storageKey)),['local:b','local:a','cloud:a']);
});
test('failed writes do not move tasks or claim success',()=>{
  const h=harness();h.api.orderedTasks(review(h),'review');h.block();
  assert.equal(h.api.moveTaskOrder('local:b','local:a'),false);
  assert.equal(h.renders(),0);assert.match(h.message(),/not saved/);
  assert.deepEqual(ids(h.api.orderedTasks(review(h),'review')),['local:a','local:b','cloud:a']);
});
test('sort preference persists and invalid values fall back to recently updated',()=>{
  const h=harness();h.api.changeSort();
  const reloaded=harness(h.storage);reloaded.nodes.order.value='recent';reloaded.api.restoreSortPreference();
  assert.equal(reloaded.nodes.order.value,'manual');
  h.storage.set('codex-kanban.sort.v1','invalid');reloaded.api.restoreSortPreference();
  assert.equal(reloaded.nodes.order.value,'recent');
});
test('a stale tab cannot remove ordering entries learned from a newer snapshot',()=>{
  const fresh=harness(),stale=harness(fresh.storage);
  fresh.api.orderedTasks(review(fresh),'review');
  fresh.data.tasks.push({id:'new',hostId:'local',group:'review',updatedAt:100});
  fresh.api.orderedTasks(review(fresh),'review');
  const storageKey=fresh.api.taskOrderKey('review'),before=fresh.storage.get(storageKey);
  stale.api.orderedTasks(review(stale),'review');
  assert.equal(fresh.storage.get(storageKey),before,'older snapshots must not trigger opposing storage writes');
  assert.equal(stale.api.moveTaskOrder('local:b','local:a'),true);
  assert.ok(JSON.parse(fresh.storage.get(storageKey)).includes('local:new'),'a user reorder retains entries missing from this tab');
  assert.deepEqual(ids(fresh.api.orderedTasks(review(fresh),'review')),['local:b','local:a','cloud:a','local:new']);
});
test('Ungrouped retains former Tasks and Projects orders across a manual reorder and reload',()=>{
  const h=harness();for(const task of h.data.tasks)task.group='chats';
  h.storage.set(h.api.taskOrderKey('chats'),'["local:b","local:a"]');
  h.storage.set(h.api.taskOrderKey('threads'),'["local:p","cloud:a","local:b"]');
  const before=JSON.stringify(h.data);
  assert.deepEqual(ids(h.api.orderedTasks(h.data.tasks,'chats')),['local:b','local:a','local:p','cloud:a']);
  assert.equal(JSON.stringify(h.data),before);
  assert(h.api.moveTaskOrder('cloud:a','local:b'));
  const reload=harness(h.storage);for(const task of reload.data.tasks)task.group='chats';
  assert.deepEqual(ids(reload.api.orderedTasks(reload.data.tasks,'chats')),['cloud:a','local:b','local:a','local:p']);
  h.nodes.grouping.value='workflow';assert.deepEqual(ids(h.api.orderedTasks(h.data.tasks,'chats')),['local:a','local:b','cloud:a','local:p']);
});
