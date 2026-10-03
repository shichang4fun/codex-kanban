import test from 'node:test';
import assert from 'node:assert/strict';
import {Script} from 'node:vm';
import {harness,fixture,localId} from './ui-test-helpers.mjs';

test('the simplified UI boots, polls, filters and changes layout without touching retired classifications',()=>{
  const h=harness();h.api.applyNativeBoard(fixture());
  assert.equal(h.nodes.get('visible-count').textContent,'2 tasks');
  assert(h.nodes.get('native-note').hidden);
  h.nodes.get('search').value='Cloud';h.nodes.get('search').listeners.input();
  assert.equal(h.nodes.get('visible-count').textContent,'1 / 2 tasks');
  h.nodes.get('search').value='';h.api.setFilter('unread');
  assert.equal(h.nodes.get('visible-count').textContent,'1 / 2 tasks');
  h.api.setView('list');assert(h.nodes.get('board').classList.contains('list'));
  h.intervals[0]();h.events.storage({key:null});
  assert.equal(h.storage.get('codex-kanban.workflow.v1:local%3Alegacy'),'done');
  assert.equal(h.storage.get('codex-kanban.group-order.v1:workflow'),'["done","todo"]');
  assert(!h.writes.some(key=>key.includes('workflow')));
  assert.match(h.nodes.get('refresh').title,/Groups read:/);
  assert.match(h.nodes.get('refresh').title,/Runtime snapshot:/);
});

test('details keep direct navigation, technical data and clipboard fallback for every task without a valid link',async()=>{
  const h=harness();h.api.applyNativeBoard(fixture());
  h.api.showDetail(h.api.DATA.tasks[0]);
  assert(!h.nodes.get('open-task').hidden);assert(h.nodes.get('copy').hidden);
  assert.equal(h.nodes.get('detail-technical').open,false);
  assert(h.nodes.get('detail-tech-meta').children.some(n=>n.textContent===localId));
  assert(!h.nodes.get('detail-meta').children.some(n=>n.textContent==='Task ID'||n.textContent==='Group'));
  for(const task of [h.api.DATA.tasks[1],{...h.api.DATA.tasks[0],id:'invalid-local-id'}]){
    h.api.showDetail(task);assert(h.nodes.get('open-task').hidden);assert(!h.nodes.get('copy').hidden);
    await h.nodes.get('copy').onclick();
    assert.equal(h.nodes.get('open-prompt').style.display,'block');
    assert.match(h.nodes.get('open-prompt').value,new RegExp(task.id));
  }
});

test('connection, read-only and unavailable-host warnings remain visible',()=>{
  const h=harness();assert(!h.nodes.get('native-note').hidden);
  const board=fixture();board.sync.writable=false;board.sync.moveWritable=false;h.api.applyNativeBoard(board);
  assert(!h.nodes.get('native-note').hidden);assert.match(h.nodes.get('native-note').textContent,/updated Kanban launcher/i);
  board.sync.writable=true;board.sync.moveWritable=true;board.unavailableHosts=['remote'];h.api.applyNativeBoard(board);
  assert(!h.nodes.get('native-note').hidden);assert.match(h.nodes.get('native-note').textContent,/Some hosts unavailable/);
});

test('Group explains every protected source and pending action while keeping write eligibility',()=>{
  const h=harness(),board=fixture(),task=board.tasks[0];
  new Script("nativeToken='csrf'").runInContext(h.context);h.api.applyNativeBoard(board);
  const check=(candidate,reason)=>{
    h.api.showDetail(candidate);
    assert.equal(h.nodes.get('detail-native').disabled,!!reason);
    assert.equal(h.api.nativeCanEditGroup(candidate),!reason);
    assert.equal(h.nodes.get('native-edit-hint').hidden,!reason);
    if(reason){assert.match(h.nodes.get('native-edit-hint').textContent,reason);assert.equal(h.nodes.get('detail-native').title,h.nodes.get('native-edit-hint').textContent);}
  };
  check(task,null);
  check({...task,placementSource:'desktopProject',projectName:'Tools'},/Inherited from project “Tools”/);
  check({...task,placementSource:'desktopProject'},/Inherited from its project/);
  check({...task,hostId:'durable'},/local tasks only/);
  check({...task,sidebarOnly:true},/details could not be verified/);
  check({...task,placementSource:'unconfirmed'},/group could not be verified/);
  check({...task,nativeMembershipCount:2},/membership is ambiguous/);
  new Script('nativePending=true').runInContext(h.context);check(task,/Saving group/);
  new Script("nativePending=false;pinningKey='fixture'").runInContext(h.context);check(task,/Another task action/);
  new Script('pinningKey=null;nativeConnected=false').runInContext(h.context);check(task,/Local connection required/);
  new Script("nativeConnected=true;nativeToken=''").runInContext(h.context);check(task,/Local connection required/);
  new Script("nativeToken='csrf'").runInContext(h.context);
  h.api.applyNativeBoard({...board,sync:{...board.sync,moveWritable:false}});check(task,/updated Kanban launcher/);
});

