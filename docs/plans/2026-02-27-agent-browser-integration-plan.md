# Agent-Browser Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `agent-browser` CLI instructions to all 9 agent templates so sub-agents and the workshop agent can browse the web, take screenshots, test UI interactions, and audit accessibility.

**Architecture:** Template-only integration. Each template gets a `## Browser Automation` section with stage-appropriate commands, usage guidance, and safety guardrails. Zero code changes — agents call `agent-browser` via existing Bash tool.

**Tech Stack:** `agent-browser` (globally installed CLI), Markdown templates

**Design Doc:** `docs/plans/2026-02-27-agent-browser-integration-design.md`

---

### Task 1: Add Browser Automation to workshop-agent.md

**Files:**
- Modify: `src/templates/workshop-agent.md` (insert before `## Guidelines` section)

**Step 1: Add the Browser Automation section**

Insert the following before the `## Guidelines` section:

```markdown
## Browser Automation

You have access to `agent-browser`, a headless browser CLI installed on this system. Run commands via Bash to browse the web, take screenshots, and research references.

### Key Commands
- `agent-browser open <url>` — Navigate to a URL
- `agent-browser snapshot` — Get accessibility tree of current page (useful for understanding page structure)
- `agent-browser screenshot --path <file>` — Capture page screenshot to file

### When to Use
- **THINK phase:** Browse documentation, check competitor UIs, research design patterns before creating artifacts
- **EXECUTE phase:** Include browser-based verification criteria in work orders (e.g., "Screenshot the page and verify layout matches design")
- Reference API docs to validate feasibility before suggesting tasks

### Work Order Browser Tests
When creating work orders with `suggest_tasks`, you can include browser verification in the `tests` field:
```
"tests": [
  "Use agent-browser to screenshot the page and verify it matches the design",
  "Use agent-browser snapshot to verify form inputs have proper ARIA labels",
  "Navigate the user flow end-to-end with agent-browser"
]
```

### Rules
- ALWAYS close the browser when done: `agent-browser close`
- One browser session at a time
- Don't browse sites requiring authentication unless the task involves it
- Don't submit forms on production sites
- If a page doesn't load in 10 seconds, move on
- Use `snapshot` sparingly — output can be verbose
```

**Step 2: Verify the template is valid**

Run: `cat -n src/templates/workshop-agent.md | head -5`
Expected: File starts with `# Workshop — Creative Collaboration Session`

**Step 3: Commit**

```bash
git add src/templates/workshop-agent.md
git commit -m "feat: add browser automation instructions to workshop agent template"
```

---

### Task 2: Add Browser Automation to brainstorm-agent.md

**Files:**
- Modify: `src/templates/brainstorm-agent.md` (insert before `## Output` section)

**Step 1: Add the Browser Automation section**

Insert before `## Output`:

```markdown
## Browser Automation

You have access to `agent-browser`, a headless browser CLI. Run commands via Bash.

### Key Commands
- `agent-browser open <url>` — Navigate to a URL
- `agent-browser snapshot` — Get accessibility tree of current page

### When to Use
- Look up design patterns, prior art, or API documentation to inform your brainstorming
- Research how similar products solve the problem you're exploring

### When NOT to Use
- Don't browse for information you already have in context or from domain knowledge
- Don't use for implementation details — focus on design-level research

### Rules
- ALWAYS close the browser when done: `agent-browser close`
- One browser session at a time
- If a page doesn't load in 10 seconds, move on
- Use `snapshot` sparingly — output can be verbose
```

**Step 2: Commit**

```bash
git add src/templates/brainstorm-agent.md
git commit -m "feat: add browser automation instructions to brainstorm agent template"
```

---

### Task 3: Add Browser Automation to plan-agent.md

**Files:**
- Modify: `src/templates/plan-agent.md` (insert before `## Output` section)

**Step 1: Add the Browser Automation section**

Insert before `## Output`:

```markdown
## Browser Automation

You have access to `agent-browser`, a headless browser CLI. Run commands via Bash.

### Key Commands
- `agent-browser open <url>` — Navigate to a URL
- `agent-browser snapshot` — Get accessibility tree of current page

### When to Use
- Check API documentation to validate implementation feasibility
- Browse library/framework docs to verify assumptions in the plan
- Look up compatibility information for dependencies

### When NOT to Use
- Don't browse for information already provided in the brainstorm context
- Focus on feasibility checks, not general research (that's the brainstormer's job)

### Rules
- ALWAYS close the browser when done: `agent-browser close`
- One browser session at a time
- If a page doesn't load in 10 seconds, move on
- Use `snapshot` sparingly — output can be verbose
```

**Step 2: Commit**

```bash
git add src/templates/plan-agent.md
git commit -m "feat: add browser automation instructions to plan agent template"
```

---

### Task 4: Add Browser Automation to design-review-agent.md

**Files:**
- Modify: `src/templates/design-review-agent.md` (insert before `## Instructions` section)

