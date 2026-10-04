import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {installKanban} from './install.mjs';
import {installDesktopBridge,readDesktopBridgeConfig,launchDesktopBridge} from './setup-desktop-bridge.mjs';

const source=dirname(fileURLToPath(import.meta.url));
async function fixture(t){
  const root=await mkdtemp(join(tmpdir(),'kb-i-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const app=join(root,'ChatGPT.app'),home=join(root,'home');
  const cli=join(app,'Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex');
  const nodePath=join(app,'Contents/Resources/cua_node/bin/node');
  for(const file of [cli,nodePath]){await mkdir(dirname(file),{recursive:true});await writeFile(file,'#!/bin/sh\nexit 0\n',{mode:0o700});}
  const calls=[];let alreadyAdded=false;
  const run=(bin,args)=>{
    calls.push({bin,args});
    if(bin==='/bin/ps')return join(app,'Contents/MacOS/ChatGPT');
    if(bin==='/usr/bin/open')return '';
    if(args[1]==='marketplace'&&args[2]==='add')return JSON.stringify({marketplaceName:'codex-kanban',alreadyAdded});
    if(args[1]==='marketplace'&&args[2]==='upgrade')return '{}';
    return JSON.stringify({pluginId:'codex-kanban@codex-kanban',version:'fixture',installedPath:source});
  };
  return {app,home,cli,nodePath,calls,run,originalIcon:false,set alreadyAdded(value){alreadyAdded=value;}};
}
test('one installer registers the official package, configures the bridge without a task ID and reveals the launcher',async t=>{
  const f=await fixture(t),result=await installKanban({...f,launch:true});
  assert.equal(result.phase,'restart-required');
  assert.deepEqual(f.calls.map(c=>c.args),[
    ['plugin','marketplace','add','shichang4fun/codex-kanban','--ref','marketplace','--json'],
    ['plugin','add','codex-kanban@codex-kanban','--json'],['-axo','args='],['-R',result.launcher]]);
  const config=await readDesktopBridgeConfig(join(f.home,'kanban-desktop'));
  assert.equal(config.nodePath,f.nodePath);assert.equal(config.app,f.app);assert(!('contextThreadId' in config));
  assert(!(await readFile(config.proxy,'utf8')).includes('KANBAN_CONTEXT_THREAD'));
  assert.equal(config.codexHome,f.home);
  assert((await readFile(result.launcher,'utf8')).includes(`export CODEX_HOME='${f.home}'`));
  assert.equal((await lstat(result.launcher)).mode&0o777,0o700);
});
test('Finder launch passes a custom CODEX_HOME even without an inherited terminal environment',async t=>{
  const f=await fixture(t),result=await installKanban(f),calls=[];
  const launched=await launchDesktopBridge(join(f.home,'kanban-desktop'),{run:(bin,args)=>{calls.push({bin,args});return '';}});
  assert.equal(launched.phase,'launching');
  assert(calls[1].args.includes('CODEX_HOME='+f.home));
  assert(calls[1].args.includes('CODEX_CLI_PATH='+join(f.home,'kanban-desktop','codex-proxy')));
  assert.equal((await lstat(result.launcher)).mode&0o777,0o700);
});
test('reinstall upgrades the marketplace and preserves a previously selected CLI chain',async t=>{
  const f=await fixture(t),chain=join(f.home,'custom-cli');await mkdir(f.home);await writeFile(chain,'#!/bin/sh\nexit 0\n',{mode:0o700});
  await installDesktopBridge({root:join(f.home,'kanban-desktop'),app:f.app,nodePath:f.nodePath,chainedCli:chain});
  f.alreadyAdded=true;await installKanban(f);
  assert.deepEqual(f.calls[1].args,['plugin','marketplace','upgrade','codex-kanban','--json']);
  assert.equal((await readDesktopBridgeConfig(join(f.home,'kanban-desktop'))).chainedCli,chain);
});
test('missing Desktop runtime and failed CLI installation do not leave a bridge behind',async t=>{
  const f=await fixture(t);await rm(f.cli);await assert.rejects(installKanban(f),/ENOENT/);assert.equal(f.calls.length,0);
  await writeFile(f.cli,'#!/bin/sh\nexit 0\n',{mode:0o700});
  await assert.rejects(installKanban({...f,run:()=>{throw Error('Offline');}}),/Offline/);
  await assert.rejects(lstat(join(f.home,'kanban-desktop')),/ENOENT/);
});
test('invalid existing bridge settings are preserved and reported',async t=>{
  const f=await fixture(t),root=join(f.home,'kanban-desktop');await mkdir(root,{recursive:true,mode:0o700});
  await writeFile(join(root,'connection.json'),'unrelated file');
  await assert.rejects(installKanban(f));assert.equal(await readFile(join(root,'connection.json'),'utf8'),'unrelated file');
});
