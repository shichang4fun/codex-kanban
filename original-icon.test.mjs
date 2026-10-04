import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,chmod,symlink,realpath,rename} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {installKanbanOriginalIcon,refreshKanbanOriginalIcon,disableKanbanOriginalIcon,emergencyDisableScript} from './original-icon.mjs';
import {installOriginalIcon} from './test-fixtures/sidebar-original-icon.mjs';
import {installDesktopBridge} from './setup-desktop-bridge.mjs';
import {quote} from './startup-runtime.mjs';

const ownLabel='io.github.codex-kanban.original-icon',legacyLabel='io.github.codex-sidebar-flow.original-icon';
const release='a'.repeat(64),uid=process.getuid();
async function put(file,text,mode=0o600){await mkdir(dirname(file),{recursive:true,mode:0o700});await writeFile(file,text,{mode});await chmod(file,mode);}
function launchd(){
  const jobs=new Map(),env=new Map(),calls=[];
  const system={platform:'darwin',uid,buffer:false,failOnce:null,jobs,env,calls,
    run(bin,args){
      assert.equal(bin,'/bin/launchctl');calls.push([...args]);
      const [op,...rest]=args;
      if(system.failOnce===op){system.failOnce=null;throw Error('injected '+op+' failure');}
      let text='';
      if(op==='getenv')text=env.get(rest[0])??'';
      else if(op==='setenv')env.set(rest[0],rest[1]);
      else if(op==='unsetenv')env.delete(rest[0]);
      else if(op==='print'){if(!jobs.has(rest[0]))throw Error('No such service');text=jobs.get(rest[0]);}
      else if(op==='bootout'){if(!jobs.delete(rest[0]))throw Error('No such service');}
      else if(op==='bootstrap'){
        const plist=readFileSync(rest[1],'utf8'),decode=s=>s.replaceAll('&amp;','&').replaceAll('&lt;','<').replaceAll('&gt;','>');
        const label=decode(plist.match(/<key>Label<\/key><string>(.*?)<\/string>/)[1]);
        const args=[...plist.match(/<key>ProgramArguments<\/key><array>(.*?)<\/array>/s)[1].matchAll(/<string>(.*?)<\/string>/g)].map(m=>decode(m[1]));
        const job=rest[0]+'/'+label;if(jobs.has(job))throw Error('Service already registered');
        jobs.set(job,`${job} = {\n\tpath = ${rest[1]}\n\tprogram = ${args[0]}\n\targuments = {\n${args.map(a=>'\t\t'+a+'\n').join('')}\t}\n}\n`);
      }else throw Error('Unexpected launchctl operation '+op);
      return system.buffer?Buffer.from(text):text;
    }};
  return system;
}
async function fixture(t,{legacy=false}={}){
  const dir=await realpath(await mkdtemp('/tmp/kb-icon-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const home=join(dir,'home'),app=join(dir,"Codex O'Brien.app"),native=join(app,'Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex');
  const trace=join(dir,'trace'),codexHome=join(dir,'custom-codex-home'),pluginPath=join(dir,'plugin'),system=launchd();
  await mkdir(home,{mode:0o700});await mkdir(codexHome,{mode:0o700});
  await put(native,`#!${process.execPath}\nimport {appendFileSync} from 'node:fs';
appendFileSync(process.env.TEST_ICON_TRACE,JSON.stringify({stage:'native',args:process.argv.slice(2),home:process.env.CODEX_HOME,cli:process.env.CODEX_CLI_PATH,kanban:process.env.KANBAN_TEST,sidebar:process.env.SIDEBAR_FLOW_TEST})+'\\n');
const chunks=[];for await(const chunk of process.stdin)chunks.push(chunk);process.stdout.write(Buffer.concat(chunks));process.exitCode=Number(process.env.TEST_ICON_EXIT||0);\n`,0o700);
  await put(join(pluginPath,'plugin.json'),JSON.stringify({name:'codex-kanban'}));
  const f={dir,home,app,native,trace,codexHome,pluginPath,system};
  if(legacy)await sidebar(f);
  f.bridge=await installDesktopBridge({root:join(dir,'bridge'),app,nodePath:process.execPath,chainedCli:f.sidebar?.proxy??native,codexHome});
  f.options={root:f.bridge.root,pluginPath,pluginId:'codex-kanban@test',homeDir:home};
  if(legacy){
    f.old=await installOriginalIcon({root:f.sidebar.root,homeDir:home},system);
    f.oldHelper=await readFile(join(dirname(f.old.shim),'original-icon.mjs'),'utf8');
    f.oldShim=await readFile(f.old.shim,'utf8');f.oldPlist=await readFile(f.old.plist,'utf8');
    f.oldState=await readFile(join(dirname(f.old.shim),'installation.json'),'utf8');
  }
  return f;
}
async function sidebar(f){
  const root=join(f.home,'Applications/Codex Sidebar Flow'),proxy=join(root,'codex-proxy'),entry=join(root,'releases',release,'experimental/stdio-observer-proxy.mjs');
  await put(join(root,'.owner'),'codex-sidebar-flow-desktop-v1');
  await put(join(root,'installation.json'),JSON.stringify({owner:'codex-sidebar-flow-desktop-v1',proxy,nodePath:process.execPath,realCodex:f.native,release}));
  await put(join(root,'config.json'),'{}');
  await put(entry,`import {spawn} from 'node:child_process';import {appendFileSync} from 'node:fs';
appendFileSync(process.env.TEST_ICON_TRACE,JSON.stringify({stage:'sidebar',args:process.argv.slice(2)})+'\\n');
const child=spawn(process.env.SIDEBAR_FLOW_REAL_CODEX,process.argv.slice(2),{stdio:'inherit'});child.once('exit',code=>process.exitCode=code??1);\n`);
  await put(proxy,`#!/bin/sh\nexport SIDEBAR_FLOW_REAL_CODEX=${quote(f.native)}\nexport SIDEBAR_FLOW_CONFIG_FILE=${quote(join(root,'config.json'))}\nexec ${quote(process.execPath)} ${quote(entry)} "$@"\n`,0o700);
  f.sidebar={root,proxy,entry};
}
async function install(f){f.result=await installKanbanOriginalIcon(f.options,f.system);return f.result;}
async function absent(file){await assert.rejects(readFile(file),{code:'ENOENT'});}
async function snapshot(paths){return Promise.all(paths.map(async p=>[p,await readFile(p,'utf8').catch(e=>{if(e.code==='ENOENT')return null;throw e;})]));}
async function unchanged(before){assert.deepEqual(await snapshot(before.map(([p])=>p)),before);}
function launch(f,args=['app-server','--arg','space value',"quote'value"],input='first request\npartial',exit=0){
  return spawnSync(f.result.shim,args,{input,encoding:'utf8',timeout:20000,env:{...process.env,CODEX_CLI_PATH:f.result.shim,TEST_ICON_TRACE:f.trace,TEST_ICON_EXIT:String(exit),KANBAN_TEST:'must-clear',SIDEBAR_FLOW_TEST:'must-clear'}});
}
async function trace(f){return (await readFile(f.trace,'utf8')).trim().split('\n').map(JSON.parse);}
async function emergency(f){
  const legacy=f.result.adoptedSidebarFlow,label=legacy?legacyLabel:ownLabel;
  const state=join(f.dir,'mock-launchd'),job=join(state,'job'),env=join(state,'env'),calls=join(state,'calls'),mock=join(state,'launchctl');
  await put(job,f.system.jobs.get(`gui/${uid}/${label}`));await put(env,f.system.env.get('CODEX_CLI_PATH')??'');
  await put(mock,`#!/bin/sh
printf '%s\\n' "$*" >> ${quote(calls)}
case "$1" in
print) [ -f ${quote(job)} ] || exit 1; /bin/cat ${quote(job)};;
getenv) [ ! -f ${quote(env)} ] || /bin/cat ${quote(env)};;
unsetenv) /bin/rm -f ${quote(env)};;
bootout) [ ! -f ${quote(join(state,'fail-bootout'))} ] || exit 7; /bin/rm -f ${quote(job)};;
*) exit 99;;
esac
`,0o700);
  const script=join(f.dir,'emergency.command');
  await put(script,emergencyDisableScript({support:f.result.support,legacy,label,uid,agentNode:process.execPath,
    helper:join(f.result.support,legacy?'original-icon.mjs':'kanban-original-icon.mjs'),plist:f.result.plist,shim:f.result.shim,home:f.home},mock),0o700);
  return {state,job,env,calls,script,run:()=>spawnSync('/bin/sh',[script],{encoding:'utf8',timeout:10000,env:{PATH:'/no-node-runtime'}})};
}

test('original icon creates exactly one owned agent; repeat install and login refresh are idempotent',async t=>{
  const f=await fixture(t),result=await install(f);
  assert.equal(result.adoptedSidebarFlow,false);assert.equal(f.system.jobs.size,1);assert.equal(f.system.env.get('CODEX_CLI_PATH'),result.shim);
  const first=await snapshot([result.plist,result.shim,join(result.support,'kanban-route.json')]);
  await install(f);await unchanged(first);assert.equal(f.system.calls.filter(c=>c[0]==='bootstrap').length,1);
  f.system.env.delete('CODEX_CLI_PATH');await refreshKanbanOriginalIcon({support:result.support},f.system);
  assert.equal(f.system.env.get('CODEX_CLI_PATH'),result.shim);assert.equal(f.system.jobs.size,1);
});

test('real execFileSync Buffer-valued launchctl runner is normalized on install, refresh and disable',async t=>{
  const f=await fixture(t);f.system.buffer=true;await install(f);await install(f);
  await refreshKanbanOriginalIcon({support:f.result.support},f.system);await disableKanbanOriginalIcon({support:f.result.support},f.system);
  assert.equal(f.system.jobs.size,0);assert.equal(f.system.env.has('CODEX_CLI_PATH'),false);
});

test('adoption keeps legacy plist/state/label; uninstall restores byte-identical legacy helper and shim',async t=>{
  const f=await fixture(t,{legacy:true});await install(f);
  assert.equal(f.result.adoptedSidebarFlow,true);assert.equal(f.system.jobs.size,1);assert(f.system.jobs.has(`gui/${uid}/${legacyLabel}`));
  assert.equal(await readFile(f.old.plist,'utf8'),f.oldPlist);assert.equal(await readFile(join(f.result.support,'installation.json'),'utf8'),f.oldState);
  const result=await disableKanbanOriginalIcon({support:f.result.support},f.system);assert.equal(result.sidebarFlowPreserved,true);
  assert.equal(await readFile(join(f.result.support,'original-icon.mjs'),'utf8'),f.oldHelper);assert.equal(await readFile(f.old.shim,'utf8'),f.oldShim);
  assert.equal(await readFile(f.old.plist,'utf8'),f.oldPlist);assert.equal(f.system.jobs.size,1);assert.equal(f.system.env.get('CODEX_CLI_PATH'),f.old.shim);
  await absent(join(f.result.support,'kanban-route.json'));assert.equal(await readFile(join(f.result.support,'kanban-helper.before'),'utf8'),f.oldHelper);
});

test('installed legacy refresh and reinstall regenerate the Kanban stable shim without state migration',async t=>{
  const f=await fixture(t,{legacy:true});await install(f);
  const helper=await import(pathToFileURL(join(f.result.support,'original-icon.mjs')));
  const shim=await readFile(f.result.shim,'utf8');await put(f.result.shim,f.oldShim,0o700);
  await helper.refreshOriginalIcon({homeDir:f.home},f.system);assert.equal(await readFile(f.result.shim,'utf8'),shim);
  await helper.installOriginalIcon({root:f.sidebar.root,homeDir:f.home},f.system);
  assert.equal(await readFile(f.result.shim,'utf8'),shim);assert.match(await readFile(join(f.result.support,'original-icon.mjs'),'utf8'),/codex-kanban-original-icon-v1 hook/);
  assert.equal(await readFile(join(f.result.support,'installation.json'),'utf8'),f.oldState);assert.equal(f.system.jobs.size,1);
});

test('reinstall recovers only exact pristine legacy updater output; arbitrary edits stay untouched',async t=>{
  const f=await fixture(t,{legacy:true});await install(f);
  await installOriginalIcon({root:f.sidebar.root,homeDir:f.home},f.system);
  assert.equal(await readFile(f.result.shim,'utf8'),f.oldShim);
  await install(f);assert.match(await readFile(f.result.shim,'utf8'),/--dispatch/);
  await put(join(f.result.support,'original-icon.mjs'),f.oldHelper+'\n// unrelated user edit\n');
  const before=await snapshot([f.result.shim,join(f.result.support,'original-icon.mjs'),f.result.plist,join(f.result.support,'kanban-route.json')]);
  await assert.rejects(install(f),/changed after/);await unchanged(before);assert.equal(f.system.jobs.size,1);
});

test('owned uninstall removes its agent and override but preserves bridge, plugin and user configuration',async t=>{
  const f=await fixture(t);await install(f);
  const before=await snapshot([join(f.bridge.root,'connection.json'),join(f.pluginPath,'plugin.json')]);
  await disableKanbanOriginalIcon({support:f.result.support},f.system);await unchanged(before);
  assert.equal(f.system.jobs.size,0);assert.equal(f.system.env.has('CODEX_CLI_PATH'),false);await absent(f.result.plist);await absent(f.result.shim);
  await install(f);assert.equal(f.system.jobs.size,1);
});

test('foreign GUI override blocks install and refresh; uninstall preserves a subsequently foreign override',async t=>{
  const f=await fixture(t);f.system.env.set('CODEX_CLI_PATH','/foreign/codex');await assert.rejects(install(f),/Conflicting/);
  assert.equal(f.system.jobs.size,0);f.system.env.clear();await install(f);f.system.env.set('CODEX_CLI_PATH','/foreign/codex');
  const before=await snapshot([f.result.shim,f.result.plist]);await assert.rejects(refreshKanbanOriginalIcon({support:f.result.support},f.system),/Conflicting/);await unchanged(before);
  await disableKanbanOriginalIcon({support:f.result.support},f.system);assert.equal(f.system.env.get('CODEX_CLI_PATH'),'/foreign/codex');
});

test('unknown same-label registration and orphan alternative agent are never adopted or stopped',async t=>{
  for(const label of [ownLabel,legacyLabel])await t.test(label,async t=>{
    const f=await fixture(t);f.system.jobs.set(`gui/${uid}/${label}`,'foreign registered job');
    await assert.rejects(install(f),/Foreign registered|Another original/);assert.equal(f.system.jobs.size,1);
    assert.equal(f.system.calls.some(c=>['bootout','bootstrap','setenv'].includes(c[0])),false);
  });
});

test('symlink integration parents/files and publicly readable routes fail closed with byte preservation',async t=>{
  for(const invalid of ['parent','shim','route','support permissions','route permissions'])await t.test(invalid,async t=>{
    const f=await fixture(t);
    if(invalid==='parent'){
      const target=join(f.dir,'other-library');await mkdir(target,{mode:0o700});await symlink(target,join(f.home,'Library'));
      await assert.rejects(install(f),/Unsafe integration parent/);assert.equal(f.system.jobs.size,0);return;
    }
    await install(f);
    const file=invalid==='shim'?f.result.shim:join(f.result.support,'kanban-route.json');
    if(invalid==='shim'||invalid==='route'){await rename(file,file+'.saved');await symlink(file+'.saved',file);}
    else await chmod(invalid==='support permissions'?f.result.support:file,0o755);
    const before=await snapshot([f.result.shim,f.result.plist,join(f.result.support,'kanban-route.json')]);
    await assert.rejects(install(f),/Unsafe startup file|Private owned directory/);await unchanged(before);assert.equal(f.system.jobs.size,1);
  });
});

test('bootstrap or setenv failure rolls back generated files and never leaves a GUI override or job',async t=>{
  for(const op of ['bootstrap','setenv'])await t.test(op,async t=>{
    const f=await fixture(t);f.system.failOnce=op;await assert.rejects(install(f),new RegExp('injected '+op));
    assert.equal(f.system.jobs.size,0);assert.equal(f.system.env.has('CODEX_CLI_PATH'),false);
    const support=join(f.home,'Library/Application Support/Codex Kanban Original Icon');
    for(const file of ['kanban-route.json','kanban-original-icon.mjs','startup-runtime.mjs','codex-original-icon'])await absent(join(support,file));
    await install(f);assert.equal(f.system.jobs.size,1);
  });
});

test('failed legacy adoption restores existing helper/shim/plist/state and leaves its registered job intact',async t=>{
  const f=await fixture(t,{legacy:true});f.system.failOnce='setenv';await assert.rejects(install(f),/injected setenv/);
  assert.equal(await readFile(join(dirname(f.old.shim),'original-icon.mjs'),'utf8'),f.oldHelper);assert.equal(await readFile(f.old.shim,'utf8'),f.oldShim);
  assert.equal(await readFile(f.old.plist,'utf8'),f.oldPlist);assert.equal(await readFile(join(dirname(f.old.shim),'installation.json'),'utf8'),f.oldState);
  assert.equal(f.system.jobs.size,1);assert.equal(f.system.env.get('CODEX_CLI_PATH'),f.old.shim);
});

test('known disabled plist can be reenabled; a modified disabled plist is preserved',async t=>{
  for(const modified of [false,true])await t.test(String(modified),async t=>{
    const f=await fixture(t);await install(f);f.system.jobs.clear();f.system.env.clear();await rename(f.result.plist,f.result.plist+'.disabled');
    if(modified)await put(f.result.plist+'.disabled','foreign plist');
    if(modified){await assert.rejects(install(f),/Modified disabled/);assert.equal(await readFile(f.result.plist+'.disabled','utf8'),'foreign plist');assert.equal(f.system.jobs.size,0);}
    else {await install(f);assert.equal(f.system.jobs.size,1);assert.equal(f.system.env.get('CODEX_CLI_PATH'),f.result.shim);}
  });
});

test('explicitly disabled unadopted Sidebar Flow original-icon integration is not silently reenabled',async t=>{
  const f=await fixture(t,{legacy:true});await rename(f.old.plist,f.old.plist+'.disabled');f.system.jobs.clear();f.system.env.clear();
  await assert.rejects(install(f),/is disabled/);assert.equal(f.system.jobs.size,0);assert.equal(await readFile(f.old.shim,'utf8'),f.oldShim);
});

test('modified generated helper or original backup prevents destructive uninstall',async t=>{
  for(const invalid of ['helper','backup'])await t.test(invalid,async t=>{
    const f=await fixture(t,{legacy:true});await install(f);
    const file=join(f.result.support,invalid==='helper'?'original-icon.mjs':'kanban-helper.before');await put(file,(await readFile(file,'utf8'))+'\n// external edit\n');
    const before=await snapshot([file,f.result.shim,f.result.plist,join(f.result.support,'kanban-route.json')]);
    await assert.rejects(disableKanbanOriginalIcon({support:f.result.support},f.system),/Modified integration/);await unchanged(before);assert.equal(f.system.jobs.size,1);
  });
});

test('dispatch preserves stdin/argv/custom CODEX_HOME, clears stale proxy variables and starts each CLI once',async t=>{
  const f=await fixture(t,{legacy:true});await install(f);
  const args=['app-server','--arg','space value',"quote'value"],input='raw request\npartial';
  const result=launch(f,args,input);assert.equal(result.error,undefined);assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,input);
  assert.deepEqual(await trace(f),[{stage:'sidebar',args},{stage:'native',args,home:f.codexHome,cli:f.sidebar.proxy}]);
});

test('a started native CLI failure propagates once through the original icon without replaying stdin',async t=>{
  for(const fallback of [false,true])await t.test(String(fallback),async t=>{
    const f=await fixture(t,{legacy:true});await install(f);
    if(fallback)await rm(join(f.result.support,'kanban-original-icon.mjs'));
    const result=launch(f,['app-server'],'request must not replay\n',29);
    assert.equal(result.status,29,result.stderr);assert.equal(result.stdout,'request must not replay\n');
    assert.equal((await trace(f)).filter(x=>x.stage==='native').length,1);
  });
});

test('a recursive original-icon or bridge chain is refused before any GUI integration changes',async t=>{
  for(const cycle of ['bridge','original icon'])await t.test(cycle,async t=>{
    const f=await fixture(t);
    f.bridge.chainedCli=cycle==='bridge'?f.bridge.proxy:join(f.home,'Library/Application Support/Codex Kanban Original Icon/codex-original-icon');
    await put(join(f.bridge.root,'connection.json'),JSON.stringify(f.bridge));
    await assert.rejects(install(f),/Proxy cycle/);assert.equal(f.system.jobs.size,0);assert.equal(f.system.env.size,0);
  });
});

test('missing or disabled plugin and unavailable Kanban runtime preserve Sidebar Flow',async t=>{
  for(const invalid of ['missing plugin','disabled plugin','missing startup','missing proxy'])await t.test(invalid,async t=>{
    const f=await fixture(t,{legacy:true});await install(f);
    if(invalid==='missing plugin')await rm(join(f.pluginPath,'plugin.json'));
    if(invalid==='disabled plugin')await put(join(f.codexHome,'config.toml'),'[plugins."codex-kanban@test"]\nenabled = false\n');
    if(invalid==='missing startup')await rm(join(f.bridge.root,'runtime/desktop-startup.mjs'));
    if(invalid==='missing proxy')await rm(join(f.bridge.root,'runtime/desktop-proxy.mjs'));
    const result=launch(f);assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,'first request\npartial');
    assert.deepEqual((await trace(f)).map(x=>x.stage),['sidebar','native']);
  });
});

