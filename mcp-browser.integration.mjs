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
let archived=false,reads=0,flowEnabled=true,renameFailures=Number(process.env.KANBAN_TEST_RENAME_FAILURES??0);
const moves=[];
let groupActions=true,moveFailure=false,desktopConnected=true;
let archiveDelayMs=0,staleArchiveBoard=false,archiveFailure=false,staleRestoreBoard=false,restoreDelayMs=0,restoreFailures=0,restored=false;
const archives=[];
const renames=[];
const projects=[{projectId:'project-a',desktopProjectId:'desktop-a',hostId:'local',label:'Fixture A'},{projectId:'project-b',desktopProjectId:'desktop-b',hostId:'local',label:'Fixture B'}];
task.projectId='desktop-a';
const passiveTasks=Array.from({length:Math.max(0,Number(process.env.KANBAN_TEST_TASK_COUNT??1)-1)},(_,index)=>({...task,
  id:'22222222-2222-4222-8222-'+String(index).padStart(12,'0'),title:'Synthetic scrolling task '+(index+1),isUnread:index%2===0,
  nativeSectionId:'group-0',localSectionId:'group-0',placementSource:'localThreadSection'}));
// Opt-in acceptance cases for previews, waiting reasons and narrow layouts.
if(process.env.KANBAN_TEST_CARD_INFO==='1'){
  Object.assign(task,{title:'修复 Kanban 排序',summary:'需要确认刷新后顺序保持不变，同时保留未保存的任务草稿。',summarySource:'threadPreview',
    column:'attention',rawStatus:{type:'active',activeFlags:['waitingOnUserInput','waitingOnApproval']},runtimeStatusSource:'desktopRuntime'});
  const cases=[
    {title:'Investigate a runtime issue',summary:'The runtime reported an error; the task outcome has not been determined.',summarySource:'desktopSnapshot',column:'error',rawStatus:{type:'systemError'}},
    {title:'长中文摘要和很长的英文标识符',summary:'检查长文本在窄窗口下的表现。'+('long_identifier_without_spaces_'.repeat(12)),summarySource:'threadPreview',column:'idle',rawStatus:{type:'idle'}},
    {title:'No summary',summary:'  ',column:'idle',rawStatus:{type:'idle'},projectId:null,projectName:null},
    {title:'Duplicate summary',summary:'Duplicate\n summary',column:'idle',rawStatus:{type:'idle'}},
    {title:'Expired runtime observation',summary:'Keep the preview visible after the waiting observation expires.',column:'attention',rawStatus:{type:'active',activeFlags:['waitingOnUserInput']},runtimeStatusStale:true},
    {title:'Remote snapshot',summary:'Summary from a remote desktop snapshot, not the most recent reply.',summarySource:'desktopSnapshot',hostId:'remote-control:fixture',runtimeStatusSource:'desktopSnapshot',column:'attention',rawStatus:{type:'active',activeFlags:['waitingOnApproval']}},
    {title:'Multiple branch PR matches',summary:'These PRs match the working directory branch; they are not explicitly attached to this task.',summarySource:'threadPreview',column:'idle',rawStatus:{type:'idle'},
      git:{status:'ready',branch:'codex/card-info',repository:'fixture/kanban',pullRequests:{status:'matched',match:'branch',items:[
        {number:12,state:'OPEN',url:'https://github.com/fixture/kanban/pull/12'},
        {number:13,state:'DRAFT',url:'https://github.com/fixture/kanban/pull/13'}]}}}
  ];
  passiveTasks.splice(0,passiveTasks.length,...cases.map((entry,index)=>({...task,
    id:'22222222-2222-4222-8222-'+String(index).padStart(12,'0'),nativeSectionId:'group-'+(index%3),localSectionId:'group-'+(index%3),
    placementSource:'localThreadSection',isUnread:index%2===0,...entry})));
}
if(process.env.KANBAN_TEST_PR_ATTENTION==='1'){
  const git=(items)=>({status:'ready',branch:'codex/pr-attention',repository:'fixture/kanban',
    pullRequests:{status:'ready',match:'branch',items}});
  const pr=(number,fields={})=>({number,state:'OPEN',url:'https://github.com/fixture/kanban/pull/'+number,checks:'failed',review:'CHANGES_REQUESTED',...fields});
  Object.assign(task,{title:'PR checks need attention',summary:'Synthetic fixture: CI failed and review requested changes.',git:git([pr(12)])});
  const cases=[
    {title:'Review required',git:git([pr(13,{checks:'passed',review:'REVIEW_REQUIRED'})])},
    {title:'Draft CI failure',git:git([pr(14,{state:'DRAFT',review:'REVIEW_REQUIRED'})])},
    {title:'Healthy PR',git:git([pr(15,{checks:'passed',review:'APPROVED'})])},
    {title:'Merged historical failure',git:git([pr(16,{state:'MERGED'})])},
    {title:'Multiple PR alerts',git:git([pr(17),pr(18,{checks:'passed',review:'REVIEW_REQUIRED'})])},
    {title:'Cached PR alerts',git:git([pr(19)]),fixtureGitStale:true}
  ];
  passiveTasks.splice(0,passiveTasks.length,...cases.map((entry,index)=>({...task,
    id:'22222222-2222-4222-8222-'+String(index).padStart(12,'0'),nativeSectionId:'group-'+(index%3),localSectionId:'group-'+(index%3),
    placementSource:'localThreadSection',isUnread:false,...entry})));
}
if(process.env.KANBAN_TEST_UI_CLEANUP==='1'){
  const git=()=>({status:'ready',branch:'codex/cache-cleanup',repository:'fixture/kanban',refreshing:true,
    pullRequests:{status:'ready',refreshing:true,items:[{number:20,state:'OPEN',checks:'passed',review:'APPROVED',url:'https://github.com/fixture/kanban/pull/20'}]}});
  Object.assign(task,{title:'Fresh background refresh',summary:'# Files mentioned by the user:\n## photo.png: /tmp/photo.png\nImage attachment: true\n## My request:\nKeep the actual request visible.',git:git()});
  const cases=[
    {title:'Expired branch data',git:git(),fixtureBranchStale:true},
    {title:'Attachment metadata only',summary:'# Files mentioned by the user:\n## photo.png: /tmp/photo.png\nImage attachment: true'},
    {title:'User-written metadata heading',summary:'# Files mentioned by the user:\nPlease explain this Markdown heading.'},
    {title:'No assigned project',projectId:null,localProjectId:null,projectName:null}
  ];
  passiveTasks.splice(0,passiveTasks.length,...cases.map((entry,index)=>({...task,
    id:'22222222-2222-4222-8222-'+String(index).padStart(12,'0'),nativeSectionId:'group-0',localSectionId:'group-0',placementSource:'localThreadSection',...entry})));
}
const getBoard=async()=>{reads++;const capturedAt=new Date().toISOString();return {tasks:[...(archived&&!staleArchiveBoard||restored&&staleRestoreBoard?[]:[{...task}]),...passiveTasks].map(t=>({...t,
  ...(t.runtimeStatusSource?{runtimeCapturedAt:capturedAt}:{}),...(t.git?{git:{...t.git,checkedAt:t.fixtureBranchStale?new Date(Date.now()-120000).toISOString():capturedAt,pullRequests:{...t.git.pullRequests,
    checkedAt:t.fixtureGitStale?new Date(Date.now()-120000).toISOString():capturedAt}}}:{})})),
  projects,sections,capturedAt,runtimeCapturedAt:process.env.KANBAN_TEST_CARD_INFO==='1'?capturedAt:null,
  runtimeSnapshotMaxAgeMs:15000,coverage:'Synthetic fixture only',unavailableHosts:[],sync:{connected:true,scope:'localSections',runtimeLive:false,projectCatalogConnected:true}};};
