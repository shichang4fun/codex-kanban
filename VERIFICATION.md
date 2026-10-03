# Archive bridge verification — 0.4.22

Verified on 2026-10-04 with the bundled Codex CLI 0.160.0.

- 66 automated tests passed: archive/Undo, Desktop bridge transport and routing, installer, pinning, groups, unread state, ordering, refresh animation, and runtime expiration.
- The workflow VM regression passed.
- Generated official App Server schemas match the bridge's `mcpServer/tool/call` parameters and response parsing.
- Both installed shell launchers pass `sh -n`; the installed CLI chain returns the expected CLI version without launching Desktop.
- `desktop-native.integration.mjs` used a temporary CODEX_HOME and a real bundled App Server. It reproduced independent-writer rejection, then confirmed Archive and token-scoped Undo through a simulated Desktop MCP dispatcher using the original writer. No model turns were started; temporary data was removed.
- The installed launcher preserves the existing Sidebar Flow wrapper. Launcher tests verify that it does not stop a running Desktop process.

**Pending:** the live Codex Desktop client has not been restarted with the launcher. Genuine Desktop MCP authorization, archive of a Desktop-owned disposable task, Undo, and immediate sidebar updates remain unverified. A healthy socket or passing simulation does not certify these behaviors. Existing user tasks were not archived for testing.

To activate, quit Codex normally and open `~/.codex/kanban-desktop/Launch Codex with Kanban.command`, then open a local task. The running Kanban service checks connection readiness automatically. Test with a disposable task and verify both Archive and Undo in the actual Codex sidebar.

## Native flow-group dragging — 0.4.24

- 74 automated checks passed, including the workflow regression and seven new group-move tests.
- The isolated real App Server lab moved a task through For Later, In Progress and For Review via the production HTTP endpoint and the official local section RPC, while its original App Server still held the active writer. These group moves use the real native RPC, with no simulated MCP dispatcher in that path.
- A subsequent native group change appeared on the next poll without replaying the manual move. The experiment simulates a later classification with a native section write; it does not certify the live Sidebar Flow engine's lifecycle rules.
- Browser drag gestures passed in Board and List, including Manual order. The browser fixture uses a disposable in-memory native reader and the production move controller/API. No existing user task was moved for verification.
- Manual writes use local section IDs, check the expected direct source, verify the result, and do not change runtime status or project association. Pinned/project-inherited/other-host tasks and stale moves are protected. Sidebar Flow configuration is untouched.

## Task-detail group editing — 0.4.25

- 77 automated checks passed. New coverage verifies explicit edits from/to Pinned, null Tasks membership, stale-source rejection, selector eligibility, detail-property refresh, option stability across polling, and rollback after failed edits.
- The isolated real App Server lab verified Review → Pinned → Review → Pinned → Tasks through the production move endpoint, while the original reader held the active writer. No model turns or existing user-task writes were used. The archive portion of this lab still uses a simulated Desktop MCP dispatcher.
- In-app browser gestures against an in-memory native fixture verified Pinned → Review → Pinned → Tasks in Board and Tasks → In Progress in List. Detail properties, selection, pin state and card membership followed confirmed readback. Runtime view also exposes the same editor.
- Details allow Pinned, Tasks and the three flow groups; cross-group dragging retains its existing flow-destination and Pinned-source restrictions. Project-inherited placements and other hosts remain read-only. Later native classifications update both the board and open details without corrective writes.

## Pinned drag-and-drop — 0.4.26

- 77 automated checks passed. Pinned task drag eligibility is enabled while pending writes, inherited project placements and other protected sources remain blocked.
- Real in-app browser gestures with the disposable native fixture verified Review → Pinned → In Progress in Board with recent sorting, and In Progress → Pinned in List with Manual order. The production move endpoint/controller handled the writes; card placement, pin buttons and pinned counts followed confirmed readback. No existing user tasks were moved.
- Long vertical gestures initially failed to reach the drop target in browser automation. QA-only event tracing showed dragstart followed by source-header dragover events without a destination drop; an adjacent-group gesture reached the destination and passed. No drag timing workaround or diagnostic instrumentation is included in shipped files.
- Backend behavior is unchanged from 0.4.25. Moves remain single native writes with stale-source checks and verification; Sidebar Flow can classify afterward. Group-header ordering and within-group manual ordering remain separate.

## Unified default display group — 0.4.27

- 82 automated checks passed. Synthetic Tasks and Projects defaults share one Ungrouped display group without changing native membership or project association; real custom groups with those names remain separate.
- Regression coverage verifies the earliest legacy column position and combined manual task ordering, including subsequent reordering and independence from other grouping modes.
- The production in-app browser showed 31 Ungrouped tasks and 55 total tasks in both Board and List. The project task retained its project label; its details showed Ungrouped while its inherited native-group selector remained disabled.
- This release changes display behavior only. No existing user task was moved, no native writes were performed for verification, and Sidebar Flow configuration is unchanged.

## GitHub preparation and independent review — 0.4.28

- An independent read-only agent reviewed the intended source, native writes, localhost authorization, archive/Undo, lifecycle behavior and clean-clone setup. It identified two P2 defects: stale Pin/Unpin membership during group listing, and missing runtime snapshot metadata in standalone builds.
- Pin/Unpin now revalidates the exact protected task and source membership immediately before writing. A regression simulates Sidebar Flow moving a task during group lookup and confirms no write occurs.
- Standalone builds now preserve the runtime observation timestamp, snapshot source and expiration policy. A regression invokes the real build CLI and checks the generated board with the actual browser helpers: fresh observations are qualified as snapshots and day-old execution becomes unknown while history remains available.
- 84 automated checks pass. The clean source checkout builds an empty-snapshot page without dependencies; generated files, personal task data, screenshots and machine connection settings are excluded from Git. Node 22/macOS CI runs the same test suite.
- The independent reviewer reran all 84 checks, verified both fixes and reported no remaining PR blockers.
- This review does not certify genuine Desktop tool acceptance or immediate sidebar refresh. No existing user task, running Codex process or Sidebar Flow configuration was changed during review.
