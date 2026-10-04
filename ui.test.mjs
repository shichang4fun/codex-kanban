import test from 'node:test';
import assert from 'node:assert/strict';
import {Script} from 'node:vm';
import {readFileSync} from 'node:fs';
import {harness,fixture,localId} from './ui-test-helpers.mjs';
const html=readFileSync(new URL('./ui.html',import.meta.url),'utf8');

test('a failed background read preserves a newly opened task menu',async()=>{
  const h=harness();h.context.location.protocol='http:';let rejectRead;
  h.context.fetchImpl=()=>new Promise((_,reject)=>rejectRead=reject);
  const pending=h.api.refreshNativeBoard(),board=h.nodes.get('board').children[0];
  h.nodes.get('board').querySelectorAll('.card-details')[0].onclick({stopPropagation(){}});
  rejectRead(Error('Temporary disconnection'));await pending;
  assert.equal(h.nodes.get('board').children[0],board);assert(!h.nodes.get('task-menu').hidden);
});

test('inline Host and Theme controls retain their nodes and focus through renders and theme notifications',()=>{
  const h=harness(),host=h.nodes.get('host'),theme=h.nodes.get('theme');
  host.focus();h.api.render();h.events['kanban-host-theme']({detail:'light'});
  assert.equal(h.context.document.activeElement,host);assert.equal(h.nodes.get('host'),host);
  theme.focus();theme.value='dark';theme.onchange();h.api.applyNativeBoard(fixture());
  assert.equal(h.context.document.activeElement,theme);assert.equal(h.nodes.get('theme'),theme);assert.equal(theme.value,'dark');
});

