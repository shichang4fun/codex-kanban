import test from 'node:test';
import assert from 'node:assert/strict';
import {setLocalProject} from './project.mjs';
import {createKanbanServer} from './serve.mjs';
import {createKanbanService} from './kanban-service.mjs';

const id='11111111-1111-4111-8111-111111111111';
const board={tasks:[{id,hostId:'local'}],sync:{connected:true,projectCatalogConnected:true}};
const params={threadId:id,hostId:'local',projectId:'project-b',expectedProjectId:'project-a'};
function fixture({confirm=true,stale=false,adjacentChange=false,ephemeral=false,parent=null}={}){
  const calls=[],thread={id,projectId:stale?'project-c':'project-a',ephemeral,parentThreadId:parent,cwd:'/fixture',section:{id:'review'},status:'active'};
  let reads=0,closed=false;
  const client={close(){closed=true;},async request(method,p){calls.push({method,params:p});
    if(method==='project/list')return p.cursor?{data:[{id:'project-b'}]}:{data:[{id:'project-a'}],nextCursor:'next'};
    if(method==='thread/read'){if(adjacentChange&&++reads===2)thread.projectId='project-c';return {thread:structuredClone(thread)};}
    if(method==='thread/metadata/update'){if(confirm)thread.projectId=p.projectId||null;return {thread};}
    throw Error('Unexpected RPC');
  }};
  return {calls,thread,open:async()=>client,get closed(){return closed;}};
}
test('project assignment writes only projectId once, verifies it, and leaves cwd, section and execution unchanged',async()=>{
  const f=fixture();assert.deepEqual(await setLocalProject(params,board,f),{threadId:id,projectId:'project-b',changed:true});
  assert.deepEqual(f.calls.filter(c=>c.method==='thread/metadata/update'),[{method:'thread/metadata/update',params:{threadId:id,projectId:'project-b'}}]);
  assert.equal(f.thread.cwd,'/fixture');assert.deepEqual(f.thread.section,{id:'review'});assert.equal(f.thread.status,'active');assert(f.closed);
  const same=fixture();assert.equal((await setLocalProject({...params,projectId:'project-a'},board,same)).changed,false);
  assert(!same.calls.some(c=>c.method==='thread/metadata/update'));
});
test('No project translates to the native clear operation, checks stale sources and verifies null readback',async()=>{
  const f=fixture(),clear={...params,projectId:null};
  assert.deepEqual(await setLocalProject(clear,board,f),{threadId:id,projectId:null,changed:true});
  assert.deepEqual(f.calls.filter(c=>c.method==='thread/metadata/update'),[{method:'thread/metadata/update',params:{threadId:id,projectId:''}}]);
  assert(!f.calls.some(c=>c.method==='project/list'));assert.equal(f.thread.projectId,null);assert.equal(f.thread.cwd,'/fixture');assert.deepEqual(f.thread.section,{id:'review'});
  const stale=fixture({stale:true});await assert.rejects(setLocalProject(clear,board,stale),/changed projects/);assert(!stale.calls.some(c=>c.method==='thread/metadata/update'));
  const failed=fixture({confirm:false});await assert.rejects(setLocalProject(clear,board,failed),/could not be confirmed/);
  const native=fixture();native.thread.projectId=null;
  const staleSnapshot={...board,tasks:[{id,hostId:'local',projectId:'desktop-old'}]};
  assert.equal((await setLocalProject({...clear,expectedProjectId:null},staleSnapshot,native)).changed,false);
  assert(!native.calls.some(c=>c.method==='thread/metadata/update'));
  const same=fixture();same.thread.projectId=null;assert.equal((await setLocalProject({...clear,expectedProjectId:null},board,same)).changed,false);
});

