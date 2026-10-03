import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script,createContext} from 'node:vm';

const html=readFileSync(new URL('./ui.html',import.meta.url),'utf8');
const helpers=html.match(/const refreshAnimations=[\s\S]*?(?=function render)/)[0];
const rect=(left,top,width=200,height=70)=>({left,top,width,height,right:left+width,bottom:top+height});
function node(key,left,top,{group=false,hidden=false,unread=false}={}){
  const classes=new Set(),calls=[];
  const element={dataset:group?{groupKey:key}:{taskKey:key},classes,calls,
    classList:{add:value=>classes.add(value),remove:value=>classes.delete(value)},
    rect:rect(left,top,hidden?0:200,hidden?0:70),
    getBoundingClientRect(){return this.rect;},querySelector:()=>unread?marker:null,
    animate(frames,timing){
      const animation={frames,timing,cancelled:false,cancel(){this.cancelled=true;this.oncancel?.();}};
      calls.push(animation);return animation;
    }};
  const marker=unread?node('marker',left,top):null;
  element.marker=marker;return element;
}
function harness(nodes){
  const board={querySelectorAll:()=>nodes,parentElement:{getBoundingClientRect:()=>rect(0,0,800,600)}};
  const context=createContext({$:()=>board});
  const api=new Script(helpers+'\n({captureBoardLayout,animateBoardRefresh,cancelRefreshAnimations,refreshAnimations})').runInContext(context);
  return {api,set:next=>nodes=next};
}

test('unchanged snapshots stay still; cross-group moves animate from the previous position',()=>{
  const h=harness([node('local:task',20,100)]),before=h.api.captureBoardLayout();
  const unchanged=node('local:task',20,100);h.set([unchanged]);h.api.animateBoardRefresh(before);
  assert.equal(unchanged.calls.length,0);
  const moved=node('local:task',280,30);h.set([moved]);h.api.animateBoardRefresh(before);
  assert.equal(moved.calls.length,1);
  assert.equal(moved.calls[0].frames[0].transform,'translate(-260px,70px)');
  assert.equal(moved.calls[0].frames[1].transform,'translate(0,0)');
  assert.equal(moved.calls[0].timing.duration,500);
});
test('new tasks fade in and host identities stay separate',()=>{
  const h=harness([node('local:same-id',20,100)]),before=h.api.captureBoardLayout();
  const remote=node('cloud:same-id',20,100);h.set([remote]);h.api.animateBoardRefresh(before);
  assert.equal(remote.calls[0].frames[0].opacity,0);
  assert.equal(remote.calls[0].frames[1].opacity,1);
  assert.equal(remote.calls[0].timing.duration,180);
});
test('collapsed and fully offscreen rows are skipped; visible destinations still move',()=>{
  const h=harness([node('hidden',20,100,{hidden:true}),node('offscreen',900,100)]),before=h.api.captureBoardLayout();
  assert.equal(before.has('task:hidden'),false);
  const hidden=node('hidden',30,100,{hidden:true}),offscreen=node('offscreen',950,100);
  h.set([hidden,offscreen]);h.api.animateBoardRefresh(before);
  assert.equal(hidden.calls.length+offscreen.calls.length,0);
  const entered=node('offscreen',280,100);h.set([entered]);h.api.animateBoardRefresh(before);
  assert.equal(entered.calls[0].frames[0].transform,'translate(620px,0px)');
});
test('list group headers and following rows glide when a preceding group changes height',()=>{
  const h=harness([node('review',20,200,{group:true}),node('task',20,250)]),before=h.api.captureBoardLayout();
  const heading=node('review',20,130,{group:true}),task=node('task',20,180);
  h.set([heading,task]);h.api.animateBoardRefresh(before);
  for(const element of [heading,task])assert.equal(element.calls[0].frames[0].transform,'translate(0px,70px)');
});
test('new unread markers fade without moving stationary cards; completed animations clean up',()=>{
  const h=harness([node('task',20,100)]),before=h.api.captureBoardLayout();
  const unread=node('task',20,100,{unread:true});h.set([unread]);h.api.animateBoardRefresh(before);
  assert.equal(unread.calls.length,0);
  assert.equal(unread.marker.calls[0].frames[0].opacity,0);
  unread.marker.calls[0].onfinish();
  assert.equal(h.api.refreshAnimations.size,0);
  assert.equal(unread.marker.classes.has('layout-moving'),false);
});
test('interrupted updates use the current visual position and cancel old animations',()=>{
  const h=harness([node('task',20,100)]),before=h.api.captureBoardLayout();
  const moving=node('task',280,30);h.set([moving]);h.api.animateBoardRefresh(before);
  moving.rect=rect(100,80);
  const interrupted=h.api.captureBoardLayout();h.api.cancelRefreshAnimations();
  assert.equal(moving.calls[0].cancelled,true);
  assert.equal(h.api.refreshAnimations.size,0);
  const destination=node('task',500,30);h.set([destination]);h.api.animateBoardRefresh(interrupted);
  assert.equal(destination.calls[0].frames[0].transform,'translate(-400px,50px)');
});
