# Verification — Extended Guide

## Verification Checklist

1. Build passes (`npm run build` / `tsc --noEmit`)
2. All tests pass (full suite, not just new tests)
3. No new lint warnings
4. Each plan task has corresponding implementation
5. Each plan task has corresponding test
6. No hardcoded values that should be configurable
7. Error paths tested
8. Edge cases covered

## What to Look For

- Files mentioned in plan but not modified
- Tests that pass trivially (always true)
- Commented-out code
- TODO/FIXME comments without tracking
- Console.log statements left in production code
