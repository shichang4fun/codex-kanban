# Verification

## Rebase and independent pre-PR review — 2026-10-04

- Rebased onto origin/main at a7843ec, preserving its per-group Project view, host-qualified project grouping, preference namespace and project-aware manual ordering. Conflict resolution adapts Project view to the native-only grouping mode and retains the 48px collapsed Board column and filtered-empty behavior.
- All 116 automated tests passed. A full-script regression combines Project view with the simplified controls, safe PR cards, Board/List switching, keyboard focus restoration and global filtered empty states. Existing native action and retired-storage protection checks remain passing.
- An independent read-only agent reviewed the final diff and reran npm test and git diff --check. It found one List Grid issue: Git metadata pushed the footer onto a third row. An explicit footer grid-row:1 fixes it; live measurements confirm heading/footer share the same vertical center and Git remains on the second row. No unresolved actionable findings remained.
- In-app browser verified Project view in Board/List, 48px folded-group layout, action menu access inside project groups and the List fix at port 8896. Temporary view preferences were restored; no browser warnings/errors or native task writes occurred. Screenshot: ui-rebased-review-preview.png (local ignored artifact).
- Remaining data boundaries: Project uses a Desktop snapshot; PR matching follows the current working directory and named branch, excludes detached HEAD/fork inference, and marks old visible results Cached. Generated UI, task snapshots, local screenshots and connection data are excluded from Git.

## Project metadata refresh — 2026-10-04

- Live Desktop list_threads/list_projects confirmed the current UI task belongs to codex-kanban. The previous Desktop snapshot predated the project and task; the separate local App Server reported a null projectId. Project labels intentionally use exact Desktop host/project IDs rather than inferring from a worktree directory name.
- Refreshed the timestamped Desktop snapshot and project catalog, then regenerated the standalone board. No UI rendering change or native task write was needed. Project metadata still uses the Desktop snapshot; ordinary board polling refreshes local tasks/groups.
- All 20 targeted local-board/UI tests passed. Port 8896 showed codex-kanban on both the task card and the Project detail field, independently of its native Group. Empty branch/PR information stayed hidden. No browser warnings/errors were observed. Screenshot: ui-project-refresh-preview.png (local ignored artifact).

## Hide absent branch and PR information — 2026-10-04

- All 110 automated tests passed. Board/List regressions confirm branch-only cards omit missing/loading/unavailable/unsupported PR placeholders; detached tasks omit the entire Git row and empty detail section while keeping commits and lookup diagnostics in collapsed Technical information. Existing actual PR links, multiple matches and stale-result labels remain covered.
- The in-app browser at port 8896 showed zero Git rows for the current detached worktrees and no Detached/PR-not-linked placeholders on cards. The current task's details hid the empty branch/PR area; expanded technical information retained its commit, repository and lookup reason. Board and List both passed; Board and collapsed technical information were restored. No browser warnings/errors or native task writes occurred.
- Regenerated the standalone preview. Screenshot: `ui-pr-visibility-preview.png` (local ignored artifact).

## New worktree PR association fix — 2026-10-04

- All 109 automated tests passed. Regressions reproduce detached worktrees starting at PR head/merge commits, reuse of a historical branch name, switching from a PR branch to detached HEAD, and suppression of inherited PR badges/search matches from old static data.
- Detached HEAD no longer queries GitHub by commit. Named branches match same-repository PR head branches; merged/closed results also require the current HEAD to equal the PR head SHA. HEAD changes invalidate the associated cache key.
- Live readback confirmed this worktree (`e3e8`) starts at `3d63c5f`, the merge commit of PR #1. The prior integration treated this historical base as a task PR association; that rule is superseded. The in-app browser at port 8896 now shows Detached and PR not linked, with no Merged badge or CI/review for that historical PR. Expanded technical information confirmed the actual task working directory, then was folded again. No browser warnings/errors or native task writes occurred.
- Updated the standalone page and preview server. Screenshot: `ui-pr-association-fix-preview.png` (local ignored artifact).

