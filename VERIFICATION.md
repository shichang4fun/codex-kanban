# Verification

## Navigation integration 0.4.49 — 2026-10-04

- Integrated the navigation changes with current main. Two independent reviewers found timestamp presses missing the pointer guard and runtime/PR expiry updates still changing click-target geometry. Both are fixed with regressions, and both reviewers verified the final changes without remaining P1/P2 findings.
- All 650 automated tests pass on Node 22; 88 focused tests pass on bundled Node 24. Marketplace packaging, repeat native install and official App Server discovery pass with 14 app-only tools. Real App Server tests in a disposable home verify Rename, projects, groups, Pin/Unpin, Archive/Undo, offline creation and duplicate-safe flow initialization; Desktop MCP dispatch is simulated and zero model turns are started.
- Synthetic in-app-browser acceptance verifies immediate opening/aria-busy feedback, duplicate suppression, timestamp forwarding, failure cleanup/retry and List keyboard activation with the official SDK and a host delaying responses by four seconds. No existing user tasks were modified. Actual Desktop chat landing and end-to-end latency improvement remain unmeasured.
- Updated the existing local plugin and private Desktop runtime to 0.4.49 with a recoverable backup. Flow policy, the original LaunchAgent/manifest, legacy configuration/proxy and CODEX_CLI_PATH are preserved; the original-icon CLI probe passes. The running client was not restarted; a normal next launch is required for loaded code to change.

## Card navigation responsiveness — 2026-10-04

- Connected MCP App clicks dispatch `openLink` in the current turn, coalesce repeated clicks on the same URL until acknowledgement, and show an opening border/cursor with `aria-busy`. Initialization and rejected-link feedback remain supported; drag-cancelled clicks do not navigate.
- Polling, in-flight read success/failure and timer redraws defer while a link is pressed or opening. The pointer guard lasts through pointerup's microtask checkpoint and clears on click, cancellation, blur or release outside the link. Polling resumes normally after navigation completes.
- All 648 automated tests pass, including real SDK navigation concurrent with an unresolved board tool, synchronous dispatch ordering, duplicate suppression, retry and full-script polling preservation. Plugin build and `git diff --check` pass.
- In-app browser acceptance with a synthetic MCP host delaying navigation by four seconds confirms immediate `aria-busy`/opening state, two clicks producing one host request, rejection cleanup and Board/List operation. The installed plugin cache is unchanged. Actual Desktop chat landing and end-to-end latency improvement are unmeasured; the host still owns deep-link resolution and chat loading.

## Card information integration 0.4.48 — 2026-10-04

- Integrated descriptions, runtime attention and PR attention with main's three-second refresh, stable ordering, native Rename and automatic grouping. Two independent reviews identified and verified fixes for timestamp tooltip hit testing and clearing Cached on identical fresh reads without losing card DOM/focus. New text follows Aa scaling; PR notices wrap at narrow widths.
- All 643 automated tests pass on Node 22; 106 focused tests pass on bundled Node 24. Marketplace build, official plugin discovery and repeat-install acceptance pass with 14 app-only tools. Real App Server tests in a disposable home pass for Rename, projects, groups, pinning, archive/Undo, creation and flow-group initialization; Desktop MCP dispatch is simulated and no model turns are started.
- Synthetic in-app-browser acceptance covers Board/List, dark/light, 420px at 130%, empty/duplicate descriptions, long text, PR states/links and runtime expiry while an unsaved rename draft retains focus. Independent browser review verifies timestamp hover and forwarded card activation. Live Desktop acceptance after a normal restart remains a separate gate.

## Remove card-wide tooltips — 2026-10-04

- Removed the card overlay's open/drag instructions, duplicate description and recency disclaimer. Removed obsolete runtime-tooltip bookkeeping. Accessible open-task labels, native links, drag behavior, inline runtime/PR notices and individual control/time tooltips remain.
- Focused card-info, UI, task-order and PR-attention tests pass, as do plugin build and `git diff --check`. In-app browser confirmed all 55 real cards have accessible names and no overlay title; List view also has no overlay title, and the timestamp retains its own tooltip. Restored Board and cleared the temporary search. Screenshot: `dist/card-no-overlay-tooltip.png` (ignored). Updated standalone board at port 18865; installed plugin unchanged.

