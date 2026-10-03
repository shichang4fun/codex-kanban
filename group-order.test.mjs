import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script,createContext} from 'node:vm';

const html=readFileSync(new URL('./ui.html',import.meta.url),'utf8');
const helpers=html.match(/const groupOrderStoragePrefix=[\s\S]*?(?=function expireRuntimeSnapshot)/)[0];
const groups=[{id:'pinned'},{id:'review'},{id:'later'}];
function harness(storage=new Map()){
  let blocked=false,renders=0,message='';
  const data={tasks:[{id:'task',column:'running',nativeSectionId:'review'}]};
  const context=createContext({DATA:data,nativeColumns:()=>groups,
    localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>{if(blocked)throw Error('storage unavailable');storage.set(key,value);}},
    render:()=>renders++,announce:text=>message=text});
  const api=new Script(helpers+'\n({orderedGroups,moveGroup})').runInContext(context);
  return {api,data,storage,block:()=>blocked=true,renders:()=>renders,message:()=>message};
}
const ids=items=>Array.from(items,g=>g.id);
test('group moves persist across reload, append new groups, and never move tasks',()=>{
  const h=harness(),before=JSON.stringify(h.data);
  assert.equal(h.api.moveGroup('later','pinned'),true);
  assert.deepEqual(ids(h.api.orderedGroups(groups)),['later','pinned','review']);
  assert.equal(JSON.stringify(h.data),before);
  const reload=harness(h.storage);
  assert.deepEqual(ids(reload.api.orderedGroups([...groups,{id:'new'}])),['later','pinned','review','new']);
  assert.equal(reload.api.moveGroup('later','review',true),true);
  assert.deepEqual(ids(reload.api.orderedGroups(groups)),['pinned','review','later']);
});
test('native group moves preserve retired workflow and runtime storage',()=>{
  const storage=new Map([['codex-kanban.group-order.v1:workflow','["done","todo"]'],['codex-kanban.group-order.v1:runtime','["idle","running"]']]);
  const h=harness(storage);h.api.moveGroup('review','pinned');
  assert.deepEqual(ids(h.api.orderedGroups(groups)),['review','pinned','later']);
  assert.equal(storage.get('codex-kanban.group-order.v1:workflow'),'["done","todo"]');
  assert.equal(storage.get('codex-kanban.group-order.v1:runtime'),'["idle","running"]');
});
test('invalid saved data and missing targets are harmless; failed writes do not reorder',()=>{
  const h=harness();h.storage.set('codex-kanban.group-order.v1:native','{"broken":true}');
  assert.deepEqual(ids(h.api.orderedGroups(groups)),ids(groups));
  h.storage.set('codex-kanban.group-order.v1:native','["review","review",null,"removed"]');
  assert.deepEqual(ids(h.api.orderedGroups(groups)),['review','pinned','later']);
  assert.equal(h.api.moveGroup('missing','pinned'),false);
  h.block();assert.equal(h.api.moveGroup('later','review'),false);
  assert.equal(h.renders(),0);assert.match(h.message(),/not saved/);
  assert.deepEqual(ids(h.api.orderedGroups(groups)),['review','pinned','later']);
});
test('the merged default group keeps the first former Tasks or Projects position only in sidebar mode',()=>{
  const h=harness();h.storage.set('codex-kanban.group-order.v1:native','["threads","review","chats","pinned"]');
  assert.deepEqual(ids(h.api.orderedGroups([{id:'pinned'},{id:'chats'},{id:'review'}])),['chats','review','pinned']);
  h.storage.set('codex-kanban.group-order.v1:workflow','["threads","review","chats","pinned"]');
  assert.deepEqual(ids(h.api.orderedGroups([{id:'chats'},{id:'threads'},{id:'review'}],'workflow')),['threads','review','chats']);
  assert.equal(JSON.parse(h.storage.get('codex-kanban.group-order.v1:native'))[0],'threads','read-only display migration preserves saved data');
});
