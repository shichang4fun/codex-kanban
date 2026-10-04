import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,chmod,symlink,copyFile,realpath} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {nativeCli,sidebarCli,selectedChain,preflight,pluginActive,validPath,quote} from './startup-runtime.mjs';
import {installDesktopBridge} from './setup-desktop-bridge.mjs';

const source=dirname(fileURLToPath(import.meta.url)),release='a'.repeat(64);
const shellQuote=quote;
async function put(file,text,mode=0o600){await mkdir(dirname(file),{recursive:true,mode:0o700});await writeFile(file,text,{mode});await chmod(file,mode);}
async function fixture(t){
  const root=await realpath(await mkdtemp('/tmp/kb-start-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const app=join(root,"Codex O'Brien.app"),native=join(app,'Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex');
  const trace=join(root,'trace.jsonl');
  await put(native,`#!${process.execPath}\nimport {appendFileSync} from 'node:fs';
appendFileSync(process.env.TEST_STARTUP_TRACE,JSON.stringify({stage:'native',args:process.argv.slice(2),cli:process.env.CODEX_CLI_PATH})+'\\n');
const chunks=[];for await(const chunk of process.stdin)chunks.push(chunk);process.stdout.write(Buffer.concat(chunks));process.exitCode=Number(process.env.TEST_NATIVE_EXIT||0);\n`,0o700);
  return {root,app,native,trace};
}
async function sidebar(f){
  const root=join(f.root,'Sidebar Flow'),proxy=join(root,'codex-proxy'),entry=join(root,'releases',release,'experimental/stdio-observer-proxy.mjs');
  await mkdir(root,{mode:0o700});await put(join(root,'.owner'),'codex-sidebar-flow-desktop-v1');
  const state={owner:'codex-sidebar-flow-desktop-v1',proxy,nodePath:process.execPath,release,realCodex:f.native};
  await put(join(root,'installation.json'),JSON.stringify(state));await put(join(root,'config.json'),'{}');
  await put(join(dirname(entry),'helper.mjs'),'export const ready=true;\n');
  await put(entry,`import './helper.mjs';
import {spawn} from 'node:child_process';import {appendFileSync} from 'node:fs';
appendFileSync(process.env.TEST_STARTUP_TRACE,JSON.stringify({stage:'sidebar',args:process.argv.slice(2)})+'\\n');
const child=spawn(process.env.SIDEBAR_FLOW_REAL_CODEX,process.argv.slice(2),{stdio:'inherit'});child.once('exit',code=>process.exitCode=code??1);
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>child.kill(signal));\n`);
  await put(proxy,`#!/bin/sh\nexport SIDEBAR_FLOW_REAL_CODEX=${shellQuote(f.native)}\nexport SIDEBAR_FLOW_CONFIG_FILE=${shellQuote(join(root,'config.json'))}\nexec ${shellQuote(process.execPath)} ${shellQuote(entry)} "$@"\n`,0o700);
  return {root,proxy,entry,state};
}
function launch(file,f,{args=['app-server','--test','space value',"quote'value"],input='{"id":1,"method":"initialize"}\nraw input\n',exit=0}={}){
  return spawnSync(file,args,{input,encoding:'utf8',timeout:10000,env:{...process.env,TEST_STARTUP_TRACE:f.trace,TEST_NATIVE_EXIT:String(exit)}});
}
async function stages(f){return (await readFile(f.trace,'utf8')).trim().split('\n').map(line=>JSON.parse(line));}
async function bridge(f,chainedCli=f.native){return installDesktopBridge({root:join(f.root,'bridge'),app:f.app,nodePath:process.execPath,chainedCli,codexHome:join(f.root,'codex-home')});}

test('native CLI resolution accepts only supported executable regular-file layouts',async t=>{
  const f=await fixture(t);assert.equal(await nativeCli(f.app),f.native);
  const relocated=join(f.app,'Contents/Resources/codex-cli/bin/codex');await put(relocated,'#!/bin/sh\nexit 0\n',0o700);
  await chmod(f.native,0o600);assert.equal(await nativeCli(f.app),relocated);
  await rm(f.native);await symlink(relocated,f.native);assert.equal(await nativeCli(f.app),relocated);
  await rm(relocated);await assert.rejects(nativeCli(f.app),/Official CLI unavailable/);
  for(const app of ['relative/app','/tmp/../app','/tmp/bad\napp'])await assert.rejects(nativeCli(app),/Invalid application path/);
  assert.equal(validPath('/tmp/a b'),true);
});

test('Sidebar preflight accepts a private owned installation and preserves native identity',async t=>{
  const f=await fixture(t),s=await sidebar(f);
  assert.equal(await sidebarCli(s.root,f.app),s.proxy);
  assert.equal(await selectedChain({app:f.app,chainedCli:s.proxy,proxy:join(f.root,'bridge/codex-proxy')}),s.proxy);
  for(const chainedCli of [f.native,'relative',join(f.root,'bridge/codex-proxy')])
    assert.equal(await selectedChain({app:f.app,chainedCli,proxy:join(f.root,'bridge/codex-proxy')}),f.native);
});

test('Sidebar missing runtime, config, entry or relative dependency falls back before launch',async t=>{
  for(const missing of ['node','config','entry','dependency'])await t.test(missing,async t=>{
    const f=await fixture(t),s=await sidebar(f);
    if(missing==='node'){s.state.nodePath=join(f.root,'missing-node');await put(join(s.root,'installation.json'),JSON.stringify(s.state));}
    else await rm(missing==='config'?join(s.root,'config.json'):missing==='entry'?s.entry:join(dirname(s.entry),'helper.mjs'));
    assert.equal(await sidebarCli(s.root,f.app),f.native);
    await assert.rejects(readFile(f.trace),{code:'ENOENT'});
  });
});

test('Sidebar ownership, manifest, native target and wrapper cycles fail closed',async t=>{
  for(const invalid of ['root permissions','owner','manifest','native target','symlink proxy','Kanban wrapper','original icon wrapper','self recursion'])await t.test(invalid,async t=>{
    const f=await fixture(t),s=await sidebar(f);
    if(invalid==='root permissions')await chmod(s.root,0o755);
    if(invalid==='owner')await put(join(s.root,'.owner'),'foreign-owner');
    if(invalid==='manifest')await put(join(s.root,'installation.json'),'{');
    if(invalid==='native target'){s.state.realCodex=s.proxy;await put(join(s.root,'installation.json'),JSON.stringify(s.state));}
    if(invalid==='symlink proxy'){const saved=s.proxy+'.saved';await copyFile(s.proxy,saved);await rm(s.proxy);await symlink(saved,s.proxy);}
    if(invalid.includes('wrapper')||invalid==='self recursion'){
      const extra=invalid==='Kanban wrapper'?'KANBAN_REAL_CODEX=bad':invalid==='original icon wrapper'?'exec codex-original-icon "$@"':'exec "$0" "$@"';
      await put(s.proxy,(await readFile(s.proxy,'utf8'))+extra+'\n',0o700);
    }
    assert.equal(await sidebarCli(s.root,f.app),f.native);
  });
});

test('Sidebar invalid configuration and unavailable imported dependencies are preflight failures',async t=>{
  for(const invalid of ['invalid config JSON','array config','null config','invalid imported syntax','bare dependency','dynamic relative dependency'])await t.test(invalid,async t=>{
    const f=await fixture(t),s=await sidebar(f);
    if(invalid==='invalid config JSON')await put(join(s.root,'config.json'),'{broken');
    if(invalid==='array config')await put(join(s.root,'config.json'),'[]');
    if(invalid==='null config')await put(join(s.root,'config.json'),'null');
    if(invalid==='invalid imported syntax')await put(join(dirname(s.entry),'helper.mjs'),'export const = ;');
    if(invalid==='bare dependency')await put(s.entry,"import 'missing-startup-package-for-test';\n");
    if(invalid==='dynamic relative dependency')await put(s.entry,"await import('./missing-dependency.mjs');\n");
    assert.equal(await sidebarCli(s.root,f.app),f.native);
    await assert.rejects(readFile(f.trace),{code:'ENOENT'});
  });
});

test('standalone preflight rejects missing node, entry, dependency and entry syntax without executing code',async t=>{
  const f=await fixture(t),entry=join(f.root,'entry.mjs');await put(entry,'throw Error("must not execute");\n');
  await preflight(process.execPath,entry);
  await assert.rejects(preflight(join(f.root,'missing-node'),entry));
  await assert.rejects(preflight(process.execPath,join(f.root,'missing-entry.mjs')));
  await put(entry,"import './missing.mjs';\n");await assert.rejects(preflight(process.execPath,entry));
  await put(entry,'const = ;\n');await assert.rejects(preflight(process.execPath,entry));
});

test('link-only preflight validates imports, reexports and literal dynamic dependency graphs without side effects',async t=>{
  const f=await fixture(t),entry=join(f.root,'entry.mjs'),dependency=join(f.root,'dependency.mjs'),other=join(f.root,'other.mjs');
  await put(dependency,"export const present=true;throw Error('dependency must not execute');\n");
  await put(entry,"import {present} from './dependency.mjs';import {readFile} from 'node:fs/promises';throw Error('entry must not execute');\n");
  await preflight(process.execPath,entry);
  await put(entry,"import {missing} from './dependency.mjs';\n");
  await assert.rejects(preflight(process.execPath,entry),/does not provide an export named 'missing'/);
  await put(entry,"export {missing} from './dependency.mjs';\n");
  await assert.rejects(preflight(process.execPath,entry),/does not provide an export named 'missing'/);
  await put(entry,"import {missing} from 'node:fs/promises';\n");
  await assert.rejects(preflight(process.execPath,entry),/does not provide an export named 'missing'/);
  await put(entry,"await import('./other.mjs');\n");
  await put(other,"import {missing} from './dependency.mjs';\n");
  await assert.rejects(preflight(process.execPath,entry),/does not provide an export named 'missing'/);
  await put(entry,"import './other.mjs';export const entryValue=true;throw Error('must not execute');\n");
  await put(other,"import {entryValue} from './entry.mjs';export const otherValue=true;\n");
  await preflight(process.execPath,entry);
  await assert.rejects(readFile(f.trace),{code:'ENOENT'});
});

test('Sidebar missing named exports fall back before any module side effects or protocol input',async t=>{
  const f=await fixture(t),s=await sidebar(f);
  await put(join(dirname(s.entry),'helper.mjs'),`import {appendFileSync} from 'node:fs';appendFileSync(${JSON.stringify(f.trace)},'unexpected side effect');export const ready=true;\n`);
  await put(s.entry,"import {missing} from './helper.mjs';\n");
  assert.equal(await sidebarCli(s.root,f.app),f.native);
  await assert.rejects(readFile(f.trace),{code:'ENOENT'});
  const config=await bridge(f,s.proxy),input='unconsumed protocol input\n';
  const result=launch(config.proxy,f,{args:['app-server'],input});
  assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,input);
  assert.deepEqual(await stages(f),[{stage:'native',args:['app-server'],cli:f.native}]);
});

test('plugin preflight rejects missing, malformed, unrelated and explicitly disabled installations',async t=>{
  const f=await fixture(t),route={pluginPath:join(f.root,'plugin'),codexHome:join(f.root,'home'),pluginId:'codex-kanban@test'};
  assert.equal(await pluginActive(route),false);
  await put(join(route.pluginPath,'plugin.json'),'{broken');assert.equal(await pluginActive(route),false);
  await put(join(route.pluginPath,'plugin.json'),JSON.stringify({name:'unrelated'}));assert.equal(await pluginActive(route),false);
  await put(join(route.pluginPath,'plugin.json'),JSON.stringify({name:'codex-kanban'}));assert.equal(await pluginActive(route),true);
  await put(join(route.codexHome,'config.toml'),'[plugins."codex-kanban@test"]\nenabled = false\n');assert.equal(await pluginActive(route),false);
  await put(join(route.codexHome,'config.toml'),'[plugins."other@test"]\nenabled = false\n[plugins."codex-kanban@test"]\nenabled = true\n');assert.equal(await pluginActive(route),true);
});

test('bridge shell falls back directly to native when Node or startup modules are unavailable',async t=>{
  for(const unavailable of ['Node','desktop-startup.mjs','startup-runtime.mjs'])await t.test(unavailable,async t=>{
    const f=await fixture(t),s=await sidebar(f),config=await bridge(f,s.proxy);
    if(unavailable==='Node'){
      const wrapper=(await readFile(config.proxy,'utf8')).replaceAll(shellQuote(process.execPath),shellQuote(join(f.root,'removed node')));
      await put(config.proxy,wrapper,0o700);
    }else await rm(join(config.root,'runtime',unavailable));
    const args=['app-server','--value','space value',"quote'value"],input='{"id":1}\npartial no newline';
    const result=launch(config.proxy,f,{args,input});assert.equal(result.error,undefined);assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,input);
    assert.deepEqual(await stages(f),[{stage:'native',args,cli:f.native}]);
  });
});