## PR attention on cards — 2026-10-04

- Cards show linked CI failed, Changes requested and Review required notices using existing GitHub check/review metadata. Multiple PRs identify each notice by PR number. Drafts show CI failures only; merged/closed PRs suppress historical failures and review notices. Healthy, pending, unknown or unavailable states add no alert row.
- PR or branch metadata older than 90 seconds, invalid or dated in the future labels notices Cached. During Options, task menus, creation or dragging, the timer qualifies notices in place without replacing the active card. Existing PR state badges, details, polling and native task actions remain intact. No recent-message/result extraction was added.
- All 396 tests pass (`npm test`), including six PR-attention regression tests; plugin build (`npm run build:plugin`) and `git diff --check` pass.
- Synthetic MCP App acceptance (`KANBAN_TEST_PR_ATTENTION=1 KANBAN_TEST_PORT=18866 node mcp-browser.integration.mjs`) verified simultaneous CI/review notices, review-required, drafts, healthy and merged PRs, multiple PRs, cached reads, valid PR links and no alert text overflow in Board/List and dark/light themes. Screenshots: `dist/pr-attention-board-dark.png`, `dist/pr-attention-board-light.png`, `dist/pr-attention-card.png` (ignored synthetic artifacts). Closed the test tab and stopped its server.
- Regenerated and refreshed the real standalone board at port 18865. The 55-task board has no PR-attention notices in its observed snapshot, so actual anomalies were not fabricated. Installed plugin remains unchanged.

## Concise description tooltips — 2026-10-04

- Card tooltips retain the action hint, complete description and the single caveat `任务描述，可能不反映最新进展。`; removed technical source, Preview/Summary prefixes and duplicate timestamp explanation. Timestamp tooltips retain their own update-time explanation.
- All 11 focused card-info tests, plugin build and `git diff --check` pass. In-app browser inspected current summary and local-preview tooltip attributes, including both Board and List, and confirmed the separate timestamp tooltip. Restored Board and cleared the temporary search. Card screenshot: `dist/card-tooltip-concise.png` (ignored; tooltip text verified through DOM attributes). Current standalone board at port 18865 is updated; installed plugin is unchanged.

## Plain card descriptions — 2026-10-04

- Removed visible Preview/Summary prefixes and their unused label style. Card tooltips retain the content type, provenance and recency caveat; attention notices are unchanged.
- All 11 focused card-info tests, plugin build and `git diff --check` pass. In-app browser confirmed no preview-label nodes, preserved snapshot-source tooltip, and plain user-request text in both Board and List. Restored Board view and cleared the temporary search on the 55-task standalone board at port 18865. Screenshot: `dist/card-preview-no-prefix.png` (ignored). The installed plugin was not updated.

## Preview context cleanup — 2026-10-04

- Removed recognized leading browser ambient-context blocks before preview whitespace normalization. Legacy browser context is removed only when its explicit user-request boundary is present; context-only or truncated context is hidden. Ordinary request text, embedded markup and original task metadata are preserved.
- Snapshot summaries display `Summary`; provenance remains in the card tooltip. Local previews retain `Preview`, with a tooltip explaining they usually contain the initial user request.
- All 390 tests pass (`npm test`), plugin build passes (`npm run build:plugin`), and `git diff --check` passes. Regressions cover the reported example, repeated wrappers, legacy context, incomplete context, empty or duplicate requests, safe text rendering and tooltip sources.
- Refreshed the current standalone board at port 18865. In-app browser confirmed the real Sebastian tutorial card displays its user request in Board and List, and all summary labels omit `(snapshot)`. Restored Board view and cleared the temporary search. Screenshot: `dist/card-preview-cleaned.png` (ignored). The installed plugin was not updated.

## Card previews and attention notices — 2026-10-04

