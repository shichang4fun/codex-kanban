import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export function classify(status) {
  const type = typeof status === 'string' ? status : status?.type;
  const flags = typeof status === 'object' ? status?.activeFlags ?? [] : [];
  if (type === 'systemError' || type === 'error') return 'error';
  if (type === 'active') return flags.some(flag => /waiting/i.test(flag)) ? 'attention' : 'running';
  if (type === 'idle') return 'idle';
  if (type === 'notLoaded') return 'unloaded';
  return 'unknown';
}

export function normalize(snapshot) {
  const projectNames=new Map((snapshot.projects??[])
    .filter(p=>typeof p.projectId==='string'&&typeof p.hostId==='string'&&typeof p.label==='string'&&p.label.trim())
    .map(p=>[`${p.hostId}:${p.projectId}`,p.label]));
  const sections = (snapshot.sections ?? []).map(section => ({
    sectionId: section.sectionId, name: section.name,
    itemKeys: (section.itemKeys ?? []).filter(key => typeof key === 'string')
  }));
  const byId = new Map();
  for (const task of [...snapshot.pinnedThreads ?? [], ...snapshot.threads ?? []]) {
    if (task.kind !== 'codex') continue;
    const key = `${task.hostId ?? 'unknown'}:${task.id}`;
    const previous = byId.get(key);
    byId.set(key, { ...previous, ...task, pinnedIndex: task.pinnedIndex ?? previous?.pinnedIndex });
  }
  function membership(task) {
    const exactKey = `codex:thread:${task.hostId ?? 'unknown'}:${task.id}`;
    const direct = sections.filter(section => section.itemKeys.includes(exactKey));
    const result = (matches, source) => ({
      nativeMembershipCount: matches.length,
      nativeSectionId: matches.length === 1 ? matches[0].sectionId : null,
      nativeMembershipSource: source
    });
    if (direct.length) return result(direct, 'task');
    if (task.pinnedIndex) return result(sections.filter(section => section.sectionId === 'pinned'), 'pinned');
    const aliases = (snapshot.sidebarAliases ?? []).filter(alias => alias.threadId === task.id && alias.hostId === task.hostId
      && typeof alias.memberKey === 'string' && alias.memberKey.startsWith('codex:thread:') && alias.memberKey.endsWith(`:${task.id}`)
      && !alias.memberKey.includes(':client-new-thread:'));
    if (aliases.length === 1) {
      const matches = sections.filter(section => section.itemKeys.includes(aliases[0].memberKey));
      if (matches.length) return result(matches, 'verifiedAlias');
    }
    if (task.projectId && task.hostId === 'local') {
      const matches = sections.filter(section => section.itemKeys.includes(`codex:project:${task.projectId}`));
      if (matches.length) return result(matches, 'project');
    }
    return result([], 'unconfirmed');
  }
  const allTasks = [...byId.values()].map(task => ({
    id: task.id, title: task.title ?? 'Untitled task', summary: task.summary ?? '',
    hostId: task.hostId ?? 'unknown', cwd: task.cwd ?? '', projectId: task.projectId,
    projectName: projectNames.get(`${task.hostId}:${task.projectId}`)??null,
    git: task.hostId==='local'?task.git??null:null,
    updatedAt: task.updatedAt, isUnread: task.isUnread === true,
    unreadSource: task.unreadSource??'desktopSnapshot',unreadCapturedAt: task.unreadCapturedAt??snapshot.capturedAt??null,
    pinned: Boolean(task.pinnedIndex), sidebarOnly: task.sidebarOnly === true, placementSource: task.placementSource ?? null,
    nativeTaskPinned:typeof task.nativeTaskPinned==='boolean'?task.nativeTaskPinned:Boolean(task.pinnedIndex),
    localSectionId:task.localSectionId??null,
    rawStatus: task.status, column: classify(task.status),
    runtimeStatusSource: task.runtimeStatusSource ?? 'desktopSnapshot', runtimeStatusStale: task.runtimeStatusStale === true,
    lastObservedStatus: task.lastObservedStatus, lastObservedAt: task.lastObservedAt,
    ...membership(task)
  })).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  const tasks = allTasks.filter(task => !task.sidebarOnly);
  return { capturedAt: snapshot.capturedAt ?? null, source: 'Codex desktop task tools',
    runtimeCapturedAt: snapshot.capturedAt ?? null, runtimeSnapshotMaxAgeMs: 15000,
    sync: {runtimeLive: false},
    coverage: snapshot.sidebarCoverage ?? 'Latest 50 unpinned chats + all pinned chats; Codex tasks only',
    unavailableHosts: snapshot.unavailableHosts ?? [], sections, tasks,
    sidebarUnresolved: allTasks.filter(task => task.sidebarOnly) };
}

export async function writeBoard(board,output) {
  const template = await readFile(new URL('./ui.html', import.meta.url), 'utf8');
  const payload = JSON.stringify(board).replaceAll('<', '\\u003c');
  await writeFile(output, template.replace('/*__BOARD_DATA__*/null', payload));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const snapshot = JSON.parse(await readFile(process.argv[2] ?? 'snapshot.json', 'utf8'));
  await writeBoard(normalize(snapshot),process.argv[3] ?? 'index.html');
  console.log(`Generated ${process.argv[3] ?? 'index.html'} with ${normalize(snapshot).tasks.length} Codex tasks`);
}