test('setting an unassigned task and changing it both use exact native project IDs',async()=>{
  const f=fixture();f.thread.projectId=null;
  assert.equal((await setLocalProject({...params,expectedProjectId:null},board,f)).projectId,'project-b');
  const missing=fixture();await assert.rejects(setLocalProject({...params,projectId:'deleted'},board,missing),/no longer available/);
  assert(!missing.calls.some(c=>c.method==='thread/metadata/update'));assert(missing.closed);
});
test('malformed, ambiguous and cyclic project catalogs fail before any native write',async()=>{
  for(const catalog of [
    ()=>({data:null}),
    ()=>({data:[{id:'project-b'},{id:'project-b'}]}),
    ()=>({data:[{id:'project-b'}],nextCursor:123}),
    ()=>({data:[{id:'project-b'}],nextCursor:'repeated'})
  ]){
    const f=fixture(),open=async()=>{
      const client=await f.open();
      return {...client,request(method,p){return method==='project/list'?Promise.resolve(catalog(p)):client.request(method,p);}};
    };
    await assert.rejects(setLocalProject(params,board,{open}),/unavailable|no longer available/);
    assert(!f.calls.some(c=>c.method==='thread/metadata/update'));assert(f.closed);
  }
});
test('stale project assignments, protected sources and invalid requests never reach a native write',async()=>{
  for(const options of [{stale:true},{adjacentChange:true},{ephemeral:true},{parent:'parent'}]){
    const f=fixture(options);await assert.rejects(setLocalProject(params,board,f));assert(f.closed);assert(!f.calls.some(c=>c.method==='thread/metadata/update'));
  }
  let opens=0;const open=async()=>{opens++;throw Error('Unexpected writer');};
  for(const value of [{...params,hostId:'durable'},{...params,threadId:'bad'},{...params,projectId:''},{...params,projectId:undefined},{...params,expectedProjectId:undefined}])await assert.rejects(setLocalProject(value,board,{open}));
  await assert.rejects(setLocalProject(params,{tasks:[]},{open}));assert.equal(opens,0);
});
test('unconfirmed project changes fail without retrying, and cancellation closes the connection before any write',async()=>{
  const f=fixture({confirm:false});await assert.rejects(setLocalProject(params,board,f),/could not be confirmed/);
  assert.equal(f.calls.filter(c=>c.method==='thread/metadata/update').length,1);assert(f.closed);
  const abort=new AbortController();abort.abort();const cancelled=fixture();
  await assert.rejects(setLocalProject(params,board,{...cancelled,signal:abort.signal}),/cancelled/);assert.equal(cancelled.calls.length,0);
});

function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
function waitingFixture(stage){
  const f=fixture(),entered=deferred(),release=deferred();let reads=0;
  const open=async()=>{
    const client=await f.open();
    return {...client,async request(method,p){
      if(method==='thread/read')reads++;
      const waiting=stage==='catalog'&&method==='project/list'&&!p.cursor
        ||stage==='first-read'&&method==='thread/read'&&reads===1
        ||stage==='second-read'&&method==='thread/read'&&reads===2;
      const result=await client.request(method,p);
      if(waiting){entered.resolve();await release.promise;}
      return result;
    }};
  };
  return {f,open,entered:entered.promise,release:release.resolve};
}
for(const stage of ['catalog','first-read','second-read']){
  test('request cancellation during '+stage+' prevents project dispatch and closes its writer',async()=>{
    const waiting=waitingFixture(stage),abort=new AbortController();
    const result=setLocalProject(params,board,{open:waiting.open,signal:abort.signal});
    const rejected=assert.rejects(result,/cancelled/);
    await waiting.entered;abort.abort();waiting.release();await rejected;
    assert(!waiting.f.calls.some(c=>c.method==='thread/metadata/update'));assert(waiting.f.closed);
  });
  test('service.close during '+stage+' cancels project dispatch and releases the writer',async()=>{
    const waiting=waitingFixture(stage);
    const service=createKanbanService({getBoard:async()=>board,setProject:(p,b,{signal})=>setLocalProject(p,b,{open:waiting.open,signal})});
    const result=service.action('project',params),rejected=assert.rejects(result,/cancelled/);
    await waiting.entered;const closed=service.close();waiting.release();await rejected;await closed;
    assert(!waiting.f.calls.some(c=>c.method==='thread/metadata/update'));assert(waiting.f.closed);
    await assert.rejects(service.action('project',params),error=>error.status===503);
  });
}

for(const closeService of [false,true]){
  test((closeService?'service.close':'request cancellation')+' after project dispatch still confirms the single write',async()=>{
    const f=fixture(),entered=deferred(),release=deferred(),abort=new AbortController();
    const open=async()=>{
      const client=await f.open();
      return {...client,async request(method,p){
        const result=await client.request(method,p);
        if(method==='thread/metadata/update'){entered.resolve();await release.promise;}
        return result;
      }};
    };
    const service=createKanbanService({getBoard:async()=>board,setProject:(p,b,{signal})=>setLocalProject(p,b,{open,signal})});
    try{
      const pending=service.action('project',params,{signal:abort.signal});
      await entered.promise;const closed=closeService?service.close():null;if(!closeService)abort.abort();
      release.resolve();const result=await pending;await closed;
      assert.equal(result.changed,true);assert.equal(result.projectId,'project-b');
      assert.equal(f.calls.filter(c=>c.method==='thread/metadata/update').length,1);
      assert.equal(f.calls.filter(c=>c.method==='thread/read').length,3);assert(f.closed);
    }finally{release.resolve();await service.close();}
  });
}

