# Desktop-owned task group changes

## Problem and acceptance criteria

The current move endpoint writes through a separate App Server. Native readback and Desktop list_threads already report Recap Computer History patterns in In Progress, while the user reports an unchanged sidebar. Desktop rendering or refresh is therefore the working hypothesis, not a proven root cause.

Route explicit task group changes through Codex Desktop's move_thread_to_sidebar_section tool so Desktop owns the action. Keep native task.section authoritative for the board. Success requires exact native membership confirmation; Desktop tool acceptance and visible sidebar refresh are separate acceptance levels.

## Minimal implementation

1. Extend the existing private Desktop bridge with move and pin operations. Reuse moveLocalTask and pinLocalTask validation, immediate pre-write source checks, one-write behavior and native readback by adapting their write RPC to the Desktop tool. The adapter opens only a local reader and never opens a second writer.
2. Resolve each requested native section ID against threadSection/list. Resolve the matching Desktop section against a fresh list_threads result by an exact, unique allowed name. The two ID namespaces remain separate. Pinned must resolve to Desktop's built-in pinned section; null clears the task's own section via the documented Desktop default. Missing or ambiguous mappings fail before writing.
3. After Desktop lookup, reread the native destination catalog and require the original ID/name mapping to remain unique. Then read the native source immediately before calling the one Desktop mutation. Check the canonical projectId, including null; a missing field fails verification. A stale source or cancelled request must not overwrite an already observed Sidebar Flow move. Read back native membership and project association afterward. Do not retry or issue corrective writes if automatic classification wins the race.
4. Add only move_thread_to_sidebar_section to the relay tool whitelist. Preserve existing request forwarding, context discovery and notifications. Do not add arbitrary RPCs, model turns, project movement or configuration writes.
5. HTTP move/pin require an advertised desktop group-action capability. A missing, old or disconnected bridge returns an actionable error and disables those controls. Never silently fall back to a separate writer after a Desktop attempt. Archive/Undo keep their existing transport selection and tokens.
6. Keep HTTP CSRF/origin checks and action serialization. Add explicit sync flags for group/pin readiness, separate from read connection and Archive readiness. Board/List/Native group editing share the same capability; local manual ordering stays available.
7. Update the private installed bridge runtime, preserving the existing Sidebar Flow chain and connection settings. Do not terminate Codex or active tasks. A running Desktop must be restarted normally with the existing Kanban launcher before its proxy can load the new capability.

## Verification

- Unit tests: exact-ID/name mapping, duplicate or unavailable groups, null/Pinned, direct and inherited project tasks, protected hosts/tasks, stale source during Desktop lookup, cancellation, unchanged project association, later automatic reclassification, no duplicate writes, relay whitelist and read-only adapter.
- HTTP/private-socket tests: ready/new capability, old bridge, disconnection, origin/CSRF, serialization and failure without fallback; existing Archive/Undo regressions.
- Isolated official App Server lab: disposable CODEX_HOME, real task section writes/readbacks, simulated Desktop MCP dispatcher and Desktop section IDs. Verify move/pin/unpin, project inheritance, later native grouping and no model turns. Label the simulated Desktop component clearly.
- Browser: controls reflect capability, failures preserve task cards and authoritative group, normal ordering stays usable. Use disposable fixtures for mutation tests.
- Live Desktop: after a normal launch with the updated bridge, verify capability and user-driven drag plus native readback. Computer use cannot inspect the Codex native UI in this session, so visible sidebar acceptance requires the user's observation; do not claim it from mocks or list_threads alone.

## Independent review

The independent agent approved the approach before implementation. Required boundaries were unique cross-namespace mappings, reserved Desktop Pinned ID, explicit null clearing, a final native source/project check after Desktop lookup, and a separate new bridge capability. During implementation review it found a destination rename/replacement race; destination catalog revalidation and a zero-write regression now cover that race. The protocol lab creates a real native project using project/create and starts its disposable task with projectId.

## Out of scope

Persistent grouping overrides, forcing Sidebar Flow classification, starting/stopping tasks, remote/cloud mutations, project-container movement and automatic Codex restarts.