test('missing Sidebar Flow entry or configuration safely dispatches directly to the official CLI',async t=>{
  for(const invalid of ['entry','config'])await t.test(invalid,async t=>{
    const f=await fixture(t,{legacy:true});await install(f);await rm(join(f.pluginPath,'plugin.json'));
    await rm(invalid==='entry'?f.sidebar.entry:join(f.sidebar.root,'config.json'));
    const result=launch(f);assert.equal(result.status,0,result.stderr);assert.deepEqual((await trace(f)).map(x=>x.stage),['native']);
  });
});

test('corrupt startup route and missing routing runtime fall back to native without consuming stdin',async t=>{
  for(const invalid of ['route','routing module','routing core'])await t.test(invalid,async t=>{
    const f=await fixture(t);await install(f);
    if(invalid==='route')await put(join(f.result.support,'kanban-route.json'),'{broken');
    else await rm(join(f.result.support,invalid==='routing module'?'kanban-original-icon.mjs':'startup-runtime.mjs'));
    const result=launch(f);assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,'first request\npartial');
    const [native]=await trace(f);
    assert.equal(native.stage,'native');assert.deepEqual(native.args,['app-server','--arg','space value',"quote'value"]);
    assert.equal(native.home,f.codexHome);assert.equal(native.cli,f.native);
    if(invalid==='route'){assert.equal(native.kanban,undefined);assert.equal(native.sidebar,undefined);}
  });
});

