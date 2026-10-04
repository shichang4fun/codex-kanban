import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {installKanban,checkKanbanInstallation} from './install.mjs';
import {installDesktopBridge,readDesktopBridgeConfig,launchDesktopBridge} from './setup-desktop-bridge.mjs';

const source=dirname(fileURLToPath(import.meta.url));
async function fixture(t){
  const root=await mkdtemp(join(tmpdir(),'kb-i-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const app=join(root,'ChatGPT.app'),home=join(root,'home');
  const cli=join(app,'Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex');
  const nodePath=join(app,'Contents/Resources/cua_node/bin/node');
  for(const file of [cli,nodePath]){await mkdir(dirname(file),{recursive:true});await writeFile(file,'#!/bin/sh\nexit 0\n',{mode:0o700});}
  const calls=[];let alreadyAdded=false;
  const version=JSON.parse(await readFile(join(source,'plugin.json'),'utf8')).version;
  const run=(bin,args)=>{
    calls.push({bin,args});
    if(bin==='/bin/ps')return join(app,'Contents/MacOS/ChatGPT');
    if(bin==='/usr/bin/open')return '';
    if(args[1]==='marketplace'&&args[2]==='add')return JSON.stringify({marketplaceName:'codex-kanban',alreadyAdded});
    if(args[1]==='marketplace'&&args[2]==='upgrade')return '{}';
    if(args[1]==='list')return JSON.stringify({installed:[{name:'codex-kanban',pluginId:'codex-kanban@codex-kanban',version,enabled:true}]});
    return JSON.stringify({pluginId:'codex-kanban@codex-kanban',version,installedPath:source});
  };
  return {app,home,homeDir:root,cli,nodePath,calls,run,originalIcon:false,set alreadyAdded(value){alreadyAdded=value;}};
}
test('one installer registers the official package, configures the bridge without a task ID and reveals the launcher',async t=>{
  const f=await fixture(t),result=await installKanban({...f,launch:true});
  assert.equal(result.phase,'restart-required');
  assert.deepEqual(f.calls.map(c=>c.args),[
    ['plugin','marketplace','add','shichang4fun/codex-kanban','--ref','marketplace','--json'],
    ['plugin','add','codex-kanban@codex-kanban','--json'],['-axo','args='],['-R',result.launcher],['plugin','list','--json']]);
  assert.equal(result.verification.phase,'waiting-for-chat');assert.equal(result.verification.guiVerified,false);
  const config=await readDesktopBridgeConfig(join(f.home,'kanban-desktop'));
  assert.equal(config.nodePath,f.nodePath);assert.equal(config.app,f.app);assert(!('contextThreadId' in config));
  assert(!(await readFile(config.proxy,'utf8')).includes('KANBAN_CONTEXT_THREAD'));
  assert.equal(config.codexHome,f.home);
  assert((await readFile(result.launcher,'utf8')).includes(`export CODEX_HOME='${f.home}'`));
  assert.equal((await lstat(result.launcher)).mode&0o777,0o700);
  assert.equal((await lstat(result.checker)).mode&0o777,0o700);
  assert((await readFile(result.checker,'utf8')).includes('--check'));
});

async function checkFixture(t){
  const f=await fixture(t);await installKanban(f);
  const version=JSON.parse(await readFile(join(source,'plugin.json'),'utf8')).version;
  const plugin={name:'codex-kanban',pluginId:'codex-kanban@codex-kanban',version,enabled:true};
  const status={bridgeVersion:version,connected:true,groupActions:true,runtimeAvailable:true,
    autoFlow:{available:true,enabled:true,initialization:{state:'ready'}}};
  const calls=[];
  const check=({plugins=[plugin],response=status,unavailable=false}={})=>checkKanbanInstallation({...f,
    run:(bin,args)=>{assert.equal(bin,f.cli);calls.push(args);return JSON.stringify({installed:plugins});},
    request:async(socket,method,params,timeout)=>{
      assert.equal(socket,join(f.home,'kanban-desktop','desktop.sock'));assert.equal(method,'status');
      assert.deepEqual(params,{});assert.equal(timeout,3000);
      if(unavailable)throw Object.assign(Error('Disconnected'),{status:503});return response;
    }});
  return {...f,version,plugin,status,check,calls};
}
test('installation checks confirm bridge readiness without mutating settings or claiming GUI verification',async t=>{
  const f=await checkFixture(t),path=join(f.home,'kanban-desktop','flow.json'),before=await readFile(path,'utf8');
  const result=await f.check();assert.equal(result.phase,'ready');assert.equal(result.guiVerified,false);
  assert.equal(result.autoOrganize,'enabled');assert.equal(result.version,f.version);
  assert.deepEqual(f.calls,[['plugin','list','--json']]);assert.equal(await readFile(path,'utf8'),before);
});
test('missing, disabled and duplicate plugins cannot pass installation verification',async t=>{
  const f=await checkFixture(t);
  for(const plugins of [[],[{...f.plugin,enabled:false}],[f.plugin,{...f.plugin,pluginId:'codex-kanban@codex-kanban-local'}]])
    assert.equal((await f.check({plugins})).phase,'needs-attention');
});
test('installation checks detect old running bridges, disconnected chats and missing capabilities',async t=>{
  const f=await checkFixture(t);
  for(const bridgeVersion of ['0.4.1',undefined])
    assert.equal((await f.check({response:{...f.status,bridgeVersion}})).phase,'restart-required');
  assert.equal((await f.check({unavailable:true})).phase,'waiting-for-chat');
  assert.equal((await f.check({response:{...f.status,connected:false}})).phase,'waiting-for-chat');
  assert.equal((await f.check({response:{...f.status,groupActions:false}})).phase,'needs-attention');
  assert.equal((await f.check({response:{...f.status,runtimeAvailable:false}})).phase,'needs-attention');
});
test('installation checks expose pending and failed group initialization without retrying writes',async t=>{
  const f=await checkFixture(t);
  for(const state of ['waiting','initializing','error']){
    const result=await f.check({response:{...f.status,autoFlow:{...f.status.autoFlow,initialization:{state,message:'Group diagnostic'}}}});
    assert.equal(result.phase,state==='error'?'needs-attention':'waiting-for-groups');assert.equal(result.message,'Group diagnostic');
  }
  assert.equal((await f.check({response:{...f.status,autoFlow:{available:false}}})).phase,'needs-attention');
  assert(f.calls.every(args=>JSON.stringify(args)===JSON.stringify(['plugin','list','--json'])));
});
test('installation checks preserve an intentionally disabled classification policy',async t=>{
  const f=await checkFixture(t),path=join(f.home,'kanban-desktop','flow.json'),settings=JSON.parse(await readFile(path,'utf8'));
  settings.enabled=false;await writeFile(path,JSON.stringify(settings));const before=await readFile(path,'utf8');
  const result=await f.check({response:{...f.status,autoFlow:{available:true,enabled:false,initialization:{state:'error'}}}});
  assert.equal(result.phase,'ready');assert.equal(result.autoOrganize,'disabled');assert.equal(await readFile(path,'utf8'),before);
});
test('installation checks reject mismatched or damaged bridge configuration',async t=>{
  const f=await checkFixture(t),path=join(f.home,'kanban-desktop','connection.json'),config=JSON.parse(await readFile(path,'utf8'));
  config.pluginVersion='0.4.1';await writeFile(path,JSON.stringify(config));
  assert.equal((await f.check()).phase,'needs-attention');await writeFile(path,'{broken');
  assert.equal((await f.check()).phase,'needs-attention');
  await writeFile(path,JSON.stringify({...config,pluginVersion:f.version,codexHome:join(f.home,'other-home')}));
  assert.equal((await f.check()).phase,'needs-attention');
});
test('Finder launch passes a custom CODEX_HOME even without an inherited terminal environment',async t=>{
  const f=await fixture(t),result=await installKanban(f),calls=[];
  const launched=await launchDesktopBridge(join(f.home,'kanban-desktop'),{run:(bin,args)=>{calls.push({bin,args});return '';}});
  assert.equal(launched.phase,'launching');
  assert(calls[1].args.includes('CODEX_HOME='+f.home));
  assert(calls[1].args.includes('CODEX_CLI_PATH='+join(f.home,'kanban-desktop','codex-proxy')));
  assert.equal((await lstat(result.launcher)).mode&0o777,0o700);
});
test('reinstall refuses to replace an unknown CLI chain while upgrading the marketplace',async t=>{
  const f=await fixture(t),chain=join(f.home,'custom-cli');await mkdir(f.home);await writeFile(chain,'#!/bin/sh\nexit 0\n',{mode:0o700});
  await installDesktopBridge({root:join(f.home,'kanban-desktop'),app:f.app,nodePath:f.nodePath,chainedCli:chain});
  f.alreadyAdded=true;await assert.rejects(installKanban(f),/unknown CLI chain/);
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
