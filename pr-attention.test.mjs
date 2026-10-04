import test from 'node:test';
import assert from 'node:assert/strict';
import {Script} from 'node:vm';
import {fixture,harness} from './ui-test-helpers.mjs';

const pr=(number,fields={})=>({number,url:'https://github.com/example/board/pull/'+number,state:'OPEN',checks:'failed',review:'CHANGES_REQUESTED',...fields});
function boardWith(items=[pr(7)]){
  const board=fixture(),checkedAt=new Date().toISOString();
  board.tasks[0].git={status:'ready',branch:'codex/pr-attention',repository:'example/board',checkedAt,
    pullRequests:{status:'ready',checkedAt,items}};
  return board;
}
const alerts=root=>root.querySelectorAll('.pr-alert');
const labels=root=>alerts(root).map(n=>n.textContent);

test('background refresh keeps fresh branch and PR labels stable until their data expires',()=>{
  for(const view of ['board','list']){
    const board=boardWith(),git=board.tasks[0].git,now=Date.now();
    git.checkedAt=git.pullRequests.checkedAt=new Date(now-6000).toISOString();
    git.refreshing=git.pullRequests.refreshing=true;
    const h=harness(board),root=h.nodes.get('board');h.api.setView(view);
    const branchText=()=>root.querySelectorAll('.git-branch')[0].children[1].textContent;
    assert.equal(branchText(),'codex/pr-attention');
    assert.equal(root.querySelectorAll('.pr-badge')[0].textContent,'#7 · Open');
    assert.deepEqual(labels(root),['CI failed','Changes requested']);

    const fresh=boardWith();h.api.applyNativeBoard(fresh,{skipUnchanged:true});
    assert.equal(branchText(),'codex/pr-attention');
    assert.deepEqual(labels(root),['CI failed','Changes requested']);

    h.context.expiredNow=Date.parse(fresh.tasks[0].git.checkedAt)+91000;
    new Script('Date.now=()=>expiredNow').runInContext(h.context);
    for(const tick of h.intervals)tick();
    assert.equal(branchText(),'codex/pr-attention · Cached');
    assert.equal(root.querySelectorAll('.pr-badge')[0].textContent,'#7 · Open · Cached');
    assert.deepEqual(labels(root),['CI failed · Cached','Changes requested · Cached']);

    const refreshed=boardWith();
    refreshed.tasks[0].git.checkedAt=refreshed.tasks[0].git.pullRequests.checkedAt=new Date(h.context.expiredNow).toISOString();
    h.api.applyNativeBoard(refreshed,{skipUnchanged:true});
    assert.equal(branchText(),'codex/pr-attention');
    assert.equal(root.querySelectorAll('.pr-badge')[0].textContent,'#7 · Open');
    assert.deepEqual(labels(root),['CI failed','Changes requested']);
  }
});

test('timestamp-only recovery clears all Cached labels without replacing cards or focus',()=>{
  for(const view of ['board','list'])for(const count of [1,2])
    for(const checkedAt of [undefined,null,'invalid',new Date(Date.now()+60000).toISOString(),new Date(Date.now()-120000).toISOString()]){
      const board=boardWith(count===1?[pr(7)]:[pr(7),pr(8)]);
      board.tasks[0].git.checkedAt=board.tasks[0].git.pullRequests.checkedAt=checkedAt;
      const h=harness(board);h.api.setView(view);h.api.applyNativeBoard(board);
      const root=h.nodes.get('board'),card=root.querySelectorAll('.card')[0],branch=card.querySelector('.git-branch');
      const badges=card.querySelectorAll('.pr-badge');badges[0].focus();
      assert.match(branch.children[1].textContent,/Cached/);assert(badges.every(b=>b.textContent.includes('Cached')));
      const fresh=structuredClone(board);
      fresh.tasks[0].git.checkedAt=fresh.tasks[0].git.pullRequests.checkedAt=new Date().toISOString();
      h.api.applyNativeBoard(fresh,{skipUnchanged:true});
      assert.equal(root.querySelectorAll('.card')[0],card);assert.equal(card.querySelector('.git-branch'),branch);
      assert.equal(branch.children[1].textContent,'codex/pr-attention');
      assert(badges.every(b=>!b.textContent.includes('Cached')));assert.deepEqual(card.querySelectorAll('.pr-badge'),badges);
      assert.equal(h.context.document.activeElement,badges[0]);
    }
});

test('fresh unchanged PR reads clear Cached without replacing cards or focus',()=>{
  const board=boardWith(),h=harness(board);h.api.applyNativeBoard(board);
  const root=h.nodes.get('board'),card=root.querySelectorAll('.card')[0],badge=alerts(card)[0];
  badge.focus();h.nodes.get('creation').open=true;
  h.context.expiredNow=Date.now()+100000;new Script('Date.now=()=>expiredNow').runInContext(h.context);
  for(const tick of h.intervals)tick();
  assert.deepEqual(labels(card),['CI failed · Cached','Changes requested · Cached']);
  const fresh=boardWith();fresh.tasks[0].git.checkedAt=fresh.tasks[0].git.pullRequests.checkedAt=new Date(h.context.expiredNow).toISOString();
  h.api.applyNativeBoard(fresh,{skipUnchanged:true});
  assert.equal(root.querySelectorAll('.card')[0],card);assert.equal(h.context.document.activeElement,badge);
  assert.deepEqual(labels(card),['CI failed','Changes requested']);assert.equal(badge.title,'PR #7 · CI failed');
});