test('Host and Theme are inline, grouping settings stay available, and the host chip clears only its filter',()=>{
  const h=harness(),host=h.nodes.get('host'),search=h.nodes.get('search'),chip=h.nodes.get('host-chip');
  for(const removed of ['order','refresh','manual-order-hint'])assert(!h.nodes.has(removed));
  assert(h.nodes.has('auto-organize'));assert(h.nodes.has('view-options-trigger'));
  const symbols=new Set([...html.matchAll(/<symbol id="([^"]+)"/g)].map(match=>match[1]));
  for(const match of html.matchAll(/<use href="#([^"]+)"/g))assert(symbols.has(match[1]),`Missing toolbar icon: ${match[1]}`);
  assert(html.includes('class="toolbar-select"'));assert(html.includes('class="toolbar-select theme-control"'));
  assert(chip.hidden);search.value='fixture';h.api.setFilter('unread');host.value='durable';host.onchange();
  assert(!chip.hidden);assert.equal(h.nodes.get('host-chip-label').textContent,'Cloud');
  chip.onclick();assert.equal(host.value,'all');assert.equal(search.value,'fixture');assert.equal(h.nodes.get('unread-only').attributes['aria-pressed'],'true');assert(chip.hidden);
});

test('automatic reads continue while an inline selector has focus without resetting its selection',async()=>{
  for(const field of ['host','theme']){
    const h=harness(),control=h.nodes.get(field);h.context.location.protocol='http:';
    control.value=field==='host'?'durable':'dark';control.onchange();control.focus();
    const next=fixture();next.tasks[1].title='Updated cloud task';
    h.context.fetchImpl=async()=>({ok:true,json:async()=>({board:next,csrf:'fixture'})});
    await h.api.refreshNativeBoard();
    assert(h.nodes.get('board').querySelectorAll('.card-title').some(n=>n.textContent==='Updated cloud task'));assert.equal(h.context.document.activeElement,control);
    assert.equal(control.value,field==='host'?'durable':'dark');
  }
});

test('automatic refresh recovers after a read failure without clearing filters, layout or Undo',async()=>{
  const h=harness();let resolveResponse;
  h.context.location.protocol='http:';h.context.fetchImpl=()=>new Promise(resolve=>resolveResponse=resolve);
  h.nodes.get('search').value='fixture';h.api.setFilter('unread');h.api.setView('list');
  new Script("archiveNotices.set('undo-test',{task:DATA.tasks[0],error:null});renderArchiveNotices()").runInContext(h.context);
  h.context.fetchImpl=async()=>{throw Error('Temporary disconnection');};
  await h.api.refreshNativeBoard();assert(!h.nodes.get('native-note').hidden);
  h.context.fetchImpl=()=>new Promise(resolve=>resolveResponse=resolve);
  const pending=h.api.refreshNativeBoard();
  resolveResponse({ok:true,json:async()=>({board:fixture(),csrf:'fixture'})});await pending;
  assert(h.nodes.get('native-note').hidden);assert.equal(h.nodes.get('archive-notices').children.length,1);
  assert.equal(h.nodes.get('search').value,'fixture');assert.equal(h.nodes.get('unread-only').attributes['aria-pressed'],'true');assert(h.nodes.get('board').classList.contains('list'));
});

test('Unread badge counts the whole board independently of search and host filters',()=>{
  const h=harness(),badge=h.nodes.get('unread-count'),inbox=h.nodes.get('unread-only');
  assert.equal(badge.textContent,'1');assert(!badge.hidden);assert.match(inbox.title,/1 unread task.*Click to show only unread/);
  h.nodes.get('search').value='missing';h.nodes.get('host').value='durable';h.api.render();
  assert.equal(h.nodes.get('visible-count').textContent,'0 / 2 tasks');assert.equal(badge.textContent,'1');assert(!badge.hidden);
  h.nodes.get('clear-filters').onclick();inbox.onclick();assert.equal(inbox.attributes['aria-pressed'],'true');assert.match(inbox.title,/Click to show all tasks/);
  assert(h.nodes.get('active-filters').hidden);
  const next=fixture();next.tasks[0].isUnread=false;h.api.applyNativeBoard(next);
  assert(badge.hidden);assert.equal(inbox.attributes['aria-pressed'],'true');assert(!inbox.disabled);inbox.onclick();
  assert.equal(h.nodes.get('visible-count').textContent,'2 tasks');assert.equal(inbox.attributes['aria-pressed'],'false');
});

test('Unread badge caps large counts visually while keeping the exact accessible total',()=>{
  const board=fixture();board.tasks=Array.from({length:120},(_,index)=>({...board.tasks[0],id:'fixture-'+index}));
  const h=harness(board);assert.equal(h.nodes.get('unread-count').textContent,'99+');assert.match(h.nodes.get('unread-only').attributes['aria-label'],/120 unread tasks/);
  h.nodes.get('unread-only').onclick();h.api.setView('list');assert.equal(h.nodes.get('unread-count').textContent,'99+');
});

test('rapid unread toggles size the final title and count without retaining old widths',()=>{
  const h=harness(),toggle=h.nodes.get('unread-only'),title=h.nodes.get('view-title'),count=h.nodes.get('count-slot');
  h.nodes.get('title-all').getBoundingClientRect=()=>({width:72});h.nodes.get('title-unread').getBoundingClientRect=()=>({width:108});
  h.nodes.get('visible-count').getBoundingClientRect=()=>({width:h.nodes.get('visible-count').textContent.length*6});
  h.api.render();assert.equal(title.attributes['aria-label'],'All tasks');assert.equal(title.style.width,'72px');assert.equal(count.style.width,'42px');
  for(let index=0;index<7;index++)toggle.onclick();
  assert.equal(h.nodes.get('header-title').dataset.unread,'true');assert.equal(toggle.attributes['aria-pressed'],'true');
  assert.equal(title.attributes['aria-label'],'Unread tasks');assert.equal(title.style.width,'108px');assert.equal(count.style.width,'66px');
  h.nodes.get('search').value='missing';h.api.render();assert.equal(h.nodes.get('visible-count').textContent,'0 / 2 tasks');assert.equal(count.style.width,'66px');
  const next=fixture();next.tasks.push({...next.tasks[0],id:'new-fixture'});h.api.applyNativeBoard(next);assert.equal(title.style.width,'108px');
  h.nodes.get('clear-filters').onclick();assert.equal(h.nodes.get('header-title').dataset.unread,'false');assert.equal(title.attributes['aria-label'],'All tasks');
  assert.equal(title.style.width,'72px');assert.equal(count.style.width,'42px');
});

test('Unread inbox stays active across refreshes and layouts',()=>{
  assert.doesNotMatch(html,/<aside|data-filter=|id="sidebar-toggle"/);
  const h=harness(),toggle=h.nodes.get('unread-only');h.api.applyNativeBoard(fixture());
  assert.equal(h.nodes.get('visible-count').textContent,'2 tasks');
  toggle.onclick();assert.equal(toggle.attributes['aria-pressed'],'true');assert.equal(h.nodes.get('view-title').attributes['aria-label'],'Unread tasks');
  assert.equal(h.nodes.get('visible-count').textContent,'1 / 2 tasks');
  h.api.setView('list');assert.equal(toggle.attributes['aria-pressed'],'true');
  const next=fixture();next.tasks[0].isUnread=false;h.api.applyNativeBoard(next);
  assert.equal(h.nodes.get('visible-count').textContent,'0 / 2 tasks');assert.equal(toggle.attributes['aria-pressed'],'true');
  toggle.onclick();assert.equal(toggle.attributes['aria-pressed'],'false');assert.equal(h.nodes.get('view-title').attributes['aria-label'],'All tasks');
  assert.equal(h.nodes.get('visible-count').textContent,'2 tasks');assert(h.nodes.get('board').classList.contains('list'));
});

test('appearance defaults to the system and reacts to media and native host changes without rebuilding cards',()=>{
  const h=harness(),select=h.nodes.get('theme'),root=h.context.document.documentElement,card=h.nodes.get('board').children[0];
  assert.equal(select.value,'system');assert.equal(root.dataset.theme,'dark');
  h.themeMedia.matches=false;h.events.mediaTheme();assert.equal(root.dataset.theme,'light');
  select.value='dark';select.onchange();h.events.mediaTheme();assert.equal(root.dataset.theme,'dark');
  h.events['kanban-host-theme']({detail:'light'});assert.equal(root.dataset.theme,'dark');
  select.value='system';select.onchange();assert.equal(root.dataset.theme,'light');
  h.events['kanban-host-theme']({detail:'dark'});assert.equal(root.dataset.theme,'dark');
  h.events['kanban-host-theme']({detail:'invalid'});assert.equal(root.dataset.theme,'dark');
  assert.equal(h.nodes.get('board').children[0],card);assert(!h.nodes.get('detail').open);
});

test('appearance restores saved choices and synchronizes changes and resets across tabs',()=>{
  const key='codex-kanban.theme.v1',h=harness(fixture(),{dark:false,theme:'dark'}),select=h.nodes.get('theme'),root=h.context.document.documentElement;
  assert.equal(select.value,'dark');assert.equal(root.dataset.theme,'dark');
  select.value='light';select.onchange();assert.equal(h.storage.get(key),'light');
  h.storage.set(key,'dark');h.events.storage({key});assert.equal(select.value,'dark');assert.equal(root.dataset.theme,'dark');
  h.storage.set(key,'unknown');h.events.storage({key});assert.equal(select.value,'system');assert.equal(root.dataset.theme,'light');
  h.storage.delete(key);h.events.storage({key:null});assert.equal(select.value,'system');
  assert.equal(h.storage.get('codex-kanban.workflow.v1:local%3Alegacy'),'done');
});

test('appearance remains usable when browser storage is unavailable',()=>{
  const h=harness(fixture(),{storageFailure:true}),select=h.nodes.get('theme');
  assert.equal(select.value,'system');select.value='light';select.onchange();
  assert.equal(h.context.document.documentElement.dataset.theme,'light');
  assert.match(h.nodes.get('task-toast').textContent,/could not be saved/);
});

test('text size scales without rebuilding cards and persists, synchronizes and resets across tabs',()=>{
  const key='codex-kanban.text-size.v1',h=harness(fixture(),{textSize:'120'});
  const select=h.nodes.get('font-size'),root=h.context.document.documentElement,card=h.nodes.get('board').children[0];
  assert.equal(select.value,'120');assert.equal(root.style['--font-scale'],'1.2');
  select.focus();select.value='130';select.onchange();
  assert.equal(h.storage.get(key),'130');assert.equal(root.style['--font-scale'],'1.3');
  assert.equal(h.nodes.get('board').children[0],card);assert.equal(h.context.document.activeElement,select);
  const reload=harness(fixture(),{textSize:h.storage.get(key)});assert.equal(reload.nodes.get('font-size').value,'130');
  h.storage.set(key,'90');h.events.storage({key});assert.equal(select.value,'90');assert.equal(root.style['--font-scale'],'0.9');
  h.storage.set(key,'invalid');h.events.storage({key});assert.equal(select.value,'100');assert.equal(root.style['--font-scale'],'1');
  select.value='110';select.onchange();select.value='100';select.onchange();assert.equal(h.storage.get(key),'100');
  h.storage.delete(key);h.events.storage({key:null});assert.equal(select.value,'100');
});

test('text size still changes when browser storage is unavailable',()=>{
  const h=harness(fixture(),{storageFailure:true}),select=h.nodes.get('font-size');
  assert.equal(select.value,'100');select.value='110';select.onchange();
  assert.equal(h.context.document.documentElement.style['--font-scale'],'1.1');
  assert.match(h.nodes.get('task-toast').textContent,/Text size changed.*could not be saved/);
});

test('default stable order leads arrivals and survives Board and List status refreshes and filters',()=>{
  for(const view of ['board','list'])for(const projectView of [false,true]){
    const board=fixture();
    board.tasks[0].updatedAt=30;
    board.tasks.push({...board.tasks[0],id:'older',title:'Hidden existing',updatedAt:20},
      {...board.tasks[0],id:'moved',title:'Moved task',nativeSectionId:'pin',localSectionId:'pin',updatedAt:10});
    for(const task of board.tasks)if(task.hostId==='local')Object.assign(task,{projectId:'one',projectName:'Project one'});
    const h=harness(board),root=h.nodes.get('board');
    h.storage.set('codex-kanban.task-order.v1:native:review',JSON.stringify(['local:older','local:'+localId]));
    h.storage.set('codex-kanban.project-view.v2:native:review',String(projectView));
    h.events.storage({key:'codex-kanban.project-view.v2:native:review'});
    h.api.setView(view);
    const reviewCards=()=>root.querySelectorAll('.card').filter(n=>n.dataset.groupId==='review').map(n=>n.dataset.taskKey);
    assert.deepEqual(reviewCards(),['local:older','local:'+localId]);
    h.nodes.get('search').value='Incoming';h.nodes.get('search').listeners.input();
    const incoming=structuredClone(board);
    incoming.tasks[0].updatedAt=9999;
    Object.assign(incoming.tasks.find(t=>t.id==='moved'),{nativeSectionId:'review',localSectionId:'review',updatedAt:50});
    incoming.tasks.push({...incoming.tasks[0],id:'new',title:'Incoming task',updatedAt:100});
    h.api.applyNativeBoard(incoming);
    assert.deepEqual(reviewCards(),['local:new']);
    h.nodes.get('search').value='';h.nodes.get('search').listeners.input();
    const expected=['local:new','local:moved','local:older','local:'+localId];
    assert.deepEqual(reviewCards(),expected);
    const next=structuredClone(incoming);
    next.tasks.find(t=>t.id==='older').updatedAt=20000;
    next.tasks[0].isUnread=false;
    next.tasks[0].title='Updated existing task';
    h.api.applyNativeBoard(next);assert.deepEqual(reviewCards(),expected);
    assert(root.querySelectorAll('.card').some(n=>n.querySelector('.card-title')?.textContent==='Updated existing task'));
    assert.equal(h.storage.get('codex-kanban.sort.v1'),'recent','retired sort preferences cannot change stable ordering');
    assert(!h.writes.includes('codex-kanban.sort.v1'));
  }
});

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
  assert.match(h.nodes.get('visible-count').title,/Groups read:/);
  assert.match(h.nodes.get('visible-count').title,/Runtime snapshot:/);
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
  board.sync.writable=true;board.unavailableHosts=['remote'];h.api.applyNativeBoard(board);
  assert(!h.nodes.get('native-note').hidden);assert.match(h.nodes.get('native-note').textContent,/Some hosts unavailable/);
});

