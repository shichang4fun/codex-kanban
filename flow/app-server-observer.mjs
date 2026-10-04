// Observe structured native lifecycle events; this module has no standalone CLI.
import { resolveConfiguredSections } from './sidebar-policy.mjs';

export function createObserver(rpc, { threadIds, apply = false, excludeThreadIds = [], allowProjectTasks = false,
  allowForLaterStart = false, forceStatus = false } = {}) {
  if (!Array.isArray(threadIds) || threadIds.length === 0 || threadIds.length > 10
      || threadIds.some(id => typeof id !== 'string' || !id || id.length > 128)
      || new Set(threadIds).size !== threadIds.length) throw Error('1-10 explicit unique thread IDs required');
  const allowed = new Set(threadIds.filter(id => !excludeThreadIds.includes(id)));
  const activeSeen = new Set();
  let queue = Promise.resolve();
  const names = { inProgress: 'In Progress', forReview: 'For Review', ...(!forceStatus ? { forLater: 'For Later' } : {}) };

  function eligible(thread, id, sections) {
    if (!thread || thread.id !== id || (thread.projectId !== null
        && (!allowProjectTasks || typeof thread.projectId !== 'string' || !thread.projectId)) || thread.parentThreadId != null
        || thread.archived === true || thread.ephemeral === true) return null;
    if (thread.section !== null && (typeof thread.section?.id !== 'string' || !thread.section.id)) return null;
    if (forceStatus) return true;
    // Desktop may release a directly deferred task only while it is running.
    // Idle/attention/unknown state stays protected, even with prior start evidence.
    const source = thread.section?.id ?? null;
    if (source === sections.forLater.sectionId) return allowForLaterStart
      && thread.status?.type === 'active' && Array.isArray(thread.status.activeFlags)
      && thread.status.activeFlags.length === 0;
    if (source !== null && ![sections.inProgress.sectionId, sections.forReview.sectionId].includes(source)) return null;
    return true;
  }
  function destination(thread, id, sections) {
    if (!eligible(thread, id, sections)) return null;
    const status = thread.status;
    if (status?.type === 'active') {
      if (!Array.isArray(status.activeFlags)
          || status.activeFlags.some(f => !['waitingOnApproval', 'waitingOnUserInput'].includes(f))) return null;
      return status.activeFlags.length ? sections.forReview.sectionId : sections.inProgress.sectionId;
    }
    if (['idle', 'systemError'].includes(status?.type)
        && (activeSeen.has(id) || thread.section?.id === sections.inProgress.sectionId
          || (forceStatus && thread.section?.id === sections.forReview.sectionId))) return sections.forReview.sectionId;
    return null;
  }

  async function reconcile(id, message = null, client = rpc) {
    if (!allowed.has(id)) return { action: 'skipped' };
    const result = await client.request('threadSection/list');
    const sections = forceStatus ? Object.fromEntries(Object.entries(names).map(([key, name]) => {
      const matches = result.data?.filter(s => s.name === name);
      if (matches?.length !== 1 || typeof matches[0].id !== 'string' || !matches[0].id) throw Error('Ambiguous force-status destination');
      return [key, { sectionId: matches[0].id, name }];
    })) : resolveConfiguredSections(result.data?.map(s => ({ sectionId: s.id, name: s.name })), names);
    if (sections.inProgress.sectionId === sections.forReview.sectionId) throw Error('Distinct destinations required');
    const read = async () => (await client.request('thread/read', { threadId: id, includeTurns: false })).thread;
    const thread = await read();
    // Only these messages from the connected server are activity evidence, never
    // user text. Preserve a short turn's start even if the current read is idle.
    const eventStatus = message?.method === 'thread/status/changed' ? message.params?.status
      : message?.method === 'thread/started' ? message.params?.thread?.status : null;
    // Opening history also emits idle snapshots. Only an actual terminal turn
    // notification can recover a missed start; a terminal snapshot cannot.
    const completedTurn = forceStatus && message?.method === 'turn/completed'
      && typeof message.params?.turn?.id === 'string' && message.params.turn.id.length > 0
      && message.params.turn.id.length <= 128
      && ['completed', 'interrupted', 'failed'].includes(message.params.turn.status);
    if (eligible(thread, id, sections) && (completedTurn || message?.method === 'turn/started' || (eventStatus?.type === 'active'
        && Array.isArray(eventStatus.activeFlags)
        && eventStatus.activeFlags.every(f => ['waitingOnApproval', 'waitingOnUserInput'].includes(f))))) activeSeen.add(id);
    const target = destination(thread, id, sections);
    if (!target) return { action: 'skipped' };
    if (thread.status.type === 'active') activeSeen.add(id);
    if (thread.section?.id === target) return { action: 'unchanged' };
    if (!apply) return { action: 'would-move', sectionId: target };
    const latest = await read();
    if (latest?.section?.id !== thread.section?.id || destination(latest, id, sections) !== target) {
      return { action: 'skipped' };
    }
    // API has no conditional move. This final read narrows, but cannot eliminate, the race.
    await client.request('thread/section/move', { threadId: id, sectionId: target });
    const after = await read();
    if (after?.section?.id !== target) throw Error('Server section readback mismatch');
    return { action: 'moved', sectionId: target, desktopVerified: false };
  }
  function runReconciliation(id, message) {
    return typeof rpc.withReconciliation === 'function'
      ? rpc.withReconciliation(client => reconcile(id, message, client))
      : reconcile(id, message);
  }
  return {
    handle(message) {
      if (!['thread/status/changed', 'thread/started', 'turn/started', 'turn/completed'].includes(message.method)) {
        return Promise.resolve({ action: 'skipped' });
      }
      const id = message.method === 'thread/started' ? message.params?.thread?.id : message.params?.threadId;
      const result = queue.then(() => runReconciliation(id, message));
      queue = result.catch(() => {});
      return result;
    },
    // Explicit snapshot path: never invent a lifecycle event or start evidence.
    reconcile(id) {
      const result = queue.then(() => runReconciliation(id));
      queue = result.catch(() => {});
      return result;
    },
    drain() { return queue; },
  };
}
