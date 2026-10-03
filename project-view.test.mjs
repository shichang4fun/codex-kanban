import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script,createContext} from 'node:vm';

const html=readFileSync(new URL('./ui.html',import.meta.url),'utf8');
const helpers=html.match(/const projectViewStoragePrefix=[\s\S]*?(?=function clearTaskDropMarkers)/)[0];
function harness(storage=new Map()){
  let blocked=false,message='',renders=0;
  const nodes={grouping:{value:'native'}};
  const context=createContext({localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>{if(blocked)throw Error('storage blocked');storage.set(key,value);}},
    $:id=>nodes[id],announce:text=>message=text,render:()=>renders++});
  const api=new Script(helpers+'\n({projectGroups,projectViewKey,readProjectView,changeProjectView,invalidate:key=>key===null?projectViews.clear():projectViews.delete(key)})').runInContext(context);
  return {api,storage,nodes,block:()=>blocked=true,message:()=>message,renders:()=>renders};
}
test('projects come before unassociated tasks, preserving project and task order without merging identities',()=>{
  const h=harness(),tasks=[
    {id:'e',hostId:'local',projectName:'Tools'},
    {id:'a',hostId:'local',projectId:'one',projectName:'Tools'},
    {id:'b',hostId:'local',projectId:'two',projectName:'Tools'},
    {id:'c',hostId:'local',projectId:'one',projectName:'Tools'},
    {id:'d',hostId:'remote',projectId:'one',projectName:'Tools'},
    {id:'f',hostId:'local',projectId:'unknown'},
    {id:'g',hostId:'local'}
  ],before=JSON.stringify(tasks);
  assert.deepEqual(Array.from(h.api.projectGroups(tasks),g=>[g.name,Array.from(g.items,t=>t.id)]),[
    ['Tools',['a','c']],['Tools',['b']],['Tools',['d']],['Unnamed project',['f']],['No project',['e','g']]
  ]);
  assert.equal(JSON.stringify(tasks),before);
  assert.equal(h.api.projectGroups([]).length,0);
});
test('each group and grouping mode toggles independently and survives reload',()=>{
  const h=harness();assert.equal(h.api.readProjectView('pinned'),false);
  h.api.changeProjectView('pinned');assert.equal(h.api.readProjectView('pinned'),true);assert.equal(h.renders(),1);
  assert.equal(h.api.readProjectView('review'),false);
  h.api.changeProjectView('review');h.api.changeProjectView('pinned');
  assert.equal(h.api.readProjectView('review'),true);assert.equal(h.api.readProjectView('pinned'),false);
  const reload=harness(h.storage);assert.equal(reload.api.readProjectView('review'),true);assert.equal(reload.api.readProjectView('pinned'),false);
  reload.nodes.grouping.value='workflow';assert.equal(reload.api.readProjectView('review'),false);
  reload.api.changeProjectView('review');reload.nodes.grouping.value='runtime';assert.equal(reload.api.readProjectView('review'),false);
  reload.nodes.grouping.value='native';reload.api.changeProjectView('review');
  assert.equal(reload.api.readProjectView('review','workflow'),true);
});
test('storage updates refresh only the affected group and clearing storage resets all groups',()=>{
  const h=harness(),other=harness(h.storage);h.api.changeProjectView('review');h.api.changeProjectView('pinned');
  assert.equal(other.api.readProjectView('review'),true);assert.equal(other.api.readProjectView('pinned'),true);
  h.api.changeProjectView('review');other.api.invalidate(other.api.projectViewKey('review'));
  assert.equal(other.api.readProjectView('review'),false);assert.equal(other.api.readProjectView('pinned'),true);
  h.storage.clear();other.api.invalidate(null);assert.equal(other.api.readProjectView('pinned'),false);
});
test('invalid preferences fall back to off and failed saving leaves the switch usable',()=>{
  const h=harness(new Map([['codex-kanban.project-view.v1','true'],['codex-kanban.project-view.v2:native:review','invalid']]));
  assert.equal(h.api.readProjectView('review'),false);assert.equal(h.api.readProjectView('pinned'),false);
  h.block();h.api.changeProjectView('review');
  assert.equal(h.api.readProjectView('review'),true);assert.equal(h.api.readProjectView('pinned'),false);
  assert.match(h.message(),/could not be saved/);assert.equal(h.renders(),1);
});