- All 386 automated tests pass (`npm test`), plugin build passes (`npm run build:plugin`), and `git diff --check` passes. Independent implementation review found an interaction-paused expiry bug; the fix passed follow-up review and regressions covering Options, task menus, creation, task dragging and group dragging across waiting/error/running states.
- Cards show existing task previews with explicit source labels, two lines in Board and one in List. Empty, invalid and title-duplicate content is hidden. Snapshot summaries are not presented as latest progress; timestamps identify task updates. No new conversation reads, model-generated summaries, dependencies or runtime writes were added.
- In-app browser acceptance used only synthetic MCP App fixtures (`KANBAN_TEST_CARD_INFO=1 KANBAN_TEST_PORT=18864 node mcp-browser.integration.mjs`). Verified dark/light appearances, 390px Board/List layouts, long Chinese and unbroken English content, simultaneous input/approval notices, hidden empty/duplicate previews, multiple-PR details and task action menus. Measured preview heights were 36px in Board and 18px in List, with no text overflow beyond their own containers.
- With Options held open, four waiting/error notices expired to zero after the observation window; all six previews and the open Options panel remained. The stale notice also disappeared from the card tooltip. Expiry removes indicators in place instead of interrupting active interactions. Temporary viewport overrides were reset.
- Screenshot: `dist/card-info-board-dark.png` (ignored local artifact). No existing user task was moved, pinned, archived or executed. This verifies the built code in a synthetic MCP host; the installed plugin was not updated and actual native deep-link landing was not exercised.

## Native new-task navigation — 2026-10-04

- The latest checkout now serves the real 55-task board at port 8898; port 8896 belongs to an older checkout. Each local group exposes a title-row plus link and a footer New task link, including when the creation bridge is unavailable. In-app browser checks confirm the title link is visible and points to codex://threads/new; screenshots are saved in outputs/real-kanban-new-task-entry.png.
- Removed the native card container's 180px minimum height so New task follows the last card or empty placeholder at the existing 8px spacing. Browser measurements confirm an empty filtered group and the restored task list both have an 8px gap; the empty container matches its content height. The search was restored, all 162 tests pass, and git diff --check passes. Screenshot: outputs/new-task-spacing.png.
- Task drag start now stretches expanded Board columns to the board's full height; drag end/drop removes that layout state. Card contents and New task keep their natural position. All 163 tests pass, including accepted hover, render preservation, cancellation and blocked drag start. In an isolated read-only browser fixture, a one-card column expanded from 165.5px to 1199.5px, a point 250px below New task hit that column, and its button gap stayed 8px. Cancelling restored 165.5px. These are synthetic drag events exercising the production handlers and real browser layout; no real task move was attempted. Screenshot: outputs/expanded-drag-target.png.
- Default New task entries are genuine native deep links rather than composer buttons. The installed app.asar bootstrap parser recognizes codex://threads/new and codex://new?projectId=…&prompt=…; its main-process newThread handler navigates to the native home composer with the resolved project and prefilled prompt. No sidebar group, model or environment parameter is propagated by that handler.
- All 162 tests pass, covering URL encoding, project/no-project overrides, absence of unsupported parameters, empty local group links, no remote-group entrance and links usable while the creation bridge is unavailable. HTTP regression confirms only project/template defaults are supplied for native launch while disconnected.
- In-app browser DOM verification confirms the codex-kanban project-subgroup link contains the exact project ID returned by live list_projects. Browser Use security policy rejected the codex:// navigation itself; no workaround was attempted, no model turn was started, and actual native landing is unverified. The user must click the link to complete that acceptance check.

## Per-group task creation and floating dialog — 2026-10-04

- Subsequent UI revision follows the user's native Codex screenshot: a light rounded composer, borderless Do anything prompt, plus settings popover, current model/reasoning trigger and circular send action. Constant form labels and instructional paragraphs are removed from the default view; recovery messages appear only when needed. All 161 tests pass, including current-value summaries, blank-prompt disabling and recovery visibility. In-app browser checks verify menu switching, editable controls and the rendered composer. Permission and voice controls are not represented because the bridge exposes no corresponding capability.
- The independent UI review identified a short-window popover clipping risk. Menu height is now bounded by the actual space above its trigger and refreshed on viewport resize. Browser measurements passed in 900×600 and 390×600: settings menus retain 16px top clearance, controls remain accessible and the composer toolbar has no horizontal overflow. Model/reasoning changes update the visible trigger, entering a prompt enables sending, and clearing it disables sending. A local screenshot is saved in outputs/task-creation-native-composer.jpg.