**Step 1: Add the Browser Automation section**

Insert before `## Instructions`:

```markdown
## Browser Automation

You have access to `agent-browser`, a headless browser CLI. Run commands via Bash.

### Key Commands
- `agent-browser open <url>` — Navigate to a URL
- `agent-browser snapshot` — Get accessibility tree of current page
- `agent-browser screenshot --path <file>` — Capture page screenshot

### When to Use
- Research industry patterns and standards to evaluate the design against
- Check how established products implement similar features
- Verify design claims about third-party APIs or libraries

### When NOT to Use
- Don't browse to find implementation details — you're reviewing the design, not planning the build
- Don't use if the design document provides sufficient context

### Rules
- ALWAYS close the browser when done: `agent-browser close`
- One browser session at a time
- If a page doesn't load in 10 seconds, move on
- Use `snapshot` sparingly — output can be verbose
```

**Step 2: Commit**

```bash
git add src/templates/design-review-agent.md
git commit -m "feat: add browser automation instructions to design review agent template"
```

---

### Task 5: Add Browser Automation to implement-agent.md

**Files:**
- Modify: `src/templates/implement-agent.md` (insert before `## Rules` section)

**Step 1: Add the Browser Automation section**

Insert before `## Rules`:

```markdown
## Browser Automation

You have access to `agent-browser`, a headless browser CLI. Run commands via Bash.

### Key Commands
- `agent-browser open <url>` — Navigate to a URL
- `agent-browser snapshot` — Get accessibility tree of current page

### When to Use
- Look up framework or library documentation while implementing
- Check MDN or API references for correct usage of web APIs
- Verify third-party API response formats

### When NOT to Use
- Don't browse for general research — your plan already covers the design
- Don't use to verify your own UI work — that's the verifier's job
- Don't browse if the information is already in your context

### Rules
- ALWAYS close the browser when done: `agent-browser close`
- One browser session at a time
- If a page doesn't load in 10 seconds, move on
- Use `snapshot` sparingly — output can be verbose
```

**Step 2: Commit**

```bash
git add src/templates/implement-agent.md
git commit -m "feat: add browser automation instructions to implement agent template"
```

---

### Task 6: Add Browser Automation to grouped-implement-agent.md

**Files:**
- Modify: `src/templates/grouped-implement-agent.md` (insert before `## Rules` section)

**Step 1: Add the Browser Automation section**

Insert before `## Rules`:

```markdown
## Browser Automation

You have access to `agent-browser`, a headless browser CLI. Run commands via Bash.

### Key Commands
- `agent-browser open <url>` — Navigate to a URL
- `agent-browser snapshot` — Get accessibility tree of current page

### When to Use
- Look up framework or library documentation while implementing
- Check MDN or API references for correct usage of web APIs
- Verify third-party API response formats

### When NOT to Use
- Don't browse for general research — your work order already covers the design
- Don't use to verify your own UI work — that's the verifier's job
- Don't browse if the information is already in your context

### Rules
- ALWAYS close the browser when done: `agent-browser close`
- One browser session at a time
- If a page doesn't load in 10 seconds, move on
- Use `snapshot` sparingly — output can be verbose
```

**Step 2: Commit**

```bash
git add src/templates/grouped-implement-agent.md
git commit -m "feat: add browser automation instructions to grouped implement agent template"
```

---

### Task 7: Add Browser Automation to code-review-agent.md

**Files:**
- Modify: `src/templates/code-review-agent.md` (insert before `## Scoring` section)

**Step 1: Add the Browser Automation section**

Insert before `## Scoring`:

```markdown
## Browser Automation

You have access to `agent-browser`, a headless browser CLI. Run commands via Bash.

### Key Commands
- `agent-browser open <url>` — Navigate to a URL
- `agent-browser snapshot` — Get accessibility tree (use for a11y review)
- `agent-browser screenshot --path <file>` — Capture page screenshot
- `agent-browser click @<ref>` — Click element by accessibility ref
- `agent-browser type @<ref> "text"` — Type into input field

### When to Use
- If the task involves UI changes, open the running app and verify the UI matches the design intent
- Use `snapshot` to audit accessibility — check ARIA roles, labels, form structure
- Click through interactive elements to verify they respond correctly
- Screenshot the result for your review notes

### When NOT to Use
- Don't browse for backend-only changes with no UI component
- Don't use if the app isn't running locally

### Rules
- ALWAYS close the browser when done: `agent-browser close`
- One browser session at a time
- Don't submit forms on production sites
- If a page doesn't load in 10 seconds, move on
- Use `snapshot` sparingly — output can be verbose
```

**Step 2: Commit**

```bash
git add src/templates/code-review-agent.md
git commit -m "feat: add browser automation instructions to code review agent template"
```

---

### Task 8: Add Browser Automation to verify-agent.md (Full Command Set)

