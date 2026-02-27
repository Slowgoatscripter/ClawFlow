# Design Document: Workshop Layer Bug Sweep

**Task:** Bug sweep — Workshop layer (chat, artifacts, panel sessions)
**Tier:** L2 | **Priority:** High
**Author:** Brainstormer Agent
**Date:** 2026-02-27

---

## 1. Problem Statement

The Workshop is ClawFlow's primary user-facing interaction layer. A thorough audit reveals **30+ bugs, error handling gaps, and edge cases** across the engine (`workshop-engine.ts`), IPC handlers (`index.ts`), Zustand store (`workshopStore.ts`), and 10+ UI components. Silent failures in this layer directly hurt the user experience — messages vanish without feedback, panel sessions crash on edge cases, artifacts fail to load with no explanation, and malformed content breaks the chat.

### Impact Summary

| Severity | Count | Examples |
|----------|-------|---------|
| **Critical** | 6 | Empty personas crash, silent tool call drops, SVG injection, JSON.stringify crash |
| **High** | 10 | Memory leaks on project switch, no IPC error feedback, race conditions on send |
| **Medium** | 10 | Cache invalidation, unsafe regex, missing input validation |
| **Low** | 4+ | Type safety (`any` casts), accessibility gaps, cosmetic issues |

---

## 2. Audit Findings — Full Catalog

### 2.1 Workshop Engine (`src/main/workshop-engine.ts`)

#### CRITICAL

**C1 — Empty personas array crash (parsePanelResponse)**
When `parsePanelResponse` falls back to assigning unparsed output to a persona, it accesses `personas[0]` without checking if the array is empty. If a panel session is somehow created with zero personas, this throws `Cannot read property 'id' of undefined`.

**C2 — Silent tool call drops (handleToolCalls)**
When `JSON.parse(match[2].trim())` fails on malformed tool call JSON, the `catch` block executes `continue` with zero logging or user feedback. The tool call is silently discarded — the user never knows a feature execution was skipped.

**C3 — Unsafe context stream parsing**
```typescript
const parts = streamContent.replace('__context:', '').split(':')
this.emit('context-update', { contextTokens: parseInt(parts[0], 10), contextMax: parseInt(parts[1], 10) })
```
No validation that `parts` has ≥2 elements. `parseInt` can return `NaN`, which then propagates through token tracking silently.

#### HIGH

**H1 — Event listener leak on project switch (ensureWorkshopEngine in index.ts)**
When `ensureWorkshopEngine` creates a new engine (e.g., switching projects), old `.on()` listeners are never removed. Each switch stacks duplicate listeners, causing memory leaks and duplicate event emissions to the renderer.

**H2 — No error propagation from IPC handlers**
Most IPC handlers use `currentWorkshopEngine?.method()` — if the engine is null, the call silently returns `undefined`. The renderer cannot distinguish "session doesn't exist" from "engine not initialized." Errors thrown inside `sendMessage` are caught internally and emitted as stream events, but the IPC `Promise` resolves successfully — the renderer's `await` never rejects.

**H3 — Partial failure in batch task creation**
```typescript
for (const task of tasks) {
  await currentWorkshopEngine.createPipelineTask(sessionId, task)
}
```
If task 3/5 fails, tasks 1-2 are already created but the loop aborts. No rollback, no partial-success feedback.

**H4 — Debounce timer not cleaned on early error**
The `pendingSaveTimer` in `sendMessage` could fire after the session is cleaned up if the SDK call rejects before any streaming begins.

**H5 — `trackTokens` can throw inside Promise.all persona map**
In panel discussions, each persona's promise catches SDK errors but `this.trackTokens()` sits outside the inner try/catch. If it throws, it escapes the error boundary.

#### MEDIUM

**M1 — File read errors swallowed (`getArtifactContent`)**
Returns `null` on any `fs.readFileSync` error with no logging. Permission denied, disk errors, missing directories — all invisible.

**M2 — No validation of toolInput shape before dispatching**
After parsing tool call JSON, properties like `toolInput.name`, `toolInput.type`, `toolInput.content` are accessed without existence checks.

**M3 — Potential file name length overflow**
Artifact file names are sanitized for invalid characters but not for length — could create invalid paths on Windows (260-char limit).