test('pure-shell emergency disable survives broken Node routing and preserves both plugins configuration',{skip:process.platform!=='darwin'&&'Recovery script uses macOS stat/launchd tools'},async t=>{
  for(const legacy of [false,true])await t.test(String(legacy),async t=>{
    const f=await fixture(t,{legacy});await install(f);const e=await emergency(f),plist=await readFile(f.result.plist,'utf8');
    await rm(join(f.result.support,'kanban-original-icon.mjs'));await rm(join(f.result.support,'startup-runtime.mjs'));
    await put(join(f.result.support,'kanban-route.json'),'{broken');
    const before=await snapshot([f.result.shim,join(f.bridge.root,'connection.json'),join(f.pluginPath,'plugin.json'),join(f.result.support,'kanban-route.json')]);
    const result=e.run();assert.equal(result.error,undefined);assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/No plugin data was removed/);
    await absent(e.job);await absent(e.env);await absent(f.result.plist);assert.equal(await readFile(f.result.plist+'.disabled','utf8'),plist);await unchanged(before);
    assert.match(await readFile(e.calls,'utf8'),/bootout/);assert.match(await readFile(e.calls,'utf8'),/unsetenv CODEX_CLI_PATH/);
    const again=e.run();assert.equal(again.status,0,again.stderr);
  });
});

