# tests

Vitest tests for feature and fix changes, created by the `/feature` skill.

- Run all: `npm test`
- Run one file: `npx vitest run tests/<slug>/<name>.test.ts`
- Layout: one folder per change, matching the plan in `feature logs/<slug>/plan.md` (e.g. `tests/<slug>/*.test.ts`).
- Environment is Node (see `vitest.config.ts`); there is no component/DOM layer. Test pure logic, helpers, and route handlers. Use the `@` alias for repo-root imports.