test('project and other service actions share one lock, including requests from separate callers',async()=>{
  const entered=deferred(),release=deferred();let projects=0,archives=0;
  const service=createKanbanService({getBoard:async()=>board,setProject:async p=>{
    projects++;entered.resolve();await release.promise;return {threadId:p.threadId,projectId:p.projectId,changed:true};
  },archiveTask:async p=>{archives++;return {threadId:p.threadId,archived:true};}});
  try{
    const pending=service.action('project',params);await entered.promise;
    for(const action of ['project','move','pin','archive','unarchive'])
      await assert.rejects(service.action(action,params),error=>error.status===409&&/in progress/.test(error.message));
    assert.equal(projects,1);assert.equal(archives,0);release.resolve();await pending;
    assert.equal((await service.action('archive',params)).archived,true);assert.equal(archives,1);
  }finally{release.resolve();await service.close();}
});

test('unavailable native project catalogs refuse assignment and clearing before opening a writer',async()=>{
  for(const sync of [{},{projectCatalogConnected:false},{projectCatalogConnected:null}]){
    let writes=0;const service=createKanbanService({getBoard:async()=>({...board,sync}),setProject:async()=>{writes++;throw Error('Unexpected writer');}});
    try{
      for(const projectId of ['project-b',null])await assert.rejects(service.action('project',{...params,projectId}),error=>error.status===503&&/projects are unavailable/.test(error.message));
      assert.equal(writes,0);
    }finally{await service.close();}
  }
});

test('service rejects malformed project confirmations without retrying and releases its lock',async()=>{
  for(const invalid of [{threadId:'other',projectId:'project-b',changed:true},{threadId:id,projectId:'other',changed:true},{threadId:id,projectId:'project-b',changed:undefined}]){
    let writes=0;const service=createKanbanService({getBoard:async()=>board,setProject:async p=>{
      writes++;return writes===1?invalid:{threadId:p.threadId,projectId:p.projectId,changed:true};
    }});
    try{
      await assert.rejects(service.action('project',params),error=>error.status===503&&/could not be confirmed/.test(error.message));
      assert.equal(writes,1);assert.equal((await service.action('project',params)).projectId,'project-b');assert.equal(writes,2);
    }finally{await service.close();}
  }
});
test('HTTP project editing uses CSRF, serializes with other actions and rejects mismatched confirmation',async()=>{
  let release,started;const entered=new Promise(r=>started=r);let changed=false;
  const server=createKanbanServer({port:0,getBoard:async()=>board,setProject:async p=>{started();await new Promise(r=>release=r);changed=true;return {threadId:p.threadId,projectId:p.projectId,changed:true};}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try{
    const base='http://127.0.0.1:'+server.address().port,{csrf,board:current}=await(await fetch(base+'/api/board')).json();assert(current.sync.projectLocal);
    const post=(path,body,token=csrf)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json','X-Kanban-Token':token},body:JSON.stringify(body)});
    assert.equal((await post('/api/project',params,'wrong')).status,403);
    const pending=post('/api/project',params);await entered;
    assert.equal((await post('/api/archive',{threadId:id,hostId:'local'})).status,409);release();
    const response=await pending,payload=await response.json();assert.equal(response.status,200);assert.equal(payload.projectId,'project-b');assert(changed);
  }finally{await new Promise(r=>server.close(r));}
  const invalid=createKanbanServer({port:0,getBoard:async()=>board,setProject:async()=>({threadId:id,projectId:'wrong',changed:true})});
  await new Promise(r=>invalid.listen(0,'127.0.0.1',r));
  try{const base='http://127.0.0.1:'+invalid.address().port,{csrf}=await(await fetch(base+'/api/board')).json();const response=await fetch(base+'/api/project',{method:'POST',headers:{'Content-Type':'application/json','X-Kanban-Token':csrf},body:JSON.stringify(params)});assert.equal(response.status,503);}
  finally{await new Promise(r=>invalid.close(r));}
});