test('emergency disable refuses foreign plist or registered job and preserves a foreign override',{skip:process.platform!=='darwin'&&'Recovery script uses macOS stat/launchd tools'},async t=>{
  for(const invalid of ['plist','job','override','bootout failure'])await t.test(invalid,async t=>{
    const f=await fixture(t);await install(f);const e=await emergency(f);
    if(invalid==='plist')await put(f.result.plist,'foreign plist');
    if(invalid==='job')await put(e.job,'foreign loaded job');
    if(invalid==='override')await put(e.env,'/foreign/codex');
    if(invalid==='bootout failure')await put(join(e.state,'fail-bootout'),'1');
    const before=await snapshot([f.result.plist,e.job,e.env,f.result.shim]);
    const result=e.run();
    if(invalid==='override'){
      assert.equal(result.status,0,result.stderr);assert.equal(await readFile(e.env,'utf8'),'/foreign/codex');
      assert.doesNotMatch(await readFile(e.calls,'utf8'),/unsetenv/);
    }else{assert.notEqual(result.status,0);await unchanged(before);}
  });
});

test('emergency disables owned registration and ordinary reinstall restores it without duplicate jobs',{skip:process.platform!=='darwin'&&'Recovery script uses macOS stat/launchd tools'},async t=>{
  for(const legacy of [false,true])await t.test(String(legacy),async t=>{
    const f=await fixture(t,{legacy});await install(f);const e=await emergency(f);assert.equal(e.run().status,0);
    // Reflect the isolated shell mock's final state in the in-process launchd fake.
    f.system.jobs.clear();f.system.env.clear();await install(f);
    assert.equal(f.system.jobs.size,1);assert.equal(f.system.env.get('CODEX_CLI_PATH'),f.result.shim);
  });
});

