import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Script,createContext} from 'node:vm';

const html=await readFile(new URL('./ui.html',import.meta.url),'utf8');
const browserScript=html.match(/<script>([\s\S]*?)<\/script>/)[1];
new Script(browserScript);
const persistence=browserScript.match(/const workflowStoragePrefix=[\s\S]*?(?=function finishDrag)/)[0];
const stages=[{id:'todo',name:'To do'},{id:'progress',name:'In progress'},{id:'done',name:'Done'}];
const local={hostId:'local',id:'same-task',column:'running',rawStatus:{type:'active'}};
const remote={hostId:'remote-control:test',id:'same-task',column:'idle',rawStatus:'idle'};
function harness(storage=new Map()){
  const nodes=new Map();
  const node=id=>{if(!nodes.has(id))nodes.set(id,{value:id==='grouping'?'workflow':'',open:false,textContent:'',hidden:true});return nodes.get(id);};
  let failRead=false,failWrite=false,renders=0;
  const context=createContext({
    DATA:{tasks:[local,remote]},workflowColumns:stages,$:node,
    document:{querySelector:()=>node('subtitle')},
    localStorage:{getItem:key=>{if(failRead)throw Error('read blocked');return storage.get(key)??null;},setItem:(key,value)=>{if(failWrite)throw Error('quota exceeded');storage.set(key,value);}},
    render:()=>renders++,clearTimeout:()=>{},setTimeout:()=>1
  });
  const api=new Script(persistence+'\n({taskKey,storageKey,loadWorkflow,workflowStage,moveWorkflow,validWorkflow})').runInContext(context);
  return {api,storage,nodes,blockRead:()=>failRead=true,blockWrite:()=>failWrite=true,renders:()=>renders};
}
const first=harness();
first.api.loadWorkflow();
assert.equal(first.api.workflowStage(local),'todo');
assert.notEqual(first.api.storageKey(local),first.api.storageKey(remote),'same IDs on different hosts must remain independent');
const runtimeBefore=JSON.stringify([local,remote]);
assert.equal(first.api.moveWorkflow(local,'progress'),true);
assert.equal(first.api.workflowStage(local),'progress');
assert.equal(first.api.workflowStage(remote),'todo');
assert.equal(JSON.stringify([local,remote]),runtimeBefore,'manual moves must never modify runtime status');
const reloaded=harness(first.storage);
reloaded.api.loadWorkflow();
assert.equal(reloaded.api.workflowStage(local),'progress','classification survives reload');
assert.equal(reloaded.api.moveWorkflow(remote,'done'),true);
assert.equal(first.api.moveWorkflow(local,'done'),true);
const latest=harness(first.storage);latest.api.loadWorkflow();
assert.equal(latest.api.workflowStage(local),'done');
assert.equal(latest.api.workflowStage(remote),'done','independent writes cannot overwrite the other host');
assert.equal(latest.api.moveWorkflow(local,'running'),false,'runtime state is not a workflow stage');
const denied=harness(first.storage);denied.api.loadWorkflow();denied.blockWrite();
assert.equal(denied.api.moveWorkflow(local,'todo'),false);
assert.equal(denied.api.workflowStage(local),'done','failed save must not silently change the visible classification');
assert.equal(denied.renders(),0);
assert.match(denied.nodes.get('workflow-toast').textContent,/Not saved/);
const unreadable=harness();unreadable.blockRead();unreadable.api.loadWorkflow();
assert.equal(unreadable.api.workflowStage(local),'todo');
const malformed=harness();malformed.storage.set(malformed.api.storageKey(local),'unexpected');malformed.api.loadWorkflow();
assert.equal(malformed.api.workflowStage(local),'todo');
console.log('PASS: defaults, host isolation, reload persistence, independent writes, runtime isolation and storage failures');
