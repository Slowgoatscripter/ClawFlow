# Writing Plans — Core Rules

1. **Each task is one action** (2-5 minutes of work).
2. **Exact file paths always.** Never say "the config file" — say `src/config/settings.ts`.
3. **Include complete code** in the plan. Never write "add validation" — write the actual code.
4. **Specify test commands** with expected output for each verification step.
5. **TDD sequence:** Write failing test → verify it fails → implement → verify it passes → commit.
6. **One commit per logical unit.** Don't batch unrelated changes.
7. **Reference domain knowledge** when it informs task design.
