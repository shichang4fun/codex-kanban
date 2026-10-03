import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {randomUUID,timingSafeEqual} from 'node:crypto';
import {openLocalReader} from './local-read.mjs';
import {createLocalBoard} from './local-board.mjs';
import {readLocalUnread} from './desktop-unread.mjs';
import {archiveLocalTask,restoreArchivedTask} from './archive.mjs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {desktopBridgeRequest,bridgeError} from './bridge-transport.mjs';
import {readDesktopBridgeConfig} from './setup-desktop-bridge.mjs';
import {createGitStatusReader} from './git-status.mjs';
import {readBoardRuntime} from './desktop-runtime.mjs';

const port=Number(process.env.KANBAN_PORT??8876);
let reading,reader;
const gitStatus=createGitStatusReader();
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
const board=()=>reading??=(async()=>{
  reader??=await openLocalReader();
  const [raw,unreadState]=await Promise.all([readFile(new URL('./snapshot.json',import.meta.url),'utf8'),readLocalUnread()]);
  return gitStatus.enrich(await createLocalBoard(reader,JSON.parse(raw),{unreadState}).getBoard());
})().catch(error=>{reader?.close();reader=null;throw error;}).finally(()=>reading=null);
export function createKanbanServer({port=8876,getBoard=board,archiveTask=archiveLocalTask,
  restoreTask=restoreArchivedTask,pinTask=null,moveTask=null,desktopBridgeSocket=null,bridgeRequest=desktopBridgeRequest}={}){
const csrf=randomUUID(),undoArchives=new Map();let mutating=null;
const desktopStatus=async()=>{
  if(desktopBridgeSocket)try{return await bridgeRequest(desktopBridgeSocket,'status',{},1500);}catch{}
  return {connected:false};
};
const connectedBoard=async()=>{let value=await getBoard();const status=await desktopStatus(),desktopArchiveConnected=status.connected===true,
  desktopGroupsConnected=desktopArchiveConnected&&status.groupActions===true;
  if(desktopArchiveConnected&&status.runtimeAvailable===true)value=await readBoardRuntime(value,desktopBridgeSocket,{request:bridgeRequest});
  return {...value,sync:{...value.sync,writable:true,moveWritable:desktopGroupsConnected,archiveLocal:true,pinLocal:desktopGroupsConnected,
    moveTransport:desktopGroupsConnected?'desktop':null,desktopGroupsConnected,archiveTransport:desktopArchiveConnected?'desktop':'local',desktopArchiveConnected}};
};
return createServer(async(req,res)=>{
  const origins=[`http://127.0.0.1:${port}`,`http://localhost:${port}`];
  if(!origins.includes('http://'+req.headers.host)||(req.headers.origin&&!origins.includes(req.headers.origin))
    ||['cross-site','same-site'].includes(req.headers['sec-fetch-site'])){res.writeHead(403).end('Forbidden');return;}
  try{
    if(req.url==='/api/board'&&req.method==='GET'){
      if(mutating)await mutating.catch(()=>{});
      json(res,200,{board:await connectedBoard(),csrf});return;
    }
    if(['/api/move','/api/archive','/api/unarchive','/api/pin'].includes(req.url)&&req.method==='POST'){
      const token=Buffer.from(req.headers['x-kanban-token']??''),expected=Buffer.from(csrf);
      if(token.length!==expected.length||!timingSafeEqual(token,expected)||req.headers['content-type']!=='application/json'){
        json(res,403,{error:'This action request is not allowed.'});return;
      }
      req.setEncoding('utf8');let body='';for await(const chunk of req){body+=chunk;if(body.length>8192){json(res,413,{error:'Request too large.'});return;}}
      let params;try{params=JSON.parse(body);}catch{json(res,400,{error:'Invalid request format.'});return;}
      {
        if(mutating){json(res,409,{error:'Another task action is in progress.'});return;}
        const undo=req.url==='/api/unarchive'?undoArchives.get(params?.undoToken):null;
        if(req.url==='/api/unarchive'&&!undo){json(res,409,{error:'Undo is no longer available here. Restore this task from Codex archived tasks.'});return;}
        let archiveTransport='local';
        mutating=(async()=>{
          if(undo)return undo.transport==='desktop'?bridgeRequest(desktopBridgeSocket,'archive',{threadId:undo.threadId,hostId:'local',archived:false}):restoreTask({threadId:undo.threadId,hostId:'local'});
          const current=await getBoard();
          if(req.url==='/api/move'||req.url==='/api/pin'){
            const status=await desktopStatus();
            if(status.connected!==true||status.groupActions!==true)
              throw bridgeError('Group changes require the updated Codex Kanban launcher. Launch Codex with it and open a local task.');
            if(!current.tasks.some(t=>t.id===params?.threadId&&t.hostId==='local'&&!t.sidebarOnly)||params?.hostId!=='local')
              throw bridgeError('This local task is no longer in the board. Refresh and try again.',409);
            const action=req.url==='/api/move'?'move':'pin',handler=action==='move'?moveTask:pinTask;
            return handler?handler(params,current):bridgeRequest(desktopBridgeSocket,action,params);
          }
          if((await desktopStatus()).connected!==true)return archiveTask(params,current);
          archiveTransport='desktop';
          if(!current.tasks.some(t=>t.id===params?.threadId&&t.hostId==='local'&&!t.sidebarOnly)||params?.hostId!=='local')
            throw Object.assign(Error('This local task is no longer in the board. Refresh and try again.'),{status:409});
          return bridgeRequest(desktopBridgeSocket,'archive',{threadId:params.threadId,hostId:'local',archived:true});
        })();
        let result;
        try{
          result=await mutating;
          if(req.url==='/api/move'&&(result.threadId!==params.threadId||result.sectionId!==params.sectionId||typeof result.changed!=='boolean'))throw Error('Move not verified');
          if(undo){
            if(result.restored!==true||result.threadId!==undo.threadId)throw Error('Restore not verified');
            undoArchives.delete(params.undoToken);
          }else if(req.url==='/api/archive'){
            if(result.archived!==true||result.threadId!==params.threadId)throw Error('Archive not verified');
            const undoToken=randomUUID();
            undoArchives.set(undoToken,{threadId:result.threadId,transport:archiveTransport});
            result={...result,undoToken};
          }
        }
        catch(error){json(res,error.status??503,{error:error.status?error.message:'Task action could not be confirmed. Refresh before trying again.'});return;}
        finally{mutating=null;}
        // A confirmed archive stays successful even if the subsequent board
        // refresh fails; the browser can remove that exact card and retry polling.
        let next;try{next=await connectedBoard();}catch{}
        json(res,200,{...result,...(next?{board:next}:{}),csrf});return;
      }
    }
    if((req.url==='/'||req.url==='/index.html')&&req.method==='GET'){
      const html=await readFile(new URL('./index.html',import.meta.url));
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});res.end(html);return;
    }
    res.writeHead(404).end('Not found');
  }catch(error){
    if(req.url?.startsWith('/api/'))json(res,503,{error:'Local groups unavailable; keeping the latest snapshot.',code:'LOCAL_READER_UNAVAILABLE',connected:false});
    else res.writeHead(503).end('Generate index.html with build.mjs first.');
  }
});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const connection=await readDesktopBridgeConfig().catch(()=>null);
  const server=createKanbanServer({port,desktopBridgeSocket:process.env.KANBAN_ARCHIVE_SOCKET??connection?.socketPath??null}).listen(port,'127.0.0.1',()=>console.log(`Codex Kanban: http://127.0.0.1:${port}`));
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{reader?.close();server.close(()=>process.exit(0));});
}
