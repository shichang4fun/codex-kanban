import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {timingSafeEqual} from 'node:crypto';
import {createBoardSource,createKanbanService} from './kanban-service.mjs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {readDesktopBridgeConfig} from './setup-desktop-bridge.mjs';
import {desktopBridgeRequest} from './bridge-transport.mjs';

const port=Number(process.env.KANBAN_PORT??8876);
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
export function createKanbanServer({port=8876,getBoard,archiveTask,restoreTask,pinTask,moveTask,setProject,settingsStore,htmlPath=new URL('./index.html',import.meta.url),desktopBridgeSocket=null,bridgeRequest=desktopBridgeRequest}={}){
const source=getBoard?null:createBoardSource();
const service=createKanbanService({getBoard:getBoard??source.getBoard,archiveTask,restoreTask,pinTask,moveTask,setProject,settingsStore,desktopBridgeSocket,bridgeRequest});
const server=createServer(async(req,res)=>{
  const listeningPort=port===0?req.socket.localPort:port;
  const origins=[`http://127.0.0.1:${listeningPort}`,`http://localhost:${listeningPort}`];
  if(!origins.includes('http://'+req.headers.host)||(req.headers.origin&&!origins.includes(req.headers.origin))
    ||['cross-site','same-site'].includes(req.headers['sec-fetch-site'])){res.writeHead(403).end('Forbidden');return;}
  try{
    if(req.url==='/api/board'&&req.method==='GET'){
      json(res,200,await service.read());return;
    }
    if(req.url==='/api/creation-options'&&req.method==='GET'){
      try{json(res,200,await service.creationOptions());}catch(error){json(res,error.status??503,{error:error.status?error.message:'Creation options are unavailable.'});}return;
    }
    if(req.url?.startsWith('/api/creation-status?')&&req.method==='GET'){
      try{json(res,200,await service.creationStatus({requestId:new URL(req.url,'http://localhost').searchParams.get('requestId')}));}
      catch(error){json(res,error.status??503,{error:error.status?error.message:'Creation status is unavailable.'});}return;
    }
    if(['/api/project','/api/move','/api/archive','/api/unarchive','/api/pin','/api/create','/api/creation-group','/api/group-settings','/api/flow-settings'].includes(req.url)&&req.method==='POST'){
      const cancellation=new AbortController();
      req.once('aborted',()=>cancellation.abort());
      res.once('close',()=>{if(!res.writableEnded)cancellation.abort();});
      const token=Buffer.from(req.headers['x-kanban-token']??''),expected=Buffer.from(service.csrf);
      if(token.length!==expected.length||!timingSafeEqual(token,expected)||req.headers['content-type']!=='application/json'){
        json(res,403,{error:'This action request is not allowed.'});return;
      }
      req.setEncoding('utf8');let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>8192){json(res,413,{error:'Request too large.'});return;}}
      let params;try{params=JSON.parse(body);}catch{json(res,400,{error:'Invalid request format.'});return;}
      try{json(res,200,await service.action(req.url.slice(5),params,{signal:cancellation.signal}));}
      catch(error){json(res,error.status??503,{error:error.status?error.message:'Task action could not be confirmed. Refresh before trying again.'});}
      return;
    }
    if((req.url==='/'||req.url==='/index.html')&&req.method==='GET'){
      const html=await readFile(htmlPath);
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});res.end(html);return;
    }
    res.writeHead(404).end('Not found');
  }catch(error){
    if(req.url?.startsWith('/api/'))json(res,503,{error:'Local groups unavailable; keeping the latest snapshot.',code:'LOCAL_READER_UNAVAILABLE',connected:false});
    else res.writeHead(503).end('Generate index.html with build.mjs first.');
  }
});
server.once('close',()=>{void service.close().then(()=>source?.close());});
return server;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const connection=await readDesktopBridgeConfig().catch(()=>null);
  const server=createKanbanServer({port,desktopBridgeSocket:process.env.KANBAN_ARCHIVE_SOCKET??connection?.socketPath??null}).listen(port,'127.0.0.1',()=>console.log(`Codex Kanban: http://127.0.0.1:${port}`));
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{server.close();});
}
