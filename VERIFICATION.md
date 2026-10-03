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
## MCP sidebar plugin — 0.4.29

- 104 automated checks pass after a clean `npm ci` and plugin build. Coverage includes strict app-only schemas, action tokens, pre-dispatch cancellation in native helpers, the write lock through readback, recoverable Undo after dropped responses, SDK initialization and teardown, missing snapshots, self-contained installation and stdin EOF cleanup.
- An independent agent reviewed the design and final implementation, reran all 104 checks, and independently passed the official plugin-discovery acceptance test. No remaining development blockers were reported.
- `test:plugin-native` installs through the actual official CLI in a disposable CODEX_HOME and verifies all six tools and global sidebar metadata through `mcpServerStatus/list`. It starts no model turn and removes its isolated context afterward. The test caught portable-manifest restrictions on absolute commands and cwd `.`; installation now uses a plugin-contained executable launcher and cwd `./`.
- The local plugin was installed and enabled through the official CLI. Its cache has no node_modules dependency; a read-only MCP client successfully loaded the UI and real local task board. Personal runtime/project metadata stays in the private user data directory, separate from plugin/source files.
- The in-app browser exercised a real MCP Apps SDK iframe against synthetic tasks: entry opening and handshake, Pin, Pinned to For Review detail editing, Archive, Refresh retaining Undo, restoration to For Review, and List view. No existing user task was changed.
- Genuine native sidebar clicking and custom-protocol chat opening remain unverified. Computer Use explicitly refused control of `com.openai.codex`; browser fixture and real App Server discovery do not substitute for native client UI acceptance. The optional Desktop archive bridge keeps its previously documented acceptance boundary.

## Opaque App surface — 0.4.30

- The user's native screenshot showed a light canvas behind dark cards and pale text. Inspection of the installed Codex sandbox styles confirmed `html > body { background: transparent !important; }`; the board previously painted its background only on body.
- The application shell now explicitly paints its existing dark background and text colors. Host styles and the transparent body policy remain intact; task behavior is unchanged.
- The browser fixture reproduces the host's transparent-body rule with a light canvas. Before the fix, both body and shell computed as transparent. Afterward, the canvas remains rgb(248,248,248), body remains transparent, and the shell paints rgb(25,26,30) with text rgb(238,239,243). The corrected interface was visually checked in the in-app browser.
- All 104 regression checks pass. The updated plugin was installed as 0.4.30; a running client must reload its MCP plugin or restart normally to use the new package. Native client UI automation retains the previously stated access limitation.

## Integrated sidebar plugin — 0.4.31

- PR #3 was merged at fde218a after its independent review and CI passed. Imported the sidebar session's uncommitted MCP implementation and opaque-surface fix using a three-way merge; its source worktree and user data were preserved. The current simplified menu, branch/PR matching, Project view, Desktop group guards and owning-connection runtime remain intact.
- HTTP and the six app-only MCP tools now use the same service implementation, including Desktop capability checks, serialization through post-write readback, expiring live runtime, Git/PR enrichment and service-owned Undo recovery. Plugin snapshots remain outside the immutable package. Source and self-contained packages include a plugin-relative executable launcher.
- All 160 automated tests pass, including MCP rejection of old/disconnected group bridges, no fallback writes, live runtime reads, lost-response Undo recovery, SDK initialization, cancellation, self-contained installation and Host/Origin guards. Navigation regressions verify host-mediated chat/PR links and the current UI's failure toast.
- The real App Server lab passes for group/pin/runtime and Archive/Undo with simulated Desktop MCP dispatch. The separate official plugin-discovery lab installs the package in disposable CODEX_HOME and verifies all six tools plus global sidebar metadata; neither starts a model turn.
- In-app browser acceptance against synthetic tasks passed opening the SDK iframe, Pin, Pinned-to-For Review details editing, Archive, refreshing without losing Undo, restoration and List view. The light-host/transparent-body fixture retains the board's opaque dark surface. A rejected chat link displays feedback without navigation or script errors. Screenshot: outputs/plugin-sidebar-validation.png (ignored local artifact).
- The official CLI installed and enabled version 0.4.31. A read-only MCP client launched the installed cache outside its directory and confirmed six tools, live Desktop connection, the real current task's Running status, codex-kanban Project and codex/sidebar-plugin branch. Existing user tasks were not moved, pinned or archived.
- A running Desktop must reload its MCP plugin or restart normally to load the new package. Native sidebar clicking, genuine Desktop MCP mutation acceptance and immediate sidebar updates still require live client acceptance; fixture tests and installed read verification do not certify them.

## PR #4 independent strict review — 2026-10-04

