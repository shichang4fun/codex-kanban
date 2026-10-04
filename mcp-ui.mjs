import {App} from '@modelcontextprotocol/ext-apps';
import {createMcpFetch} from './mcp-ui-transport.mjs';

const app=new App({name:'Codex 看板',version:'0.4.43'},{},{autoResize:false});
const ready=app.connect(undefined,{timeout:15000});
// Attach a rejection handler immediately; the initial board request shows errors.
void ready.catch(()=>{});
let closed=false;
const fetchBoard=createMcpFetch(app,ready);
globalThis.kanbanTransport={
  async fetch(...args){if(closed)throw Error('The board connection is closed.');return fetchBoard(...args);}
};
function syncHostTheme(context){
  if(context?.theme==='light'||context?.theme==='dark')window.dispatchEvent(new CustomEvent('kanban-host-theme',{detail:context.theme}));
}
app.onhostcontextchanged=syncHostTheme;
void ready.then(()=>syncHostTheme(app.getHostContext())).catch(()=>{});
app.onteardown=async()=>{closed=true;return {};};
document.addEventListener('click',async event=>{
  const link=event.target.closest?.('a[href^="codex://threads/"],a[href^="codex://new?"],a[href^="https://"]');
  if(!link)return;
  event.preventDefault();
  try{
    await ready;
    const response=await app.openLink({url:link.href});
    if(response.isError)throw Error('Link navigation is unavailable.');
  }catch{
    const status=document.getElementById('task-toast');
    status.textContent=link.href.startsWith('codex://new?')||link.href==='codex://threads/new'?'New-task navigation is unavailable. Open New task in Codex.':link.href.startsWith('codex:')?'Chat navigation is unavailable. Open this task from Codex.':'Link navigation is unavailable. Open the link in your browser.';status.hidden=false;
  }
});
window.addEventListener('pagehide',()=>{closed=true;void app.close();},{once:true});
