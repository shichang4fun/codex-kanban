import {readFile} from 'node:fs/promises';
import {realpathSync,readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {timingSafeEqual} from 'node:crypto';
import {McpServer,StdioServerTransport,registerAppResource,registerAppTool,RESOURCE_MIME_TYPE,z} from './mcp-sdk.mjs';
import {createBoardSource,createKanbanService} from './kanban-service.mjs';
import {readDesktopBridgeConfig} from './setup-desktop-bridge.mjs';

export const boardResourceUri='ui://kanban/board/v1.html';
export const defaultDataDir=()=>process.env.KANBAN_DATA_DIR??join(process.env.CODEX_HOME??join(homedir(),'.codex'),'kanban');
const taskFields={threadId:z.string().uuid(),hostId:z.literal('local')};
const writeToken={actionToken:z.string().uuid()};
const appOnly={ui:{visibility:['app']}};
// Sidebar entries use MCP tool icons, then server icons; plugin logos are separate.
const boardIcons=['light','dark'].map(theme=>({
  src:`data:image/png;base64,${readFileSync(new URL(`./assets/kanban-icon${theme==='dark'?'-dark':''}.png`,import.meta.url)).toString('base64')}`,
  mimeType:'image/png',theme
}));
const result=payload=>({content:[{type:'text',text:payload.error??(payload.board?`${payload.board.tasks.length} Codex tasks loaded.`:'Task action verified.')}],
  structuredContent:payload,...(payload.error?{isError:true}:{})});

export function createKanbanMcp({service,source,readUi=()=>readFile(new URL('./dist/kanban-ui.html',import.meta.url),'utf8')}={}){
  source??=service?null:createBoardSource({snapshotPath:join(defaultDataDir(),'snapshot.json'),allowMissingSnapshot:true});
  service??=createKanbanService({getBoard:source.getBoard});
  const server=new McpServer({name:'codex-kanban',version:'0.4.51',icons:boardIcons},
    {instructions:'This plugin provides a local Codex task board through an app-only sidebar UI. Local placement is authoritative; a connected Desktop bridge supplies live runtime observations, with expiring snapshots otherwise. Task actions require explicit user interaction in the app.'});
  const read=async()=>{
    try{return result(await service.read());}
    catch{return result({error:'Local groups unavailable. Check the local Codex connection and refresh.',status:503});}
  };
  registerAppTool(server,'open_board',{
    title:'Codex Kanban',description:'Open the local Codex task board from the sidebar.',inputSchema:z.object({}).strict(),
    annotations:{readOnlyHint:true,openWorldHint:false},
    _meta:{ui:{resourceUri:boardResourceUri,visibility:['app']},'openai/ui':{entrypoints:[{type:'global'}]}}
  },read);
  server.registerTool('get_board',{
    title:'Refresh Codex board',description:'Read current local groups, branch/PR information and Desktop runtime observations.',
    inputSchema:z.object({}).strict(),annotations:{readOnlyHint:true,openWorldHint:false},_meta:appOnly
  },read);
  for(const [name,method,fields] of [
    ['get_creation_options','creationOptions',{}],
    ['get_creation_status','creationStatus',{requestId:z.string().uuid()}]
  ])server.registerTool(name,{
    description:name==='get_creation_options'?'Read verified local creation projects, groups and saved defaults':'Read a recorded creation outcome without creating again',
    inputSchema:z.object(fields).strict(),annotations:{readOnlyHint:true,openWorldHint:false},_meta:appOnly
  },async params=>{
    try{return result(await service[method](params));}
    catch(error){return result({error:error.status?error.message:'Creation information is unavailable.',status:error.status??503});}
  });
  const settingsSchema=z.object({projectId:z.string().min(1).max(256).nullable().optional(),environment:z.enum(['local','worktree']).optional(),branch:z.string().max(256).optional(),model:z.string().max(128).optional(),thinking:z.enum(['','none','minimal','low','medium','high','xhigh','max','ultra']).optional(),template:z.string().max(2000).optional()}).strict();
  const actions=[
    ['set_flow_settings','flow-settings','Enable or disable automatic local task grouping without changing classification rules',{enabled:z.boolean()}],
    ['rename_task','rename','Rename a local task title and verify it without changing its project, group or execution',{...taskFields,title:z.string().trim().min(1).max(256),expectedTitle:z.string().min(1)}],
    ['save_group_settings','group-settings','Save defaults for a verified local group without creating a task',{sectionId:z.string().min(1).max(128).nullable(),settings:settingsSchema}],
    ['create_task','create','Explicitly create and run one task using a durable request ID; never automatically retry',{requestId:z.string().uuid(),sectionId:z.string().min(1).max(128).nullable(),settings:settingsSchema,prompt:z.string().min(1).max(5000)}],
    ['retry_creation_group','creation-group','Retry grouping an already confirmed creation; never create another task',{requestId:z.string().uuid()}],
    ['set_project','project','Assign or remove a local task project without changing its working directory',{...taskFields,projectId:z.string().min(1).max(128).nullable(),expectedProjectId:z.string().min(1).max(128).nullable()}],
    ['move_task','move','Move task to a verified native group',{...taskFields,sectionId:z.string().nullable(),expectedSectionId:z.string().nullable()}],
    ['pin_task','pin','Pin or unpin a local task',{...taskFields,pinned:z.boolean()}],
    ['archive_task','archive','Archive a local task and issue a session-bound Undo token',taskFields],
    ['undo_archive','unarchive','Restore a confirmed archive using its Undo token',{undoToken:z.string().uuid()}]
  ];
  for(const [name,action,description,fields] of actions)server.registerTool(name,{
    description,inputSchema:z.object({...fields,...writeToken}).strict(),
    annotations:{readOnlyHint:false,destructiveHint:action==='archive',idempotentHint:false,openWorldHint:false},_meta:appOnly
  },async({actionToken,...params},extra)=>{
    const token=Buffer.from(actionToken),expected=Buffer.from(service.csrf);
    if(token.length!==expected.length||!timingSafeEqual(token,expected))return result({error:'This app session is no longer authorized. Refresh before trying again.',status:403});
    try{return result(await service.action(action,params,{signal:extra.signal}));}
    catch(error){return result({error:error.status?error.message:'Task action could not be confirmed. Refresh before trying again.',status:error.status??503});}
  });
  registerAppResource(server,'Codex Kanban UI',boardResourceUri,{},async()=>({contents:[{
    uri:boardResourceUri,mimeType:RESOURCE_MIME_TYPE,text:await readUi(),
    _meta:{ui:{prefersBorder:false,csp:{connectDomains:[],resourceDomains:[]}}}
  }]}));
  let closing;
  const close=()=>closing??=(async()=>{await service.close();await source?.close();})();
  server.server.onclose=()=>{void close();};
  return {server,service,close};
}

if(process.argv[1]&&realpathSync(resolve(process.argv[1]))===fileURLToPath(import.meta.url)){
  const source=createBoardSource({snapshotPath:join(defaultDataDir(),'snapshot.json'),allowMissingSnapshot:true});
  const connection=await readDesktopBridgeConfig().catch(()=>null);
  const service=createKanbanService({getBoard:source.getBoard,
    desktopBridgeSocket:process.env.KANBAN_ARCHIVE_SOCKET??connection?.socketPath??null});
  const app=createKanbanMcp({source,service});
  let stopping=false;
  const stop=async()=>{if(stopping)return;stopping=true;await app.server.close();await app.close();};
  process.stdin.once('end',()=>{void stop();});
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{void stop();});
  try{await app.server.connect(new StdioServerTransport());}
  catch{await stop();process.stderr.write('Codex Kanban MCP could not connect.\n');process.exitCode=1;}
}