test('verified project-inherited tasks can change group while preserving project details',()=>{
  const board=fixture(),task=board.tasks[0];
  Object.assign(task,{placementSource:'desktopProject',localSectionId:null,projectId:'fixture-project',projectName:'Tools'});
  const h=harness(board);new Script("nativeToken='csrf'").runInContext(h.context);h.api.applyNativeBoard(board);
  h.api.showDetail(task);
  assert(h.api.nativeCanEditGroup(task));assert(!h.nodes.get('detail-native').disabled);
  assert.match(h.nodes.get('native-edit-hint').textContent,/this task only; its project stays in place/);
  assert(h.nodes.get('detail-meta').children.some(n=>n.textContent==='Tools'));
  const disconnected={...board,sync:{...board.sync,moveWritable:false,pinLocal:false}};
  h.api.applyNativeBoard(disconnected);
  assert(h.nodes.get('detail-native').disabled);
  assert.match(h.nodes.get('native-edit-hint').textContent,/updated Kanban launcher/);
  const menu=h.nodes.get('board').querySelectorAll('.card-menu')[0];
  assert(!menu.querySelector('.card-menu-panel').children.some(n=>n.attributes['aria-label']?.startsWith('Pin task:')));
});

test('details visibly explain absence from refreshed board data and recover when the task returns',()=>{
  const h=harness(),board=fixture();new Script("nativeToken='csrf'").runInContext(h.context);
  h.api.applyNativeBoard(board);h.api.showDetail(board.tasks[0]);
  assert(h.nodes.get('native-edit-hint').hidden);
  const link=h.nodes.get('open-task').href;
  h.api.applyNativeBoard({...board,tasks:[board.tasks[1]]});
  assert(h.nodes.get('detail-native').disabled);assert(!h.nodes.get('native-edit-hint').hidden);
  assert.match(h.nodes.get('native-edit-hint').textContent,/no longer in the current board data/);
  assert.doesNotMatch(h.nodes.get('native-edit-hint').textContent,/deleted|archived|unavailable/);
  assert(!h.nodes.get('open-task').hidden);assert.equal(h.nodes.get('open-task').href,link);
  h.api.applyNativeBoard(board);
  assert(!h.nodes.get('detail-native').disabled);assert(h.nodes.get('native-edit-hint').hidden);
});

const nodeText=node=>[node.textContent,...node.children.map(nodeText)].join(' ');
test('filtered empty groups differ from empty data and zero matches share one state in Board and List',()=>{
  const h=harness(),board=h.nodes.get('board');
  assert.match(nodeText(board),/No readable tasks in this group/);
  h.nodes.get('search').value='Cloud';h.nodes.get('search').listeners.input();
  assert.match(nodeText(board),/No matching tasks in this group/);
  assert.doesNotMatch(nodeText(board),/No readable tasks/);
  h.nodes.get('search').value='No such task';h.nodes.get('search').listeners.input();
  for(const view of ['board','list']){
    h.api.setView(view);assert.equal(board.children.length,1);
    assert.equal(board.children[0].className,'empty board-empty');
    assert.match(nodeText(board),/No matching tasks.*Try another search or filter/);
  }
  new Script("draggedKey='local:fixture'").runInContext(h.context);h.api.render();
  assert(board.children.every(node=>node.dataset.groupId));
  new Script('draggedKey=null').runInContext(h.context);
  h.nodes.get('search').value='';h.api.setFilter('pinned');
  h.api.applyNativeBoard({...fixture(),tasks:[]});assert.equal(board.children.length,1);
  h.api.setFilter('all');assert(board.children.every(node=>node.dataset.groupId));
  assert.doesNotMatch(nodeText(board),/No matching tasks/);
});

