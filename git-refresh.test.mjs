import test from 'node:test';
import assert from 'node:assert/strict';
import {createKanbanServer} from './serve.mjs';
import {createKanbanService} from './kanban-service.mjs';
import {harness,fixture} from './ui-test-helpers.mjs';

test('HTTP manual Git refresh preserves origin guards and rejects unrelated queries',async()=>{
  const calls=[],server=createKanbanServer({port:0,getBoard:async options=>{calls.push(options);return fixture();},settingsStore:{read:async()=>({})}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url='http://127.0.0.1:'+server.address().port;
  try{
    for(const path of ['/api/board','/api/board?forceGit=1','/api/board'])assert.equal((await fetch(url+path)).status,200);
    assert.deepEqual(calls,[{forceGit:false},{forceGit:true},{forceGit:false}]);
    for(const path of ['/api/board?forceGit=0','/api/board?forceGit=1&extra=1'])assert.equal((await fetch(url+path)).status,404);
    assert.equal((await fetch(url+'/api/board?forceGit=1',{headers:{Origin:'https://evil.example'}})).status,403);
    assert.equal(calls.length,3);
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('manual reads do not force Git during action preflight or verified write readback',async()=>{
  const calls=[],service=createKanbanService({getBoard:async options=>{calls.push(options);return fixture();},settingsStore:{read:async()=>({})},
    renameTask:async params=>({threadId:params.threadId,title:params.title,changed:true})});
  try{
    await service.read({forceGit:true});
    await service.action('rename',{threadId:fixture().tasks[0].id,hostId:'local',title:'Changed',expectedTitle:'Local fixture'});
    assert.deepEqual(calls,[{forceGit:true},undefined,{forceGit:false}]);
  }finally{await service.close();}
});

test('manual Git refresh retains verified archive and Undo state while the reader lags',async()=>{
  const board=fixture(),task=board.tasks.find(t=>t.hostId==='local'),calls=[];let visible=true;
  const service=createKanbanService({getBoard:async options=>{calls.push(options);return {...board,tasks:visible?board.tasks:board.tasks.filter(t=>t!==task)};},
    archiveTask:async()=>({threadId:task.id,archived:true}),restoreTask:async()=>({threadId:task.id,restored:true}),settingsStore:{read:async()=>({})}});
  try{
    const archived=await service.action('archive',{threadId:task.id,hostId:'local'});
    assert(!(await service.read({forceGit:true})).board.tasks.some(t=>t.id===task.id&&t.hostId==='local'));
    assert.deepEqual(calls.at(-1),{forceGit:true});
    visible=false;await service.read();
    await service.action('unarchive',{undoToken:archived.undoToken});
    const refreshed=await service.read({forceGit:true});
    assert.deepEqual(refreshed.board.tasks.find(t=>t.id===task.id&&t.hostId==='local'),task);
    assert.deepEqual(calls.at(-1),{forceGit:true});
  }finally{await service.close();}
});

test('only the explicit UI refresh forces Git; polls, focus and action recovery keep normal reads',async()=>{
  const h=harness(),urls=[];h.context.location.protocol='http:';
  h.context.fetchImpl=async url=>{urls.push(url);return {ok:true,json:async()=>({csrf:'token',board:fixture()})};};
  await h.api.refreshNativeBoard();
  await h.nodes.get('refresh-board').onclick();
  await h.api.refreshNativeBoard(true);
  await h.events.focus();
  h.context.document.hidden=true;h.events.visibilitychange();
  assert.equal(urls.length,4);
  h.context.document.hidden=false;h.events.visibilitychange();await new Promise(resolve=>setImmediate(resolve));
  await h.intervals[0]();await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(urls,['/api/board','/api/board?forceGit=1','/api/board','/api/board','/api/board','/api/board']);
  assert.equal(h.intervals[0].delay,3000);
});

test('manual refresh prevents repeated requests and preserves open drafts',async()=>{
  const h=harness();h.context.location.protocol='http:';let release,reads=0;
  h.context.fetchImpl=async()=>{reads++;await new Promise(resolve=>release=resolve);return {ok:true,json:async()=>({csrf:'token',board:fixture()})};};
  const button=h.nodes.get('refresh-board'),reading=button.onclick();
  assert(button.disabled);assert.equal(button.attributes['aria-busy'],'true');await button.onclick();assert.equal(reads,1);
  release();await reading;assert(!button.disabled);assert.equal(button.attributes['aria-busy'],'false');
  for(const id of ['creation','rename-task']){
    const dialog=h.nodes.get(id);dialog.open=true;
    await button.onclick();assert.equal(reads,1);assert(dialog.open);dialog.open=false;
  }
});

test('a Refresh press survives iframe focus and cancellation restores normal polling',async()=>{
  const h=harness(),urls=[];h.context.location.protocol='http:';
  h.context.fetchImpl=async url=>{urls.push(url);return {ok:true,json:async()=>({csrf:'token',board:fixture()})};};
  const button=h.nodes.get('refresh-board');
  button.onpointerdown({button:0});await h.events.focus();await h.api.refreshNativeBoard();
  assert.deepEqual(urls,[]);assert(!button.disabled);
  await button.onclick();assert.deepEqual(urls,['/api/board?forceGit=1']);
  h.events.pointercancel();await h.events.focus();assert.equal(urls.at(-1),'/api/board');
  button.onpointerdown({button:0});h.events.blur();await h.api.refreshNativeBoard();assert.equal(urls.length,3);
  button.onpointerdown({button:0});button.onpointerleave();await h.api.refreshNativeBoard();assert.equal(urls.length,4);
});
