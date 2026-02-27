# Design Review — Extended Guide

## Review Checklist

### Architecture
- Does the design follow existing patterns?
- Are there unnecessary abstractions?
- Is the data flow clear?

### Completeness
- Are all requirements addressed?
- Are error scenarios covered?
- Are edge cases identified?

### Security
- Input validation at boundaries?
- Authentication/authorization considered?
- Data sanitization?

### Performance
- Will this scale with expected data volume?
- Any N+1 query risks?
- Caching considerations?

## Verdict Criteria

- **Approved:** Ready to implement as-is
- **Approved with Changes:** Minor adjustments needed, can proceed
- **Needs Rework:** Fundamental issues, return to design phase