**M4 — `SdkRunner` typed as `(params: any) => Promise<any>`**
Defeats TypeScript's entire purpose. Stream event emissions also use `as any` casts.

### 2.2 IPC Handlers (`src/main/index.ts`)

**H6 — `workshop:recover-session` accesses private `dbPath` via string indexing**
```typescript
createWorkshopMessage(currentWorkshopEngine['dbPath'], ...)
```
Code smell — accesses a private field through bracket notation. Fragile if the field is renamed.

**M5 — `workshop:get-artifact` performs a linear scan**
```typescript
const artifacts = currentWorkshopEngine?.listArtifacts() ?? []
const artifact = artifacts.find(a => a.id === artifactId) ?? null
```
Lists all artifacts just to find one. Not a bug but a performance concern for sessions with many artifacts.

### 2.3 Zustand Store (`src/renderer/src/stores/workshopStore.ts`)

#### HIGH

**H7 — No error handling on `sendMessage` / `sendPanelMessage`**
The store methods optimistically add the user message to state and set `isStreaming: true`, then `await` the IPC call. If the IPC call throws (engine null, network error), `isStreaming` stays `true` forever and the user message appears sent but nothing happens. No try/catch, no error state, no recovery.

**H8 — Input cleared before send completes (in ConversationPanel)**
The component clears the textarea immediately after calling `sendMessage()`. If the IPC call fails, the message is lost — the user can't retry.

**H9 — `selectArtifact` swallows errors silently**
```typescript
} catch {
  set({ artifactLoading: false })
}
```
No error state set, no user feedback. Artifact panel just shows nothing.

#### MEDIUM

**M6 — `loadArtifacts` silently preserves stale data**
```typescript
if (artifacts.length === 0 && prev.length > 0) return
```
If the backend legitimately returns empty (all artifacts deleted), the store refuses to update. Stale artifacts remain visible forever.

**M7 — Stream error handler clears state but shows no message**
```typescript
} else if (event.type === 'error') {
  set({ isStreaming: false, streamingContent: '', ... })
}
```
The error event's `event.error` string is available but never displayed to the user.

**M8 — `setupListeners` uses `(useWorkshopStore as any)._ipcListenersActive`**
Monkey-patches a flag onto the store to prevent duplicate listeners. Fragile pattern — no type safety, invisible to other code.

**M9 — `groupConsecutiveTools` uses `(segments[i + 1] as any).tool`**
Unsafe cast could fail if segment structure changes.

### 2.4 UI Components

#### ConversationPanel.tsx

**H10 — `_dismissStall` accessed via `(useWorkshopStore as any)._dismissStall`**
If the function doesn't exist (listeners not set up), it silently fails. Falls back to `setState()` which isn't a Zustand API.

#### ArtifactPanel.tsx

**M10 — Error boundary only catches render errors, not async content loading**
Content loading errors go through the store's silent catch. The error boundary won't trigger.

**M11 — Cache invalidation: `cachedArtifactsRef` persists stale data indefinitely**
Old artifacts are never evicted. If artifacts are deleted or corrupted, stale versions display.

#### MessageBubble.tsx

**H11 — Tool call XML stripping regex is fragile**
```typescript
/tool_call name="\w+">/
```
`\w+` doesn't match tool names with hyphens (e.g., `create-artifact`). Partial XML remnants leak into displayed content.

**M12 — Segments array not validated before iteration**
`message.metadata?.segments` could be malformed (not an array). No `Array.isArray()` check.

**M13 — Unknown segment types silently return null**
If a segment has an unexpected `type`, it's dropped. No fallback rendering, no warning.

#### ToolCallCard.tsx

**C4 — `JSON.stringify` can crash on circular references**
```typescript
JSON.stringify(tool.toolInput, null, 2)
```
No try/catch. If `toolInput` contains circular references (possible from SDK output), React crashes the entire component tree.

**M14 — Unsafe property access on `toolInput`**
`getToolContext()` accesses `input.file_path`, `input.path` etc. without checking if `input` is an object. If `input` is a string or number, property access returns `undefined` silently.

#### MermaidDiagram.tsx

