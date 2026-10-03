import test from 'node:test';
import assert from 'node:assert/strict';
import {pinLocalTask} from './pin.mjs';

const id='11111111-1111-4111-8111-111111111111',params={threadId:id,hostId:'local',pinned:true};
const board={tasks:[{id,hostId:'local'}]};
function fixture({sections=[{id:'pin-id',name:'Pinned'}],section={id:'review'},verified=true,changeDuringListing}={}){
  const calls=[];let closed=false;
  const client={close(){closed=true;},async request(method,p){calls.push({method,params:p});
    if(method==='thread/read')return {thread:{id,ephemeral:false,parentThreadId:null,section}};
    if(method==='threadSection/list'){
      if(changeDuringListing!==undefined)section=changeDuringListing;
      return {data:sections};
    }
    if(method==='thread/section/move'){if(verified)section=p.sectionId?{id:p.sectionId}:null;return {};}
    throw Error('Unexpected method');}};
  return {calls,get closed(){return closed;},open:async()=>client};
}
test('Pin uses the unique native Pinned ID and verifies the exact membership',async()=>{
  const f=fixture();assert.deepEqual(await pinLocalTask(params,board,f),{threadId:id,pinned:true,sectionId:'pin-id'});
  assert.deepEqual(f.calls.find(c=>c.method==='thread/section/move').params,{threadId:id,sectionId:'pin-id'});assert(f.closed);
});
test('Unpin removes native section membership; stale Unpin cannot overwrite a later move',async()=>{
  const f=fixture({section:{id:'pin-id'}});
  assert.equal((await pinLocalTask({...params,pinned:false},board,f)).pinned,false);
  assert.equal(f.calls.find(c=>c.method==='thread/section/move').params.sectionId,null);
  const stale=fixture();await assert.rejects(pinLocalTask({...params,pinned:false},board,stale));
  assert.equal(stale.calls.some(c=>c.method==='thread/section/move'),false);
});
test('a native classification during group lookup is preserved before Pin or Unpin writes',async()=>{
  for(const pinned of [false,true]){
    const f=fixture({section:{id:'pin-id'},changeDuringListing:{id:'review'}});
    await assert.rejects(pinLocalTask({...params,pinned},board,f),/changed groups/);
    assert.equal(f.calls.some(c=>c.method==='thread/section/move'),false);
    assert(f.closed);
  }
});
test('missing or ambiguous Pinned groups, remote identities and unconfirmed changes never claim success',async()=>{
  for(const sections of [[],[{id:'one',name:'Pinned'},{id:'two',name:'Pinned'}]]){
    const f=fixture({sections});await assert.rejects(pinLocalTask(params,board,f));assert(f.closed);
    assert.equal(f.calls.some(c=>c.method==='thread/section/move'),false);
  }
  const f=fixture({verified:false});await assert.rejects(pinLocalTask(params,board,f));assert(f.closed);
  let opens=0;await assert.rejects(pinLocalTask({...params,hostId:'durable'},board,{open:async()=>{opens++;}}));assert.equal(opens,0);
});
