import test from 'node:test';
import assert from 'node:assert/strict';
import {harness,fixture} from './ui-test-helpers.mjs';
import {Script} from 'node:vm';

const find=(root,name)=>root.querySelectorAll('.'+name)[0]??null;
function boardWith(task){
  const board=fixture(),capturedAt=new Date().toISOString();
  board.runtimeCapturedAt=capturedAt;board.runtimeSnapshotMaxAgeMs=15000;
  board.tasks=[{...board.tasks[0],runtimeStatusSource:'desktopRuntime',runtimeCapturedAt:capturedAt,
    updatedAt:Math.floor(Date.now()/1000),...task}];
  return board;
}

test('previews show plain content without card-wide tooltips and preserve untrusted text safely',()=>{
  for(const source of ['threadPreview','desktopSnapshot',null]){
    const h=harness(boardWith({summary:'  检查排序\n <img src=x onerror=alert(1)>  ',summarySource:source}));
    const card=h.api.makeCard(h.api.DATA.tasks[0],'review');
    assert.equal(find(card,'preview-label'),null);
    assert.equal(find(card,'card-preview').children.length,1);
    assert.equal(find(card,'preview-text').textContent,'检查排序 <img src=x onerror=alert(1)>');
    assert.equal(find(card,'preview-text').children.length,0);
    assert.equal(find(card,'card-open').title??'','');
    assert.equal(find(card,'card-open').getAttribute('aria-label'),'Open task: Local fixture');
    assert.match(find(card,'time').title,/Not the summary or last reply time/);
    assert.match(find(card,'time').attributes['aria-label'],/^Task updated at /);
    let activated=0;find(card,'card-open').click=()=>activated++;
    find(card,'time').onclick({stopPropagation(){}});assert.equal(activated,1);
  }
});

test('leading browser context is removed before normalizing the actual request',()=>{
  const context='<in-app-browser-context source="ambient-ui-state">\nAutomatically supplied context.\n# In app browser:\n- Current URL: https://example.com\n</in-app-browser-context>';
  const request='将 Sebastian 关于 LLMs、AI Agent 的图文内容\n整理成一个教程';
  for(const source of ['threadPreview','desktopSnapshot'])for(const prefix of [context,context+'\n'+context]){
    const h=harness(boardWith({summary:prefix+'\n\n## My request:\n'+request,summarySource:source}));
    const card=h.api.makeCard(h.api.DATA.tasks[0],'review');
    assert.equal(find(card,'preview-text').textContent,request.replace(/\s+/g,' '));
    assert.equal(find(card,'card-open').title??'','');
    assert.equal(h.api.DATA.tasks[0].summary,prefix+'\n\n## My request:\n'+request,'Keep source metadata intact');
  }
  const h=harness(boardWith({summary:context+'\n直接展示请求'}));
  assert.equal(find(h.api.makeCard(h.api.DATA.tasks[0],'review'),'preview-text').textContent,'直接展示请求');
});

test('legacy browser context uses the explicit request boundary',()=>{
  for(const context of ['# Chrome tabs:\n- The user has the Chrome extension side panel open.\n- Current URL: https://example.com',
    '# In app browser:\n- The user has the in-app browser open with 1 tab.\n- Current URL: https://example.com']){
    const h=harness(boardWith({summary:context+'\n\n## My request:\n整理教程'}));
    assert.equal(find(h.api.makeCard(h.api.DATA.tasks[0],'review'),'preview-text').textContent,'整理教程');
  }
});

test('context-only, truncated and cleaned title-duplicate previews are hidden',()=>{
  for(const summary of ['<in-app-browser-context source="ambient-ui-state">Incomplete context',
    '<in-app-browser-context', '<in-app-browser-context>Context</in-app-browser-context>\n## My request:\n',
    '<in-app-browser-context>Context</in-app-browser-context>\n## My request:\nLocal fixture',
    '# Chrome tabs:\n- The user has the Chrome extension side panel open.\n- Current URL: https://example.com']){
    const h=harness(boardWith({summary}));
    assert.equal(find(h.api.makeCard(h.api.DATA.tasks[0],'review'),'card-preview'),null);
  }
});

test('ordinary requests and markup inside requests remain intact',()=>{
  for(const summary of ['解释 <in-app-browser-context> 标签', '<custom-tag>用户内容</custom-tag>',
    '请解释下面的结构\n## My request:\n保留这一段', '# Chrome tabs:\n请为这个标题编写说明']){
    const h=harness(boardWith({summary}));
    assert.equal(find(h.api.makeCard(h.api.DATA.tasks[0],'review'),'preview-text').textContent,summary.replace(/\s+/g,' '));
  }
});

test('empty, invalid and title-duplicate previews do not add a card row',()=>{
  for(const summary of [undefined,null,'',' \n\t ',42,' Local\n fixture ']){
    const h=harness(boardWith({summary})),card=h.api.makeCard(h.api.DATA.tasks[0],'review');
    assert.equal(find(card,'card-preview'),null);
    assert.equal(find(card,'card-info'),null);
  }
});

