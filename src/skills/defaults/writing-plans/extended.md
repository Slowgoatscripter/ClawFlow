# Writing Plans — Extended Guide

## Task Structure Template

### Task N: [Component]
**Files:** Create/Modify/Test with exact paths
**Step 1:** Write failing test (include code)
**Step 2:** Run test, verify failure
**Step 3:** Implement (include code)
**Step 4:** Run test, verify pass
**Step 5:** Commit with descriptive message

## Dependency Ordering

- Data layer first (types, schemas, DB)
- Service layer second (business logic)
- Integration layer third (API, IPC)
- UI layer last (components, stores)

## Common Planning Mistakes

- Tasks too large (should be 2-5 minutes each)
- Missing file paths
- Pseudo-code instead of real code
- No verification steps
- Not considering existing patterns
