import test from 'node:test';
import assert from 'node:assert/strict';
import {Script} from 'node:vm';
import {randomUUID} from 'node:crypto';
import {harness,fixture,localId} from './ui-test-helpers.mjs';

function setup({createWritable=true,reply=null}={}){
  const board=fixture();board.sync={...board.sync,scope:'localSections',createWritable};
  board.sections.push({sectionId:'custom',name:'Research'},{sectionId:'other-hosts',name:'Other hosts (snapshot)'});
  Object.assign(board.tasks[0],{projectId:'one',localProjectId:'native-one',projectName:'First project'});
  board.projects=[{projectId:'native-one',desktopProjectId:'one',hostId:'local',label:'First project'}];
  const h=harness(board),requests=[];
  const options={projects:[{projectId:'one',label:'First project',isGitRepository:true},{projectId:'two',label:'Notes',isGitRepository:false}],
    sections:[{sectionId:'review',name:'For Review'},{sectionId:'custom',name:'Research'},{sectionId:null,name:'Ungrouped'}],
    settings:{'"review"':{projectId:'one',environment:'worktree',branch:'codex/base',model:'fixture-model',thinking:'high',template:'Check tests.'}}};
  h.context.crypto={randomUUID};h.context.fetchImpl=async(url,args)=>{
    requests.push({url,args});
    if(url==='/api/creation-options')return {ok:true,json:async()=>options};
    if(url==='/api/group-settings')return {ok:true,json:async()=>({saved:true})};
    if(url==='/api/create')return {ok:true,json:async()=>reply??{state:'created',threadId:localId,groupAssigned:false,message:'Group failed.'}};
    if(url.startsWith('/api/creation-status?'))return {ok:true,json:async()=>reply??{state:'unknown',threadId:null,message:'Check Codex.'}};
    if(url==='/api/creation-group')return {ok:true,json:async()=>({state:'created',threadId:localId,groupAssigned:true,message:'Group verified.'})};
    throw Error('Unexpected URL: '+url);
  };
  new Script("nativeToken='csrf'").runInContext(h.context);h.api.applyNativeBoard(board);
  const api=new Script('({applyNativeBoard,openCreation,submitCreation,checkCreation,retryCreationGroup,readCreationSettings})').runInContext(h.context);
  return {...h,api,requests,board,options};
}
const group={id:'review',name:'For Review'};
test('project subgroup links use verified Desktop IDs and disable unmapped native projects',()=>{
  const h=setup();
  h.storage.set('codex-kanban.project-view.v2:native:review','true');h.events.storage({key:'codex-kanban.project-view.v2:native:review'});
  let link=h.nodes.get('board').querySelectorAll('.project-create')[0];
  assert.equal(new URL(link.href).searchParams.get('projectId'),'one');
  const incoming=structuredClone(h.board);incoming.projects=[];incoming.tasks[0].projectId='native-unmapped';
  h.api.applyNativeBoard(incoming);link=h.nodes.get('board').querySelectorAll('.project-create')[0];
  assert.equal(link.href,undefined);assert.equal(link.attributes['aria-disabled'],'true');assert.match(link.title,/Desktop catalog/);
});
test('Board and List offer native new-task links under empty local groups independently of the creation bridge',()=>{
  const h=setup();
  for(const view of ['board','list']){
    new Script(`setView('${view}')`).runInContext(h.context);
    const groups=h.nodes.get('board').children;
    assert(groups.find(n=>n.dataset.groupId==='custom').querySelector('.group-create'));
    assert.equal(groups.find(n=>n.dataset.groupId==='custom').querySelectorAll('.group-new-task')[0].href,'codex://threads/new');
    assert(!groups.find(n=>n.dataset.groupId==='other-hosts').querySelector('.group-create'));
    assert(groups.find(n=>n.dataset.groupId==='review').querySelectorAll('.group-settings').length);
  }
  const old=setup({createWritable:false});
  for(const node of old.nodes.get('board').querySelectorAll('.group-create')){assert.equal(node.tag,'a');assert.equal(node.href,'codex://threads/new');}
  for(const node of old.nodes.get('board').querySelectorAll('.group-settings'))assert(node.disabled);
});
test('native new-task links encode project/template, allow No project overrides and omit unsupported group/model/environment parameters',()=>{
  const h=setup();h.board.nativeCreationDefaults={'"review"':{projectId:'project & one',template:'检查 A&B\n继续',model:'ignored',environment:'worktree'}};
  h.board.projects.push({hostId:'local',desktopProjectId:'project & one'},{hostId:'local',desktopProjectId:'two'});
  h.api.applyNativeBoard(h.board);
  const url=new URL(h.nodes.get('board').children.find(n=>n.dataset.groupId==='review').querySelector('.group-create').href);
  assert.equal(url.hostname,'new');assert.equal(url.searchParams.get('projectId'),'project & one');assert.equal(url.searchParams.get('prompt'),'检查 A&B\n继续');
  assert.deepEqual([...url.searchParams.keys()],['projectId','prompt']);
  const nativeUrl=new Script('nativeCreationUrl').runInContext(h.context);
  assert.equal(new URL(nativeUrl(group,'two')).searchParams.get('projectId'),'two');
  assert.equal(new URL(nativeUrl(group,null)).searchParams.has('projectId'),false);
  assert.equal(h.requests.length,0);
});
test('deleted default projects disable both group links instead of losing project preselection',()=>{
  const h=setup();h.board.projects=[];h.board.nativeCreationDefaults={'"review"':{projectId:'deleted-desktop-project'}};
  h.api.applyNativeBoard(h.board);
  const column=h.nodes.get('board').children.find(n=>n.dataset.groupId==='review');
  for(const selector of ['.group-new-task','.group-create']){
    const link=column.querySelectorAll(selector)[0];assert.equal(link.href,undefined);
    assert.equal(link.attributes['aria-disabled'],'true');assert.match(link.title,/Creation settings/);
  }
});
test('group defaults load with focus; non-Git project subgroup overrides project and resets incompatible worktree defaults',async()=>{
  const h=setup();await h.api.openCreation(group);
  assert.equal(h.nodes.get('creation-project').value,'one');assert.equal(h.nodes.get('creation-environment').value,'worktree');
  assert.equal(h.nodes.get('creation-branch').value,'codex/base');assert.equal(h.nodes.get('creation-branch').disabled,false);
  assert.equal(h.context.document.activeElement,h.nodes.get('creation-prompt'));
  await h.api.openCreation(group,false,'two');
  assert.equal(h.nodes.get('creation-project').value,'two');assert.equal(h.nodes.get('creation-environment').value,'local');
  assert.equal(h.nodes.get('creation-branch').value,'');assert.equal(h.nodes.get('creation-worktree').disabled,true);
  await h.api.openCreation(group,false,null);assert.equal(h.nodes.get('creation-project').value,'');
  assert.equal(h.api.readCreationSettings().projectId,null);
});
test('default settings save without creating a task and retain the UTF-8 template and model settings',async()=>{
  const h=setup();await h.api.openCreation(group,true);h.nodes.get('creation-template').value='先检查代码。';
  await h.api.submitCreation({preventDefault(){}});
  const saved=h.requests.find(r=>r.url==='/api/group-settings');assert(saved);assert(!h.requests.some(r=>r.url==='/api/create'));
  const body=JSON.parse(saved.args.body);assert.equal(body.settings.template,'先检查代码。');assert.equal(body.settings.model,'fixture-model');
  assert.equal(body.settings.branch,'codex/base');assert.equal(h.nodes.get('creation-message').textContent,'Defaults saved.');
});
test('composer shows actual model/project settings and enables sending only when a prompt is present',async()=>{
  const h=setup();await h.api.openCreation(group);
  assert.equal(h.nodes.get('creation-model-label').textContent,'fixture-model');
  assert.equal(h.nodes.get('creation-thinking-label').textContent,'High');
  assert.equal(h.nodes.get('creation-context').textContent,'First project');
  assert.equal(h.nodes.get('creation-advanced').open,false);assert.equal(h.nodes.get('creation-model-menu').open,false);
  assert(h.nodes.get('creation-submit').disabled);assert(h.nodes.get('creation-recovery').hidden);
  h.nodes.get('creation-prompt').value='  ';h.nodes.get('creation-prompt').oninput();assert(h.nodes.get('creation-submit').disabled);
  h.nodes.get('creation-prompt').value='Implement a feature';h.nodes.get('creation-prompt').oninput();assert(!h.nodes.get('creation-submit').disabled);
  h.nodes.get('creation-model').value='';h.nodes.get('creation-model').oninput();assert.equal(h.nodes.get('creation-model-label').textContent,'Codex default');
  h.nodes.get('creation-thinking').value='';h.nodes.get('creation-thinking').onchange();assert.equal(h.nodes.get('creation-thinking-label').textContent,'');
  await h.api.submitCreation({preventDefault(){}});assert(h.nodes.get('creation-submit').disabled);assert(!h.nodes.get('creation-recovery').hidden);
});
test('confirmed partial creation locks resubmission and Retry group never calls create again',async()=>{
  const h=setup();await h.api.openCreation(group);h.nodes.get('creation-prompt').value='Implement a feature';
  await h.api.submitCreation({preventDefault(){}});await h.api.submitCreation({preventDefault(){}});
  assert.equal(h.requests.filter(r=>r.url==='/api/create').length,1);assert(h.nodes.get('creation-submit').disabled);
  assert(!h.nodes.get('creation-retry').hidden);assert.equal(h.nodes.get('creation-open').href,'codex://threads/'+localId);
  await h.api.retryCreationGroup();assert.equal(h.requests.filter(r=>r.url==='/api/create').length,1);
  assert(h.nodes.get('creation-retry').hidden);assert.equal(h.nodes.get('creation-message').textContent,'Group verified.');
});
test('unknown/pending outcomes keep the original operation frozen but allow explicitly starting another task',async()=>{
  for(const state of ['unknown','pending']){
    const h=setup({reply:{state,threadId:null,clientThreadId:state==='pending'?'client-id':null,groupAssigned:false,message:'Check Codex.'}});
    await h.api.openCreation(group);h.nodes.get('creation-prompt').value='Original task';await h.api.submitCreation({preventDefault(){}});
    assert(h.nodes.get('creation-open').hidden);assert(h.nodes.get('creation-retry').hidden);assert(!h.nodes.get('creation-next').hidden);
    await h.api.openCreation(group);assert.equal(h.requests.filter(r=>r.url==='/api/create').length,1);
    await h.nodes.get('creation-next').onclick();
    // The click returns immediately; wait for the options fetch continuation.
    await new Promise(r=>setImmediate(r));
    h.nodes.get('creation-prompt').value='Separate task';await h.api.submitCreation({preventDefault(){}});
    const requests=h.requests.filter(r=>r.url==='/api/create');assert.equal(requests.length,2);
    assert.notEqual(JSON.parse(requests[0].args.body).requestId,JSON.parse(requests[1].args.body).requestId);
  }
});
test('starting another task uses the newly selected group and project without changing the pending request',async()=>{
  for(const target of [{col:{id:'custom',name:'Research'},projectOverride:'two'},{col:group,projectOverride:null}]){
    const h=setup({reply:{state:'pending',clientThreadId:'queued',groupAssigned:false,message:'Check Codex.'}});
    await h.api.openCreation(group);h.nodes.get('creation-prompt').value='Original';await h.api.submitCreation({preventDefault(){}});
    await h.api.openCreation(target.col,false,target.projectOverride);
    assert.equal(new Script('creationSession.sectionId').runInContext(h.context),'review');
    await h.nodes.get('creation-next').onclick();await new Promise(r=>setImmediate(r));
    assert.equal(h.nodes.get('creation-title').textContent,'New task · '+target.col.name);
    h.nodes.get('creation-prompt').value='Separate';await h.api.submitCreation({preventDefault(){}});
    const bodies=h.requests.filter(r=>r.url==='/api/create').map(r=>JSON.parse(r.args.body));
    assert.equal(bodies.length,2);assert.equal(bodies[0].sectionId,'review');assert.equal(bodies[0].settings.projectId,'one');
    assert.equal(bodies[1].sectionId,target.col.id);assert.equal(bodies[1].settings.projectId,target.projectOverride);
    assert.notEqual(bodies[0].requestId,bodies[1].requestId);
  }
});