test('missing Kanban proxy preserves the validated Sidebar chain, arguments and all stdin bytes',async t=>{
  const f=await fixture(t),s=await sidebar(f),config=await bridge(f,s.proxy);await rm(join(config.root,'runtime/desktop-proxy.mjs'));
  const args=['app-server','--value','space value',"quote'value"],input='{"id":1}\npartial no newline';
  const result=launch(config.proxy,f,{args,input});assert.equal(result.error,undefined);assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,input);
  assert.match(result.stderr,/KANBAN_RUNTIME_UNAVAILABLE/);
  assert.deepEqual(await stages(f),[{stage:'sidebar',args},{stage:'native',args,cli:s.proxy}]);
});

test('missing Kanban dependency falls back once to native before protocol consumption',async t=>{
  const f=await fixture(t),config=await bridge(f);await rm(join(config.root,'runtime/desktop-archive.mjs'));
  const args=['app-server','--value','space value'],input='{"id":1}\npartial';
  const result=launch(config.proxy,f,{args,input});assert.equal(result.error,undefined);assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,input);
  assert.deepEqual(await stages(f),[{stage:'native',args,cli:f.native}]);
});

test('bridge shell resolves the relocated CLI and reports unavailable native layouts without launching',async t=>{
  const f=await fixture(t),config=await bridge(f),relocated=join(f.app,'Contents/Resources/codex-cli/bin/codex');
  await put(relocated,await readFile(f.native,'utf8'),0o700);await rm(f.native);await rm(join(config.root,'runtime/desktop-startup.mjs'));
  const args=['app-server'],input='first request\n';
  const result=launch(config.proxy,f,{args,input});assert.equal(result.error,undefined);assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,input);
  assert.deepEqual(await stages(f),[{stage:'native',args,cli:relocated}]);
  await rm(relocated);await rm(f.trace);
  const unavailable=launch(config.proxy,f,{args,input});assert.equal(unavailable.status,1);assert.match(unavailable.stderr,/CODEX_NATIVE_CLI_UNAVAILABLE/);assert.equal(unavailable.stdout,'');
  await assert.rejects(readFile(f.trace),{code:'ENOENT'});
});