## Integrated branch and PR display — 2026-10-04

- All 106 automated tests passed. Coverage includes repository/branch and exact-commit matching, rejection of fork or malformed results, cache freshness and failures, shared-directory deduplication, and reserved local Git capacity while GitHub requests are slow. Full-script UI regressions cover safe PR links, search, multiple matches, cached labels, remote-task exclusion, and the existing task-action disclosure.
- In-app browser verified port 8896 with live data: the referenced PR-display task showed detached commit `3d63c5f`, PR #1 Merged, CI Passed, and no review decision. Expanded technical information confirmed repository, working directory, and exact head-or-merge-commit matching; it was folded again after checking. These are current-directory matches, not explicit task attachments.
- Repository and PR-number searches, Board/List rendering, and the 666px CSS viewport passed. Branch and PR badges fit within the cards and the task menu stayed in the viewport. The viewport override was reset; no browser warnings or errors were observed. No existing user task was moved, pinned, or archived.
- Preview screenshots: `ui-integrated-pr-board-preview.png` and `ui-integrated-pr-details-preview.png` (local ignored artifacts).

## Card action redesign — 2026-10-04

- All 91 automated tests passed. The new full-script regression checks single-menu exclusivity, outside/Escape dismissal, focus restoration, protected remote actions, exact Pin/Archive callback routing with mocks, and correct detail navigation.
- Cards now have one persistent action disclosure instead of separate footer action icons. The native details/summary control exposes labeled operations, retains full title width, and requires no dependency. Native mutation guards and endpoints are unchanged; no user task was pinned or archived for verification.
- In-app browser verified Board/List opening, Pin versus Unpin labels, Tab navigation, Escape focus restoration, outside-click closure, and correct detail selection. A reproduced clipped List first-row menu now opens downward and stays within the board. At CSS viewport width 666px, both menu and trigger remained within the visible board; the temporary viewport override was reset. No browser warnings or errors were observed.

## UI layout optimization — 2026-10-04

- All 90 automated tests passed; existing native-action eligibility, serialization, membership verification, ordering and runtime guards remain covered. No existing user task was modified for testing.
- In-app browser measured a 176px desktop sidebar (previously 216px) and 199px title width in a 225px card (previously 139px). Pin/Archive retain 28px targets in the footer, appear on keyboard focus, and do not overlap title or timestamp. The moved details control opened the correct task.
- Board collapsed groups measure 48px, retain names/counts and keyboard expansion, and keep the existing header/section drag handlers. List collapsed groups retain full-row width. Actual native dragging was not exercised against user tasks in this pass.
- Responsive checks covered CSS viewport widths 800px and 666px: the mobile sidebar remains 58px, card controls and timestamp fit, filters stay within the main pane, and List retains deliberate horizontal scrolling. The viewport override and temporary collapsed states were restored. No browser warnings or errors were observed.

## UI review fixes — 2026-10-04

- All 90 automated tests passed. Four new regressions cover specific Group disabled reasons without widening write eligibility, visible stale-detail feedback and recovery, filtered versus unfiltered empty states in Board/List, and host-option synchronization with selection preservation and fallback.
- In-app browser verified the connected preview at port 8896: the Tools project inheritance explanation, partial-search empty-group messages, a single zero-result state in Board and List, and preservation of Cloud selection after refresh. No browser warnings or errors were observed.
- Task absence and host addition/removal were verified with isolated browser-script fixtures. Absence does not imply deletion or archive; details retain their Open chat link and disable group editing until the task returns. Native task writes were not performed for this verification.

## UI simplification — 2026-10-04

- Independent agent reviewed the proposed scope and completed implementation; no blockers or reproducible findings remained.
- All 86 automated tests passed. Full browser-script regression coverage verifies startup against the current template, search/filter/layout changes, preserved retired storage, direct-link eligibility, clipboard failure fallback, and connection/read-only/unavailable-host warnings.
- Existing native move, pin/archive/Undo, ordering, refresh-animation and runtime-expiration tests remain passing. Native mutation tests use mocks or isolated fixtures; no existing user tasks were moved, pinned or archived for this change.
- In-app browser verified the connected worktree preview at port 8896: search result counts, Cloud host filtering, Board/List switching, editable local and protected cloud Group selectors, collapsed technical details, conditional copy controls, and in-place manual refresh. No browser warnings or errors were observed.
- The original port 8876 service remains separate. Saved native ordering keys retain their original names; the worktree preview uses a separate origin and therefore its own browser layout preferences.

