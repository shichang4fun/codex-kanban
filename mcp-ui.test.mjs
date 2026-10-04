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
    document:{hidden:false,activeElement:null,getElementById:()=>({open:false})},$:()=>({open:false}),nativeToken:null,
    fetch:async()=>({ok:true,json:async()=>({csrf:'token',board:{tasks:[]},undoArchives:[{undoToken:'recover'}]})}),
    applyNativeBoard:()=>applied++,syncArchiveNotices:entries=>recovered+=entries.length,render(){}});
  const refresh=new Script(code+'\nrefreshNativeBoard').runInContext(context);await refresh();
  assert.equal(applied,1);assert.equal(recovered,1);assert.equal(context.nativeToken,'token');
});
async function navigationHarness(app,ready=Promise.resolve()){
  const code=await readFile(new URL('./mcp-ui.mjs',import.meta.url),'utf8');
  const events={},toast={hidden:true,textContent:''},timers=new Map();let timerId=0;
  const runtimeApp={connect:()=>ready,getHostContext:()=>app.getHostContext?.()??{},openLink:params=>app.openLink(params),close:()=>app.close?.()};
  const context=createContext({App:class{constructor(){return runtimeApp;}},createMcpFetch:()=>()=>{},
    setTimeout:callback=>{timers.set(++timerId,callback);return timerId;},clearTimeout:id=>timers.delete(id),
    window:{addEventListener(name,callback){events[name]=callback;},dispatchEvent(){}},
    CustomEvent:class{},document:{addEventListener(name,callback){events[name]=callback;},getElementById(id){assert.equal(id,'task-toast');return toast;}}});
  new Script(code.replace(/^import .*;\n/gm,'')).runInContext(context);
  return {app:runtimeApp,events,toast,context,timers,async connected(){await ready;await Promise.resolve();}};
}
function navigationEvent(href,fields={}){
  const attributes=new Map(),classes=new Set(),card={classList:{add:name=>classes.add(name),remove:name=>classes.delete(name)}};
  const link={href,closest:()=>card,setAttribute:(key,value)=>attributes.set(key,value),removeAttribute:key=>attributes.delete(key)};
  return {button:0,defaultPrevented:false,target:{closest(selector){assert(selector.includes('https://'));assert(selector.includes('codex://new?'));return link;}},
    preventDefault(){this.defaultPrevented=true;},link,classes,attributes,...fields};
}
test('MCP chat and PR navigation uses the host and reports rejected links in the current toast',async()=>{
  const links=[],h=await navigationHarness({async openLink(params){links.push(params.url);return {isError:true};}});
  await h.connected();
  for(const href of ['codex://threads/fixture','https://github.com/example/repo/pull/1','codex://threads/new','codex://new?projectId=desktop-project&prompt=Review']){
    const event=navigationEvent(href);await h.events.click(event);
    assert(event.defaultPrevented);assert.equal(h.toast.hidden,false);assert(h.toast.textContent.includes('unavailable'));
    assert(!event.classes.has('opening'));assert(!event.attributes.has('aria-busy'));assert(!h.context.kanbanTransport.navigationPending);
  }
  assert.equal(links.length,4);
});
test('connected clicks dispatch before queued rendering and coalesce duplicate navigation until acknowledgement',async()=>{
  const order=[];let finish;
  const h=await navigationHarness({openLink({url}){order.push(url);return new Promise(resolve=>finish=resolve);}});await h.connected();
  const event=navigationEvent('codex://threads/fixture');
  queueMicrotask(()=>order.push('background render'));
  const pending=h.events.click(event);
  assert.deepEqual(order,['codex://threads/fixture']);
  assert(event.classes.has('opening'));assert.equal(event.attributes.get('aria-busy'),'true');assert(h.context.kanbanTransport.navigationPending);
  await h.events.click(navigationEvent(event.link.href));assert.equal(order.filter(item=>item===event.link.href).length,1);
  finish({});await pending;
  assert(!h.context.kanbanTransport.navigationPending);assert(!event.classes.has('opening'));assert(!event.attributes.has('aria-busy'));assert(h.toast.hidden);
  const retry=h.events.click(navigationEvent(event.link.href));assert.equal(order.filter(item=>item===event.link.href).length,2);finish({});await retry;
});
test('pointer activation pauses refresh only for links and resets on release, cancellation and blur',async()=>{
  const h=await navigationHarness({});await h.connected();
  for(const end of ['pointerup','pointercancel','blur']){
    h.events.pointerdown(navigationEvent('codex://threads/fixture'));assert(h.context.kanbanTransport.navigationPending);
    h.events[end]();
    if(end==='pointerup'){await Promise.resolve();assert(h.context.kanbanTransport.navigationPending);for(const callback of h.timers.values())callback();}
    assert(!h.context.kanbanTransport.navigationPending);assert.equal(h.timers.size,0);
  }
  h.events.pointerdown(navigationEvent('codex://threads/fixture',{button:2}));assert(!h.context.kanbanTransport.navigationPending);
  h.events.pointerdown({button:0,target:{closest:()=>null}});assert(!h.context.kanbanTransport.navigationPending);
});
test('navigation respects drag cancellation, waits for initialization and releases failures for retry',async()=>{
  let connect,calls=0;const ready=new Promise(resolve=>connect=resolve);
  const h=await navigationHarness({async openLink(){calls++;throw Error('Rejected');}},ready);
  await h.events.click(navigationEvent('codex://threads/fixture',{defaultPrevented:true}));assert.equal(calls,0);
  const pending=h.events.click(navigationEvent('codex://threads/fixture'));assert.equal(calls,0);assert(h.context.kanbanTransport.navigationPending);
  connect();await pending;assert.equal(calls,1);assert(!h.context.kanbanTransport.navigationPending);assert(!h.toast.hidden);
  await h.events.click(navigationEvent('codex://threads/fixture'));assert.equal(calls,2);
  await h.app.onteardown();await h.events.click(navigationEvent('codex://threads/fixture'));assert.equal(calls,2);
});
test('real SDK forwards navigation while a board tool is still waiting on the server',async()=>{
  const app=new App({name:'navigation-fixture',version:'1'},{},{autoResize:false});
  const bridge=new AppBridge(null,{name:'fixture-host',version:'1'},{serverTools:{},openLinks:{}},{hostContext:{}});
  let releaseBoard,started,finishLink;const boardStarted=new Promise(resolve=>started=resolve),linkReceived=new Promise(resolve=>finishLink=resolve),urls=[];
  bridge.oncalltool=()=>{started();return new Promise(resolve=>releaseBoard=()=>resolve({content:[],structuredContent:{board:{tasks:[]},csrf:'token'}}));};
  bridge.onopenlink=async({url})=>{urls.push(url);finishLink();return {};};
  const [host,ui]=InMemoryTransport.createLinkedPair();await bridge.connect(host);
  const ready=app.connect(ui),h=await navigationHarness(app,ready);
  try{
    await h.connected();const reading=createMcpFetch(app,ready)('/api/board');await boardStarted;
    const url='codex://threads/11111111-1111-4111-8111-111111111111';
    const opening=h.events.click(navigationEvent(url));await linkReceived;await opening;
    assert.deepEqual(urls,[url]);assert(!h.context.kanbanTransport.navigationPending);
    releaseBoard();await reading;
  }finally{await app.close();await bridge.close();}
});
