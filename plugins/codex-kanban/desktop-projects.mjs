import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {createJsonStore} from './creation-store.mjs';

const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const strings=value=>Array.isArray(value)&&value.every(v=>typeof v==='string');
export const defaultProjectRemovalStore=()=>createJsonStore(join(process.env.KANBAN_DATA_DIR
  ??join(process.env.CODEX_HOME??join(homedir(),'.codex'),'kanban'),'project-removals.json'));

// Desktop retains legacy assignments until their App Server migration finishes.
// Read the exact local host only; snapshots cannot prove migration is pending.
export function parseLocalProjects(data,codexHome=process.env.CODEX_HOME||join(homedir(),'.codex')){
  const host='local:'+resolve(codexHome);
  const migration=data?.['app-server-projects-migration-by-host']?.[host];
  const mapping=data?.['app-server-project-id-by-legacy-project-id-by-host']?.[host];
  const local=data?.['local-projects'];
  if(migration?.version!==1||migration.projectsMigrated!==true||typeof migration.threadAssignmentsMigrated!=='boolean'
    ||!record(mapping)||!record(local)||!strings(data['pinned-project-ids'])
    ||!strings(data['projectless-thread-ids'])||!record(data['thread-project-assignments'])
    ||(!migration.threadAssignmentsMigrated&&!strings(migration.pendingThreadAssignmentIds)))return {known:false};
  const projects=Object.entries(local).filter(([id,p])=>p?.id===id&&typeof p.name==='string'
    &&strings(p.rootPaths)&&typeof mapping[id]==='string'&&mapping[id]).map(([id,p])=>({
    projectId:id,label:p.name,rootPaths:p.rootPaths,nativeProjectId:mapping[id]
  }));
  const ids=new Set(projects.map(p=>p.projectId)),assignments={};
  for(const [id,a] of Object.entries(data['thread-project-assignments'])){
    const taskHost=data['thread-project-membership-host-ids']?.[id];
    if(a?.projectKind==='local'&&ids.has(a.projectId)&&(taskHost===undefined||taskHost==='local'))assignments[id]=a.projectId;
  }
  return {known:true,projects,assignments,pinnedProjectIds:data['pinned-project-ids'].filter(id=>ids.has(id)),
    projectlessThreadIds:data['projectless-thread-ids'],
    pendingThreadIds:migration.threadAssignmentsMigrated?[]:migration.pendingThreadAssignmentIds};
}

export async function readLocalProjects({codexHome=process.env.CODEX_HOME||join(homedir(),'.codex'),statePath=join(codexHome,'.codex-global-state.json'),removalStore=defaultProjectRemovalStore()}={}){
  try{
    const [data,removed]=await Promise.all([readFile(statePath,'utf8').then(JSON.parse),removalStore.read()]);
    const state=parseLocalProjects(data,codexHome);
    if(state.known)for(const [id,nativeId] of Object.entries(removed)){
      if(state.projects.some(p=>p.projectId===state.assignments[id]&&p.nativeProjectId===nativeId))delete state.assignments[id];
    }
    return state;
  }
  catch{return {known:false};}
}