test('both waiting reasons appear in every view without claiming execution or completion',()=>{
  for(const view of ['board','list']){
    const h=harness(boardWith({column:'attention',rawStatus:{type:'active',activeFlags:['waitingOnUserInput','waitingOnApproval']},summary:'检查代码'}));
    h.api.setView(view);
    const card=find(h.nodes.get('board'),'card'),badges=card.querySelectorAll('.attention-badge');
    assert.deepEqual(badges.map(n=>n.textContent),['Waiting for input','Waiting for approval']);
    assert.equal(find(card,'progress-ring'),null);assert(find(card,'unread'));assert(find(card,'card-preview'));
    assert.equal(find(card,'card-info').children[0].className,'card-attention');
    assert.match(find(card,'time').title,/Not the summary or last reply time/);
  }
});

test('runtime errors are labeled separately and ordinary states have no attention badge',()=>{
  for(const [column,rawStatus] of [['error',{type:'systemError'}],['idle',{type:'idle'}],['unloaded',{type:'notLoaded'}],['running',{type:'active',activeFlags:[]}]]){
    const h=harness(boardWith({column,rawStatus})),card=h.api.makeCard(h.api.DATA.tasks[0],'review');
    const badge=find(card,'attention-badge');
    if(column==='error'){assert.equal(badge.textContent,'Runtime error');assert.match(badge.className,/runtime-error/);}
    else assert.equal(badge,null);
  }
});

test('snapshot notices identify their source and disappear on expiry while previews remain',()=>{
  for(const live of [true,false]){
    const h=harness(boardWith({column:'attention',rawStatus:{type:'active',activeFlags:['waitingOnApproval']},
      runtimeStatusSource:live?'desktopRuntime':'desktopSnapshot',summary:'旧任务摘要',summarySource:'desktopSnapshot'}));
    const task=h.api.DATA.tasks[0],before=h.api.makeCard(task,'review');
    assert.equal(find(before,'attention-badge').textContent,'Waiting for approval'+(live?'':' (snapshot)'));
    assert(h.api.expireRuntimeSnapshot(Date.parse(task.runtimeCapturedAt)+16000));h.api.render();
    const after=find(h.nodes.get('board'),'card');
    assert.equal(find(after,'attention-badge'),null);assert(find(after,'card-preview'));assert(find(after,'unread'));
    task.column='error';task.runtimeStatusStale=false;task.runtimeStatusSource='unavailable';
    assert.equal(find(h.api.makeCard(task,'review'),'attention-badge'),null);
  }
});

test('refresh and theme changes preserve previews and replace resolved waiting notices',()=>{
  const h=harness(boardWith({column:'attention',rawStatus:{type:'active',activeFlags:['waitingOnUserInput']},summary:'保持紧凑布局',summarySource:'threadPreview'}));
  const next=boardWith({column:'idle',rawStatus:{type:'idle'},summary:'保持紧凑布局',summarySource:'threadPreview'});
  h.api.applyNativeBoard(next);h.events['kanban-host-theme']({detail:'light'});h.api.setView('list');
  const card=find(h.nodes.get('board'),'card');assert.equal(find(card,'attention-badge'),null);
  assert.equal(find(card,'preview-text').textContent,'保持紧凑布局');assert.equal(h.context.document.documentElement.dataset.theme,'light');
});

test('runtime notices expire in place during menus, creation and dragging without interrupting interaction',()=>{
  for(const paused of ['options','taskMenu','creation','taskDrag','groupDrag'])for(const column of ['attention','error','running']){
    const h=harness(boardWith({column,rawStatus:column==='attention'?{type:'active',activeFlags:['waitingOnUserInput']}:
      column==='error'?{type:'systemError'}:{type:'active',activeFlags:[]},summary:'Keep this preview'}));
    const card=find(h.nodes.get('board'),'card'),heading=find(card,'card-heading'),preview=find(card,'card-preview');
    if(paused==='options')h.nodes.get('view-options').open=true;
    if(paused==='creation')h.nodes.get('creation').open=true;
    if(paused==='taskMenu')find(card,'card-details').onclick({stopPropagation(){}});
    if(paused==='taskDrag')new Script("draggedKey='fixture'").runInContext(h.context);
    if(paused==='groupDrag')new Script("draggedGroup='review'").runInContext(h.context);
    const capturedAt=h.api.DATA.tasks[0].runtimeCapturedAt;
    h.context.expiredNow=Date.parse(capturedAt)+60000;
    new Script('Date.now=()=>expiredNow').runInContext(h.context);
    for(const tick of h.intervals)tick();
    assert.equal(find(h.nodes.get('board'),'card'),card,'Do not replace the active card');
    assert.equal(find(card,'card-heading'),heading);assert.equal(find(card,'card-preview'),preview);
    assert.equal(find(card,'attention-badge'),null);assert.equal(find(card,'progress-ring'),null);assert(find(card,'unread'));
    assert.equal(find(card,'card-open').title??'','');
    if(paused==='options')assert(h.nodes.get('view-options').open);
    if(paused==='creation')assert(h.nodes.get('creation').open);
    if(paused==='taskMenu')assert.equal(h.nodes.get('task-menu').hidden,false);
    if(paused==='taskDrag')assert.equal(new Script('draggedKey').runInContext(h.context),'fixture');
    if(paused==='groupDrag')assert.equal(new Script('draggedGroup').runInContext(h.context),'review');
  }
});
