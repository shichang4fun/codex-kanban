import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {initializeFlowGroups,FLOW_GROUP_NAMES} from './flow-initialization.mjs';
import {createJsonStore} from './creation-store.mjs';

const group=name=>({name,sectionId:'desktop-'+name});
async function fixture(t,{names=[],policy={},beforeRead,create,local}={}){
  const root=await mkdtemp('/tmp/kanban-flow-init-');t.after(()=>rm(root,{recursive:true,force:true}));
  const path=join(root,'journal.json'),store=createJsonStore(path),groups=names.map(group),writes=[];let reads=0;
  const rpc={async request(method,p){
    if(method==='threadSection/list')return local?.(p)??{data:FLOW_GROUP_NAMES.map(name=>({id:'local-'+name,name})),nextCursor:null};
    assert.equal(method,'mcpServer/tool/call');assert.equal(p.server,'codex_app');assert.equal(p.threadId,'context');
    if(p.tool==='list_threads'){await beforeRead?.(++reads,groups);return {content:[{type:'text',text:JSON.stringify({sections:groups})}]};}
    assert.equal(p.tool,'create_sidebar_section');assert.deepEqual(Object.keys(p.arguments),['name']);writes.push(p.arguments.name);
    if(create)await create(p.arguments.name,groups);else groups.push(group(p.arguments.name));
    return {content:[{type:'text',text:'{}'}]};
  }};
  return {groups,writes,store,path,rpc,run:options=>initializeFlowGroups({rpc,contextThreadId:'context',policy,store,...options})};
}
const mapping={forceStatusSections:{inProgress:{desktopId:'desktop-In Progress',localId:'local-In Progress'},
  forReview:{desktopId:'desktop-For Review',localId:'local-For Review'}}};

