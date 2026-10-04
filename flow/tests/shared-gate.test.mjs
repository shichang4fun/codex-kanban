import test from 'node:test';
import assert from 'node:assert/strict';
import { createDesktopObserverManager } from '../desktop-observer-manager.mjs';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function fixture() {
  let config = { version: 1, mode: 'all-local' };
  let section = 'chats';
  const task = { id: 'task', kind: 'codex', hostId: 'local', projectId: null,
    status: { type: 'active', activeFlags: [] } };
  const calls = [], moves = [];
  const held = deferred(), queued = deferred();
  let exclusiveQueue = held.promise;
  const manager = createDesktopObserverManager({ async request(method, params) {
    assert.equal(method, 'mcpServer/tool/call');
    calls.push(params.tool);
    let result;
    if (params.tool === 'list_threads') result = {
      threads: section === 'pinned' ? [] : [task], pinnedThreads: section === 'pinned' ? [task] : [],
      sections: [['chats', 'Tasks'], ['progress', 'In Progress'], ['review', 'For Review'],
        ['later', 'For Later'], ['pinned', 'Pinned']].map(([sectionId, name]) => ({
        sectionId, name, itemKeys: sectionId === section ? ['codex:thread:local:task'] : [],
      })),
    };
    else if (params.tool === 'read_thread') result = { thread: task };
    else if (params.tool === 'move_thread_to_sidebar_section') {
      section = params.arguments.sectionId;
      moves.push(section);
      result = params.arguments;
    } else assert.fail(params.tool);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  } }, {
    readConfig: () => config,
    runExclusive(operation) {
      queued.resolve();
      const result = exclusiveQueue.then(operation);
      exclusiveQueue = result.catch(() => {});
      return result;
    },
  });
  const event = (method, status = 'inProgress') => ({ method,
    params: { threadId: task.id, turn: { id: 'turn-one', status } },
  });
  return { manager, calls, moves, task, event, queued: queued.promise,
    release: () => held.resolve(), disable: () => { config = { version: 1, mode: 'disabled' }; },
    pin: () => { section = 'pinned'; },
  };
}

test('automatic transaction reloads disabled policy after acquiring the shared manual gate', async t => {
  const f = fixture(); t.after(() => f.manager.stop());
  const pending = f.manager.handle(f.event('turn/started'));
  await f.queued;
  assert.deepEqual(f.calls, []);
  f.disable(); f.release();
  assert.equal((await pending).action, 'skipped');
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.moves, []);
});

test('manual pin finishing before an automatic transaction protects the fresh placement', async t => {
  const f = fixture(); t.after(() => f.manager.stop());
  const pending = f.manager.handle(f.event('turn/started'));
  await f.queued;
  f.pin(); f.release();
  await assert.rejects(pending, /Protected pinned task/);
  assert.deepEqual(f.moves, []);
});

test('completion while waiting for the shared gate supersedes stale starts without stale reads', async t => {
  const f = fixture(); t.after(() => f.manager.stop());
  const started = f.manager.handle(f.event('turn/started'));
  await f.queued;
  f.task.status = { type: 'idle' };
  const completed = f.manager.handle(f.event('turn/completed', 'completed'));
  f.release();
  const [obsolete, latest] = await Promise.all([started, completed]);
  assert.equal(obsolete.reason, 'superseded');
  assert.equal(latest.action, 'moved');
  assert.deepEqual(f.moves, ['review']);
  assert.equal(f.calls.filter(tool => tool === 'move_thread_to_sidebar_section').length, 1);
});