## Archive bridge verification — 0.4.22

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

## Project-inherited task grouping

- 91 automated checks pass, including inherited Pinned task eligibility in dragging and details, task-only writes, stale-source rejection, preserved project association, and restoration of project placement when the task's own section is cleared.
- The disposable-home integration lab used the real official App Server to move an inherited task into For Review and clear its section back to inherited Pinned placement. Parent-project metadata was a simulated Desktop snapshot and remained unchanged. The lab started no model turns and touched no existing user tasks.
- The lab reuses an existing native Pinned section rather than creating a duplicate name, so inherited group matching stays unambiguous.
- The updated production page enables the Native group selector for 🎯 滴答清单 in Tools, with Pinned selected and an explanation that its project stays in place. Existing task data was only read for page verification; immediate native Desktop sidebar refresh remains unverified.

## Desktop-owned group and pin actions — 0.4.29

- An independent agent reviewed the technical plan before implementation and the resulting code afterward. It identified one destination-catalog race during Desktop lookup; the adapter now revalidates the original native destination ID/name before the final task/source/project check. Zero-write regressions cover destination rename, replacement and duplication. The reviewer independently passed all 102 checks and reported no remaining blockers.
- Dragging, details and Pin/Unpin require the new Desktop group-action capability. Missing, old or disconnected bridges disable those writes; HTTP refuses them and never silently falls back. Archive/Undo retain their recorded transport and local manual ordering remains available.
- The existing native move/pin controllers now run against a read-only adapter. The one mutation uses Desktop move_thread_to_sidebar_section, mapped by unique names into the Desktop ID namespace. Pinned uses reserved pinned; clearing sends null. Native readback verifies exact section and canonical projectId. Pending socket actions share serialization with Archive/Undo.
- The real official App Server lab passed in a disposable CODEX_HOME with a real project/create and thread/start(projectId). Desktop group moves, Pin/Unpin, inherited project placement restoration, later native classification and Archive/Undo passed; native project association remained unchanged and no model turns started. Desktop MCP dispatch and project-container placement were simulated, so this does not certify client tool authorization or visible sidebar refresh.
- Real in-app browser gestures against a disposable in-memory fixture passed inherited Pinned → For Review in Board and For Review → In Progress in List with Manual order. Pin/Unpin and detail selection to For Later also passed, retaining the project label. No existing user task was changed for testing.
- The installed private runtime is updated while preserving the original Sidebar Flow chain. A normal next launch with the Kanban launcher is required to activate it; live Desktop tool acceptance and visible sidebar refresh remain pending that activation and user observation.
- The source checkout passed 102 checks; the production copy, which retains its existing UI without the separately developed project-view feature, passed all 97 applicable checks. Both open production tabs were refreshed after confirming they had no pending Undo notices. The page shows the launcher requirement, disables the group selector, and removes Pin buttons while desktopGroupsConnected is false; native reads still succeed.
## Owning-connection runtime polling

Verified on 2026-10-04 with the bundled Codex CLI 0.160.0.