**~~C5~~ — SVG injection via `insertAdjacentHTML` → DOWNGRADED to Low**
```typescript
svgContainer.insertAdjacentHTML('beforeend', svg)
```
Mermaid's `render()` runs DOMPurify internally before returning SVG (confirmed in codebase comments). Risk is limited to a Mermaid library vulnerability — no separate DOMPurify dependency needed.

**H12 — Race condition on rapid re-renders**
`renderDiagram()` is async. If content changes quickly, multiple renders can race. The `cancelled` flag mitigates this partially but state updates from a stale render could still slip through.

**M15 — Global Mermaid state pollution**
`mermaid.initialize()` called at module load affects all instances. `renderCounter` is global with no overflow protection.

**H13 — DOM manipulation outside React**
Direct DOM operations (`replaceChildren()`, `appendChild()`) conflict with React's reconciler.

#### PanelSessionModal.tsx

**M16 — No input sanitization on custom persona names/descriptions**
No length limits, no special character escaping. Very long names break layout.

**M17 — Color allocation could assign duplicates**
`getAvailableColor()` doesn't account for custom personas being added in quick succession.

#### ChoicesModal.tsx

**M18 — `selectChoice()` not awaited, errors swallowed**
No loading indicator, no error feedback if choice selection fails.

#### SessionList.tsx

**M19 — Event handlers access `currentProject` without null guard**
`currentProject` is checked at render time but not re-checked inside async event handlers.

**M20 — No debounce on delete/stop clicks**
Rapid clicks can fire multiple IPC calls.

---

## 3. Proposed Approaches

### Approach A: Surgical Fix-by-Fix (Bottom-Up)

**Strategy:** Fix each bug individually, one at a time, prioritized by severity. No new abstractions.

**Changes:**
- Add try/catch + error state to each store method
- Add null checks in engine where identified
- Wrap `JSON.stringify` calls in try/catch
- Fix regex patterns
- Add `removeAllListeners()` in `ensureWorkshopEngine`
- DOMPurify for Mermaid SVG
- Individual error messages per component

**Pros:**
- Minimal blast radius — each fix is isolated and reviewable
- Can be shipped incrementally (fix 5 critical bugs first, medium later)
- No new abstractions to learn or maintain
- Easy to test: each fix has a clear before/after

**Cons:**
- Repetitive error handling code across store methods
- No systemic improvement — new IPC calls will repeat the same mistakes
- Error UI is ad-hoc (each component handles it differently)
- Doesn't address the `any`-typed IPC bridge

**Estimated effort:** ~3-4 hours for Critical+High, ~2-3 more for Medium

---

### Approach B: Hardened IPC Layer + Targeted UI Fixes (Top-Down)

**Strategy:** Create a thin error-handling wrapper around the IPC bridge, then fix UI components individually. Addresses the systemic root cause (unhandled IPC errors) while still doing targeted fixes for engine-level bugs.

**Changes:**

1. **IPC error wrapper** — a `safeIpc()` utility in the store that wraps every `window.api.workshop.*` call:
   ```typescript
   async function safeIpc<T>(fn: () => Promise<T>, fallback: T, errorMsg?: string): Promise<T> {
     try { return await fn() }
     catch (err) {
       console.error('[Workshop IPC]', err)
       useWorkshopStore.getState().setError(errorMsg ?? 'Something went wrong')
       return fallback
     }
   }
   ```

2. **Store-level error state** — add `error: string | null` and `setError` / `clearError` to the store. A single `<WorkshopErrorBanner>` component reads from store and auto-dismisses.

3. **Engine-level fixes** — all Critical and High engine bugs fixed directly (null checks, listener cleanup, error logging).

4. **Component-level fixes** — targeted fixes for JSON.stringify crash, regex, Mermaid sanitization, etc.

5. **IPC handler hardening** — replace `?.` with explicit null check + throw in main process handlers.

**Pros:**
- Systemic: every future IPC call gets error handling for free
- Single error display mechanism — consistent UX
- Engine fixes still surgical and isolated
- Addresses root cause (error propagation gap between main ↔ renderer)

**Cons:**
- Slightly more code to write up front (~50 lines for the wrapper + error banner)
- Need to touch every store method to wrap calls (but they need touching anyway)
- Error banner is a new component (small, but new surface area)

**Estimated effort:** ~4-5 hours for full implementation

---

### Approach C: Full Error Architecture Overhaul

