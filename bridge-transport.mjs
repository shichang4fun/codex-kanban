import {createServer,createConnection} from 'node:net';
import {chmod,lstat,mkdir,unlink} from 'node:fs/promises';
import {dirname,isAbsolute} from 'node:path';
import {randomUUID} from 'node:crypto';

export function bridgeError(message,status=503){return Object.assign(Error(message),{status});}
export async function validateBridgeDirectory(socketPath){
  if(typeof socketPath!=='string'||!isAbsolute(socketPath)||Buffer.byteLength(socketPath)>100)
    throw bridgeError('A short, absolute desktop bridge socket path is required.');
  const directory=dirname(socketPath);
  await mkdir(directory,{recursive:true,mode:0o700});
  const s=await lstat(directory);
  if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==process.getuid()||(s.mode&0o077)!==0)
    throw bridgeError('The desktop bridge directory must be private and owned by this user.');
}
export async function startLocalBridge({socketPath,dispatch}){
  await validateBridgeDirectory(socketPath);
  // Never replace a socket that may belong to another running client.
  const server=createServer(connection=>{
    let buffer='',used=false;const cancellation=new AbortController();
    connection.setEncoding('utf8');connection.setTimeout(65000,()=>connection.destroy());
    connection.once('close',()=>cancellation.abort());connection.on('error',()=>{});
    connection.on('data',chunk=>{
      if(used)return;buffer+=chunk;
      if(Buffer.byteLength(buffer)>8192){connection.destroy();return;}
      const end=buffer.indexOf('\n');if(end<0)return;used=true;
      let request;try{request=JSON.parse(buffer.slice(0,end));}catch{connection.destroy();return;}
      Promise.resolve().then(()=>dispatch(request.method,request.params,{signal:cancellation.signal}))
        .then(result=>connection.end(JSON.stringify({id:request.id,result})+'\n'),
          error=>connection.end(JSON.stringify({id:request.id,error:{status:error.status??503,message:error.status?error.message:'Desktop action could not be confirmed.'}})+'\n'));
    });
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socketPath,()=>{server.off('error',reject);resolve();});});
  await chmod(socketPath,0o600);const owned=await lstat(socketPath);
  return async()=>{
    await new Promise(resolve=>server.close(resolve));
    try{if((await lstat(socketPath)).ino===owned.ino)await unlink(socketPath);}catch{}
  };
}
export async function desktopBridgeRequest(socketPath,method,params={},timeoutMs=60000,{signal}={}){
  const cancelled=()=>bridgeError('Desktop request cancelled. Check its recorded outcome before retrying.',408);
  if(signal?.aborted)throw cancelled();
  if(typeof socketPath!=='string'||!isAbsolute(socketPath))throw bridgeError('Desktop bridge is not configured.');
  const [directory,socket]=await Promise.all([lstat(dirname(socketPath)).catch(()=>null),lstat(socketPath).catch(()=>null)]);
  if(!directory?.isDirectory()||directory.isSymbolicLink()||directory.uid!==process.getuid()||(directory.mode&0o077)!==0
    ||!socket?.isSocket()||socket.uid!==process.getuid()||(socket.mode&0o077)!==0)
    throw bridgeError('Desktop bridge is not connected. Start Codex with the Kanban launcher.');
  if(signal?.aborted)throw cancelled();
  return new Promise((resolve,reject)=>{
    const connection=createConnection(socketPath),id=randomUUID();let buffer='',settled=false;
    const abort=()=>finish(cancelled());
    const finish=(error,result)=>{if(settled)return;settled=true;signal?.removeEventListener('abort',abort);connection.destroy();error?reject(error):resolve(result);};
    signal?.addEventListener('abort',abort,{once:true});
    connection.setEncoding('utf8');connection.setTimeout(timeoutMs,()=>finish(bridgeError('Desktop response timed out. Refresh before retrying; the action was not automatically repeated.')));
    connection.on('connect',()=>connection.write(JSON.stringify({id,method,params})+'\n'));
    connection.on('error',()=>finish(bridgeError('Desktop bridge disconnected. Refresh before retrying.')));
    connection.on('end',()=>{if(!settled)finish(bridgeError('Desktop bridge closed before confirming the action.'));});
    connection.on('data',chunk=>{
      buffer+=chunk;if(Buffer.byteLength(buffer)>2097152){finish(bridgeError('Invalid desktop bridge response.'));return;}
      const end=buffer.indexOf('\n');if(end<0)return;
      try{const reply=JSON.parse(buffer.slice(0,end));if(reply.id!==id)throw Error();
        finish(reply.error?bridgeError(reply.error.message,reply.error.status??503):null,reply.result);
      }catch{finish(bridgeError('Invalid desktop bridge response.'));}
    });
  });
}