- An independent agent reviewed the complete integrated PR and reproduced two P2 issues: shutdown could dispatch a write still awaiting preflight, and a failed marketplace publication could leave the newly swapped package active. Both were fixed and independently reviewed again; no actionable findings remain.
- Service shutdown now aborts the service lifecycle signal, combined with any request signal and forwarded into native preflight. CLI shutdown closes the SDK transport before waiting for service cleanup. Writes already dispatched still complete their verification exactly once. Six new regressions cover board/native preflight shutdown, already-dispatched confirmation, real SDK app shutdown, failed updates with rollback, and failed initial publication.
- Plugin and marketplace manifest are staged before publication. The manifest is published by the final atomic rename; publication failures restore the previous plugin. The reviewer additionally reproduced EACCES with an existing ordinary manifest file and confirmed unchanged manifest content, launcher and old package marker with no stage/backup remnants. A real SDK cancellation after Desktop dispatch wrote once and recovered its confirmed Undo on the next read.
- A fresh directory created from Git archive plus the reviewed patch passed npm ci, plugin build and all 166 automated tests, with no failures or skips. The independent reviewer separately passed all 166 tests and git diff --check.
- The clean build passed both real official App Server labs: native group/pin/runtime and Archive/Undo in disposable CODEX_HOME, plus official plugin installation, discovery, all six tools and global sidebar metadata. Desktop MCP dispatch and project-container snapshots remain simulated; zero model turns were started.
- The existing localhost board was read without task mutations and had no captured browser warnings/errors. This verification did not change the active Desktop plugin cache or any existing user tasks. Genuine native sidebar clicking, Desktop write authorization and immediate visible sidebar updates retain their live-client acceptance boundary.

## Kanban plugin icon — 0.4.32

- Added a square transparent PNG with a purple three-column Kanban glyph. The portable manifest references the packaged asset through both extensions.com.openai.interface.logo and composerIcon. The build includes the asset, and Git ignores continue excluding personal screenshots while explicitly retaining this icon.
- All 166 tests pass, including installed-package checks for icon byte identity, PNG signature, square dimensions and official size limits. The official plugin-discovery lab also passes.
- Installed 0.4.32 through the official CLI, preserving the previous prepared package. Installed icon, manifest version and MCP/service files match source; a read-only client discovers six tools and loads the board with zero task writes. No Desktop restart was performed; native icon appearance awaits client plugin reload or a normal restart.

## Sidebar entry icon fix — 0.4.33

- The user reported that the native sidebar entry still lacked the icon. Read-only inspection of the installed client's entrypoint resolver confirmed it uses MCP tool icons with a serverInfo.icons fallback. Version 0.4.32 provided only plugin logo/composerIcon; those fields alone do not supply this sidebar icon.
- MCP initialization now supplies the packaged PNG as a data URI in serverInfo.icons. The current SDK preserves server icons, while its high-level registerTool configuration does not forward tool icons. The client's supported server-icon fallback avoids SDK internals and external image requests.
- All 166 tests pass. The real SDK initialization checks the exact icon bytes, and the official plugin-discovery lab verifies that the real App Server exposes serverInfo.icons with image/png and the embedded data URI.
- Updated the local official installation to 0.4.33. Existing older MCP processes were left running; the native client must reload the plugin or restart normally to receive the corrected metadata. This verifies metadata delivery, not an observed native-sidebar repaint.

## Sidebar icon contrast — 2026-10-04

- The user's light-sidebar screenshot confirmed the icon appeared but was too pale. Replaced the light-theme asset with a dark graphite glyph and retained the previous purple asset for dark themes. Plugin logo/composer metadata and MCP server icons now supply both theme variants.
- Existing SDK and packaging checks verify the selected theme and exact source bytes. The working tree passed all 170 tests and the official App Server discovery lab. Installed package readback confirms both PNG files and both MCP data URIs match source, with no task writes. Native repaint after the update remains unobserved; no Desktop restart was performed.

## UI optimization integration — 0.4.40

- Integrated the UI optimization session onto main f1e6429 in a separate managed worktree, preserving both source worktrees. Includes the compact header, unread inbox, Board/List controls, Options, System/Light/Dark themes, independent column scrolling, card shortcuts and keyboard-accessible Project/Section submenus. Native project selection and removal now share the HTTP/MCP service and write lock; the plugin packages all seven app-only tools.
- Independent review reproduced and resolved two issues: an old failed background read could close a newly opened menu, and a cleared native project could reappear from a stale Desktop snapshot. Only an explicitly unsupported project/list method permits legacy snapshot fallback; temporary catalog failures retain the last UI data. Project writes preserve cwd, section and runtime and are confirmed by native readback.
- Fresh npm ci, plugin build, all 214 automated tests and git diff --check passed with zero failures or skips. Coverage includes native catalog identity, stale selections, HTTP Origin/action-token guards, MCP app-only tools, shared locking, pre-dispatch cancellation and service shutdown, single-write confirmation, menus, focus preservation, themes, scroll restoration and Archive/Undo.
- Both official App Server labs passed in disposable CODEX_HOME directories. Native project clear/set/change/clear/restore completed with five metadata writes and a repeated-selection no-op. Existing group, Pin/Unpin, runtime and Archive/Undo checks passed; plugin installation/discovery verified seven tools and sidebar metadata. Desktop MCP dispatch and project-container snapshots remain simulated. Zero model turns were started and no existing user task was changed.
- In-app browser checks against the real MCP Apps SDK iframe and synthetic tasks passed for project selection/removal in menus and details, unread filtering, Board/List, Archive/Undo, all three themes and an opaque shell over the host's transparent body. Options stayed within 320, 800 and 1280 pixel viewports. Scrolling For Later left other columns stationary and persisted through a theme change. No browser console errors were captured.
- This integration did not replace the active Desktop plugin cache or restart Desktop. Genuine native sidebar clicks, custom-protocol navigation, Desktop write authorization and immediate native sidebar repaint remain outside browser-fixture acceptance.
