# Integrated Sidebar Flow runtime

This directory contains the current event-driven Desktop classification engine
adapted from [Codex Sidebar Flow](https://github.com/shichang4fun/codex-sidebar-flow),
version 0.4.2, source commit `e5a466fccf866570e4bc92eb9bcb10e7cf09ea94`.
The source runtime modules were clean when migrated. Their MIT license is
preserved in [LICENSE](LICENSE).

Kanban owns the native subprocess, transport, installation and configuration.
Only the observer, native Desktop adapter, validated policy and bounded
reconciliation timer are retained. There is no standalone proxy entrypoint,
WebSocket client, Hook, model heartbeat, instruction injection, legacy installer
or diagnostic log writer in this package.

Classification reads current task identity, status and placement before moving
and verifies the resulting placement. Classification writes use the native Desktop
`move_thread_to_sidebar_section` tool. It never starts or resumes a task or model
turn. The optional `runExclusive` manager callback shares the whole guarded
read/write/readback transaction with manual Kanban mutations.

Kanban's bootstrap waits for a loaded local root chat and creates only missing
In Progress, For Review and For Later groups using `create_sidebar_section`.
Unique existing groups are reused; duplicate names stop initialization before
writes. A private durable journal prevents replay of an unconfirmed create,
including after restart. Readback resolves committed creates with lost replies;
if the group remains absent, create it manually before enabling again. Explicit
migrated Desktop/local UUID mappings must remain valid and are never replaced.
Auto organize displays waiting, initialization and actionable error messages.

The regular policy protects pinned tasks, custom groups, remote tasks and
projects outside the ordinary Projects section. A fresh active Desktop snapshot
can release For Later tasks into In Progress. The optional explicit
`forceStatusSections` policy retains its existing behavior: it classifies ordinary
local root tasks across custom groups, protects Pinned, and only releases For
Later after a native turn start strictly later than `sectionEnteredAt`. Missing
timestamps or ambiguous mappings fail closed.

The tests under `tests/` cover the retained runtime only and are loaded by the
repository's `flow-engine.test.mjs`. They are excluded from plugin distribution.