- All 160 automated tests pass. New coverage verifies durable predispatch journals, timeout/restart duplicate prevention, cancellation during persistence, verified local projects, unique custom-group mapping, partial group-only retries, capability isolation on journal corruption, native project precedence, HTTP origin/CSRF protection and installed module dependencies.
- Full-script UI regressions cover Board/List entrances, empty custom groups, saved defaults, project-subgroup overrides, non-Git Worktree rejection, partial and pending outcomes, and starting a separate task in a newly selected group/project while preserving the previous request.
- The real official App Server lab passed in disposable CODEX_HOME. Native creation/group readback and duplicate prevention are verified through simulated Desktop MCP dispatch. Existing move/pin/runtime/archive checks also passed; modelTurnsStarted is zero and no existing user task was modified.
- In-app browser checks at port 8898 used a disposable private bridge/socket fixture, confirming settings save/readback, local creation with verified grouping, project-subgroup selection and queued Worktree messaging. The creation/settings UI is now a compact centered floating dialog with a blurred backdrop, rounded controls, a neutral primary action and folded advanced settings; it no longer inherits full-height drawer sizing.
- Independent review identified and drove fixes for cancellation after journal persistence, explicitly starting another task after an unresolved outcome, native-sidebar Worktree guidance, and retaining a newly selected creation destination separately from the pending request.
- Private installed runtime files were updated and read back against source; module imports passed and original connection settings and Sidebar Flow chain were preserved. The running Desktop process was not stopped or restarted. Actual live create_thread authorization/model execution and immediate visible sidebar updates remain unverified until normal activation through the updated launcher. Queued Worktree replies without a real task ID require native-sidebar grouping after setup.
## Default column order — 2026-10-04

- With no saved custom column order, In Progress now precedes For Later; other column positions remain unchanged. Existing saved orders continue to take precedence, and no native group data or browser preference is written by the default.
- Verified the full browser script with disposable Board/List fixtures, snapshot refresh and an explicitly saved For Later-before-In Progress order. All 169 automated tests and git diff --check passed.

## New manual-order arrivals — 2026-10-04

- Tasks entering a group for the first time now appear before saved tasks. Multiple arrivals follow incoming recently-updated order; existing positions, returning saved entries, hidden tasks and absent entries remain preserved.
- Ordering regressions cover reload, timestamp changes, first cross-group arrival, subsequent manual reordering and stale-tab storage preservation. Full browser-script fixtures verify Board/List with Project view on/off, arrival during search filtering, snapshot refresh and unchanged recent sorting. No existing user task was modified.
- Installed the declared dependencies with npm ci; all 169 automated tests passed. git diff --check passed. README and plugin skill describe the new behavior.

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

## Group creation and manual arrival ordering — 0.4.41

