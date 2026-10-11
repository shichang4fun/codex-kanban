import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,relative} from 'node:path';
import {createLocalBoard} from './local-board.mjs';
import {readWorktreeProjects} from './worktree-projects.mjs';
import {harness,fixture as uiFixture} from './ui-test-helpers.mjs';
import {Script} from 'node:vm';
import {execFileSync} from 'node:child_process';

async function fixture(t){
  const root=await mkdtemp(join(tmpdir(),'kb-project-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const main=join(root,'main repository'),cwd=join(root,'different worktree name'),git=join(main,'.git','worktrees','checkout');
  await Promise.all([mkdir(git,{recursive:true}),mkdir(cwd)]);
  await Promise.all([writeFile(join(cwd,'.git'),'gitdir: '+relative(cwd,git)+'\n'),writeFile(join(git,'commondir'),'../..\n')]);
  const projects=[{id:'native-project',name:'Registered project',roots:[{path:main}]}];
  return {root,main,cwd,git,projects};
}

test('linked worktrees match registered Git identities including relative paths, spaces and symlinks',async t=>{
  const f=await fixture(t),alias=join(f.root,'alias');await symlink(f.main,alias);
  f.projects[0].roots.push({path:alias});
  assert.equal((await readWorktreeProjects([f.cwd],f.projects)).get(f.cwd),'native-project');
  const nested=join(f.cwd,'src');await mkdir(nested);
  assert.equal((await readWorktreeProjects([nested],f.projects)).get(nested),'native-project');
  f.projects[0].roots=[{path:f.cwd}];
  assert.equal((await readWorktreeProjects([nested],f.projects)).get(nested),'native-project');
});

test('ordinary checkouts, missing metadata and ambiguous projects never infer an association',async t=>{
  const f=await fixture(t),missing=join(f.root,'missing');
  let result=await readWorktreeProjects([f.main,missing],f.projects);
  assert.equal(result.get(f.main),null);assert.equal(result.get(missing),null);
  f.projects.push({...f.projects[0],id:'duplicate-project'});
  assert.equal((await readWorktreeProjects([f.cwd],f.projects)).get(f.cwd),null);
  await writeFile(join(f.git,'commondir'),'../missing');
  assert.equal((await readWorktreeProjects([f.cwd],f.projects)).get(f.cwd),null);
});

test('broken or malformed nested Git boundaries do not inherit the surrounding worktree project',async t=>{
  const f=await fixture(t),nested=join(f.cwd,'nested'),dotGit=join(nested,'.git');await mkdir(nested);
  await symlink(join(f.root,'missing'),dotGit);
  assert.equal((await readWorktreeProjects([nested],f.projects)).get(nested),null);
  await rm(dotGit);await writeFile(dotGit,'not a Git pointer');
  assert.equal((await readWorktreeProjects([nested],f.projects)).get(nested),null);
});

test('real Git linked worktrees inherit the registered project while a nested checkout stays separate',async t=>{
  const root=await mkdtemp(join(tmpdir(),'kb-real-git-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const main=join(root,'main'),linked=join(root,'linked'),nested=join(linked,'nested'),bare=join(linked,'nested-bare.git');
  const git=args=>execFileSync('git',args,{stdio:'pipe'});
  git(['init',main]);git(['-C',main,'-c','core.hooksPath=/dev/null','-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--allow-empty','-m','fixture']);
  git(['-C',main,'worktree','add','--detach',linked]);git(['init',nested]);git(['init','--bare',bare]);
  const invalid=join(linked,'invalid');await mkdir(invalid);await writeFile(join(invalid,'HEAD'),'invalid');
  const matches=await readWorktreeProjects([linked,nested,bare,join(bare,'objects'),invalid],[{id:'registered',roots:[{path:main}]}]);
  assert.equal(matches.get(linked),'registered');
  for(const cwd of [nested,bare,join(bare,'objects'),invalid])assert.equal(matches.get(cwd),null);
  const bareRoot=join(root,'registered.git'),bareLinked=join(root,'bare-linked');
  git(['clone','--bare',main,bareRoot]);git(['-C',bareRoot,'worktree','add','--detach',bareLinked,'HEAD']);
  const inherited=await readWorktreeProjects([bareRoot,bareLinked],[{id:'bare-project',roots:[{path:bareRoot}]}]);
  assert.equal(inherited.get(bareRoot),null);assert.equal(inherited.get(bareLinked),'bare-project');
});

test('explicit native null stays authoritative when the project catalog is unsupported; missing fields retain legacy fallback',async()=>{
  const id='11111111-1111-4111-8111-111111111111',row={id,ephemeral:false,parentThreadId:null,projectId:null,section:null};
  const snapshot={threads:[{id,kind:'codex',hostId:'local',projectId:'stale'}],projects:[{projectId:'stale',hostId:'local',label:'Stale project'}],sections:[]};
  const reader={async request(method){if(method==='project/list')throw Object.assign(Error('Unsupported'),{code:-32601});if(method==='threadSection/list')return {data:[]};return {data:[row]};}};
  let task=(await createLocalBoard(reader,snapshot).getBoard()).tasks[0];
  assert.equal(task.projectId,null);assert.equal(task.projectName,null);assert.equal(task.nativeSectionId,'chats');
  delete row.projectId;task=(await createLocalBoard(reader,snapshot).getBoard()).tasks[0];
  assert.equal(task.projectId,'stale');assert.equal(task.projectSource,'desktopSnapshot');
});

test('native-null worktree tasks inherit project display without changing assignment or own group',async t=>{
  const f=await fixture(t),id='11111111-1111-4111-8111-111111111111';
  const row={id,name:'Worktree task',cwd:f.cwd,ephemeral:false,parentThreadId:null,projectId:null,section:{id:'progress',name:'In Progress'}};
  const snapshot={threads:[{id,kind:'codex',hostId:'local',projectId:'wrong-stale-project'}],
    projects:[{projectId:'desktop-project',hostId:'local',label:'Old label',path:f.main}],sections:[]};
  const reader={async request(method){
    if(method==='project/list')return {data:f.projects};
    if(method==='threadSection/list')return {data:[{id:'progress',name:'In Progress'}]};
    assert.equal(method,'thread/list');return {data:[row]};
  }};
  const source=createLocalBoard(reader,snapshot),before=structuredClone(row);
  let task=(await source.getBoard()).tasks[0];
  assert.equal(task.projectId,'desktop-project');assert.equal(task.projectName,'Registered project');
  assert.equal(task.projectSource,'worktree');assert.equal(task.localProjectId,null);
  assert.equal(task.localSectionId,'progress');assert.equal(task.nativeSectionId,'progress');assert.deepEqual(row,before);
  // Missing Desktop snapshots must not hide a registered worktree association.
  task=(await createLocalBoard(reader,{threads:[],projects:[],sections:[]}).getBoard()).tasks[0];
  assert.equal(task.projectId,'native-project');assert.equal(task.projectName,'Registered project');
  f.projects.push({id:'explicit-project',name:'Explicit project',roots:[]});row.projectId='explicit-project';
  task=(await source.getBoard()).tasks[0];
  assert.equal(task.projectId,'explicit-project');assert.equal(task.projectSource,'native');assert.equal(task.localProjectId,'explicit-project');
});

for(const source of ['worktree','desktopPendingMigration'])test(`${source} inheritance is displayed in Board and List without offering a no-op native removal`,()=>{
  const board=uiFixture();board.sync.projectLocal=true;
  board.projects=[{projectId:'native-project',desktopProjectId:'desktop-project',hostId:'local',label:'Registered project'}];
  board.tasks=[{...board.tasks[0],projectId:'desktop-project',localProjectId:null,projectName:'Registered project',projectSource:source}];
  const h=harness(board);new Script("nativeConnected=true;nativeToken='fixture'").runInContext(h.context);
  for(const view of ['board','list']){
    h.api.setView(view);
    assert(h.nodes.get('board').querySelectorAll('.project').some(n=>n.children.some(c=>c.textContent==='Registered project')));
    new Script("openTaskMenu(DATA.tasks[0],document.getElementById('board'),'project')").runInContext(h.context);
    const choices=h.nodes.get('task-menu').querySelectorAll('.task-menu-item');
    const project=choices.find(n=>n.querySelector('.menu-label').textContent==='Registered project');
    assert(project);assert.equal(project.attributes['aria-checked'],'false');
    assert(!choices.some(n=>n.querySelector('.menu-label').textContent.startsWith('Remove from')));
    new Script("closeTaskMenu();updateProjectPicker(DATA.tasks[0])").runInContext(h.context);
    assert.equal(h.nodes.get('detail-project').value,'');
    assert.equal(h.nodes.get('detail-project').children[0].textContent,'Inherited from Registered project');
  }
});
