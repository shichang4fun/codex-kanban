import {App} from '@modelcontextprotocol/ext-apps';
import {createMcpFetch} from './mcp-ui-transport.mjs';

const app=new App({name:'Codex Kanban',version:'0.4.53'},{},{autoResize:false});
const ready=app.connect(undefined,{timeout:15000});
// Attach a rejection handler immediately; the initial board request shows errors.
void ready.catch(()=>{});
let closed=false;
let connected=false,pointerLink=null,pointerReleaseTimer=null;
const openingLinks=new Set();
const fetchBoard=createMcpFetch(app,ready);
globalThis.kanbanTransport={
  get navigationPending(){return pointerLink!==null||openingLinks.size>0;},
  async fetch(...args){if(closed)throw Error('The board connection is closed.');return fetchBoard(...args);}
};
function syncHostTheme(context){
  if(context?.theme==='light'||context?.theme==='dark')window.dispatchEvent(new CustomEvent('kanban-host-theme',{detail:context.theme}));
}
app.onhostcontextchanged=syncHostTheme;
void ready.then(()=>{connected=true;syncHostTheme(app.getHostContext());}).catch(()=>{});
app.onteardown=async()=>{closed=true;return {};};
function navigationLink(event){
  const link=event.target.closest?.('a[href^="codex://threads/"],a[href^="codex://new?"],a[href^="https://"]');
  if(link)return link;
  // Timestamp clicks forward to the card link; protect their press too.
  const cardLink=event.target.closest?.('.time')?.closest('.card')?.querySelector('.card-open');
  return cardLink?.href?.startsWith('codex://threads/')?cardLink:null;
}
// Keep polling from replacing a link between pointerdown and click.
function clearPointerLink(){clearTimeout(pointerReleaseTimer);pointerReleaseTimer=null;pointerLink=null;}
document.addEventListener('pointerdown',event=>{if(event.button===0){clearPointerLink();pointerLink=navigationLink(event)??null;}});
// Click follows pointerup; hold through its microtask checkpoint. A release
// outside the link still clears the guard on the next turn.
document.addEventListener('pointerup',()=>{if(pointerLink)pointerReleaseTimer=setTimeout(clearPointerLink,0);});
document.addEventListener('pointercancel',clearPointerLink);
document.addEventListener('dragstart',clearPointerLink);
document.addEventListener('dragend',clearPointerLink);
window.addEventListener('blur',clearPointerLink);
document.addEventListener('click',async event=>{
  clearPointerLink();
  const link=navigationLink(event);
  if(!link||event.defaultPrevented)return;
  event.preventDefault();
  const url=link.href;
  if(openingLinks.has(url))return;
  openingLinks.add(url);
  const card=link.closest?.('.card');
  card?.classList.add('opening');link.setAttribute?.('aria-busy','true');
  try{
    // The board is already connected after its first read. Dispatch in the
    // click handler's current turn rather than yielding to background work.
    if(!connected)await ready;
    if(closed)throw Error('The board connection is closed.');
    const response=await app.openLink({url});
    if(response.isError)throw Error('Link navigation is unavailable.');
  }catch{
    const status=document.getElementById('task-toast');
    status.textContent=url.startsWith('codex://new?')||url==='codex://threads/new'?'New-task navigation is unavailable. Open New task in Codex.':url.startsWith('codex:')?'Chat navigation is unavailable. Open this task from Codex.':'Link navigation is unavailable. Open the link in your browser.';status.hidden=false;
  }finally{
    openingLinks.delete(url);card?.classList.remove('opening');link.removeAttribute?.('aria-busy');
  }
});
window.addEventListener('pagehide',()=>{closed=true;void app.close();},{once:true});
