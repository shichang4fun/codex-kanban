import test from 'node:test';
import assert from 'node:assert/strict';
import {Script} from 'node:vm';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {createKanbanService} from './kanban-service.mjs';
import {createKanbanMcp} from './mcp-server.mjs';
import {createMcpFetch} from './mcp-ui-transport.mjs';
import {createKanbanServer} from './serve.mjs';
import {harness,fixture} from './ui-test-helpers.mjs';

function serviceFixture({available=true,enabled=true,reply,dispatch}={}){
  const calls=[],options={getBoard:async()=>fixture(),desktopBridgeSocket:'fixture',settingsStore:{read:async()=>({})},
    bridgeRequest:async(_socket,method,params,_timeout,{signal}={})=>{
      if(method==='status')return {connected:true,autoFlow:{available,enabled,mode:'allowlist'}};
      assert.equal(method,'flowSettings');assert(!signal?.aborted);calls.push(params);
      if(dispatch)return dispatch(params);
      enabled=params.enabled;return reply??{autoFlow:{available:true,enabled,mode:'allowlist'}};
    }};
  return {calls,options,service:createKanbanService(options)};
}

test('flow settings read and toggle preserve the rule mode and return verified current state',async t=>{
  const f=serviceFixture();t.after(()=>f.service.close());
  assert.deepEqual((await f.service.read()).board.autoFlow,{available:true,enabled:true,mode:'allowlist'});
  const result=await f.service.action('flow-settings',{enabled:false});
  assert.deepEqual(result.autoFlow,{available:true,enabled:false,mode:'allowlist'});
  assert.deepEqual(result.board.autoFlow,result.autoFlow);assert.equal(result.csrf,f.service.csrf);
  assert.deepEqual(f.calls,[{enabled:false}]);
});

test('flow settings reject malformed settings and missing capability without dispatch',async t=>{
  const f=serviceFixture({available:false});t.after(()=>f.service.close());
  for(const params of [null,{},[],{enabled:'true'},{enabled:1},{enabled:true,mode:'all-local'}])
    await assert.rejects(f.service.action('flow-settings',params),error=>error.status===400);
  await assert.rejects(f.service.action('flow-settings',{enabled:true}),error=>error.status===503);
  assert.equal(f.calls.length,0);
  const noBridge=createKanbanService({getBoard:async()=>fixture(),settingsStore:{read:async()=>({})}});t.after(()=>noBridge.close());
  assert.deepEqual((await noBridge.read()).board.autoFlow,{available:false});
  await assert.rejects(noBridge.action('flow-settings',{enabled:false}),error=>error.status===503);
});

test('flow settings require an exact verified response',async t=>{
  for(const reply of [{},{autoFlow:{available:true,enabled:true,mode:'allowlist'}},{autoFlow:{available:false,enabled:false,mode:'allowlist'}},{autoFlow:{available:true,enabled:false}}]){
    const f=serviceFixture({reply});t.after(()=>f.service.close());
    await assert.rejects(f.service.action('flow-settings',{enabled:false}),error=>error.status===503&&/verified/.test(error.message));
  }
});

test('flow setting writes share the action lock and honor cancellation before dispatch',async t=>{
  let release,started;const begun=new Promise(resolve=>started=resolve);
  const f=serviceFixture({dispatch:()=>{started();return new Promise(resolve=>release=()=>resolve({autoFlow:{available:true,enabled:false,mode:'allowlist'}}));}});t.after(()=>f.service.close());
  const pending=f.service.action('flow-settings',{enabled:false});await begun;
  await assert.rejects(f.service.action('archive',{}),error=>error.status===409);
  release();await pending;
  await assert.rejects(f.service.action('flow-settings',{enabled:false},{signal:AbortSignal.abort()}),error=>error.status===408);
  assert.equal(f.calls.length,1);
});

test('flow settings HTTP requires a session token, JSON and same origin',async t=>{
  const f=serviceFixture();t.after(()=>f.service.close());
  const server=createKanbanServer({port:0,...f.options});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const url='http://127.0.0.1:'+server.address().port,csrf=(await(await fetch(url+'/api/board')).json()).csrf;
  const post=headers=>fetch(url+'/api/flow-settings',{method:'POST',headers,body:JSON.stringify({enabled:false})});
  for(const headers of [{},{'Content-Type':'application/json','X-Kanban-Token':'wrong'},
    {'Content-Type':'application/json','X-Kanban-Token':csrf,Origin:'https://evil.example'}])assert.equal((await post(headers)).status,403);
  assert.equal(f.calls.length,0);
  const result=await post({'Content-Type':'application/json','X-Kanban-Token':csrf});assert.equal(result.status,200);
  assert.equal((await result.json()).autoFlow.enabled,false);assert.equal(f.calls.length,1);
});