**Strategy:** Typed IPC responses with `Result<T, E>` pattern, React error boundaries at every component level, structured error logging, retry mechanisms.

**Changes:**
- New `IpcResult<T>` type with `success`/`error` discriminated union
- Rewrite all IPC handlers to return `IpcResult`
- React error boundary wrapper for every Workshop component
- Error reporting/telemetry integration
- Retry logic for transient failures
- Full type-safe IPC bridge (remove all `any`)

**Pros:**
- Gold standard error handling
- Type-safe end-to-end
- Retry handles transient issues automatically

**Cons:**
- **Massive scope** — touches every IPC handler, every store method, every component
- Way beyond L2 bug sweep — this is L3 architecture work
- High risk of regression with so many simultaneous changes
- YAGNI: retry logic not needed for a local Electron app
- Would need its own brainstorm + planning cycle

**Estimated effort:** ~12-16 hours — too large for this task

---

## 4. Recommendation: Approach B (Hardened IPC + Targeted Fixes)

**Approach B** is the right balance. Here's why:

1. **Root cause addressed**: The #1 systemic issue is that IPC errors don't propagate to the user. A thin wrapper fixes this everywhere, including for future code.

2. **Scope appropriate for L2**: ~4-5 hours of focused work. Approach A is slightly less work but leaves the systemic gap. Approach C is far too much.

3. **No over-engineering**: The `safeIpc` wrapper is ~10 lines. The error banner is a simple component. No new libraries, no architectural overhaul.

4. **Still surgical where needed**: Engine bugs (null checks, regex, listener cleanup) are fixed individually at the source.

---

## 5. Implementation Plan

### Phase 1: Critical Engine Fixes (est. 1 hour)

| ID | Fix | File | What |
|----|-----|------|------|
| C1 | Personas guard | workshop-engine.ts | Add `if (personas.length === 0) return []` in `parsePanelResponse` |
| C2 | Log dropped tool calls | workshop-engine.ts | Add `console.warn` + emit diagnostic event on tool call parse failure |
| C3 | Context parse validation | workshop-engine.ts | Validate `parts.length >= 2` and `!isNaN()` before emitting |
| C4 | Safe JSON.stringify | ToolCallCard.tsx | Wrap in try/catch, show `"[Unable to display input]"` on failure |
| ~~C5~~ | ~~Mermaid SVG sanitize~~ | MermaidDiagram.tsx | **Downgraded** — Mermaid already sanitizes SVG internally via bundled DOMPurify. No action needed. |

### Phase 2: IPC Hardening (est. 1.5 hours)

| ID | Fix | File | What |
|----|-----|------|------|
| H1 | Listener cleanup | index.ts | `currentWorkshopEngine?.removeAllListeners()` before creating new engine |
| H2 | Explicit error throws | index.ts | Replace `?.` with `if (!engine) throw new Error(...)` in IPC handlers |
| H2b | `safeIpc` wrapper | workshopStore.ts | Create wrapper, apply to all `window.api.workshop.*` calls |
| H2c | Error state + banner | workshopStore.ts + new `WorkshopErrorBanner.tsx` | Add `error` field to store, auto-dismissing banner component |
| H7 | sendMessage error recovery | workshopStore.ts | On IPC failure: set `isStreaming: false`, set error, keep user message visible |

### Phase 3: High-Priority Engine + Store Fixes (est. 1 hour)

| ID | Fix | File | What |
|----|-----|------|------|
| H3 | Batch task partial-failure | index.ts | Wrap loop in try/catch, return `{ created: N, failed: M }` |
| H4 | Debounce timer cleanup | workshop-engine.ts | Clear timer in catch block before re-throwing |
| H5 | trackTokens inside try | workshop-engine.ts | Move `trackTokens` inside the per-persona try/catch |
| H8 | Input preservation | ConversationPanel.tsx | Only clear input after successful send (move clear into `.then()`) |
| H11 | Fix tool_call regex | MessageBubble.tsx | Change `\w+` to `[\w-]+` to match hyphenated tool names |
| M7 | Surface stream errors | workshopStore.ts | On `event.type === 'error'`, call `setError(event.error)` |

### Phase 4: Medium-Priority Fixes (est. 1 hour)

