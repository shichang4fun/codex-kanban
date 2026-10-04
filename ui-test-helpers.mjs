import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script,createContext} from 'node:vm';

const html=readFileSync(new URL('./ui.html',import.meta.url),'utf8');
const source=html.match(/<script>([\s\S]*?)<\/script>/)[1];
export const localId='11111111-1111-4111-8111-111111111111';
export const fixture=()=>({capturedAt:new Date().toISOString(),runtimeCapturedAt:null,unavailableHosts:[],
  sync:{connected:true,writable:true,scope:'localSections',moveWritable:true,runtimeLive:false,pinLocal:true,archiveLocal:true,renameLocal:true},
  sections:[{sectionId:'pin',name:'Pinned'},{sectionId:'review',name:'For Review'},{sectionId:'chats',name:'Tasks'}],
  tasks:[{id:localId,title:'Local fixture',hostId:'local',nativeSectionId:'review',localSectionId:'review',placementSource:'localThreadSection',column:'unknown',isUnread:true},
    {id:'remote',title:'Cloud fixture',hostId:'durable',nativeSectionId:'chats',column:'unknown',pinned:true}]});

// Exercise the entire browser script against only the nodes that exist in the
// template, so a leftover reference to a removed control fails at startup.
export function harness(board=fixture(),{animations=false,dark=true,theme,textSize,storageFailure=false}={}){
  class Element {
    constructor(tag='div'){this.tag=tag;this.children=[];this.dataset={};this.attributes={};this.style={setProperty(key,value){this[key]=value;}};this.value='';this.hidden=false;this.open=false;this.listeners={};this.textContent='';this.animations=[];
      const classes=new Set();this.classList={add:(...names)=>names.forEach(n=>classes.add(n)),remove:(...names)=>names.forEach(n=>classes.delete(n)),contains:n=>classes.has(n),toggle:(n,on)=>{const next=on??!classes.has(n);next?classes.add(n):classes.delete(n);return next;}};
    }
    append(...children){children.forEach(child=>{child.parentElement=this;this.children.push(child);});}
    replaceChildren(...children){this.children=[];this.append(...children);}
    setAttribute(key,value){this.attributes[key]=value;}
    getAttribute(key){return this.attributes[key]??null;}
    removeAttribute(key){delete this.attributes[key];}
    addEventListener(key,listener){this.listeners[key]=listener;}
    closest(selector){
      if(selector==='button')return this.tag==='button'?this:this.parentElement?.closest(selector)??null;
      if(selector==='input,textarea,select,[contenteditable=true]')return ['input','textarea','select'].includes(this.tag)?this:null;
      if(selector.startsWith('.'))return this.className?.split(/\s+/).includes(selector.slice(1))?this:this.parentElement?.closest(selector)??null;
      return null;
    }
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
  nodes.get('host').value='all';nodes.get('search').value='';
  const storage=new Map([['codex-kanban.workflow.v1:local%3Alegacy','done'],['codex-kanban.group-order.v1:workflow','["done","todo"]'],['codex-kanban.sort.v1','recent']]);
  if(theme!==undefined)storage.set('codex-kanban.theme.v1',theme);
  if(textSize!==undefined)storage.set('codex-kanban.text-size.v1',textSize);
  const writes=[],events={},intervals=[];
  const themeMedia={matches:dark,addEventListener:(name,listener)=>events.mediaTheme=listener};
  const context=createContext({
    document:{documentElement:new Element('html'),hidden:false,activeElement:null,getElementById:id=>{assert(nodes.has(id),'Missing DOM node: '+id);return nodes.get(id);},
      createElement:tag=>new Element(tag),createElementNS:(ns,tag)=>new Element(tag),
      querySelectorAll:()=>[],addEventListener:(name,listener)=>events[name]=listener},
    window:{addEventListener:(name,listener)=>events[name]=listener},
    location:{protocol:'file:',reload(){}},performance:{now:()=>1000},matchMedia:query=>query==='(prefers-color-scheme: dark)'?themeMedia:{matches:!animations},
    localStorage:{getItem:key=>{if(storageFailure)throw Error('Storage blocked');return storage.get(key)??null;},setItem:(key,value)=>{if(storageFailure)throw Error('Storage blocked');writes.push(key);storage.set(key,value);}},
    setInterval:(listener,delay)=>{listener.delay=delay;return intervals.push(listener);},setTimeout:()=>1,clearTimeout(){},
    navigator:{clipboard:{writeText:async()=>{throw Error('Clipboard denied');}}},
    fetch:(...args)=>context.fetchImpl(...args)
  });
  new Script(source.replace('/*__BOARD_DATA__*/null',JSON.stringify(board))).runInContext(context);
  const api=new Script('({applyNativeBoard,showDetail,setFilter,setView,nativeNotice,render,nativeCanEditGroup,makeCard,expireRuntimeSnapshot,refreshNativeBoard,DATA})').runInContext(context);
  return {api,nodes,storage,writes,events,intervals,context,themeMedia};
}
