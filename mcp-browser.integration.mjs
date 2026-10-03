// Manual browser acceptance host. All mutations affect synthetic fixture tasks.
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {createKanbanMcp,boardResourceUri} from './mcp-server.mjs';
import {createKanbanService} from './kanban-service.mjs';
import {buildPlugin} from './build-plugin.mjs';

await buildPlugin();
const id='11111111-1111-4111-8111-111111111111';
const task={id,hostId:'local',title:'Sidebar integration fixture',summary:'Synthetic task for UI acceptance.',cwd:'/fixture',
  isUnread:true,localProjectId:'project-a',projectId:'project-a',projectName:'Fixture A',
  updatedAt:Math.floor(Date.now()/1000),column:'unknown',rawStatus:'unknown',nativeSectionId:'chats',localSectionId:null,
  placementSource:'localDefault',nativeMembershipSource:'localThreadSection',nativeMembershipCount:1};
const sections=[{sectionId:'chats',name:'Tasks'},...['For Later','In Progress','For Review','Pinned'].map((name,index)=>({sectionId:'group-'+index,name}))];
const defaults={};
const settingsStore={read:async()=>structuredClone(defaults),update:async change=>change(defaults)};
let archived=false,reads=0;
const projects=[{projectId:'project-a',desktopProjectId:'desktop-a',hostId:'local',label:'Fixture A'},{projectId:'project-b',desktopProjectId:'desktop-b',hostId:'local',label:'Fixture B'}];
task.projectId='desktop-a';
const passiveTasks=Array.from({length:Math.max(0,Number(process.env.KANBAN_TEST_TASK_COUNT??1)-1)},(_,index)=>({...task,
  id:'22222222-2222-4222-8222-'+String(index).padStart(12,'0'),title:'Synthetic scrolling task '+(index+1),isUnread:index%2===0,
  nativeSectionId:'group-0',localSectionId:'group-0',placementSource:'localThreadSection'}));
const getBoard=async()=>{reads++;return {tasks:[...(archived?[]:[{...task}]),...passiveTasks],projects,sections,capturedAt:new Date().toISOString(),runtimeCapturedAt:null,
  runtimeSnapshotMaxAgeMs:15000,coverage:'Synthetic fixture only',unavailableHosts:[],sync:{connected:true,scope:'localSections',runtimeLive:false,projectCatalogConnected:true}};};
const service=createKanbanService({getBoard,settingsStore,desktopBridgeSocket:'synthetic',
  bridgeRequest:async(_socket,method,params)=>{
    if(method==='status')return {connected:true,groupActions:true,taskCreation:true,creationOperations:[]};
    if(method==='creationCatalog')return {projects:projects.map(p=>({projectId:p.desktopProjectId,label:p.label,isGitRepository:true,nativeProjectId:p.projectId})),
      sections:[...sections.filter(s=>s.sectionId!=='chats'),{sectionId:null,name:'Ungrouped'}]};
    if(method==='archive'){
      archived=params.archived;
      return {threadId:id,...(archived?{archived:true}:{restored:true})};
    }
    throw Error('Unexpected fixture bridge request');
  },
  archiveTask:async()=>{archived=true;return {threadId:id,archived:true};},
  restoreTask:async()=>{archived=false;return {threadId:id,restored:true};},
  moveTask:async params=>{task.localSectionId=params.sectionId;task.nativeSectionId=params.sectionId??'chats';
    task.pinned=task.nativeTaskPinned=params.sectionId==='group-3';task.placementSource=params.sectionId?'localThreadSection':'localDefault';
    return {threadId:id,sectionId:params.sectionId,changed:true};},
  pinTask:async params=>{task.pinned=params.pinned;task.nativeTaskPinned=params.pinned;task.localSectionId=params.pinned?'group-3':null;task.nativeSectionId=params.pinned?'group-3':'chats';
    task.placementSource=params.pinned?'localThreadSection':'localDefault';return {threadId:id,pinned:params.pinned};},
  setProject:async params=>{if(params.threadId!==id||params.expectedProjectId!==task.localProjectId)throw Error('Unexpected fixture project request');
    const project=projects.find(p=>p.projectId===params.projectId);
    if(params.projectId!==null&&!project)throw Error('Unknown fixture project');
    task.localProjectId=params.projectId;task.projectId=project?.desktopProjectId??null;task.projectName=project?.label??null;
    return {threadId:id,projectId:params.projectId,changed:true};}
});
const app=createKanbanMcp({service});const client=new Client({name:'browser-fixture-host',version:'1'},{});
const [serverTransport,clientTransport]=InMemoryTransport.createLinkedPair();await app.server.connect(serverTransport);await client.connect(clientTransport);
const parentScript=await build({stdin:{contents:`
  import {AppBridge,PostMessageTransport} from '@modelcontextprotocol/ext-apps/app-bridge';
  const frame=document.querySelector('iframe');
  const bridge=new AppBridge(null,{name:'Kanban acceptance fixture',version:'1'},{serverTools:{},openLinks:{}},{hostContext:{displayMode:'fullscreen',theme:'dark'}});
  bridge.oninitialized=()=>document.querySelector('#status').textContent='MCP App initialized';
  bridge.oncalltool=async params=>await (await fetch('/tools',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(params)})).json();
  bridge.onopenlink=async()=>({isError:true});
  await bridge.connect(new PostMessageTransport(frame.contentWindow,frame.contentWindow));
  document.querySelector('button').onclick=()=>{frame.hidden=false;frame.src='/app.html';};
`,resolveDir:process.cwd(),sourcefile:'fixture-host.mjs'},bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});
const hostBackground=process.env.KANBAN_TEST_HOST_THEME==='light'?'#f8f8f8':'#181818';
const port=Number(process.env.KANBAN_TEST_PORT??0);
const server=createServer(async(req,res)=>{
  try{
    if(req.url==='/'&&req.method==='GET'){
      res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<html><meta charset="utf-8"><style>body{margin:0;background:#16161a;color:#ddd;font:13px system-ui}header{padding:8px 16px}button{margin-right:12px}iframe{width:100%;height:calc(100vh - 42px);border:0}</style><header><button>Codex 看板</button><span id="status">Synthetic MCP host</span></header><iframe title="Codex Kanban MCP App" hidden></iframe><script type="module">${parentScript.outputFiles[0].text.replaceAll('</script','<\\/script')}</script></html>`);return;
    }
    if(req.url==='/app.html'){
      res.setHeader('Content-Type','text/html');
      const html=(await client.readResource({uri:boardResourceUri})).contents[0].text;
      // Codex's sandbox forces body transparent, independently of the App palette.
      res.end(html+`<style>html{background:${hostBackground}}html > body{background:transparent!important}</style>`);return;
    }
    if(req.url==='/tools'&&req.method==='POST'){
      let body='';for await(const chunk of req){body+=chunk;if(body.length>8192)throw Error('Too large');}
      const params=JSON.parse(body);res.setHeader('Content-Type','application/json');res.end(JSON.stringify(await client.callTool({name:params.name,arguments:params.arguments})));return;
    }
    if(req.url==='/status'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({reads,archived,sectionId:task.localSectionId}));return;}
    res.writeHead(404).end();
  }catch{res.writeHead(500).end('Fixture request failed');}
});
server.listen(port,'127.0.0.1',()=>console.log(`Synthetic MCP browser acceptance: http://127.0.0.1:${server.address().port}`));
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{server.close();await client.close();await app.close();});