| ID | Fix | File | What |
|----|-----|------|------|
| M1 | Log file read errors | workshop-engine.ts | `console.error` in `getArtifactContent` catch block |
| M2 | Validate toolInput shape | workshop-engine.ts | Check required fields exist before dispatching to tool handlers |
| M6 | Fix stale artifact cache | workshopStore.ts | Remove the "don't update if empty" guard |
| M9 | Type-safe segment access | workshopStore.ts | Replace `as any` with proper type narrowing |
| M10 | Artifact loading error state | workshopStore.ts | Set `artifactError` string on catch, display in ArtifactPanel |
| M12 | Validate segments array | MessageBubble.tsx | Add `Array.isArray()` guard before `.map()` |
| M13 | Fallback for unknown segments | MessageBubble.tsx | Render `[unsupported content]` instead of null |
| H12 | Mermaid render cancellation | MermaidDiagram.tsx | Add proper cleanup with abort flag checked after each async step |
| H13 | React-safe Mermaid rendering | MermaidDiagram.tsx | Use ref + effect cleanup instead of direct DOM insertion |
| M16 | Persona input validation | PanelSessionModal.tsx | Max length 50 chars on name, 200 on description |

### Phase 5: Polish (est. 0.5 hours)

| ID | Fix | File | What |
|----|-----|------|------|
| M14 | Safe toolInput access | ToolCallCard.tsx | `typeof input === 'object' && input !== null` guard |
| M15 | Scoped Mermaid init | MermaidDiagram.tsx | Move `mermaid.initialize()` into component effect, not module scope |
| M17 | Color dedup | PanelSessionModal.tsx | Track assigned colors in state, exclude from available pool |
| M18 | Choice selection feedback | ChoicesModal.tsx | Add loading state during `selectChoice` |
| M20 | Debounce action buttons | SessionList.tsx | Disable buttons while async operation is in-flight |

---

## 6. Files Affected

**Main process:**
- `src/main/workshop-engine.ts` — Engine-level null checks, validation, logging
- `src/main/index.ts` — IPC handler hardening, listener cleanup

**Renderer store:**
- `src/renderer/src/stores/workshopStore.ts` — safeIpc wrapper, error state, fix stale cache

**UI components (modify):**
- `src/renderer/src/components/Workshop/ConversationPanel.tsx`
- `src/renderer/src/components/Workshop/ArtifactPanel.tsx`
- `src/renderer/src/components/Workshop/MessageBubble.tsx`
- `src/renderer/src/components/Workshop/ToolCallCard.tsx`
- `src/renderer/src/components/Workshop/MermaidDiagram.tsx`
- `src/renderer/src/components/Workshop/PanelSessionModal.tsx`
- `src/renderer/src/components/Workshop/ChoicesModal.tsx`
- `src/renderer/src/components/Workshop/SessionList.tsx`

**New file:**
- `src/renderer/src/components/Workshop/WorkshopErrorBanner.tsx` (~30-40 lines)

**Dependencies:**
- ~~`dompurify` package~~ — **Not needed.** Mermaid bundles DOMPurify internally and pre-sanitizes SVG output.

---

## 7. Testing Strategy

- **Manual:** Open Workshop, trigger each fixed scenario (send message with engine null, create panel session with 0 personas, load artifact that fails, paste malformed Mermaid)
- **Edge case sweep:** Rapid-fire message sends, project switching during stream, stop session during tool call
- **Regression:** Verify normal happy-path flows (solo chat, panel discussion, artifact creation) still work after changes

---

## 8. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Touching workshopStore.ts stream handler is high-risk | Make minimal changes — only add error surface, don't restructure |
| ~~DOMPurify adds bundle size~~ | **Resolved** — Mermaid bundles it internally, no new dep needed |
| Wrapping all IPC calls could mask new bugs | `safeIpc` logs to console.error AND surfaces to user — nothing hidden |
| Mermaid DOM changes could break rendering | Test with complex diagrams (flowcharts, sequence, class) |

---

## 9. Out of Scope

- Full `Result<T, E>` IPC typing (Approach C — save for future arch pass)
- Retry/reconnect logic (unnecessary for local Electron IPC)
- Comprehensive React error boundaries at every level (overkill for current component tree size)
- Full removal of `any` types from IPC bridge (worthwhile but separate task)
- Accessibility fixes (important but separate audit)
