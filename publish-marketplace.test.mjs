import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile,rm,chmod,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {publishMarketplace} from './publish-marketplace.mjs';

const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const commit=cwd=>git(cwd,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','Fixture');
async function fixture(t){
  const root=await mkdtemp(join(tmpdir(),'kanban-publish-test-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const origin=join(root,'origin.git'),seed=join(root,'seed'),repository=join(root,'source'),packagePath=join(root,'package');
  await mkdir(seed);git(root,'init','--bare',origin);git(seed,'init','-b','main');
  const manifest={name:'codex-kanban',version:'0.4.41'};
  await writeFile(join(seed,'plugin.json'),JSON.stringify(manifest));git(seed,'add','.');commit(seed);
  git(seed,'remote','add','origin',origin);git(seed,'push','origin','main');
  git(seed,'switch','--orphan','marketplace');await writeFile(join(seed,'obsolete.txt'),'Old package');git(seed,'add','.');commit(seed);git(seed,'push','origin','marketplace');
  git(seed,'switch','main');git(root,'clone','--depth=1','--single-branch','--branch','main',pathToFileURL(origin).href,repository);
  const plugin=join(packagePath,'plugins','codex-kanban'),launcher=join(plugin,'launch-mcp');
  await mkdir(plugin,{recursive:true});await mkdir(join(packagePath,'.agents/plugins'),{recursive:true});
  await writeFile(join(packagePath,'README.md'),'Install Codex Kanban');
  await writeFile(join(packagePath,'Install Codex Kanban.command'),'#!/bin/sh\nexit 0\n',{mode:0o755});
  await writeFile(join(packagePath,'.agents/plugins/marketplace.json'),JSON.stringify({name:'codex-kanban',plugins:[{name:'codex-kanban',source:{source:'local',path:'./plugins/codex-kanban'}}]}));
  await writeFile(join(plugin,'plugin.json'),JSON.stringify(manifest));await writeFile(launcher,'#!/bin/sh\nexit 0\n',{mode:0o755});
  return {root,origin,seed,repository,packagePath,plugin,launcher};
}

test('shallow CI checkout publishes hidden metadata, executable launcher and history; identical package is a no-op',async t=>{
  const f=await fixture(t),before=git(f.origin,'rev-parse','marketplace'),head=git(f.repository,'rev-parse','HEAD');
  const result=await publishMarketplace(f);assert.equal(result.published,true);assert.equal(result.sourceCommit,head);
  const published=git(f.origin,'rev-parse','marketplace');assert.equal(published,result.commit);assert.notEqual(published,before);
  assert.equal(git(f.origin,'rev-parse','marketplace^'),before,'publication preserves marketplace history');
  assert.match(git(f.origin,'show','marketplace:.agents/plugins/marketplace.json'),/codex-kanban/);
  assert.match(git(f.origin,'ls-tree','marketplace','plugins/codex-kanban/launch-mcp'),/^100755/);
  assert.match(git(f.origin,'ls-tree','marketplace','Install Codex Kanban.command'),/^100755/);
  assert(!git(f.origin,'ls-tree','-r','--name-only','marketplace').includes('obsolete.txt'));
  assert.equal(git(f.repository,'rev-parse','HEAD'),head);assert.equal(git(f.repository,'status','--porcelain'),'');
  assert.equal(git(f.repository,'worktree','list','--porcelain').split('worktree ').length,2);
  assert.equal((await publishMarketplace(f)).published,false);assert.equal(git(f.origin,'rev-parse','marketplace'),published);
});

test('outdated source checkout cannot roll the public package back',async t=>{
  const f=await fixture(t),before=git(f.origin,'rev-parse','marketplace');
  await writeFile(join(f.seed,'new.txt'),'Newer source');git(f.seed,'add','.');commit(f.seed);git(f.seed,'push','origin','main');
  await assert.rejects(publishMarketplace(f),/latest commit/);assert.equal(git(f.origin,'rev-parse','marketplace'),before);
});

test('invalid launcher, version, private files and symlinks are rejected before any publication',async t=>{
  const f=await fixture(t),before=git(f.origin,'rev-parse','marketplace');
  await chmod(f.launcher,0o644);await assert.rejects(publishMarketplace(f),/executable/);await chmod(f.launcher,0o755);
  const manifest=await readFile(join(f.plugin,'plugin.json'));await writeFile(join(f.plugin,'plugin.json'),'{}');
  await assert.rejects(publishMarketplace(f),/version/);await writeFile(join(f.plugin,'plugin.json'),manifest);
  await writeFile(join(f.plugin,'snapshot.json'),'private');await assert.rejects(publishMarketplace(f),/Private/);await rm(join(f.plugin,'snapshot.json'));
  await symlink(f.launcher,join(f.plugin,'linked'));await assert.rejects(publishMarketplace(f),/symlinks/);
  assert.equal(git(f.origin,'rev-parse','marketplace'),before);
});

test('rejected remote push cleans up its temporary checkout and leaves main and marketplace intact',async t=>{
  const f=await fixture(t),before=git(f.origin,'rev-parse','marketplace'),head=git(f.repository,'rev-parse','HEAD');
  await writeFile(join(f.origin,'hooks/pre-receive'),'#!/bin/sh\nexit 1\n',{mode:0o755});
  await assert.rejects(publishMarketplace(f),/failed/);
  assert.equal(git(f.origin,'rev-parse','marketplace'),before);assert.equal(git(f.repository,'rev-parse','HEAD'),head);
  assert.equal(git(f.repository,'worktree','list','--porcelain').split('worktree ').length,2);assert.equal(git(f.repository,'status','--porcelain'),'');
});

test('a competing marketplace commit is preserved when it arrives just before publication pushes',async t=>{
  const f=await fixture(t),before=git(f.origin,'rev-parse','marketplace'),head=git(f.repository,'rev-parse','HEAD');
  const realGit=execFileSync('which',['git'],{encoding:'utf8'}).trim(),bin=join(f.root,'bin');await mkdir(bin);
  // Interpose only this fixture's push, to make the remote race deterministic.
  await writeFile(join(bin,'git'),`#!/bin/sh
if [ "$1" = push ] && [ "$3" = HEAD:refs/heads/marketplace ]; then
  "$KANBAN_TEST_REAL_GIT" -C "$KANBAN_TEST_SEED" switch marketplace || exit 1
  "$KANBAN_TEST_REAL_GIT" -C "$KANBAN_TEST_SEED" -c user.name=Fixture -c user.email=fixture@example.invalid commit --allow-empty -m 'Competing publication' || exit 1
  "$KANBAN_TEST_REAL_GIT" -C "$KANBAN_TEST_SEED" push origin marketplace || exit 1
fi
exec "$KANBAN_TEST_REAL_GIT" "$@"
`,{mode:0o755});
  const previous={PATH:process.env.PATH,KANBAN_TEST_REAL_GIT:process.env.KANBAN_TEST_REAL_GIT,KANBAN_TEST_SEED:process.env.KANBAN_TEST_SEED};
  Object.assign(process.env,{PATH:bin+':'+process.env.PATH,KANBAN_TEST_REAL_GIT:realGit,KANBAN_TEST_SEED:f.seed});
  try{await assert.rejects(publishMarketplace(f),/rejected|fetch first/);}
  finally{for(const [key,value] of Object.entries(previous))if(value===undefined)delete process.env[key];else process.env[key]=value;}
  const competitor=git(f.origin,'rev-parse','marketplace');assert.notEqual(competitor,before);
  assert.equal(git(f.origin,'log','-1','--format=%s','marketplace'),'Competing publication');
  assert.equal(git(f.origin,'rev-parse','marketplace^'),before);assert.equal(git(f.repository,'rev-parse','HEAD'),head);
  assert.equal(git(f.repository,'worktree','list','--porcelain').split('worktree ').length,2);
});
