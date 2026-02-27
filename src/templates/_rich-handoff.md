## Context Handoff Required

The context window is approaching capacity. Before this session ends, produce a **Rich Handoff Document** so the next agent can continue without re-exploring the codebase.

Structure your handoff as follows:

### RICH_HANDOFF

#### Pipeline State
- **Completed stages:** List each completed stage and its key outcome (1-2 sentences each)
- **Next stage:** {{next_stage}}
- **User feedback received:** Summarize any rejections or feedback from the user

#### Codebase Knowledge Map
- **Project structure:** List the key directories and their purposes
- **Key files explored:** For each file you read, provide: path, purpose, approximate size, key functions/exports
- **Architecture patterns:** Describe the patterns you identified (frameworks, communication patterns, data flow)
- **Dependencies:** List key dependencies relevant to this task

#### Working State
- **What was accomplished:** Concrete outputs produced so far
- **What comes next:** Specific actions the next stage needs to take
- **Files modified:** List all files changed in the worktree with brief descriptions of changes
- **Open questions:** Anything unresolved that needs attention
- **Gotchas/warnings:** Problems or non-obvious constraints discovered

Keep each section concise but complete. The goal is ~2,000-5,000 tokens total — enough to skip codebase exploration, not a full context dump.
