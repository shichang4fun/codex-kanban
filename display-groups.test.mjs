import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script,createContext} from 'node:vm';

const html=readFileSync(new URL('./ui.html',import.meta.url),'utf8');
const helpers=html.match(/function nativeColumns\([\s\S]*?(?=function nativeNotice)/)[0];
function display(DATA){return new Script(helpers+'\n({nativeColumns,nativeStage})').runInContext(createContext({DATA}));}
test('default standalone and project tasks share one display group without changing their native data',()=>{
  const data={sections:[{sectionId:'review',name:'For Review'},{sectionId:'chats',name:'Tasks'},{sectionId:'threads',name:'Projects'}],tasks:[
    {id:'a',nativeSectionId:'chats',localSectionId:null,placementSource:'localDefault'},
    {id:'b',nativeSectionId:'threads',localSectionId:null,placementSource:'desktopProject',projectName:'Tools'},
    {id:'c',nativeSectionId:'review',localSectionId:'review',placementSource:'localThreadSection',projectName:'Tools'}]};
  const before=JSON.stringify(data),api=display(data),groups=api.nativeColumns();
  assert.deepEqual(Array.from(groups,g=>[g.id,g.name]),[['review','For Review'],['chats','Ungrouped']]);
  assert.deepEqual(data.tasks.map(t=>api.nativeStage(t,groups)),['chats','chats','review']);
  assert.equal(JSON.stringify(data),before);
});
test('real custom groups named Tasks or Projects are preserved and unknown membership remains unconfirmed',()=>{
  const data={sections:[{sectionId:'real-tasks',name:'Tasks'},{sectionId:'real-projects',name:'Projects'},{sectionId:'threads',name:'Projects'}],tasks:[
    {nativeSectionId:'real-tasks'},{nativeSectionId:'real-projects'},{nativeSectionId:'threads'},{nativeSectionId:'missing'}]};
  const api=display(data),groups=api.nativeColumns();
  assert.deepEqual(Array.from(groups,g=>[g.id,g.name]),[['real-tasks','Tasks'],['real-projects','Projects'],['chats','Ungrouped'],['__other','Unconfirmed group']]);
  assert.deepEqual(data.tasks.map(t=>api.nativeStage(t,groups)),['real-tasks','real-projects','chats','__other']);
});
