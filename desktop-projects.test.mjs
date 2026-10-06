import test from 'node:test';
import assert from 'node:assert/strict';
import {parseLocalProjects,readLocalProjects} from './desktop-projects.mjs';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

function fixture(){return {
  'app-server-projects-migration-by-host':{'local:/fixture':{version:1,projectsMigrated:true,threadAssignmentsMigrated:false,pendingThreadAssignmentIds:['pending']}},
  'app-server-project-id-by-legacy-project-id-by-host':{'local:/fixture':{tools:'native-tools'}},
  'local-projects':{tools:{id:'tools',name:'Tools',rootPaths:['/a','/b']}},
  'pinned-project-ids':['tools'],'projectless-thread-ids':[],
  'thread-project-assignments':{pending:{projectKind:'local',projectId:'tools'},remote:{projectKind:'local',projectId:'tools'},cloud:{projectKind:'chatgpt',projectId:'tools'}},
  'thread-project-membership-host-ids':{remote:'durable'}
};}
test('local project state isolates the exact host and exposes pending migration without guessing',()=>{
  const data=fixture(),state=parseLocalProjects(data,'/fixture');
  assert(state.known);assert.deepEqual(state.assignments,{pending:'tools'});
  assert.deepEqual(state.projects[0].rootPaths,['/a','/b']);assert.equal(state.projects[0].nativeProjectId,'native-tools');
  assert.deepEqual(state.pendingThreadIds,['pending']);assert.deepEqual(state.pinnedProjectIds,['tools']);
  assert.equal(parseLocalProjects(data,'/other-home').known,false);
  data['app-server-projects-migration-by-host']['local:/fixture'].threadAssignmentsMigrated=true;
  assert.deepEqual(parseLocalProjects(data,'/fixture').pendingThreadIds,[]);
});
test('missing, corrupt and unsupported migration state cannot revive legacy project assignments',()=>{
  for(const alter of [d=>delete d['projectless-thread-ids'],d=>d['pinned-project-ids']=[null],
    d=>d['app-server-projects-migration-by-host']['local:/fixture'].version=2,
    d=>delete d['app-server-projects-migration-by-host']['local:/fixture'].pendingThreadAssignmentIds]){
    const data=fixture();alter(data);assert.equal(parseLocalProjects(data,'/fixture').known,false);
  }
  assert.equal(parseLocalProjects({},'/fixture').known,false);
});
test('verified project removals suppress pending assignments after a fresh read without editing Desktop state',async t=>{
  const root=await mkdtemp(join(tmpdir(),'kb-project-state-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const statePath=join(root,'state.json'),data=fixture();await writeFile(statePath,JSON.stringify(data));
  const removalStore={read:async()=>({pending:'native-tools'})};
  assert.deepEqual((await readLocalProjects({codexHome:'/fixture',statePath,removalStore})).assignments,{});
  removalStore.read=async()=>({pending:'other-project'});
  assert.deepEqual((await readLocalProjects({codexHome:'/fixture',statePath,removalStore})).assignments,{pending:'tools'});
});