- Integrated both source sessions without modifying their worktrees. New arrivals lead a group's Manual order while saved positions, hidden tasks, returning tasks and cross-tab entries remain stable. The default layout puts In Progress before For Later; saved custom column order wins.
- New task links in group headers, immediately after cards, and in project subgroups use native Codex new-task URLs. They do not open the Kanban composer or dispatch a task. Project/template defaults persist in the user's Kanban data directory. Native deep links cannot carry a sidebar group; group selection remains manual after creation. Omitting projectId delegates project selection to Codex.
- Independent review found and resolved missing packaged dependencies, creation APIs outside the shared MCP service, missing MCP link forwarding, Desktop/native project-ID confusion, HTTP pre-dispatch cancellation, ambiguous multi-root mappings and stale default-project links. The final independent review found no blockers; its 51 focused tests passed. Cross-instance storage locking, unresolved-journal visibility and creation-dialog refresh protection also have regression coverage.
- Fresh dependency installation reported zero vulnerabilities. Plugin build, all 256 automated tests and diff checks passed, with no failures or skips. Fifteen SDK/socket/storage/HTTP integration tests cover app-only tools, action tokens, capabilities, single-write and cancellation boundaries, recovery and concurrent defaults writes.
- Both official App Server labs passed in temporary CODEX_HOME directories. Creation dispatch uses a simulated Desktop tool and a real native reader with different Desktop and native project IDs; grouping and duplicate-request prevention were verified. Existing project, group, runtime, Pin/Unpin and Archive/Undo checks passed. Plugin discovery verified twelve tools and sidebar metadata. Zero model turns or existing user-task writes were used.
- In-app browser checks used the real MCP Apps SDK iframe and synthetic tasks. Board/List links, default-settings save and reopen, verified project-subgroup overrides, Manual order, Light theme, 320/800 pixel layouts and column drop areas passed. New task click forwarded through the MCP host link handler, left the Kanban creation dialog closed, and showed the expected unavailable-navigation message from the rejecting test host. New task follows cards with an 8px gap. No browser console warnings/errors were captured.
- This change does not replace the active Desktop plugin or restart the client. The real native landing page and Desktop create-thread authorization remain outside the isolated automated acceptance coverage.
- Rebased onto main 3a5d365 after the GitHub marketplace packaging merge, preserving manifest author/repository metadata. Marketplace build, all 256 tests and both official App Server labs passed again; packaged creation modules and twelve-tool discovery were retained.

## One-click GitHub marketplace publication — 2026-10-04

- Added a manual Publish marketplace workflow restricted to main. Tests and packaging run without repository write credentials; only the dependent publication job receives contents:write. Tar preserves hidden marketplace metadata and the launcher's executable bit across artifact transfer.
- The publisher uses a temporary checkout, retains marketplace commit history, removes obsolete package files and performs a normal fast-forward push. It refuses stale main checkouts, invalid versions, private data, symlinks and non-executable launchers. Identical packages do not add commits. Source checkout and temporary-worktree cleanup are verified after rejected pushes.
- Independent review found no blockers. Five isolated Git tests pass, including a shallow CI clone and a competing remote commit inserted immediately before push; the competitor remains intact after publication is rejected.
- All 261 automated tests and marketplace packaging passed. The official actionlint 1.7.12 release passed checksum validation and reported no workflow errors. A real package passed official CLI installation and twelve-tool MCP discovery after a tar round trip, with zero model turns or user-task writes.
- README now leads with the two-command installation flow and links to the manual publication workflow. Actual hosted publication is verified separately after the workflow is merged into main.
# One installer for plugin and Desktop bridge — 0.4.42

- `npm test`: 267 tests passed. New coverage checks first install, remote upgrade, preservation of an existing CLI chain, custom CODEX_HOME on Finder launch, missing runtime/CLI failures, invalid existing settings, and dynamic proxy context without a configured task UUID.
- `npm run package:marketplace`: the package contains an executable `Install Codex Kanban.command` and the bundled installer. No npm dependencies or global CLI/Node installation are required by the installer.
- `npm run test:install-native`: actual bundled Codex CLI installs and reinstalls the package in a disposable CODEX_HOME; the generated proxy connects to a real App Server, stays disconnected before a context is loaded, becomes ready after an ephemeral context is loaded, and discovers twelve app-only tools at version 0.4.42. No model turns or existing task changes.
- `npm run test:integration`: isolated real App Server project metadata, occupied writer rejection, group/Pin changes, live runtime, archive/Undo and offline creation checks passed. Desktop MCP dispatch is simulated in this suite; zero model turns.
- Independent review found a custom CODEX_HOME relaunch issue. The bridge config and launcher now retain that home, and `open` receives it explicitly; a regression test covers launching without an inherited terminal environment. Follow-up review and twenty targeted tests passed.
- `git diff --check` and `sh -n 'Install Codex Kanban.command'` passed. Publication validates and preserves the installer's executable mode.
- Remaining acceptance boundary: Finder double-click behavior, macOS downloaded-script confirmation, real Desktop tool authorization and immediate sidebar updates need a normal client restart. The installer never stops the client; the dedicated launcher must be used for later starts as well.
