import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script,createContext} from 'node:vm';

const html=readFileSync(new URL('./ui.html',import.meta.url),'utf8');
const source=html.match(/<script>([\s\S]*?)<\/script>/)[1];
export const localId='11111111-1111-4111-8111-111111111111';
export const fixture=()=>({capturedAt:new Date().toISOString(),runtimeCapturedAt:null,unavailableHosts:[],
  sync:{connected:true,writable:true,scope:'localSections',moveWritable:true,runtimeLive:false,pinLocal:true,archiveLocal:true},
  sections:[{sectionId:'pin',name:'Pinned'},{sectionId:'review',name:'For Review'},{sectionId:'chats',name:'Tasks'}],
  tasks:[{id:localId,title:'Local fixture',hostId:'local',nativeSectionId:'review',localSectionId:'review',placementSource:'localThreadSection',column:'unknown',isUnread:true},
    {id:'remote',title:'Cloud fixture',hostId:'durable',nativeSectionId:'chats',column:'unknown',pinned:true}]});

// Exercise the entire browser script against only the nodes that exist in the
// template, so a leftover reference to a removed control fails at startup.
export function harness(board=fixture(),{animations=false}={}){
  class Element {
    constructor(tag='div'){this.tag=tag;this.children=[];this.dataset={};this.attributes={};this.style={setProperty(){}};this.value='';this.hidden=false;this.open=false;this.listeners={};this.textContent='';this.animations=[];
      const classes=new Set();this.classList={add:(...names)=>names.forEach(n=>classes.add(n)),remove:(...names)=>names.forEach(n=>classes.delete(n)),contains:n=>classes.has(n),toggle:(n,on)=>{const next=on??!classes.has(n);next?classes.add(n):classes.delete(n);return next;}};
    }
    append(...children){children.forEach(child=>{child.parentElement=this;this.children.push(child);});}
    replaceChildren(...children){this.children=[];this.append(...children);}
    setAttribute(key,value){this.attributes[key]=value;}
    removeAttribute(key){delete this.attributes[key];}
    addEventListener(key,listener){this.listeners[key]=listener;}
    closest(selector){return selector==='button'?this.parentElement:null;}
    querySelector(selector){return selector==='details'?nodes.get('detail-technical'):this.children.find(n=>selector.startsWith('.')?n.className===selector.slice(1):n.tag===selector)??this.children.map(n=>n.querySelector(selector)).find(Boolean);}
    querySelectorAll(selector){const names=selector.split(',').map(n=>n.replace('.',''));const matches=n=>names.some(name=>{const [include,exclude]=name.split(':not(.');return (include===n.className||n.className?.split(/\s+/).includes(include))&&(!exclude||!n.className?.split(/\s+/).includes(exclude.replace(')','')));});return this.children.flatMap(n=>[...(matches(n)?[n]:[]),...n.querySelectorAll(selector)]);}
    getAnimations(){return this.animations;}
    getClientRects(){return animations?[{}]:[];}
    animate(){const animation={cancel(){}};this.animations.push(animation);return animation;}
    getBoundingClientRect(){return {top:0,bottom:0,left:0,right:0,width:0,height:0};}
    showModal(){this.open=true;}
    close(){this.open=false;}
    contains(target){return this===target||this.children.some(n=>n.contains(target));}
    focus(){context.document.activeElement=this;}
    select(){}
  }
  const nodes=new Map([...html.matchAll(/id="([^"]+)"/g)].map(([,id])=>[id,new Element()]));
  nodes.get('board').parentElement=new Element();
  nodes.get('host').value='all';nodes.get('order').value='recent';nodes.get('search').value='';
  const nav=['all','unread','pinned'].map(filter=>{const button=new Element('button');button.dataset.filter=filter;const label=new Element();label.className='label';label.textContent=filter;button.append(label);if(filter!=='all')button.append(nodes.get('nav-'+filter));return button;});
  const storage=new Map([['codex-kanban.workflow.v1:local%3Alegacy','done'],['codex-kanban.group-order.v1:workflow','["done","todo"]']]);
  const writes=[],events={},intervals=[];
  const context=createContext({
    document:{hidden:false,activeElement:null,getElementById:id=>{assert(nodes.has(id),'Missing DOM node: '+id);return nodes.get(id);},
      createElement:tag=>new Element(tag),createElementNS:(ns,tag)=>new Element(tag),
      querySelectorAll:selector=>selector==='[data-filter]'?nav:[],addEventListener:(name,listener)=>events[name]=listener},
    window:{addEventListener:(name,listener)=>events[name]=listener},
    location:{protocol:'file:',reload(){}},performance:{now:()=>1000},matchMedia:()=>({matches:!animations}),
    localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>{writes.push(key);storage.set(key,value);}},
    setInterval:listener=>intervals.push(listener),setTimeout:()=>1,clearTimeout(){},
    navigator:{clipboard:{writeText:async()=>{throw Error('Clipboard denied');}}}
  });
  new Script(source.replace('/*__BOARD_DATA__*/null',JSON.stringify(board))).runInContext(context);
  const api=new Script('({applyNativeBoard,showDetail,setFilter,setView,nativeNotice,render,nativeCanEditGroup,makeCard,expireRuntimeSnapshot,DATA})').runInContext(context);
  return {api,nodes,storage,writes,events,intervals,context};
}