- 97 automated checks pass. Card regressions cover an idle Pinned task moved to In Progress, live execution in any group, Board/List rendering, snapshot qualification, waits, unread recovery and expiration. Runtime tests cover bounded reads, exact IDs, malformed/protected replies, cancellation, local/remote isolation and HTTP running → waiting → idle → disconnected transitions.
- Fresh Desktop-owned observations renew local runtime every five seconds. Long-running observations remain valid while renewed, and cached execution expires after polling stops for more than 15 seconds. No grouping or model-execution RPC is exposed by the runtime reader.
- The isolated real App Server lab read a disposable task's actual idle status through its owning connection via the production bridge and HTTP endpoint. This runtime path uses the native thread/read RPC; the lab's separate Archive/Undo MCP dispatcher remains simulated. No model turns or existing user-task writes were used.
- Updated bridge files were installed in the existing private installation, read back against source and imported successfully. Connection settings and the existing Sidebar Flow CLI chain were preserved. Shell syntax and CLI passthrough checks pass.
- The updated in-app browser page at port 8889 shows 55 tasks, native group polling and a working Refresh button. With the current Desktop bridge disconnected, it shows no fabricated running icons. A screenshot is saved locally in outputs/runtime-board.jpg and excluded from Git.
- Activation is still pending a normal Desktop exit and launch through Launch Codex with Kanban.command, followed by opening a local task. The current Desktop process was not restarted or stopped; actual active-turn display through the live client remains unverified.

## Combined session integration — 2026-10-04

- Integrated dashboard commits 90ebc4e and 443f69f plus the uncommitted runtime fixes from the Pin-icon worktree onto main 89cbb53. Both source worktrees were preserved. The current simplified task menu, folded technical details, Git/PR display and per-group Project view remain intact.
- All 143 automated tests pass. Shared full-script UI fixtures cover native group capability, verified project-inherited task editing, Board/List/Project view runtime rendering, static snapshot indicators, expiration and unread recovery. HTTP tests confirm group/pin and runtime capabilities coexist and disable appropriately after disconnection. The installer imports the combined bridge with all dependencies present.
- The disposable CODEX_HOME integration lab passed against the real official App Server: native group moves, Desktop pin/unpin routing, inherited project placement restoration, canonical project association, later automatic placement, owning-connection runtime reads and Archive/Undo. Desktop MCP dispatch and project-container placement were simulated; no model turns or existing user-task writes occurred.
- The existing private bridge installation now contains the combined source. Readback and module imports passed; connection settings, runtime paths and the Sidebar Flow CLI chain were preserved. No Desktop process was stopped or restarted.
- The regenerated preview at http://127.0.0.1:8896 displays 55 tasks. In-app browser checks passed for Board/List switching, Project view toggling, action menus, folded details, exact project labels, current branch display and in-place refresh. No fabricated running rings or browser errors appeared while the actual bridge was disconnected. A local screenshot is excluded from Git at outputs/session-integration-preview.png.
- Genuine Desktop tool authorization, immediate native sidebar updates and an active-turn indicator on the live client remain unverified until a normal launch through the updated Kanban launcher and opening a local task. Connected protocol fixtures do not certify these client behaviors.

## Live activation and independent integration review — 2026-10-04

- After the user installed and restarted through the launcher, the real Desktop bridge reported connected, groupActions and runtimeAvailable. The live HTTP board reported Desktop group/pin/archive capabilities and the current task's active status from desktopRuntime. Repeated page polls renewed the observation; native group placement was not used to infer execution.
- In-app browser verification confirmed the current task's Running indicator, no running indicators on idle Pinned tasks, an enabled Group selector, enabled Pin/Archive menu entries, and the codex-kanban Project label. No existing user task was moved, pinned or archived for this acceptance check.
- An independent agent reviewed the combined diff, including group ID mapping, destination/source/project race checks, single-write readback, serialized mutations, runtime identity filtering and expiration, relay restrictions and installer dependencies. No unresolved actionable findings remained.
- All 143 automated tests pass. The real App Server integration lab passes with simulated Desktop MCP dispatch, covering moves, Pin/Unpin, project inheritance and preservation, runtime reads, Archive/Undo and zero model turns. Live Desktop MCP mutation acceptance and immediate native sidebar updates remain outside this verified scope.
- A concurrent test run exposed the lab's hard-coded HTTP port collision. The lab and runtime HTTP test now bind an automatically allocated port. Only port-zero servers derive their allowed localhost origin from the actual listening socket; regressions reject forged Host headers, external Origin headers and the unused port-zero origin. Production configured-port checks are unchanged.
