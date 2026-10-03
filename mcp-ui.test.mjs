import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Script,createContext} from 'node:vm';
import {App} from '@modelcontextprotocol/ext-apps';
import {AppBridge} from '@modelcontextprotocol/ext-apps/app-bridge';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {createMcpFetch} from './mcp-ui-transport.mjs';

test('MCP transport forwards project assignment and removal with the current app token',async()=>{
  const calls=[],fetch=createMcpFetch({callServerTool:async params=>{calls.push(params);return {structuredContent:{projectId:params.arguments.projectId},content:[]};}},Promise.resolve());
  for(const projectId of ['native-project',null]){
    const response=await fetch('/api/project',{method:'POST',headers:{'X-Kanban-Token':'token'},body:JSON.stringify({threadId:'fixture',hostId:'local',projectId,expectedProjectId:null})});
    assert(response.ok);assert.equal((await response.json()).projectId,projectId);
  }
  assert(calls.every(call=>call.name==='set_project'&&call.arguments.actionToken==='token'));
  assert.equal(calls.length,2);
});

test('real SDK handshake completes before app tools, including app error responses',async()=>{
  const app=new App({name:'kanban-fixture',version:'1'},{},{autoResize:false});
  const bridge=new AppBridge(null,{name:'fixture-host',version:'1'},{serverTools:{}},{hostContext:{displayMode:'fullscreen'}});
  let initialized=false,calls=0;
  bridge.oninitialized=()=>initialized=true;
  bridge.oncalltool=async params=>{
    assert(initialized);calls++;
    if(params.name==='get_board')return {content:[],structuredContent:{board:{tasks:[]},csrf:'fixture-token'}};
    assert.equal(params.arguments.actionToken,'fixture-token');
    return {content:[],isError:true,structuredContent:{error:'Conflict',status:409}};
  };
  const [host,ui]=InMemoryTransport.createLinkedPair();await bridge.connect(host);
  const fetch=createMcpFetch(app,app.connect(ui));
  try{
    assert.equal((await fetch('/api/board')).ok,true);
    const response=await fetch('/api/archive',{method:'POST',headers:{'X-Kanban-Token':'fixture-token'},body:JSON.stringify({threadId:'fixture',hostId:'local'})});
    assert.equal(response.ok,false);assert.equal(response.status,409);assert.equal((await response.json()).error,'Conflict');
    await assert.rejects(fetch('https://external.example/api'));assert.equal(calls,2);
  }finally{await app.close();await bridge.close();}
});
test('bridge waits for initialization, propagates failed handshake and rejects malformed results',async()=>{
  let connect,calls=0,options;
  const ready=new Promise(resolve=>connect=resolve);
  const fetch=createMcpFetch({async callServerTool(_,opts){calls++;options=opts;return {content:[]};}},ready);
  const request=fetch('/api/board');await Promise.resolve();assert.equal(calls,0);connect();
  await assert.rejects(request,/Incomplete/);assert.equal(options.timeout,60000);
  const failed=createMcpFetch({callServerTool(){throw Error('Must not call');}},Promise.reject(Error('Handshake failed')));
  await assert.rejects(failed('/api/board'),/Handshake failed/);
  const write=createMcpFetch({async callServerTool(_,opts){assert.equal(opts.timeout,180000);return {structuredContent:{archived:true},content:[]};}},Promise.resolve());
  assert.equal((await write('/api/archive',{method:'POST',headers:{'X-Kanban-Token':'token'},body:'{}'})).ok,true);
});
test('native host appearance arrives after initialization and stays current through SDK notifications',async()=>{
  const app=new App({name:'theme-fixture',version:'1'},{},{autoResize:false});
  const bridge=new AppBridge(null,{name:'theme-host',version:'1'},{serverTools:{}},{hostContext:{theme:'light'}});
  const [host,ui]=InMemoryTransport.createLinkedPair();await bridge.connect(host);
  const events=[],code=await readFile(new URL('./mcp-ui.mjs',import.meta.url),'utf8');
  const syncCode=code.slice(code.indexOf('function syncHostTheme'),code.indexOf('app.onteardown'));
  let release;const changed=new Promise(resolve=>release=resolve);
  const ready=app.connect(ui);
  const context=createContext({app,ready,CustomEvent:class{constructor(type,{detail}){this.type=type;this.detail=detail;}},
    window:{dispatchEvent(event){assert.equal(event.type,'kanban-host-theme');events.push(event.detail);if(event.detail==='dark')release();}}});
  new Script(syncCode).runInContext(context);
  try{
    await ready;await Promise.resolve();assert.deepEqual(events,['light']);
    await bridge.sendHostContextChange({theme:'dark'});await changed;assert.deepEqual(events,['light','dark']);
  }finally{await app.close();await bridge.close();}
});
test('MCP UI can refresh on sandbox protocols and recover Undo without reloading',async()=>{
  const html=await readFile(new URL('./ui.html',import.meta.url),'utf8');
  const code=html.match(/async function refreshNativeBoard[\s\S]*?(?=async function moveNative)/)[0];
  let applied=0,recovered=0;
  const context=createContext({kanbanTransport:{},location:{protocol:'about:'},taskActionPending:()=>false,
    nativeReads:0,nativeEpoch:0,nativePending:false,taskMenu:null,draggedKey:null,draggedGroup:null,
    document:{hidden:false,activeElement:null,getElementById:()=>({open:false})},nativeToken:null,
    fetch:async()=>({ok:true,json:async()=>({csrf:'token',board:{tasks:[]},undoArchives:[{undoToken:'recover'}]})}),
    applyNativeBoard:()=>applied++,syncArchiveNotices:entries=>recovered+=entries.length,render(){}});
  const refresh=new Script(code+'\nrefreshNativeBoard').runInContext(context);await refresh();
  assert.equal(applied,1);assert.equal(recovered,1);assert.equal(context.nativeToken,'token');
  assert(html.includes("if(!globalThis.kanbanTransport&&!['http:','https:'].includes(location.protocol))"));
});
test('MCP chat and PR navigation uses the host and reports rejected links in the current toast',async()=>{
  const code=await readFile(new URL('./mcp-ui.mjs',import.meta.url),'utf8');
  const handlerCode=code.slice(code.indexOf("document.addEventListener('click'"),code.indexOf("window.addEventListener('pagehide'"));
  let handler;const toast={hidden:true,textContent:''},links=[];
  const context=createContext({ready:Promise.resolve(),app:{async openLink(params){links.push(params.url);return {isError:true};}},
    document:{addEventListener(_event,callback){handler=callback;},getElementById(id){assert.equal(id,'task-toast');return toast;}}});
  new Script(handlerCode).runInContext(context);
  for(const href of ['codex://threads/fixture','https://github.com/example/repo/pull/1']){
    let prevented=false;
    await handler({target:{closest(selector){assert(selector.includes('https://'));return {href};}},preventDefault(){prevented=true;}});
    assert(prevented);assert.equal(toast.hidden,false);assert(toast.textContent.includes('unavailable'));
  }
  assert.equal(links.length,2);
});