const renameFixture=async(params,transport)=>{
  renames.push({...params,transport});
  if(renameFailures>0){renameFailures--;throw Object.assign(Error('Synthetic rename conflict. Retry with your draft preserved.'),{status:409});}
  if(params.threadId!==id||params.expectedTitle!==task.title)throw Error('Unexpected fixture rename request');
  task.title=params.title;return {threadId:id,title:task.title,changed:true};
};
const service=createKanbanService({getBoard,settingsStore,desktopBridgeSocket:'synthetic',
  bridgeRequest:async(_socket,method,params)=>{
    if(method==='status')return {connected:desktopConnected,groupActions,renameActions:true,taskCreation:true,creationOperations:[],autoFlow:{available:true,enabled:flowEnabled,mode:'all-local'}};
    if(method==='rename')return renameFixture(params,'desktop');
    if(method==='flowSettings'){flowEnabled=params.enabled;return {autoFlow:{available:true,enabled:flowEnabled,mode:'all-local'}};}
    if(method==='creationCatalog')return {projects:projects.map(p=>({projectId:p.desktopProjectId,label:p.label,isGitRepository:true,nativeProjectId:p.projectId})),
      sections:[...sections.filter(s=>s.sectionId!=='chats'),{sectionId:null,name:'Ungrouped'}]};
    if(method==='archive'){
      archives.push(params);
      if(params.archived){
        await new Promise(resolve=>setTimeout(resolve,archiveDelayMs));
        if(archiveFailure)throw Object.assign(Error('Synthetic archive failure'),{status:409});
      }else{
        await new Promise(resolve=>setTimeout(resolve,restoreDelayMs));
        if(restoreFailures>0){restoreFailures--;throw Object.assign(Error('Synthetic Undo failure'),{status:409});}
      }
      archived=params.archived;
      restored=!archived;
      return {threadId:id,...(archived?{archived:true}:{restored:true})};
    }
    throw Error('Unexpected fixture bridge request');
  },
  archiveTask:async()=>{archived=true;return {threadId:id,archived:true};},
  restoreTask:async()=>{archived=false;return {threadId:id,restored:true};},
  moveTask:async params=>{moves.push(params);if(moveFailure){
    // An external client wins the race; the UI must read this new placement.
    Object.assign(task,{localSectionId:'group-1',nativeSectionId:'group-1',pinned:false,nativeTaskPinned:false,placementSource:'localThreadSection'});
    throw Object.assign(Error('Synthetic group conflict'),{status:409});}
    task.localSectionId=params.sectionId;task.nativeSectionId=params.sectionId??'chats';
    task.pinned=task.nativeTaskPinned=params.sectionId==='group-3';task.placementSource=params.sectionId?'localThreadSection':'localDefault';
    return {threadId:id,sectionId:params.sectionId,changed:true};},
  pinTask:async params=>{task.pinned=params.pinned;task.nativeTaskPinned=params.pinned;task.localSectionId=params.pinned?'group-3':null;task.nativeSectionId=params.pinned?'group-3':'chats';
    task.placementSource=params.pinned?'localThreadSection':'localDefault';return {threadId:id,pinned:params.pinned};},
  renameTask:params=>renameFixture(params,'local'),
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
  bridge.onopenlink=async({url})=>{
    await fetch('/fixture/navigation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url})});
    return {isError:true};
  };
  await bridge.connect(new PostMessageTransport(frame.contentWindow,frame.contentWindow));
  document.querySelector('button').onclick=()=>{frame.hidden=false;frame.src='/app.html';};
`,resolveDir:process.cwd(),sourcefile:'fixture-host.mjs'},bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});
const hostBackground=process.env.KANBAN_TEST_HOST_THEME==='light'?'#f8f8f8':'#181818';
const port=Number(process.env.KANBAN_TEST_PORT??0);
const navigationUrls=[];
const server=createServer(async(req,res)=>{
  try{
    if(new URL(req.url,'http://localhost').pathname==='/'&&req.method==='GET'){
      const width=Number(new URL(req.url,'http://localhost').searchParams.get('width'));
      const frameWidth=width>=280&&width<=1600?Math.round(width)+'px':'100%';
      res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<html><meta charset="utf-8"><style>body{margin:0;background:#16161a;color:#ddd;font:13px system-ui}header{padding:8px 16px}button{margin-right:12px}iframe{width:${frameWidth};height:calc(100vh - 42px);border:0}</style><header><button>Codex Kanban</button><span id="status">Synthetic MCP host</span></header><iframe title="Codex Kanban MCP App" hidden></iframe><script type="module">${parentScript.outputFiles[0].text.replaceAll('</script','<\\/script')}</script></html>`);return;
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
    if(req.url==='/status'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({reads,archived,title:task.title,flowEnabled,sectionId:task.localSectionId,projectId:task.projectId,moves,archives,renames,navigationUrls}));return;}
    if(req.url==='/fixture/reset'&&req.method==='POST'){
      let body='';for await(const chunk of req){body+=chunk;if(body.length>1024)throw Error('Too large');}
      const options=body?JSON.parse(body):{};
      // Reset the shared synthetic service as well as the fixture task.
      restoreDelayMs=0;restoreFailures=0;staleRestoreBoard=false;
      for(const entry of (await service.read()).undoArchives)await service.action('unarchive',{undoToken:entry.undoToken});
      archiveDelayMs=options.archiveDelayMs??0;staleArchiveBoard=options.staleArchiveBoard===true;archiveFailure=options.archiveFailure===true;
      staleRestoreBoard=options.staleRestoreBoard===true;restoreDelayMs=options.restoreDelayMs??0;restoreFailures=options.restoreFailures??0;restored=false;
      task.title='Sidebar integration fixture';
      groupActions=options.groupActions!==false;moveFailure=options.moveFailure===true;
      desktopConnected=options.desktopConnected!==false;
      Object.assign(task,{localSectionId:null,nativeSectionId:'chats',placementSource:'localDefault',pinned:false,nativeTaskPinned:false});
      if(options.inheritedProject)Object.assign(task,{nativeSectionId:'group-3',placementSource:'desktopProject',pinned:true});
      moves.length=0;archives.length=0;renames.length=0;navigationUrls.length=0;archived=false;res.writeHead(204).end();return;
    }
    if(req.url==='/fixture/navigation'&&req.method==='POST'){
      let body='';for await(const chunk of req){body+=chunk;if(body.length>8192)throw Error('Too large');}
      const {url}=JSON.parse(body);navigationUrls.push(url);
      await new Promise(resolve=>setTimeout(resolve,Number(process.env.KANBAN_TEST_NAVIGATION_DELAY_MS??0)));
      res.writeHead(204).end();return;
    }
    if(req.url==='/fixture/title'&&req.method==='POST'){
      let body='';for await(const chunk of req){body+=chunk;if(body.length>1024)throw Error('Too large');}
      const update=JSON.parse(body);if(typeof update.title!=='string'||!update.title.trim())throw Error('Invalid fixture title');
      task.title=update.title;res.writeHead(204).end();return;
    }
    res.writeHead(404).end();
  }catch{res.writeHead(500).end('Fixture request failed');}
});
server.listen(port,'127.0.0.1',()=>console.log(`Synthetic MCP browser acceptance: http://127.0.0.1:${server.address().port}`));
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{server.close();await client.close();await app.close();});