test('first run creates exactly the three missing groups and subsequent starts only reuse them',async t=>{
  const f=await fixture(t);assert.equal((await f.run()).state,'ready');assert.deepEqual(f.writes,FLOW_GROUP_NAMES);
  await f.run({store:createJsonStore(f.path)});assert.deepEqual(f.writes,FLOW_GROUP_NAMES);assert.deepEqual(await f.store.read(),{});
});
test('existing groups are reused and only missing groups are created',async t=>{
  const f=await fixture(t,{names:['In Progress','For Later']});await f.run();assert.deepEqual(f.writes,['For Review']);
});
test('duplicate names anywhere in the catalog prevent all writes',async t=>{
  for(const name of FLOW_GROUP_NAMES){const f=await fixture(t,{names:[name,name]});f.groups[1].sectionId='another';
    await assert.rejects(f.run(),/More than one group/);assert.deepEqual(f.writes,[]);}
});
test('built-in aliases and unavailable or malformed catalogs cannot be used as flow groups',async t=>{
  const f=await fixture(t,{names:['In Progress']});f.groups[0].sectionId='pinned';await assert.rejects(f.run(),/custom Codex/);
  for(const data of [{sections:[],unavailableHosts:['local']},{sections:[{name:'For Review'}]},{sections:[],unavailableSources:['chatgpt']},{}]){
    await assert.rejects(f.run({rpc:{request:async()=>({content:[{type:'text',text:JSON.stringify(data)}]})}}),/unavailable/);
  }
  assert.deepEqual(f.writes,[]);
});
test('a committed create with a lost reply is resolved by readback without replay',async t=>{
  const f=await fixture(t,{create:async(name,groups)=>{groups.push(group(name));throw Error('timeout');}});
  await f.run();assert.deepEqual(f.writes,FLOW_GROUP_NAMES);assert.deepEqual(await f.store.read(),{});
});
test('an ambiguous absent create remains durable across restarts until the user resolves it',async t=>{
  const f=await fixture(t,{create:async()=>{throw Error('timeout');}});
  await assert.rejects(f.run(),/unconfirmed/);assert.deepEqual(f.writes,['In Progress']);
  await assert.rejects(f.run({store:createJsonStore(f.path)}),/No creation request was repeated/);assert.deepEqual(f.writes,['In Progress']);
  f.groups.push(...FLOW_GROUP_NAMES.map(group));await f.run();assert.deepEqual(await f.store.read(),{});assert.deepEqual(f.writes,['In Progress']);
});
test('a success reply without a visible group is not treated as confirmation',async t=>{
  const f=await fixture(t,{create:async()=>{}});await assert.rejects(f.run(),/unconfirmed/);
  await assert.rejects(f.run(),/unconfirmed/);assert.equal(f.writes.length,1);
});
test('a failed readback retains the durable claim and does not issue a corrective write',async t=>{
  const f=await fixture(t,{beforeRead:reads=>{if(reads===4)throw Error('disconnected');}});
  await assert.rejects(f.run(),/disconnected/);assert.equal(f.writes.length,1);assert.ok((await f.store.read())['In Progress']);
  await f.run();assert.deepEqual(f.writes,FLOW_GROUP_NAMES);
});
test('separate writers sharing the durable journal do not create the same group twice',async t=>{
  let entered,release;const began=new Promise(r=>entered=r),held=new Promise(r=>release=r);
  const f=await fixture(t,{create:async(name,groups)=>{if(name==='In Progress'){entered();await held;}groups.push(group(name));}});
  const first=f.run();await began;
  await assert.rejects(f.run({store:createJsonStore(f.path)}),/unconfirmed/);release();await first;
  assert.deepEqual(f.writes,FLOW_GROUP_NAMES);
});
test('a cancellation before dispatch releases its claim without creating a group',async t=>{
  let cancelled=false;
  const f=await fixture(t,{beforeRead:reads=>{if(reads===3)cancelled=true;}});
  await assert.rejects(f.run({check:()=>{if(cancelled)throw Error('cancelled');}}),/cancelled/);
  assert.deepEqual(f.writes,[]);assert.deepEqual(await f.store.read(),{});
});
test('cancellation after dispatch completes readback and prevents the next create',async t=>{
  let cancelled=false;
  const f=await fixture(t,{create:async(name,groups)=>{groups.push(group(name));cancelled=true;}});
  await assert.rejects(f.run({check:()=>{if(cancelled)throw Error('cancelled');}}),/cancelled/);
  assert.deepEqual(f.writes,['In Progress']);assert.deepEqual(await f.store.read(),{});
});
test('a group removed while another is being created cannot produce a ready state',async t=>{
  const f=await fixture(t,{names:['In Progress','For Review'],create:async(name,groups)=>{groups.push(group(name));groups.splice(0,1);}});
  await assert.rejects(f.run(),/removed during initialization/);assert.deepEqual(f.writes,['For Later']);
});
test('explicit migrated UUID pairs are preserved while only For Later is created',async t=>{
  const f=await fixture(t,{names:['In Progress','For Review'],policy:mapping});await f.run();assert.deepEqual(f.writes,['For Later']);
});
test('missing, renamed or replaced migrated groups fail before creating anything',async t=>{
  for(const alter of [groups=>groups.shift(),groups=>groups[0].name='Renamed',groups=>groups[0].sectionId='replacement']){
    const f=await fixture(t,{names:['In Progress','For Review'],policy:mapping});alter(f.groups);
    await assert.rejects(f.run(),/saved In Progress mapping/);assert.deepEqual(f.writes,[]);
  }
});
test('a migrated group removed or renamed after initial validation is never replaced',async t=>{
  for(const alter of [groups=>groups.shift(),groups=>groups[0].name='Renamed',groups=>groups[0].sectionId='replacement']){
    const f=await fixture(t,{names:['In Progress','For Review'],policy:mapping,beforeRead:(reads,groups)=>{if(reads===2)alter(groups);}});
    await assert.rejects(f.run(),/saved In Progress mapping/);assert.deepEqual(f.writes,[]);
  }
});
test('a changed native mapping blocks a create even when the Desktop catalog is stale',async t=>{
  let reads=0;const f=await fixture(t,{names:['In Progress','For Review'],policy:mapping,
    local:()=>({data:++reads===1?[{name:'In Progress',id:'local-In Progress'},{name:'For Review',id:'local-For Review'}]:[],nextCursor:null})});
  await assert.rejects(f.run(),/saved In Progress mapping/);assert.deepEqual(f.writes,[]);assert.deepEqual(await f.store.read(),{});
});
test('paginated native mappings are verified and repeated cursors fail closed',async t=>{
  const f=await fixture(t,{names:FLOW_GROUP_NAMES,policy:mapping,local:p=>p.cursor===null?
    {data:[{name:'In Progress',id:'local-In Progress'}],nextCursor:'next'}:{data:[{name:'For Review',id:'local-For Review'}],nextCursor:null}});
  await f.run();assert.deepEqual(f.writes,[]);
  await assert.rejects(f.run({rpc:{request:async(method,p)=>method==='threadSection/list'?{data:[],nextCursor:'loop'}:f.rpc.request(method,p)}}),/Invalid local group catalog/);
});