test('native discovery and Node-free fallback refuse CLI parent symlinks escaping the application',async t=>{
  const f=await fixture(t),config=await bridge(f),external=join(f.root,'external-cli');
  await put(join(external,'codex'),await readFile(f.native,'utf8'),0o700);
  await rm(dirname(f.native),{recursive:true});await symlink(external,dirname(f.native));
  await assert.rejects(nativeCli(f.app),/Official CLI unavailable/);
  await rm(join(config.root,'runtime/desktop-startup.mjs'));
  const result=launch(config.proxy,f,{args:['app-server'],input:'must stay unconsumed\n'});
  assert.equal(result.status,1);assert.match(result.stderr,/CODEX_NATIVE_CLI_UNAVAILABLE/);assert.equal(result.stdout,'');
  await assert.rejects(readFile(f.trace),{code:'ENOENT'});
});

test('running Kanban preserves the Sidebar-to-native chain exactly once even after native failure',async t=>{
  const f=await fixture(t),s=await sidebar(f),config=await bridge(f,s.proxy),args=['app-server'],input='raw request\n';
  const result=launch(config.proxy,f,{args,input,exit:29});assert.equal(result.error,undefined);assert.equal(result.status,29,result.stderr);assert.equal(result.stdout,input);
  assert.deepEqual(await stages(f),[{stage:'sidebar',args},{stage:'native',args,cli:s.proxy}]);
});

test('a failed already-started native CLI is never retried through shell or imported proxy fallbacks',async t=>{
  for(const mode of ['shell fallback','missing Kanban proxy','running Kanban proxy'])await t.test(mode,async t=>{
    const f=await fixture(t),config=await bridge(f);
    if(mode==='shell fallback')await rm(join(config.root,'runtime/desktop-startup.mjs'));
    if(mode==='missing Kanban proxy')await rm(join(config.root,'runtime/desktop-proxy.mjs'));
    const args=['app-server'],input='raw non-JSON protocol bytes\n';
    const result=launch(config.proxy,f,{args,input,exit:23});assert.equal(result.error,undefined);assert.equal(result.status,23,result.stderr);assert.equal(result.stdout,input);
    assert.deepEqual(await stages(f),[{stage:'native',args,cli:f.native}]);
  });
});
