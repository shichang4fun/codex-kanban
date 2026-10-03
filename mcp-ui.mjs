import {App} from '@modelcontextprotocol/ext-apps';
import {createMcpFetch} from './mcp-ui-transport.mjs';

const app=new App({name:'Codex 看板',version:'0.4.32'},{},{autoResize:false});
const ready=app.connect(undefined,{timeout:15000});
// Attach a rejection handler immediately; the initial board request shows errors.
void ready.catch(()=>{});
let closed=false;
const fetchBoard=createMcpFetch(app,ready);
globalThis.kanbanTransport={
  async fetch(...args){if(closed)throw Error('The board connection is closed.');return fetchBoard(...args);}
};
app.onteardown=async()=>{closed=true;return {};};
document.addEventListener('click',async event=>{
  const link=event.target.closest?.('a[href^="codex://threads/"],a[href^="https://"]');
  if(!link)return;
  event.preventDefault();
  try{
    await ready;
    const response=await app.openLink({url:link.href});
    if(response.isError)throw Error('Link navigation is unavailable.');
  }catch{
    const status=document.getElementById('task-toast');
    status.textContent=link.href.startsWith('codex:')?'Chat navigation is unavailable. Open this task from Codex.':'Link navigation is unavailable. Open the link in your browser.';status.hidden=false;
  }
});
window.addEventListener('pagehide',()=>{closed=true;void app.close();},{once:true});