test('CI failure and requested changes are both visible and link to their PR in Board and List',()=>{
  const board=boardWith(),h=harness(board);
  for(const view of ['board','list']){
    h.api.setView(view);
    assert.deepEqual(labels(h.nodes.get('board')),['CI failed','Changes requested']);
    for(const badge of alerts(h.nodes.get('board'))){
      assert.equal(badge.tag,'a');assert.equal(badge.href,board.tasks[0].git.pullRequests.items[0].url);
      assert.equal(badge.target,'_blank');assert.equal(badge.rel,'noopener noreferrer');
      assert.match(badge.title,/PR #7/);
    }
  }
});

test('only actionable open PR states show review notices; draft CI failures remain visible',()=>{
  for(const state of ['OPEN','DRAFT','MERGED','CLOSED']){
    const h=harness(boardWith([pr(7,{state,review:'REVIEW_REQUIRED'})]));
    assert.deepEqual(labels(h.nodes.get('board')),state==='OPEN'?['CI failed','Review required']:state==='DRAFT'?['CI failed']:[]);
  }
  for(const checks of ['passed','pending','none','unknown'])for(const review of ['APPROVED','NONE','unknown']){
    const h=harness(boardWith([pr(7,{checks,review})]));
    assert.equal(alerts(h.nodes.get('board')).length,0);
    assert.equal(h.nodes.get('board').querySelectorAll('.pr-attention').length,0);
  }
});

test('multiple matching PR notices identify each PR and exclude closed historical failures',()=>{
  const h=harness(boardWith([pr(7),pr(8,{checks:'passed',review:'REVIEW_REQUIRED'}),pr(9,{state:'MERGED'})]));
  const root=h.nodes.get('board');
  assert.deepEqual(labels(root),['#7 · CI failed','#7 · Changes requested','#8 · Review required']);
  assert.equal(root.querySelectorAll('.pr-badge')[0].textContent,'3 PRs');
  assert.equal(alerts(root)[2].href,'https://github.com/example/board/pull/8');
});

test('unavailable, detached, remote and invalid PR data cannot produce attention notices',()=>{
  for(const change of [t=>t.git.pullRequests.status='unavailable',t=>t.git.branch=null,t=>t.hostId='durable',
    t=>t.git.status='unavailable',t=>t.git.pullRequests.items[0].url='https://example.com/pull/7']){
    const board=boardWith();change(board.tasks[0]);
    assert.equal(alerts(harness(board).nodes.get('board')).length,0);
  }
});

test('old or invalid Git and PR reads visibly qualify attention notices as cached',()=>{
  for(const field of ['git','pullRequests'])for(const time of [new Date(Date.now()-100000).toISOString(),'invalid',new Date(Date.now()+100000).toISOString()]){
    const board=boardWith();(field==='git'?board.tasks[0].git:board.tasks[0].git.pullRequests).checkedAt=time;
    assert.deepEqual(labels(harness(board).nodes.get('board')),['CI failed · Cached','Changes requested · Cached']);
  }
});

test('PR alerts gain Cached in place during interactions and disappear when fresh data resolves them',()=>{
  for(const paused of ['taskMenu','creation','taskDrag','groupDrag']){
    const h=harness(boardWith()),root=h.nodes.get('board'),card=root.querySelectorAll('.card')[0],before=alerts(card);
    if(paused==='creation')h.nodes.get('creation').open=true;
    if(paused==='taskMenu')card.querySelectorAll('.card-details')[0].onclick({stopPropagation(){}});
    if(paused==='taskDrag')new Script("draggedKey='fixture'").runInContext(h.context);
    if(paused==='groupDrag')new Script("draggedGroup='review'").runInContext(h.context);
    h.context.expiredNow=Date.now()+100000;
    new Script('Date.now=()=>expiredNow').runInContext(h.context);
    for(const tick of h.intervals)tick();
    assert.equal(root.querySelectorAll('.card')[0],card);
    assert.equal(alerts(card)[0],before[0]);
    assert.deepEqual(labels(card),['CI failed · Cached','Changes requested · Cached']);
    for(const tick of h.intervals)tick();
    assert.deepEqual(labels(card),['CI failed · Cached','Changes requested · Cached']);
    assert.match(alerts(card)[0].title,/CI failed · Cached$/);
    if(paused==='taskMenu')assert.equal(h.nodes.get('task-menu').hidden,false);
    if(paused==='creation')assert(h.nodes.get('creation').open);
    const resolved=boardWith([pr(7,{checks:'passed',review:'APPROVED'})]);
    h.api.applyNativeBoard(resolved);
    assert.equal(alerts(root).length,0);
  }
});
