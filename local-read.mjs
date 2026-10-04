import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const officialCli='/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex';
const allowed=new Set(['initialize','threadSection/list','thread/read','thread/list','project/list']);

// The default connection reads local metadata; action-specific connections add
// only their declared writes. None has a Desktop MCP connection or live model status.
async function openLocalMetadata({executable=officialCli,timeoutMs=20000}={},writeMethods=new Set()){
  const env={...process.env,CODEX_CLI_PATH:executable};
  for(const key of Object.keys(env))if(key.startsWith('KANBAN_')||key.startsWith('SIDEBAR_FLOW_'))delete env[key];
  const child=spawn(executable,['--disable','hooks','app-server','--listen','stdio://'],{env,stdio:['pipe','pipe','pipe']});
  let sequence=0,buffer='',closed=false;
  const pending=new Map();
  function rejectPending(message){for(const operation of pending.values()){clearTimeout(operation.timer);operation.reject(Error(message));}pending.clear();}
  child.stderr.on('data',()=>{}); // Never expose private server diagnostics.
  child.once('error',()=>rejectPending('Local metadata reader could not start'));
  child.once('exit',()=>{closed=true;rejectPending('Local metadata reader exited');});
  child.stdin.on('error',()=>rejectPending('Local metadata transport closed'));
  child.stdout.setEncoding('utf8');
  child.stdout.on('data',chunk=>{
    buffer+=chunk;
    if(buffer.length>8*1024*1024){rejectPending('Local metadata response too large');child.kill();return;}
    let end;
    while((end=buffer.indexOf('\n'))>=0){
      const line=buffer.slice(0,end);buffer=buffer.slice(end+1);
      let message;try{message=JSON.parse(line);}catch{continue;}
      if(message.method)continue; // No approvals, execution, or reverse tool calls.
      const operation=pending.get(message.id);if(!operation)continue;
      pending.delete(message.id);clearTimeout(operation.timer);
      if(message.error){
        const writerBusy=operation.method==='thread/archive'&&message.error.message?.includes('already has an active writer');
        operation.reject(writerBusy?Object.assign(Error('This task is in use by Codex. Archive it in Codex, then refresh this board.'),{status:409})
          :Object.assign(Error('Local metadata RPC failed ('+message.error.code+')'),{code:message.error.code}));
      }else operation.resolve(message.result);
    }
  });
  function request(method,params={}){
    if((!allowed.has(method)&&!writeMethods.has(method))||closed)return Promise.reject(Error('Local method unavailable'));
    const id=++sequence;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{pending.delete(id);reject(Error('Local metadata RPC timed out'));},timeoutMs);
      pending.set(id,{resolve,reject,timer,method});child.stdin.write(JSON.stringify({id,method,params})+'\n');
    });
  }
  function close(){closed=true;rejectPending('Local metadata reader closed');child.kill('SIGTERM');child.stdin.destroy();child.stdout.destroy();child.stderr.destroy();}
  try{await request('initialize',{clientInfo:{name:'kanban_local_readonly',version:'0.1.0'},capabilities:{experimentalApi:true}});}
  catch(error){close();throw error;}
  return {request,close};
}

export const openLocalReader=options=>openLocalMetadata(options);
// Each explicit action gets only its required writes; task execution is never allowed.
export const openLocalArchiver=options=>openLocalMetadata(options,new Set(['thread/archive','thread/unarchive']));
export const openLocalPinner=options=>openLocalMetadata(options,new Set(['thread/section/move']));
export const openLocalProjectEditor=options=>openLocalMetadata(options,new Set(['thread/metadata/update']));
export const openLocalRenamer=options=>openLocalMetadata(options,new Set(['thread/name/set']));

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  let reader;
  try{
    reader=await openLocalReader();
    const sections=await reader.request('threadSection/list',{limit:100});
    console.log(JSON.stringify({sections:sections.data?.map(s=>({id:s.id,name:s.name}))}));
    const id=process.argv[2];
    if(id){const {thread:t}=await reader.request('thread/read',{threadId:id,includeTurns:false});
      console.log(JSON.stringify({thread:{id:t?.id,title:t?.title,section:t?.section,projectId:t?.projectId,ephemeral:t?.ephemeral}}));}
  }catch(error){console.log(JSON.stringify({error:error.message}));process.exitCode=1;}
  finally{reader?.close();}
}