test('flow settings MCP is app-only with a strict boolean schema and token check',async t=>{
  const f=serviceFixture(),app=createKanbanMcp({service:f.service,readUi:async()=>'<html></html>'}),client=new Client({name:'flow-settings',version:'1'},{capabilities:{}});
  const [server,transport]=InMemoryTransport.createLinkedPair();await app.server.connect(server);await client.connect(transport);
  t.after(async()=>{await client.close();await app.close();});
  const tool=(await client.listTools()).tools.find(tool=>tool.name==='set_flow_settings');assert(tool);
  assert.deepEqual(tool._meta.ui.visibility,['app']);assert.equal(tool.inputSchema.properties.enabled.type,'boolean');assert.equal(tool.inputSchema.additionalProperties,false);
  for(const args of [{enabled:'false',actionToken:f.service.csrf},{enabled:false,actionToken:f.service.csrf,mode:'all-local'},
    {enabled:false,actionToken:'99999999-9999-4999-8999-999999999999'}])assert.equal((await client.callTool({name:'set_flow_settings',arguments:args})).isError,true);
  assert.equal(f.calls.length,0);
  const result=await client.callTool({name:'set_flow_settings',arguments:{enabled:false,actionToken:f.service.csrf}});
  assert(!result.isError);assert.equal(result.structuredContent.autoFlow.enabled,false);assert.equal(f.calls.length,1);
});

test('flow settings iframe transport forwards the token and exact enabled boolean',async()=>{
  const calls=[],fetch=createMcpFetch({callServerTool:async params=>{calls.push(params);return {structuredContent:{autoFlow:{available:true,enabled:false,mode:'all-local'}}};}},Promise.resolve());
  const response=await fetch('/api/flow-settings',{method:'POST',headers:{'X-Kanban-Token':'session'},body:'{"enabled":false}'});
  assert(response.ok);assert.deepEqual(calls,[{name:'set_flow_settings',arguments:{enabled:false,actionToken:'session'}}]);
});

function uiFixture(){
  const board=fixture();board.autoFlow={available:true,enabled:true,mode:'allowlist'};
  const h=harness(board);new Script("nativeToken='session'").runInContext(h.context);h.api.applyNativeBoard(board);
  return {...h,board};
}

test('Auto organize displays initialization progress and actionable errors while retaining its switch',()=>{
  const h=uiFixture(),hint=h.nodes.get('auto-organize-hint'),control=h.nodes.get('auto-organize');
  for(const state of ['waiting','initializing','ready','error']){
    h.board.autoFlow.initialization={state,message:state==='error'?'Rename duplicate For Review groups.':'Open a local chat.'};
    h.api.applyNativeBoard(h.board);assert.equal(hint.textContent,h.board.autoFlow.initialization.message);
    assert.equal(hint.dataset.error,String(state==='error'));assert(!control.disabled);assert(control.checked);
  }
  h.board.autoFlow.enabled=false;h.api.applyNativeBoard(h.board);assert.match(hint.textContent,/off/);assert.equal(hint.dataset.error,'false');
});

test('Auto organize shows persisted availability without browser storage and disables unsupported runtimes',()=>{
  const h=uiFixture(),control=h.nodes.get('auto-organize');assert(control.checked);assert(!control.disabled);
  h.board.autoFlow={available:true,enabled:false,mode:'allowlist'};h.api.applyNativeBoard(h.board);assert(!control.checked);
  assert.match(h.nodes.get('auto-organize-hint').textContent,/off/);
  delete h.board.autoFlow;h.api.applyNativeBoard(h.board);assert(control.disabled);assert(!control.checked);
  assert(!h.writes.some(key=>/flow|organize/.test(key)));
});

test('Auto organize waits for bridge readback, blocks other actions and displays failures inline',async()=>{
  const h=uiFixture(),control=h.nodes.get('auto-organize');let finish;const requests=[];
  h.context.fetchImpl=(url,args)=>{requests.push({url,args});return new Promise(resolve=>finish=resolve);};
  control.checked=false;const pending=control.onchange();assert(control.disabled);assert(control.checked);
  assert.match(h.nodes.get('auto-organize-hint').textContent,/Saving/);assert(h.nodes.get('board').querySelectorAll('.card-details').every(button=>button.disabled));
  assert.equal(requests[0].url,'/api/flow-settings');assert.equal(requests[0].args.headers['X-Kanban-Token'],'session');
  assert.deepEqual(JSON.parse(requests[0].args.body),{enabled:false});
  finish({ok:true,json:async()=>({autoFlow:{available:true,enabled:false,mode:'allowlist'}})});await pending;
  assert(!control.checked);assert(!control.disabled);
  h.context.fetchImpl=async()=>({ok:false,json:async()=>({error:'Bridge disconnected. Refresh and retry.'})});
  control.checked=true;await control.onchange();assert(!control.checked);assert.match(h.nodes.get('auto-organize-hint').textContent,/Bridge disconnected/);
  assert.equal(h.nodes.get('auto-organize-hint').dataset.error,'true');
});
