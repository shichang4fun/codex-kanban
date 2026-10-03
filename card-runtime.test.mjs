import test from 'node:test';
import assert from 'node:assert/strict';
import {harness,fixture} from './ui-test-helpers.mjs';

function runtimeFixture({column='idle',live=false,stale=false,source=live?'desktopRuntime':'desktopSnapshot'}={}){
  const board=fixture(),capturedAt=new Date().toISOString();
  board.runtimeCapturedAt=capturedAt;board.runtimeSnapshotMaxAgeMs=15000;
  board.tasks=[{...board.tasks[0],column,pinned:true,nativeTaskPinned:true,nativeSectionId:'pin',
    rawStatus:column==='running'?{type:'active',activeFlags:[]}:{type:column},
    runtimeStatusSource:source,runtimeStatusStale:stale,runtimeCapturedAt:capturedAt}];
  board.sections.push({sectionId:'progress',name:'In Progress'});
  return board;
}
const find=(root,name)=>root.querySelectorAll('.'+name)[0]??null;

test('moving a pinned idle task into In Progress preserves unread without a running icon',()=>{
  const h=harness(runtimeFixture()),task=h.api.DATA.tasks[0];
  assert.equal(find(h.api.makeCard(task,'pin'),'card-pin').attributes['data-pinned'],'true');
  task.pinned=false;task.nativeTaskPinned=false;task.nativeSectionId='progress';
  const card=h.api.makeCard(task,'progress');
  assert.equal(card.dataset.groupId,'progress');assert.equal(find(card,'progress-ring'),null);
  assert(find(card,'unread'));assert.equal(find(card,'card-pin'),null);
  assert.equal(task.column,'idle');assert.equal(task.isUnread,true);
});
test('unknown, unloaded, waiting, failed and stale or unavailable states never show a running icon',()=>{
  for(const options of [{column:'unknown'},{column:'unloaded'},{column:'attention'},{column:'error'},
    {column:'running',stale:true},{column:'running',source:'unavailable'}]){
    const h=harness(runtimeFixture(options)),task=h.api.DATA.tasks[0],card=h.api.makeCard(task,'progress');
    assert.equal(find(card,'progress-ring'),null,JSON.stringify(options));
    assert(find(card,'unread'));assert.equal(task.isUnread,true);
  }
});
test('confirmed live execution shows its icon in every native group',()=>{
  const h=harness(runtimeFixture({column:'running',live:true})),task=h.api.DATA.tasks[0];
  for(const group of ['pin','review','progress','chats']){
    task.nativeSectionId=group;
    const card=h.api.makeCard(task,group),ring=find(card,'progress-ring');
    assert(ring);assert.equal(ring.attributes['aria-label'],'Running');
    assert(!ring.className.includes('snapshot-runtime'));assert.equal(find(card,'unread'),null);
    assert.equal(task.isUnread,true);
  }
});
test('snapshot execution stays static and restores unread when its observation expires',()=>{
  const h=harness(runtimeFixture({column:'running'})),task=h.api.DATA.tasks[0];
  const ring=find(h.api.makeCard(task,'progress'),'progress-ring');
  assert(ring.className.includes('snapshot-runtime'));assert.equal(ring.title,'Running (snapshot)');
  assert(h.api.expireRuntimeSnapshot(Date.parse(h.api.DATA.runtimeCapturedAt)+16000));
  const expired=h.api.makeCard(task,'progress');
  assert.equal(find(expired,'progress-ring'),null);assert(find(expired,'unread'));
  assert.equal(task.lastObservedStatus.type,'active');assert.equal(task.nativeSectionId,'pin');
});
test('Board, List and Project view animate only confirmed live execution',()=>{
  for(const view of ['board','list'])for(const projectView of [true,false])for(const live of [true,false]){
    const board=runtimeFixture({column:'running',live}),task=board.tasks[0];
    task.nativeSectionId='progress';task.projectId='fixture-project';task.projectName='Fixture project';
    board.tasks.push({...task,id:'22222222-2222-4222-8222-222222222222',column:'idle',pinned:false});
    const h=harness(board,{animations:true}),root=h.nodes.get('board');
    if(projectView)root.querySelectorAll('.project-toggle').find(n=>n.attributes['aria-label']==='Project view: In Progress').onclick();
    h.api.setView(view);
    const cards=root.querySelectorAll('.card'),ring=find(cards[0],'progress-ring');
    assert.equal(cards[0].dataset.groupId,'progress');assert(ring);
    assert.equal(ring.animations.length,live?1:0);
    assert.equal(find(cards[1],'progress-ring'),null);assert(find(cards[1],'unread'));
    assert.equal(root.querySelectorAll('.project-group').length,projectView?1:0);
  }
});
