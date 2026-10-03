// Verify official plugin discovery in a disposable CODEX_HOME. No model turn.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {preparePlugin} from './install-plugin.mjs';

const cli='/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex';
const root=await mkdtemp(join(tmpdir(),'kanban-plugin-native-'));
const env={...process.env,CODEX_HOME:join(root,'home')};
let child,buffer='',sequence=0;
const pending=new Map();
function request(method,params={}){
  const id=++sequence;
  return new Promise((resolve,reject)=>{
    pending.set(id,{resolve,reject,timer:setTimeout(()=>{pending.delete(id);reject(Error(`RPC timeout: ${method}`));},30000)});
    child.stdin.write(JSON.stringify({id,method,params})+'\n');
  });
}
try{
  await mkdir(env.CODEX_HOME,{mode:0o700});
  const market=await preparePlugin({root:join(root,'market')});
  for(const args of [['plugin','marketplace','add',market.root,'--json'],['plugin','add','codex-kanban@codex-kanban-local','--json']])
    execFileSync(cli,args,{env,encoding:'utf8',stdio:['ignore','pipe','pipe']});
  child=spawn(cli,['--disable','hooks','app-server','--listen','stdio://'],{env,stdio:['pipe','pipe','pipe']});
  let diagnostic='';child.stderr.on('data',data=>diagnostic+=data);
  child.stdout.on('data',data=>{
    buffer+=data;let end;
    while((end=buffer.indexOf('\n'))>=0){
      const line=buffer.slice(0,end);buffer=buffer.slice(end+1);
      let message;try{message=JSON.parse(line);}catch{continue;}
      const operation=pending.get(message.id);if(!operation)continue;
      pending.delete(message.id);clearTimeout(operation.timer);
      if(message.error)operation.reject(Error(`RPC ${message.error.code}`));else operation.resolve(message.result);
    }
  });
  child.on('error',()=>{for(const operation of pending.values())operation.reject(Error('App Server could not start'));});
  await request('initialize',{clientInfo:{name:'kanban_plugin_disposable_acceptance',version:'1'},capabilities:{experimentalApi:true}});
  child.stdin.write(JSON.stringify({method:'initialized'})+'\n');
  const started=await request('thread/start',{cwd:root,ephemeral:true,approvalPolicy:'never',sandbox:'read-only'});
  assert(started.thread?.id);
  const status=await request('mcpServerStatus/list',{limit:100,threadId:started.thread.id});
  const entry=status.data?.find(server=>server.name.includes('codex-kanban'));
  if(!entry)console.log(diagnostic.slice(-2200));
  assert(entry,'Official App Server did not discover the installed MCP server.');
  assert.deepEqual(Object.values(entry.tools).map(tool=>tool.name).sort(),['archive_task','get_board','move_task','open_board','pin_task','undo_archive']);
  assert(Object.values(entry.tools).every(tool=>tool._meta.ui.visibility.length===1&&tool._meta.ui.visibility[0]==='app'));
  const open=Object.values(entry.tools).find(tool=>tool.name==='open_board');
  assert.equal(open._meta.ui.resourceUri,'ui://kanban/board/v1.html');
  assert.deepEqual(open._meta['openai/ui'].entrypoints,[{type:'global'}]);
  console.log('PASS: installed plugin discovery and sidebar metadata in official App Server; no model turn started.');
}finally{
  for(const operation of pending.values())clearTimeout(operation.timer);
  if(child&&child.exitCode===null){const exit=once(child,'exit');child.stdin.end();child.kill('SIGTERM');await exit;}
  await rm(root,{recursive:true,force:true});
}