test('Group explains every protected source and pending action while keeping write eligibility',()=>{
  const h=harness(),board=fixture(),task=board.tasks[0];
  new Script("nativeToken='csrf'").runInContext(h.context);h.api.applyNativeBoard(board);
  const check=(candidate,reason)=>{
    h.api.showDetail(candidate);
    assert.equal(h.nodes.get('detail-native').disabled,!!reason);
    assert.equal(h.api.nativeCanEditGroup(candidate),!reason);
    if(reason)assert.equal(h.nodes.get('native-edit-hint').hidden,false);
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
  new Script("nativeToken='csrf'").runInContext(h.context);board.sync.moveWritable=false;h.api.applyNativeBoard(board);check(task,/updated Kanban launcher/);
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
const menuItem=(h,label)=>['task-menu','task-submenu'].flatMap(id=>h.nodes.get(id).hidden?[]:h.nodes.get(id).querySelectorAll('.task-menu-item')).find(n=>!n.hidden&&n.querySelector('.menu-label').textContent===label);
const click=node=>node.onclick({stopPropagation(){}});
test('right-click and the keyboard context-menu key reuse task actions and clamp to the pointer',()=>{
  const h=harness(),card=h.nodes.get('board').querySelectorAll('.card')[0],panel=h.nodes.get('task-menu');
  Object.assign(h.context.window,{innerWidth:390,innerHeight:600});panel.getBoundingClientRect=()=>({width:240,height:250});
  let prevented=0,stopped=0;
  card.listeners.contextmenu({clientX:385,clientY:595,preventDefault(){prevented++;},stopPropagation(){stopped++;}});
  assert.equal(prevented,1);assert.equal(stopped,1);assert(!panel.hidden);assert(menuItem(h,'Rename'));
  assert.equal(panel.style.left,'138px');assert.equal(panel.style.top,'338px');
  h.events.keydown({key:'Escape',preventDefault(){}});assert(panel.hidden);
  card.listeners.keydown({key:'F10',shiftKey:true,preventDefault(){},stopPropagation(){}});assert(!panel.hidden);
});
test('rename saves a trimmed title once, verifies it and retains draft text after a failed save',async()=>{
  const h=harness(),initial=fixture();new Script("nativeToken='csrf'").runInContext(h.context);h.api.applyNativeBoard(initial);
  click(h.nodes.get('board').querySelectorAll('.card-details')[0]);click(menuItem(h,'Rename'));
  const dialog=h.nodes.get('rename-task'),input=h.nodes.get('rename-title'),form=h.nodes.get('rename-form');
  assert(dialog.open);assert.equal(input.value,'Local fixture');assert.equal(h.context.document.activeElement,input);
  h.context.location.protocol='http:';let writes=0,reads=0,release;
  h.context.fetchImpl=(path,opts)=>{
    if(path==='/api/board'){reads++;return Promise.resolve({ok:true,json:async()=>({board:initial,csrf:'csrf'})});}
    writes++;assert.equal(path,'/api/rename');const body=JSON.parse(opts.body);assert.equal(body.title,'Renamed task');assert.equal(body.expectedTitle,'Local fixture');
    return new Promise(resolve=>release=resolve);
  };
  await h.api.refreshNativeBoard();assert.equal(reads,0);input.value='  Renamed task  ';
  const pending=form.onsubmit({preventDefault(){}});assert(input.disabled);assert(h.nodes.get('rename-save').disabled);assert(h.nodes.get('rename-cancel').disabled);
  await form.onsubmit({preventDefault(){}});assert.equal(writes,1);
  release({ok:false,json:async()=>({error:'Renamed elsewhere'})});await pending;
  assert(dialog.open);assert(!input.disabled);assert.equal(input.value,'  Renamed task  ');assert.equal(h.nodes.get('rename-error').textContent,'Renamed elsewhere');
  const next=fixture();next.tasks[0].title='Renamed task';
  h.context.fetchImpl=async()=>({ok:true,json:async()=>({threadId:localId,title:'Renamed task',changed:true,board:next,csrf:'csrf'})});
  await form.onsubmit({preventDefault(){}});assert(!dialog.open);assert.match(nodeText(h.nodes.get('board')),/Renamed task/);
  assert.equal(h.nodes.get('task-toast').textContent,'Task renamed');
});
test('cancel, blank names, unchanged names and cloud tasks do not dispatch a rename',async()=>{
  const h=harness();new Script("nativeToken='csrf'").runInContext(h.context);h.api.applyNativeBoard(fixture());let calls=0;
  h.context.fetchImpl=async()=>{calls++;throw Error('Unexpected write');};
  const open=()=>{click(h.nodes.get('board').querySelectorAll('.card-details')[0]);click(menuItem(h,'Rename'));};
  open();h.nodes.get('rename-title').value='   ';await h.nodes.get('rename-form').onsubmit({preventDefault(){}});
  assert(!h.nodes.get('rename-error').hidden);assert(h.nodes.get('rename-task').open);
  h.nodes.get('rename-cancel').onclick();assert(!h.nodes.get('rename-task').open);
  open();await h.nodes.get('rename-form').onsubmit({preventDefault(){}});assert(!h.nodes.get('rename-task').open);assert.equal(calls,0);
  click(h.nodes.get('board').querySelectorAll('.card-details')[1]);assert(menuItem(h,'Rename').disabled);assert.match(menuItem(h,'Rename').title,/local tasks only/);
});
test('three-second polling avoids redundant renders, serializes slow reads and refreshes on focus',async()=>{
  const h=harness(),initial=fixture();h.api.applyNativeBoard(initial);h.context.location.protocol='http:';
  const original=h.nodes.get('board').children[0];let calls=0,release;
  h.context.fetchImpl=()=>{calls++;return new Promise(resolve=>release=resolve);};
  assert.equal(h.intervals[0].delay,3000);
  const pending=h.api.refreshNativeBoard();h.intervals[0]();h.events.focus();assert.equal(calls,1);
  release({ok:true,json:async()=>({board:{...initial,capturedAt:new Date(Date.now()+1000).toISOString()},csrf:'csrf'})});await pending;
  assert.equal(h.nodes.get('board').children[0],original);
  const next=fixture();next.tasks[0].column='running';next.tasks[0].rawStatus={type:'active',activeFlags:[]};next.tasks[0].runtimeStatusSource='desktopRuntime';next.tasks[0].runtimeCapturedAt=new Date().toISOString();
  h.context.fetchImpl=async()=>{calls++;return {ok:true,json:async()=>({board:next,csrf:'csrf'})};};
  h.events.visibilitychange();for(let i=0;i<6;i++)await Promise.resolve();
  assert.equal(calls,2);assert.notEqual(h.nodes.get('board').children[0],original);
  assert(h.nodes.get('board').querySelectorAll('.progress-ring').length);
});
test('polling resumes after Escape and rename cancel while card focus survives status redraws',async()=>{
  for(const exit of ['escape','rename-cancel']){
    const h=harness();new Script("nativeToken='csrf'").runInContext(h.context);h.api.applyNativeBoard(fixture());h.context.location.protocol='http:';
    const root=h.nodes.get('board'),trigger=root.querySelectorAll('.card-details')[0];click(trigger);
    if(exit==='escape')h.events.keydown({key:'Escape',target:h.nodes.get('task-menu'),preventDefault(){}});
    else{click(menuItem(h,'Rename'));h.nodes.get('rename-cancel').onclick();}
    assert.equal(h.context.document.activeElement,trigger);assert(trigger.closest('.card'));
    const next=fixture();next.tasks[0].title='Updated after dialog';let reads=0;
    h.context.fetchImpl=async()=>{reads++;return {ok:true,json:async()=>({board:next,csrf:'csrf'})};};
    h.intervals[0]();for(let i=0;i<10;i++)await Promise.resolve();assert.equal(reads,1);
    assert(root.querySelectorAll('.card-title').some(node=>node.textContent==='Updated after dialog'));
    assert.equal(h.context.document.activeElement,root.querySelectorAll('.card-details')[0]);
    h.intervals[0]();for(let i=0;i<10;i++)await Promise.resolve();assert.equal(reads,2);
  }
});
test('changed polling preserves the intended card action for chat, project, pin and archive focus',async()=>{
  for(const selector of ['.card-open','.project','.card-pin','.card-archive']){
    const board=projectFixture(),h=harness(board);new Script("nativeToken='csrf'").runInContext(h.context);h.api.applyNativeBoard(board);h.context.location.protocol='http:';
    const root=h.nodes.get('board'),card=root.querySelectorAll('.card')[0],control=card.querySelectorAll(selector)[0];assert(control,selector);control.focus();
    const next=projectFixture();next.tasks[0].title='Changed title';
    h.context.fetchImpl=async()=>({ok:true,json:async()=>({board:next,csrf:'csrf'})});await h.api.refreshNativeBoard();
    assert.equal(h.context.document.activeElement,root.querySelectorAll('.card')[0].querySelectorAll(selector)[0]);
  }
});
function projectFixture(){
  const board=fixture();board.sync.projectLocal=true;
  board.projects=[{projectId:'native-a',hostId:'local',label:'Project A'},{projectId:'native-b',hostId:'local',label:'Project B'},{projectId:'cloud',hostId:'durable',label:'Cloud project'}];
  Object.assign(board.tasks[0],{localProjectId:'native-a',projectId:'native-a',projectName:'Project A'});return board;
}

test('card menus navigate with the keyboard, dismiss safely and defer polling until closed',async()=>{
  const h=harness(projectFixture());new Script("nativeToken='csrf'").runInContext(h.context);h.api.applyNativeBoard(projectFixture());
  const panel=h.nodes.get('task-menu'),trigger=h.nodes.get('board').querySelectorAll('.card-details')[0];
  click(trigger);assert.equal(trigger.attributes['aria-expanded'],'true');
  assert.deepEqual(panel.querySelectorAll('.task-menu-item').map(n=>n.querySelector('.menu-label').textContent),['Pin','Project','Section','Rename','View details','Archive']);
  const key=value=>h.events.keydown({key:value,target:h.context.document.activeElement,preventDefault(){},stopPropagation(){}});
  assert.equal(h.context.document.activeElement,menuItem(h,'Pin'));
  key('ArrowDown');assert.equal(h.context.document.activeElement,menuItem(h,'Project'));
  key('ArrowRight');assert.equal(h.nodes.get('task-submenu').attributes['aria-label'],'Choose project: Local fixture');
  assert(!menuItem(h,'Cloud project'));assert.equal(menuItem(h,'Project A').attributes['aria-checked'],'true');
  key('End');assert.equal(h.context.document.activeElement,menuItem(h,'Remove from Project A'));
  key('Home');assert.equal(h.context.document.activeElement,menuItem(h,'Project A'));
  key('ArrowLeft');assert(h.nodes.get('task-submenu').hidden);assert.equal(h.context.document.activeElement,menuItem(h,'Project'));
  h.context.location.protocol='http:';let reads=0;h.context.fetchImpl=async()=>{reads++;return {ok:true,json:async()=>({board:projectFixture(),csrf:'csrf'})};};
  await h.api.refreshNativeBoard();assert.equal(reads,0);
  h.intervals[0]();assert(!panel.hidden);assert.equal(reads,0);
  key('Escape');assert(panel.hidden);assert.equal(trigger.attributes['aria-expanded'],'false');assert.equal(h.context.document.activeElement,trigger);
  click(trigger);h.events.click({target:h.nodes.get('search')});assert(panel.hidden);
  click(trigger);h.events.scroll({target:panel});assert(!panel.hidden);
  h.events.scroll({target:h.nodes.get('board')});assert(panel.hidden);
  click(trigger);const focused=h.context.document.activeElement;h.events.resize();assert(!panel.hidden);assert.equal(h.context.document.activeElement,focused);
  key('Tab');assert(panel.hidden);assert.equal(h.context.document.activeElement,trigger);
  click(trigger);click(trigger);assert(panel.hidden);
  click(trigger);h.api.setView('list');assert(panel.hidden);
});

test('hover switches flyouts without stealing focus or writing, and pointer transitions keep the submenu open',()=>{
  const h=harness(projectFixture());new Script("nativeToken='csrf'").runInContext(h.context);h.api.applyNativeBoard(projectFixture());
  click(h.nodes.get('board').querySelectorAll('.card-details')[0]);
  const focus=h.context.document.activeElement,parent=h.nodes.get('task-menu'),child=h.nodes.get('task-submenu');
  menuItem(h,'Project').onmouseenter();assert(!child.hidden);assert(menuItem(h,'Remove from Project A'));assert(menuItem(h,'Project A'));
  assert.equal(menuItem(h,'Project').querySelector('use').attributes.href,'#i-folder-move');
  assert.equal(menuItem(h,'Remove from Project A').querySelector('use').attributes.href,'#i-folder-remove');
  assert.equal(child.querySelectorAll('.task-menu-item').at(-1),menuItem(h,'Remove from Project A'));
  assert.equal(h.context.document.activeElement,focus);assert.equal(menuItem(h,'Project').attributes['aria-expanded'],'true');
  parent.onmouseleave();child.onmouseenter();assert(!child.hidden);
  menuItem(h,'Section').onmouseenter();assert(!menuItem(h,'Project A'));assert(menuItem(h,'Ungrouped'));
  assert.equal(menuItem(h,'Project').attributes['aria-expanded'],'false');assert.equal(menuItem(h,'Section').attributes['aria-expanded'],'true');
  h.events.click({target:menuItem(h,'Ungrouped')});h.events.scroll({target:child});assert(!parent.hidden);assert(!child.hidden);
  menuItem(h,'View details').onmouseenter();assert(child.hidden);
  menuItem(h,'Project').onmouseenter();h.events.click({target:h.nodes.get('search')});assert(parent.hidden);assert(child.hidden);
});

test('flyouts flip to the left, clamp vertically, and provide a Back action on narrow screens',()=>{
  const h=harness(projectFixture());new Script("nativeToken='csrf'").runInContext(h.context);h.api.applyNativeBoard(projectFixture());
  Object.assign(h.context.window,{innerWidth:1024,innerHeight:768});
  const parent=h.nodes.get('task-menu'),child=h.nodes.get('task-submenu');
  parent.getBoundingClientRect=()=>({left:772,right:1012,width:240,height:200});child.getBoundingClientRect=()=>({width:240,height:300});
  click(h.nodes.get('board').querySelectorAll('.card-details')[0]);
  const project=menuItem(h,'Project');project.getBoundingClientRect=()=>({top:700});project.onmouseenter();
  assert.equal(child.style.left,'532px');assert.equal(child.style.top,'456px');
  h.context.window.innerWidth=390;h.events.resize();assert(menuItem(h,'Back'));
  h.context.window.innerWidth=1024;h.events.resize();assert(!menuItem(h,'Back'));
  h.context.window.innerWidth=390;menuItem(h,'Section').onmouseenter();assert(menuItem(h,'Back'));assert.equal(child.style.left,'138px');
  click(menuItem(h,'Back'));assert(child.hidden);assert.equal(h.context.document.activeElement,menuItem(h,'Section'));
});

test('Remove from the current project clears the assignment in place, survives updates and is also available in details',async()=>{
  const board=projectFixture(),h=harness(board);new Script("nativeToken='csrf'").runInContext(h.context);h.api.applyNativeBoard(board);
  const next=structuredClone(board);Object.assign(next.tasks[0],{localProjectId:null,projectId:null,projectName:null});
  let writes=0;h.context.fetchImpl=async(url,request)=>{writes++;assert.equal(url,'/api/project');assert.deepEqual(JSON.parse(request.body),{threadId:localId,hostId:'local',projectId:null,expectedProjectId:'native-a'});return {ok:true,json:async()=>({threadId:localId,projectId:null,changed:true,board:next})};};
  click(h.nodes.get('board').querySelectorAll('.card-details')[0]);menuItem(h,'Project').onmouseenter();click(menuItem(h,'Remove from Project A'));
  for(let i=0;i<10;i++)await Promise.resolve();
  assert.equal(writes,1);assert(h.nodes.get('task-menu').hidden);assert(h.nodes.get('task-submenu').hidden);assert(!h.nodes.get('detail').open);
  assert.equal(h.nodes.get('task-toast').textContent,'Project removed and verified.');h.api.applyNativeBoard(next);
  assert.doesNotMatch(nodeText(h.nodes.get('board')),/Set project|Project A/);
  const unset=h.nodes.get('board').querySelectorAll('.project')[0];assert(unset.classList.contains('project-unassigned'));assert.equal(nodeText(unset).trim(),'');assert.match(unset.attributes['aria-label'],/Set project/);
  click(h.nodes.get('board').querySelectorAll('.project')[0]);assert(!menuItem(h,'Remove from Project A'));assert(!menuItem(h,'No project'));
  h.api.showDetail(next.tasks[0]);const picker=h.nodes.get('detail-project');assert.equal(picker.value,'');assert.equal(picker.children[0].textContent,'No project');assert(!picker.children[0].disabled);
  h.api.applyNativeBoard(board);h.api.showDetail(board.tasks[0]);assert.equal(picker.children[0].textContent,'Remove from Project A');picker.value='';await picker.onchange();assert.equal(writes,2);assert.equal(picker.value,'');
});

test('in-place project choices share verified saving without opening details',async()=>{
  const board=projectFixture(),h=harness(board);new Script("nativeToken='csrf'").runInContext(h.context);h.api.applyNativeBoard(board);
  const next=structuredClone(board);Object.assign(next.tasks[0],{localProjectId:'native-b',projectId:'native-b',projectName:'Project B'});
  let writes=0;h.context.fetchImpl=async(url,request)=>{
    assert.equal(url,'/api/project');writes++;
    assert.deepEqual(JSON.parse(request.body),{threadId:localId,hostId:'local',projectId:'native-b',expectedProjectId:'native-a'});
    return {ok:true,json:async()=>({threadId:localId,projectId:'native-b',changed:true,board:next})};
  };
  click(h.nodes.get('board').querySelectorAll('.project')[0]);
  click(menuItem(h,'Project B'));assert(h.nodes.get('task-menu').hidden);
  // The event deliberately starts an async action; wait for its pending state to clear.
  for(let i=0;i<10;i++)await Promise.resolve();
  assert.equal(writes,1);assert(!h.nodes.get('detail').open);assert.match(nodeText(h.nodes.get('board')),/Project B/);
  assert.equal(h.nodes.get('task-toast').textContent,'Project saved and verified.');
});

test('menus clamp to the viewport and open above a bottom-edge trigger',()=>{
  const h=harness(),trigger=h.nodes.get('board').querySelectorAll('.card-details')[0],panel=h.nodes.get('task-menu');
  Object.assign(h.context.window,{innerWidth:1024,innerHeight:768});
  trigger.getBoundingClientRect=()=>({right:1020,top:700,bottom:720});panel.getBoundingClientRect=()=>({width:240,height:204});
  click(trigger);assert.equal(panel.style.left,'772px');assert.equal(panel.style.top,'490px');
  trigger.getBoundingClientRect=()=>({right:20,top:40,bottom:60});
  h.events.resize();assert.equal(panel.style.left,'12px');assert.equal(panel.style.top,'66px');assert(!panel.hidden);
});

test('section and native actions dispatch from menus, while cloud controls explain their limits',()=>{
  const h=harness(projectFixture());new Script("nativeToken='csrf'").runInContext(h.context);h.api.applyNativeBoard(projectFixture());
  h.context.actionCalls=[];
  new Script("moveNative=(task,section)=>actionCalls.push(['section',task.id,section]);setTaskPinned=task=>actionCalls.push(['pin',task.id]);archiveTask=task=>actionCalls.push(['archive',task.id]);").runInContext(h.context);
  const triggers=h.nodes.get('board').querySelectorAll('.card-details'),panel=h.nodes.get('task-menu');
  click(triggers[0]);click(menuItem(h,'Section'));
  assert.equal(menuItem(h,'For Review').attributes['aria-checked'],'true');click(menuItem(h,'Ungrouped'));
  for(const action of ['Pin','Archive']){click(triggers[0]);click(menuItem(h,action));assert(panel.hidden);}
  assert.deepEqual(JSON.parse(JSON.stringify(h.context.actionCalls)),[['section',localId,null],['pin',localId],['archive',localId]]);
  click(triggers[1]);assert(!menuItem(h,'Pin'));assert(!menuItem(h,'Archive'));
  for(const action of ['Project','Section']){assert(menuItem(h,action).disabled);assert.match(menuItem(h,action).title,/local tasks only/);}
  click(menuItem(h,'View details'));assert(h.nodes.get('detail').open);assert.equal(h.nodes.get('detail-title').textContent,'Cloud fixture');
});

test('clearing filters restores all tasks without changing sort, layout or saved orders',()=>{
  const h=harness(),before=new Map(h.storage);
  h.api.setView('list');h.api.setFilter('unread');
  h.nodes.get('host').value='durable';h.nodes.get('search').value='missing';h.nodes.get('search').listeners.input();
  assert(!h.nodes.get('clear-filters').hidden);
  assert.equal(h.nodes.get('visible-count').textContent,'0 / 2 tasks');
  const empty=h.nodes.get('board').querySelectorAll('.board-empty')[0];
  empty.querySelector('button').onclick();
  assert.equal(h.nodes.get('search').value,'');assert.equal(h.nodes.get('host').value,'all');
  assert.equal(h.nodes.get('visible-count').textContent,'2 tasks');assert(h.nodes.get('clear-filters').hidden);
  assert(h.nodes.get('board').classList.contains('list'));
  assert.deepEqual(h.storage,before);assert.equal(h.context.document.activeElement,h.nodes.get('search'));
  h.nodes.get('search').value='fixture';h.nodes.get('search').listeners.input();h.nodes.get('clear-filters').onclick();
  assert(h.nodes.get('clear-filters').hidden);
});

test('column scroll positions survive polling, list switches and collapsed refreshes independently',()=>{
  const h=harness(),root=h.nodes.get('board');
  const section=id=>root.querySelectorAll('.column').find(n=>n.dataset.groupId===id);
  const cards=id=>section(id).querySelector('.cards');
  cards('review').scrollTop=240;cards('chats').scrollTop=80;
  h.api.applyNativeBoard(fixture());assert.equal(cards('review').scrollTop,240);assert.equal(cards('chats').scrollTop,80);
  h.api.setView('list');cards('review').scrollTop=0;h.api.setView('board');
  assert.equal(cards('review').scrollTop,240);assert.equal(cards('chats').scrollTop,80);
  section('review').querySelector('.col-head').onclick();cards('review').scrollTop=0;
  h.api.applyNativeBoard(fixture());section('review').querySelector('.col-head').onclick();
  assert.equal(cards('review').scrollTop,240);assert.equal(cards('chats').scrollTop,80);
});

test('a pending polling response preserves new card interactions and keeps open details current',async()=>{
  for(const interaction of ['focused-card','detail','menu']){
    const h=harness(),root=h.nodes.get('board');let resolveResponse;
    h.context.location.protocol='http:';
    h.context.fetchImpl=()=>new Promise(resolve=>resolveResponse=resolve);
    const reading=h.api.refreshNativeBoard(),original=root.children[0];
    if(interaction==='focused-card')root.querySelectorAll('.card-details')[0].focus();
    else if(interaction==='menu')root.querySelectorAll('.card-details')[0].onclick({stopPropagation(){}});
    else h.api.showDetail(fixture().tasks[0]);
    const next=fixture();next.tasks[0].title='Updated local fixture';
    resolveResponse({ok:true,json:async()=>({board:next,csrf:'fixture-token'})});
    await reading;
    if(interaction==='detail'||interaction==='focused-card'){
      assert.notEqual(root.children[0],original);
      if(interaction==='focused-card'){assert.equal(h.context.document.activeElement,root.querySelectorAll('.card-details')[0]);continue;}
      assert.notEqual(root.children[0],original);assert(h.nodes.get('detail').open);
      assert.equal(h.nodes.get('detail-title').textContent,'Updated local fixture');
    }else{assert.equal(root.children[0],original);if(interaction==='menu')assert(!h.nodes.get('task-menu').hidden);}
  }
});

test('task dragging expands group hit areas and cancellation restores compact columns without a write',()=>{
  const h=harness(),board=h.nodes.get('board');
  new Script("nativeToken='csrf'").runInContext(h.context);h.api.applyNativeBoard(fixture());
  const card=board.querySelectorAll('.card')[0],target=board.children.find(node=>node.dataset.groupId==='pin');
  const transfer={setData(type,value){this.type=type;this.value=value;}};
  let prevented=false;
  const event={target:card,dataTransfer:transfer,preventDefault(){prevented=true;},stopPropagation(){}};
  assert(!board.classList.contains('task-dragging'));
  card.listeners.dragstart(event);
  assert(board.classList.contains('task-dragging'));assert.equal(transfer.value,'local:'+localId);
  target.listeners.dragover(event);
  assert(prevented);assert(target.classList.contains('drop-target'));assert.equal(transfer.dropEffect,'move');
  h.api.render();assert(board.classList.contains('task-dragging'));
  card.listeners.dragend();assert(!board.classList.contains('task-dragging'));
  assert.equal(new Script('draggedKey').runInContext(h.context),null);
  h.api.render();assert(!board.classList.contains('task-dragging'));
  new Script('nativePending=true').runInContext(h.context);
  prevented=false;board.querySelectorAll('.card')[0].listeners.dragstart(event);
  assert(prevented);assert(!board.classList.contains('task-dragging'));
});
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
  h.nodes.get('search').value='';h.api.setFilter('unread');
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

test('project labels have folder icons and open the picker; verified changes survive polling and failed changes revert',async()=>{
  const board=fixture();board.sync.projectLocal=true;board.projects=[{projectId:'native-a',desktopProjectId:'desktop-a',hostId:'local',label:'Project A'},
    {projectId:'native-b',hostId:'local',label:'Project B'},{projectId:'remote',hostId:'durable',label:'Cloud project'}];
  Object.assign(board.tasks[0],{projectId:'desktop-a',projectName:'Project A',localProjectId:null});
  const h=harness(board);new Script("nativeToken='csrf'").runInContext(h.context);h.api.applyNativeBoard(board);
  const label=h.nodes.get('board').querySelectorAll('.project')[0];
  assert.equal(label.tag,'button');assert.equal(label.querySelector('use').attributes.href,'#i-folder');
  label.onclick({stopPropagation(){}});assert(!h.nodes.get('detail').open);assert(!h.nodes.get('task-menu').hidden);
  assert.equal(menuItem(h,'Project A').attributes['aria-checked'],'true');
  h.api.showDetail(board.tasks[0]);
  const picker=h.nodes.get('detail-project');assert(!picker.disabled);assert.equal(picker.value,'native-a');
  assert(!picker.children.some(n=>n.value==='remote'));
  const options=picker.children;h.api.applyNativeBoard(board);assert.equal(picker.children,options);
  let resolve;h.context.fetchImpl=async(url,request)=>{assert.equal(url,'/api/project');assert.deepEqual(JSON.parse(request.body),{threadId:localId,hostId:'local',projectId:'native-b',expectedProjectId:null});return new Promise(r=>resolve=r);};
  picker.value='native-b';const saving=picker.onchange();assert(picker.disabled);
  await picker.onchange(); // A disabled/pending edit cannot dispatch another write.
  const next=structuredClone(board);Object.assign(next.tasks[0],{localProjectId:'native-b',projectId:'native-b',projectName:'Project B'});
  resolve({ok:true,json:async()=>({threadId:localId,projectId:'native-b',changed:true,board:next})});await saving;
  assert.equal(picker.value,'native-b');assert(!picker.disabled);assert.match(h.nodes.get('project-edit-hint').textContent,/saved and verified/);
  h.api.applyNativeBoard(next);assert.equal(picker.value,'native-b');assert.match(nodeText(h.nodes.get('board')),/Project B/);
  h.context.fetchImpl=async()=>({ok:false,json:async()=>({error:'Project changed elsewhere'})});picker.value='native-a';await picker.onchange();
  assert.equal(picker.value,'native-b');assert.match(h.nodes.get('project-edit-hint').textContent,/changed elsewhere/);
  h.api.showDetail(board.tasks[1]);assert(picker.disabled);assert.match(h.nodes.get('project-edit-hint').textContent,/local tasks only/);
  const unassigned=fixture();unassigned.sync.projectLocal=true;unassigned.projects=board.projects;h.api.applyNativeBoard(unassigned);
  const set=h.nodes.get('board').querySelectorAll('.project')[0];assert.match(set.attributes['aria-label'],/Set project/);
  h.nodes.get('detail').close();set.onclick({stopPropagation(){}});assert(!h.nodes.get('detail').open);
  assert(!h.nodes.get('task-menu').hidden);assert(!menuItem(h,'Project A').attributes['aria-checked'].includes('true'));
});

test('direct task actions preserve native pin semantics, host icons, footer projects and details',()=>{
  const h=harness();new Script("nativeToken='csrf'").runInContext(h.context);h.api.applyNativeBoard(fixture());
  const root=h.nodes.get('board'),cards=root.querySelectorAll('.card'),local=cards.find(n=>n.dataset.taskKey==='local:'+localId),remote=cards.find(n=>n.dataset.taskKey==='durable:remote');
  const buttons=local.querySelector('.card-actions').children;
  assert(buttons.some(n=>n.attributes['aria-label']==='Pin task: Local fixture'));
  assert(buttons.some(n=>n.attributes['aria-label']==='Archive task: Local fixture'));
  assert(buttons.every(n=>n.children.length===1));assert.equal(root.querySelectorAll('.card-menu').length,0);
  assert.equal(remote.querySelector('.card-actions').children[0].tag,'span');
  assert.equal(remote.querySelector('.card-actions').children[0].attributes['data-pinned'],'true');
  assert.equal(local.querySelectorAll('.host').length,0);assert.equal(remote.querySelector('.host').attributes['aria-label'],'Cloud');
  assert.equal(remote.querySelector('.host').querySelector('use').attributes.href,'#i-cloud');
  h.context.actionCalls=[];
  new Script("setTaskPinned=task=>actionCalls.push(['pin',task.id]);archiveTask=task=>actionCalls.push(['archive',task.id]);").runInContext(h.context);
  for(const label of ['Pin task: Local fixture','Archive task: Local fixture']){
    buttons.find(n=>n.attributes['aria-label']===label).onclick({stopPropagation(){}});
  }
  assert.deepEqual(JSON.parse(JSON.stringify(h.context.actionCalls)),[['pin',localId],['archive',localId]]);
  local.querySelector('.card-details').onclick({stopPropagation(){}});
  menuItem(h,'View details').onclick({stopPropagation(){}});
  assert(h.nodes.get('detail').open);assert.equal(h.nodes.get('detail-title').textContent,'Local fixture');
  for(const nativeTaskPinned of [true,false]){
    const board=fixture();Object.assign(board.tasks[0],{pinned:true,nativeTaskPinned,projectName:'Example project'});h.api.applyNativeBoard(board);
    const card=root.querySelectorAll('.card').find(n=>n.dataset.taskKey==='local:'+localId),pin=card.querySelectorAll('.card-pin')[0];
    assert.equal(pin.attributes['data-pinned'],'true');assert.equal(pin.attributes['aria-pressed'],String(nativeTaskPinned));
    assert.equal(pin.attributes['aria-label'],(nativeTaskPinned?'Unpin':'Pin')+' task: Local fixture');
    assert.equal(card.querySelector('.project-line').parentElement,card.querySelector('.card-footer'));
    assert.equal(nodeText(card.querySelector('.project-line')).trim(),'Example project');
  }
  new Script("pinningKey='local:'+DATA.tasks[0].id").runInContext(h.context);h.api.render();
  assert(root.querySelectorAll('.card-actions').flatMap(n=>n.children).filter(n=>n.tag==='button').every(n=>n.disabled));
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
  assert.equal(root.querySelectorAll('.card-details').length,2);
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
  assert.equal(root.querySelectorAll('.card-details').length,2);
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

test('Clear filters resets search, host and unread without changing layout and sort',()=>{
  const h=harness(),host=h.nodes.get('host'),search=h.nodes.get('search');
  h.api.setView('list');h.api.setFilter('unread');host.value='durable';search.value='missing';search.listeners.input();
  assert(!h.nodes.get('clear-filters').hidden);h.nodes.get('board').children[0].querySelector('button').onclick();
  assert.equal(host.value,'all');assert.equal(search.value,'');assert.equal(h.nodes.get('unread-only').attributes['aria-pressed'],'false');
  assert(h.nodes.get('board').classList.contains('list'));assert(h.nodes.get('clear-filters').hidden);
  search.value='fixture';search.listeners.input();h.nodes.get('clear-filters').onclick();assert.equal(search.value,'');
});


test('verified project-inherited tasks can change group while preserving project details',()=>{
  const board=fixture(),task=board.tasks[0];
  Object.assign(task,{placementSource:'desktopProject',localSectionId:null,projectId:'fixture-project',projectName:'Tools'});
  const h=harness(board);new Script("nativeToken='csrf'").runInContext(h.context);h.api.applyNativeBoard(board);
  h.api.showDetail(task);
  assert(h.api.nativeCanEditGroup(task));assert(!h.nodes.get('detail-native').disabled);
  assert.match(h.nodes.get('native-edit-hint').textContent,/this task only; its project stays in place/);
  assert.equal(h.nodes.get('detail-project').children[0].textContent,'Remove from Tools');
  const disconnected={...board,sync:{...board.sync,moveWritable:false,pinLocal:false}};
  h.api.applyNativeBoard(disconnected);
  assert(h.nodes.get('detail-native').disabled);
  assert.match(h.nodes.get('native-edit-hint').textContent,/updated Kanban launcher/);
  assert(!h.nodes.get('board').querySelectorAll('.card-pin').some(n=>n.tag==='button'));
});