**Files:**
- Modify: `src/templates/verify-agent.md` (insert before `## Verification Checklist` section)

**Step 1: Add the Browser Automation section**

Insert before `## Verification Checklist`:

```markdown
## Browser Automation

You have access to `agent-browser`, a headless browser CLI. Run commands via Bash. You have the FULL command set for comprehensive UI testing.

### Key Commands
- `agent-browser open <url>` — Navigate to a URL
- `agent-browser snapshot` — Get accessibility tree (use for a11y audits)
- `agent-browser screenshot --path <file>` — Capture page screenshot
- `agent-browser click @<ref>` — Click element by accessibility ref
- `agent-browser type @<ref> "text"` — Type into input field
- `agent-browser scroll down 500` — Scroll the page
- `agent-browser execute "document.title"` — Run JavaScript on the page
- `agent-browser close` — Close the browser

### Workflow
1. Open the running app: `agent-browser open http://localhost:<port>`
2. Take a screenshot to capture initial state
3. Use `snapshot` to get the accessibility tree — verify ARIA roles, labels, structure
4. Walk through user flows: click buttons, fill forms, navigate between pages
5. Screenshot key states for verification evidence
6. Close the browser when done

### When to Use
- **Always** for tasks with UI changes — screenshot and verify visual correctness
- Run through user flows (click, type, navigate) to validate interactive behavior
- Use `snapshot` to audit accessibility compliance
- Compare current state against design artifacts or requirements
- Run JavaScript to check DOM state, computed styles, or runtime values

### When NOT to Use
- Don't use for pure backend changes with no UI component
- Don't use if unit/integration tests fully cover the verification criteria
- Don't use if the app isn't running locally

### Rules
- ALWAYS close the browser when done: `agent-browser close`
- One browser session at a time
- Don't submit forms on production sites
- Don't browse sites requiring authentication unless the task involves it
- If a page doesn't load in 10 seconds, move on
- Use `snapshot` sparingly — output can be verbose
```

**Step 2: Update the Verification Checklist**

Add a browser verification step to the existing checklist. Find:

```markdown
## Verification Checklist

1. Run the test suite — report pass/fail counts
2. Run the linter — report error count
3. Run the build — report success/failure
4. Verify the feature works as described
5. Check for regressions
```

Replace with:

```markdown
## Verification Checklist

1. Run the test suite — report pass/fail counts
2. Run the linter — report error count
3. Run the build — report success/failure
4. Verify the feature works as described
5. If the task has UI changes, use browser automation to screenshot and test interactions
6. Check for regressions
```

**Step 3: Commit**

```bash
git add src/templates/verify-agent.md
git commit -m "feat: add full browser automation instructions to verify agent template"
```

---

### Task 9: Add Browser Automation to completion-agent.md

**Files:**
- Modify: `src/templates/completion-agent.md` (insert before `## Instructions` section)

**Step 1: Add the Browser Automation section**

Insert before `## Instructions`:

```markdown
## Browser Automation

You have access to `agent-browser`, a headless browser CLI. Run commands via Bash.

### Key Commands
- `agent-browser open <url>` — Navigate to a URL
- `agent-browser screenshot --path <file>` — Capture final screenshot
- `agent-browser snapshot` — Get accessibility tree for final a11y check

### When to Use
- If the task involved UI changes, take a final screenshot as visual confirmation of the delivered work
- Quick accessibility spot-check with `snapshot` if relevant

### When NOT to Use
- Don't do full testing — that's the verifier's job, already done
- Don't use for backend-only tasks

### Rules
- ALWAYS close the browser when done: `agent-browser close`
- One browser session at a time
- If a page doesn't load in 10 seconds, move on
```

**Step 2: Commit**

```bash
git add src/templates/completion-agent.md
git commit -m "feat: add browser automation instructions to completion agent template"
```

---

### Task 10: Final verification

**Step 1: Verify all templates have the Browser Automation section**

Run: `grep -l "Browser Automation" src/templates/*.md`
Expected: All 9 template files listed:
```
src/templates/brainstorm-agent.md
src/templates/code-review-agent.md
src/templates/completion-agent.md
src/templates/design-review-agent.md
src/templates/grouped-implement-agent.md
src/templates/implement-agent.md
src/templates/plan-agent.md
src/templates/verify-agent.md
src/templates/workshop-agent.md
```

**Step 2: Verify no template has broken placeholder syntax**

Run: `grep -c "{{" src/templates/*.md`
Expected: Each file still has its expected placeholder count (no accidental overwrites).

**Step 3: Verify the "close" rule is in every template**

Run: `grep -l "agent-browser close" src/templates/*.md`
Expected: All 9 files listed.

**Step 4: Run build to confirm templates are loadable**

Run: `npm run build`
Expected: Build succeeds with no errors.

**Step 5: Commit verification pass (if any fixes needed)**

If fixes were required:
```bash
git add src/templates/
git commit -m "fix: correct template issues found during verification"
```