test('syntax-broken original routing module/core and missing own helper can be recovered safely',async t=>{
  for(const broken of ['module syntax','core syntax','missing own helper'])await t.test(broken,async t=>{
    const f=await fixture(t);await install(f);
    const file=join(f.result.support,broken==='core syntax'?'startup-runtime.mjs':'kanban-original-icon.mjs');
    if(broken==='missing own helper')await rm(file);else await put(file,'export const = ;\n');
    const result=launch(f);assert.equal(result.status,0,result.stderr);assert.deepEqual((await trace(f)).map(x=>x.stage),['native']);
    if(broken==='missing own helper'){await install(f);assert.match(await readFile(file,'utf8'),/installKanbanOriginalIcon/);}
  });
});

test('valid-syntax routing dependency with a missing named export falls back before protocol input',async t=>{
  const f=await fixture(t);await install(f);const core=join(f.result.support,'startup-runtime.mjs');
  await put(core,(await readFile(core,'utf8')).replace('export function forward','function forward'));
  const result=launch(f);assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,'first request\npartial');
  const records=await trace(f);assert.equal(records.length,1);assert.equal(records[0].stage,'native');assert.equal(records[0].home,f.codexHome);assert.equal(records[0].cli,f.native);
});

test('emergency shutdown followed by normal own detach removes its disabled plist and all owned routing files',{skip:process.platform!=='darwin'&&'Recovery script uses macOS stat/launchd tools'},async t=>{
  const f=await fixture(t);await install(f);const e=await emergency(f);assert.equal(e.run().status,0);
  f.system.jobs.clear();f.system.env.clear();const before=await snapshot([join(f.bridge.root,'connection.json'),join(f.pluginPath,'plugin.json')]);
  await disableKanbanOriginalIcon({support:f.result.support},f.system);await unchanged(before);
  await absent(f.result.plist);await absent(f.result.plist+'.disabled');await absent(f.result.shim);
  for(const file of ['kanban-route.json','kanban-original-icon.mjs','startup-runtime.mjs','Disable Kanban Original Icon.command','Emergency Disable Original Icon.command'])await absent(join(f.result.support,file));
  await install(f);assert.equal(f.system.jobs.size,1);
});

