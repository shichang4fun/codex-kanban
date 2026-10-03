# Native task creation — completed implementation

Final entry behavior: New task now navigates directly to the genuine Codex new-task page instead of opening the Kanban composer. The installed client recognizes codex://threads/new and codex://new with projectId/prompt. Verified Desktop project IDs from project subgroups override group defaults; ambiguous or unavailable projects disable links. No project omits the project parameter and leaves selection to the native page, rather than guaranteeing a projectless task. Only project/template defaults are exposed for native launching; model, reasoning, permissions and environment are chosen in Codex. Its newThread parser/navigation does not carry a sidebar group, so grouping is manual after creation. The reviewed bridge/composer implementation below remains available internally but is not called by the default link. Browser automation blocks the custom-protocol navigation; native landing remains a user-click acceptance check.

Goal: create tasks from every real local sidebar group, with reusable defaults and the same native project/environment configuration used by Codex. Group defaults remain local Kanban settings; they do not change Codex project settings.

## Reviewed design

- A compact centered composer follows the user's native Codex reference: a light rounded input area and bottom toolbar. The plus menu holds verified local project, Local/Worktree, existing starting branch and prompt template. A separate model/reasoning menu displays the current values in its trigger. A circular send button is disabled for blank prompts. Each group has New task and Creation settings; project subgroups preselect the exact project.
- The private owning Desktop bridge calls only native list_projects and create_thread in addition to its existing narrow capabilities. The separate App Server connection remains read-only for identity and readback. No standalone creation fallback or model turn RPC is exposed.
- Persist a request journal before native creation. Duplicate requests return the recorded outcome; unknown outcomes freeze that request. A separate explicit Start another task creates a new request while preserving the original record.
- A real task ID must retain the selected canonical project. Move it through the existing Desktop group adapter, permitting uniquely mapped custom groups for creation only, then verify native placement. Partial failures preserve the task ID and permit group-only retry.
- Worktree replies containing only clientThreadId remain pending. There is no reliable public resolver; users assign the finished task's group in the native Codex sidebar. Never guess an ID or repeat creation.
- Existing group, pin, runtime and archive capabilities survive a damaged creation journal; only creation is disabled.

## Independent review changes

The review required cancellation/readiness revalidation after journal persistence, an explicit separate-task recovery action, native-sidebar wording for pending Worktrees, and preserving a newly selected group/project separately from the unresolved operation. All were implemented with regression coverage.

## Verification and limits

- Automated coverage includes backend journals, cancellation, exact native identity/project validation, partial retry, custom-group mapping, HTTP origin/CSRF checks, capability isolation, installer dependencies and full-script UI interactions.
- A disposable real App Server lab verifies task creation/group readback and duplicate prevention through simulated Desktop MCP dispatch. No model turns or existing user-task mutations occur.
- In-app browser checks use the private socket and HTTP server with disposable fixtures, covering default persistence, local creation, project subgroups, pending Worktree recovery and the floating dialog.
- Actual live Desktop create_thread authorization, model execution and immediate visible sidebar refresh are not certified by these simulated Desktop tests. Updated private runtime code activates on a normal launch through the existing Kanban launcher.
