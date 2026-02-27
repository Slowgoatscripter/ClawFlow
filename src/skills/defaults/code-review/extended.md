# Code Review — Extended Guide

## Review Categories

### Critical (blocks approval)
- Logic errors
- Security vulnerabilities
- Missing error handling for user-facing paths
- Breaking changes to public APIs

### Important (should fix)
- Missing tests for new code paths
- Performance issues
- Poor naming that obscures intent

### Minor (nice to have)
- Code style consistency
- Documentation gaps
- Refactoring opportunities

## Score Guide

- **5:** Clean, well-tested, follows patterns, no issues
- **4:** Minor issues that don't block, good overall
- **3:** Some important issues to address
- **2:** Major issues, needs significant rework
- **1:** Fundamentally wrong approach, reject
