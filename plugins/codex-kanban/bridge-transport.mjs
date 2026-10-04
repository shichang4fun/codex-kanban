import {createServer,createConnection} from 'node:net';
import {chmod,lstat,mkdir,unlink,symlink,readlink} from 'node:fs/promises';
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
const sameFile=(a,b)=>a&&b&&a.dev===b.dev&&a.ino===b.ino;
const stat=path=>lstat(path).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
const unavailable=()=>Object.assign(bridgeError('Another desktop bridge owns the socket.'),{code:'EADDRINUSE'});
// Serialize startup and stale-socket recovery across reconnecting proxies. The
// symlink is an atomic PID/token marker, never a path that we follow or open.
async function claimSocket(socketPath){
  const lockPath=socketPath+'.lock',token=process.pid+':'+randomUUID();
  try{await symlink(token,lockPath);}
  catch(error){
    if(error.code!=='EEXIST')throw error;
    const existing=await stat(lockPath);
    if(!existing)throw unavailable();
    if(!existing?.isSymbolicLink()||existing.uid!==process.getuid())throw bridgeError('Invalid desktop bridge startup lock.');
    const owner=await readlink(lockPath).catch(()=>''),match=owner.match(/^([1-9][0-9]*):[a-f0-9-]{36}$/);
    if(!match)throw bridgeError('Invalid desktop bridge startup lock.');
    try{process.kill(Number(match[1]),0);throw unavailable();}
    catch(error){if(error.code!=='ESRCH')throw error;}
    // A fresh claim may be in flight; leave it to the next bounded retry.
    if(!sameFile(existing,await stat(lockPath)))throw unavailable();
    await unlink(lockPath).catch(error=>{if(error.code!=='ENOENT')throw error;});
    // Re-enter through the atomic create; never assume a recovered lock is ours.
    return claimSocket(socketPath);
  }
  const owned=await stat(lockPath);
  return async()=>{if(sameFile(owned,await stat(lockPath))&&await readlink(lockPath).catch(()=>null)===token)await unlink(lockPath);};
}
async function removeStaleSocket(socketPath){
  const existing=await stat(socketPath);if(!existing)return;
  if(!existing.isSocket()||existing.uid!==process.getuid()||(existing.mode&0o077)!==0)
    throw bridgeError('Refusing to replace an unsafe desktop bridge socket.');
  // Only ECONNREFUSED proves a leftover socket. Timeouts, permissions, and a
  // connected but not-yet-ready Desktop remain owned by the existing client.
  const stale=await new Promise(resolve=>{
    const connection=createConnection(socketPath);
    const finish=value=>{connection.destroy();resolve(value);};
    connection.setTimeout(500,()=>finish(false));
    connection.once('connect',()=>finish(false));
    connection.once('error',error=>finish(error.code==='ECONNREFUSED'));
  });
  if(!stale)throw unavailable();
  if(!sameFile(existing,await stat(socketPath)))throw unavailable();
  await unlink(socketPath);
}
export async function startLocalBridge({socketPath,dispatch}){
  await validateBridgeDirectory(socketPath);
  const connections=new Set();let stopping=false;
  const server=createServer(connection=>{
    connections.add(connection);connection.once('close',()=>connections.delete(connection));
    let buffer='',used=false;const cancellation=new AbortController();
    connection.setEncoding('utf8');connection.setTimeout(65000,()=>connection.destroy());
    connection.once('close',()=>cancellation.abort());connection.on('error',()=>{});
    connection.on('data',chunk=>{
      if(used)return;buffer+=chunk;
      if(Buffer.byteLength(buffer)>8192){connection.destroy();return;}
      const end=buffer.indexOf('\n');if(end<0)return;used=true;
      let request;try{request=JSON.parse(buffer.slice(0,end));}catch{connection.destroy();return;}
      Promise.resolve().then(()=>{if(stopping||cancellation.signal.aborted)throw bridgeError('Desktop connection closed.');return dispatch(request.method,request.params,{signal:cancellation.signal});})
        .then(result=>connection.end(JSON.stringify({id:request.id,result})+'\n'),
          error=>connection.end(JSON.stringify({id:request.id,error:{status:error.status??503,message:error.status?error.message:'Desktop action could not be confirmed.'}})+'\n'));
    });
  });
  const release=await claimSocket(socketPath);let owned;
  try{
    await removeStaleSocket(socketPath);
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socketPath,()=>{server.off('error',reject);resolve();});});
    owned=await lstat(socketPath);await chmod(socketPath,0o600);
    await release();
  }catch(error){
    await new Promise(resolve=>server.close(resolve));
    if(owned&&sameFile(owned,await stat(socketPath)))await unlink(socketPath);
    throw error;
  }finally{await release().catch(()=>{});}
  let stopped;
  return ()=>stopped??=Promise.resolve().then(async()=>{
    stopping=true;
    const closed=new Promise(resolve=>server.close(resolve));
    for(const connection of connections)connection.destroy();
    await closed;
    if(sameFile(owned,await stat(socketPath)))await unlink(socketPath);
  });
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