test('host options follow refreshed data, preserve valid selection and remain stable across reordered snapshots',()=>{
  const h=harness(),board=fixture(),select=h.nodes.get('host');
  assert.deepEqual(select.children.map(n=>n.value),['all','durable','local']);
  select.value='durable';const options=select.children;
  h.api.applyNativeBoard({...board,tasks:[...board.tasks].reverse()});
  assert.equal(select.children,options);assert.equal(select.value,'durable');
  const added={...board.tasks[0],id:'remote-2',hostId:'remote-control:fixture'};
  h.api.applyNativeBoard({...board,tasks:[...board.tasks,added]});
  assert(select.children.some(n=>n.value===added.hostId));assert.equal(select.value,'durable');
  select.value=added.hostId;
  h.api.applyNativeBoard(board);assert.equal(select.value,'all');assert(!select.children.some(n=>n.value===added.hostId));
  assert.equal(h.nodes.get('visible-count').textContent,'2 tasks');
});

test('task action disclosures close outside and on Escape, restore focus, and open the correct details',()=>{
  const h=harness();new Script("nativeToken='csrf'").runInContext(h.context);h.api.applyNativeBoard(fixture());
  const menus=h.nodes.get('board').querySelectorAll('.card-menu'),[local,remote]=menus;
  local.open=true;remote.open=true;local.listeners.toggle();assert(!remote.open);
  assert.equal(local.querySelector('summary').attributes['aria-expanded'],'true');
  const trigger=local.querySelector('summary');h.events.click({target:trigger});assert(local.open);
  h.events.click({target:h.nodes.get('search')});assert(!local.open);
  local.open=true;let prevented=false;
  h.events.keydown({key:'Escape',target:trigger,preventDefault(){prevented=true;}});
  assert(!local.open);assert(prevented);assert.equal(h.context.document.activeElement,trigger);
  const buttons=local.querySelector('.card-menu-panel').children;
  assert(buttons.some(n=>n.attributes['aria-label']==='Pin task: Local fixture'));
  assert(buttons.some(n=>n.attributes['aria-label']==='Archive task: Local fixture'));
  assert.deepEqual(remote.querySelector('.card-menu-panel').children.map(n=>n.attributes['aria-label']),['View details: Cloud fixture']);
  h.context.actionCalls=[];
  new Script("setTaskPinned=task=>actionCalls.push(['pin',task.id]);archiveTask=task=>actionCalls.push(['archive',task.id]);").runInContext(h.context);
  for(const label of ['Pin task: Local fixture','Archive task: Local fixture']){
    local.open=true;buttons.find(n=>n.attributes['aria-label']===label).onclick({stopPropagation(){}});assert(!local.open);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(h.context.actionCalls)),[['pin',localId],['archive',localId]]);
  local.open=true;buttons.find(n=>n.attributes['aria-label']==='View details: Local fixture').onclick({stopPropagation(){}});
  assert(!local.open);assert(h.nodes.get('detail').open);assert.equal(h.nodes.get('detail-title').textContent,'Local fixture');
});

