import {createServer,createConnection} from 'node:net';
import {chmod,lstat,mkdir,readFile,unlink} from 'node:fs/promises';
import {dirname,isAbsolute} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createNativeSync,syncError} from './native-sync.mjs';

// The bridge is hosted inside an attached Desktop stdio proxy, never a new app-server.
export async function startNativeBridge({socketPath,call,autoGroupingConfigPath}){
  if(!isAbsolute(socketPath))throw Error('Absolute bridge socket path required');
  const directory=dirname(socketPath);
  await mkdir(directory,{recursive:true,mode:0o700});
  const directoryStat=await lstat(directory);
  if(!directoryStat.isDirectory()||directoryStat.isSymbolicLink()||directoryStat.uid!==process.getuid()
    ||(directoryStat.mode&0o077)!==0)throw Error('Private, owned bridge directory required');
  // Do not unlink another proxy's active socket or take over an existing installation.
  const controller=createNativeSync({call,canWrite:async()=>{
    if(!autoGroupingConfigPath)return false;
    try{const config=JSON.parse(await readFile(autoGroupingConfigPath,'utf8'));return config.version===1&&config.mode==='disabled';}
    catch{return false;}
  }});
  const server=createServer(connection=>{
    connection.setEncoding('utf8');let buffer='',used=false;const cancellation=new AbortController();
    connection.once('close',()=>cancellation.abort());
    connection.setTimeout(45000,()=>connection.destroy());
    connection.on('error',()=>{});
    connection.on('data',chunk=>{
      if(used)return;buffer+=chunk;if(buffer.length>8192){connection.destroy();return;}
      const end=buffer.indexOf('\n');if(end<0)return;used=true;
      let request;try{request=JSON.parse(buffer.slice(0,end));}catch{connection.destroy();return;}
      const operation=request.method==='getBoard'?controller.getBoard():request.method==='moveTask'?controller.moveTask(request.params,{signal:cancellation.signal})
        :Promise.reject(syncError('METHOD_UNSUPPORTED','不支持此桥接操作。'));
      operation.then(result=>connection.end(JSON.stringify({id:request.id,result})+'\n'),error=>connection.end(JSON.stringify({id:request.id,error:{code:error.code??'DESKTOP_UNAVAILABLE',message:error.code?error.message:'桌面桥接暂不可用。'}})+'\n'));
    });
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socketPath,()=>{server.off('error',reject);resolve();});});
  await chmod(socketPath,0o600);
  const socketStat=await lstat(socketPath);
  return async()=>{
    await new Promise(resolve=>server.close(resolve));
    try{const current=await lstat(socketPath);if(current.ino===socketStat.ino)await unlink(socketPath);}catch{}
  };
}
export async function bridgeRequest(socketPath,method,params={}){
  if(!socketPath)throw syncError('BRIDGE_NOT_CONNECTED','桌面桥接未连接，原生分组同步尚未启用。');
  const stat=await lstat(socketPath).catch(()=>null);
  if(!stat?.isSocket()||stat.uid!==process.getuid()||(stat.mode&0o077)!==0)
    throw syncError('BRIDGE_NOT_CONNECTED','无法连接受保护的桌面桥接 socket。');
  return new Promise((resolve,reject)=>{
    const connection=createConnection(socketPath);const id=randomUUID();let buffer='',settled=false;
    function finish(error,result){if(settled)return;settled=true;connection.destroy();error?reject(error):resolve(result);}
    connection.setEncoding('utf8');connection.setTimeout(45000,()=>finish(syncError('BRIDGE_TIMEOUT','桌面响应超时，请刷新检查；写入不会自动重试。')));
    connection.on('connect',()=>connection.write(JSON.stringify({id,method,params})+'\n'));
    connection.on('error',()=>finish(syncError('BRIDGE_NOT_CONNECTED','桌面桥接连接已中断。')));
    connection.on('end',()=>{if(!settled)finish(syncError('BRIDGE_NOT_CONNECTED','桌面桥接连接已结束。'));});
    connection.on('data',chunk=>{
      buffer+=chunk;if(buffer.length>2097152){finish(syncError('INVALID_RESPONSE','桌面响应过大，已停止同步。'));return;}
      const end=buffer.indexOf('\n');if(end<0)return;
      try{const reply=JSON.parse(buffer.slice(0,end));if(reply.id!==id)throw Error();
        finish(reply.error?syncError(reply.error.code,reply.error.message):null,reply.result);
      }catch{finish(syncError('INVALID_RESPONSE','桌面响应无效，已停止同步。'));}
    });
  });
}
