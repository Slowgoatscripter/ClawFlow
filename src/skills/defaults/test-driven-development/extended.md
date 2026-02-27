# TDD — Extended Guide

## Test Naming Convention

Use descriptive names: `test_<action>_<condition>_<expected_result>`

## When to Write Integration vs Unit Tests

- Unit: isolated logic, pure functions, data transformations
- Integration: API endpoints, database operations, multi-component flows

## Common TDD Mistakes

- Writing tests that are too tightly coupled to implementation
- Testing private methods instead of public behavior
- Skipping edge cases (null, empty, boundary values)
- Not testing error paths

## Refactoring Phase Checklist

After green:
1. Extract duplicated code
2. Rename for clarity
3. Simplify conditionals
4. Run all tests again after each change