function gitFixture(){
  const board=fixture(),checkedAt=new Date().toISOString();
  board.tasks[0].git={status:'ready',branch:'codex/pr-layout',sha:'a'.repeat(40),repository:'example/board',checkedAt,
    pullRequests:{status:'ready',match:'branch',checkedAt,items:[{number:7,url:'https://github.com/example/board/pull/7',state:'DRAFT',checks:'pending',review:'REVIEW_REQUIRED'}]}};
  return board;
}
test('integrated Git cards keep task actions and search while details separate PR status from technical provenance',()=>{
  const board=gitFixture(),h=harness(board),root=h.nodes.get('board');
  assert.match(nodeText(root),/codex\/pr-layout.*#7 · Draft/);
  const badge=root.querySelectorAll('.pr-badge pr-draft')[0];assert.equal(badge.href,board.tasks[0].git.pullRequests.items[0].url);
  assert.equal(badge.target,'_blank');assert.equal(badge.rel,'noopener noreferrer');
  assert.equal(root.querySelectorAll('.card-menu').length,2);
  for(const query of ['codex/pr-layout','example/board','#7']){
    h.nodes.get('search').value=query;h.nodes.get('search').listeners.input();assert.equal(h.nodes.get('visible-count').textContent,'1 / 2 tasks');
  }
  h.api.showDetail(board.tasks[0]);assert(!h.nodes.get('detail-git').hidden);
  assert.match(nodeText(h.nodes.get('detail-git-meta')),/Pending \/ Review required/);
  assert.doesNotMatch(nodeText(h.nodes.get('detail-meta')),/Commit|Repository/);
  assert.match(nodeText(h.nodes.get('detail-tech-meta')),/Repository \+ current branch/);
  h.api.showDetail(board.tasks[1]);assert(h.nodes.get('detail-git').hidden);assert.equal(h.nodes.get('detail-git-meta').children.length,0);
});
test('multiple matching PRs open full details and disconnected expiry visibly qualifies cached card results',()=>{
  const board=gitFixture(),pr=board.tasks[0].git.pullRequests;
  pr.items.push({...pr.items[0],number:8,url:'https://github.com/example/board/pull/8',state:'OPEN'});
  const h=harness(board),badge=h.nodes.get('board').querySelectorAll('.pr-badge')[0];
  assert.equal(badge.tag,'button');assert.equal(badge.textContent,'2 PRs');badge.onclick();
  assert(h.nodes.get('detail').open);assert.match(nodeText(h.nodes.get('detail-git-meta')),/#7 · Draft.*#8 · Open/);
  new Script("DATA.tasks[0].git.checkedAt=DATA.tasks[0].git.pullRequests.checkedAt=new Date(Date.now()-100000).toISOString()").runInContext(h.context);
  h.intervals[0]();assert.match(nodeText(h.nodes.get('board')),/Cached/);
  assert.match(nodeText(h.nodes.get('detail-git-meta')),/Cached/);
});
test('detached worktrees suppress inherited PR badges even in an old static snapshot',()=>{
  const board=gitFixture();board.tasks[0].git.branch=null;
  board.tasks[0].git.pullRequests.items[0].state='MERGED';
  const h=harness(board),root=h.nodes.get('board');
  assert.equal(root.querySelectorAll('.pr-badge').length,0);
  assert.equal(root.querySelectorAll('.git-line').length,0);
  assert.doesNotMatch(nodeText(root),/Detached|PR not linked|Merged/);
  h.api.showDetail(board.tasks[0]);
  assert(h.nodes.get('detail-git').hidden);
  assert.equal(h.nodes.get('detail-git-meta').children.length,0);
  assert.match(nodeText(h.nodes.get('detail-tech-meta')),/Commit.*PR lookup.*PR not linked/);
  h.nodes.get('search').value='#7';h.nodes.get('search').listeners.input();
  assert.equal(h.nodes.get('visible-count').textContent,'0 / 2 tasks');
});
test('branch-only cards omit empty PR placeholders and keep lookup diagnostics folded',()=>{
  for(const status of ['none','unavailable','loading','unsupported']){
    const board=gitFixture();board.tasks[0].git.pullRequests={status,items:[],checkedAt:board.tasks[0].git.checkedAt};
    const h=harness(board);
    for(const view of ['board','list']){
      h.api.setView(view);const root=h.nodes.get('board'),line=root.querySelectorAll('.git-line')[0];
      assert.equal(nodeText(line).trim(),'codex/pr-layout');assert.equal(line.children.length,1);
      assert.equal(root.querySelectorAll('.pr-badge').length,0);
    }
    h.api.showDetail(board.tasks[0]);
    assert(!h.nodes.get('detail-git').hidden);assert.deepEqual(h.nodes.get('detail-git-meta').children.map(n=>n.textContent),['Branch','codex/pr-layout']);
    assert.match(nodeText(h.nodes.get('detail-tech-meta')),/PR lookup/);
    assert.equal(h.nodes.get('detail-technical').open,false);
  }
});
test('upstream project view works with simplified controls, PR cards and filtered empty states',()=>{
  const board=gitFixture();board.tasks[0].projectId='board-project';board.tasks[0].projectName='Board project';
  const h=harness(board),root=h.nodes.get('board');
  const toggle=()=>root.querySelectorAll('.project-toggle').find(n=>n.attributes['aria-label']==='Project view: For Review');
  toggle().onclick();assert.equal(toggle().attributes['aria-checked'],'true');
  assert.equal(root.querySelectorAll('.project-group').length,1);
  assert.match(nodeText(root.querySelectorAll('.project-group')[0]),/Board project.*#7 · Draft/);
  assert.equal(root.querySelectorAll('.card-menu').length,2);
  assert.equal(h.context.document.activeElement,toggle());
  h.api.setView('list');assert.equal(root.querySelectorAll('.project-group').length,1);
  h.nodes.get('search').value='missing';h.nodes.get('search').listeners.input();
  assert.equal(root.querySelectorAll('.project-group').length,0);
  assert.equal(root.querySelectorAll('.empty board-empty').length,1);
  h.nodes.get('search').value='';h.nodes.get('search').listeners.input();
  assert.equal(toggle().attributes['aria-checked'],'true');
  toggle().onclick();assert.equal(root.querySelectorAll('.project-group').length,0);
  assert.equal(root.querySelectorAll('.pr-badge pr-draft').length,1);
});