test('changed retained legacy backups block later adoption without overwriting the preserved bytes',async t=>{
  for(const file of ['kanban-helper.before','kanban-shim.before'])await t.test(file,async t=>{
    const f=await fixture(t,{legacy:true});await install(f);await disableKanbanOriginalIcon({support:f.result.support},f.system);
    const backup=join(f.result.support,file);await put(backup,(await readFile(backup,'utf8'))+'\n// retained foreign edit\n');
    const before=await snapshot([backup,join(f.result.support,'original-icon.mjs'),f.result.shim,f.result.plist]);
    await assert.rejects(install(f),/Modified integration backup/);await unchanged(before);assert.equal(f.system.jobs.size,1);
  });
});

test('foreign edits to every generated auxiliary file survive reinstall and normal uninstall',async t=>{
  for(const file of ['kanban-original-icon.mjs','startup-runtime.mjs','Disable Kanban Original Icon.command','Emergency Disable Original Icon.command'])await t.test(file,async t=>{
    const f=await fixture(t,{legacy:true});await install(f);const changed=join(f.result.support,file);
    await put(changed,(await readFile(changed,'utf8'))+'\n# foreign owned edit\n',file.endsWith('.command')?0o700:0o600);
    const before=await snapshot([changed,join(f.result.support,'original-icon.mjs'),f.result.shim,f.result.plist,join(f.result.support,'kanban-route.json')]);
    await assert.rejects(install(f),/Modified integration files/);await unchanged(before);
    await assert.rejects(disableKanbanOriginalIcon({support:f.result.support},f.system),/Modified integration files/);await unchanged(before);
    assert.equal(f.system.jobs.size,1);assert.equal(f.system.env.get('CODEX_CLI_PATH'),f.result.shim);
  });
});
