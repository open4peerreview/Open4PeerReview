---
name: feature
description: Plan, implement, and open a PR for a feature or bug fix. Creates a feature/ or fix/ branch, writes plan.md, waits for approval, builds the change, then opens a PR.
argument-hint: [description of the feature or fix]
disable-model-invocation: true
allowed-tools: Bash(git *) Bash(gh *) Bash(npm run lint) Bash(npm run build) Bash(npm test) Read Grep Glob Write Edit
---

# /feature

Implement this request end to end: **$ARGUMENTS**

If `$ARGUMENTS` is empty, ask the user what feature or fix they want and stop until they answer.

Follow the steps in order. Do not skip the approval gate in step 4.

## 1. Preflight

- Run `git status --short` and `git branch --show-current`.
- If there are uncommitted changes unrelated to this request, tell the user and ask whether to stash them, carry them along, or abort. Never discard them.
- Run `gh auth status`. If `gh` is not authenticated, tell the user now (they can run `! gh auth login`) rather than discovering it at step 8.

## 2. Create the branch

- Decide the prefix: `fix/` if the request is a bug fix or regression, otherwise `feature/`.
- Build a short kebab-case slug (3–5 words, lowercase, no punctuation) from the description, e.g. `feature/reviewer-dashboard-filters` or `fix/rubric-accordion-state`.
- Branch from an up-to-date `main`:
  `git fetch origin && git switch -c <branch> origin/main`
  (If the user is intentionally on another base such as `testing`, ask before switching bases.)
- If the branch name already exists, append `-2` rather than reusing it.

## 3. Investigate and write `plan.md`

Do a read-only investigation first (Grep/Glob/Read). Read `CLAUDE.md` conventions as needed: design tokens come from `app/globals.css` (never hardcode colors, spacing, or fonts), `cx()` is defined locally per component, the extension in `extension/` is a separate build, and Next.js 16 uses `proxy.ts` instead of `middleware.ts`.

Write the plan to `feature logs/<slug>/plan.md` (create the `feature logs/` folder if it doesn't exist; `<slug>` is the branch name without its `feature/` or `fix/` prefix). The folder name contains a space, so quote the path in shell commands. Use these sections:

```markdown
# Plan: <short title>

**Branch:** `<branch name>`
**Type:** feature | fix

## Summary
What is being changed and why, in 2–4 sentences.

## Proposed changes
- Bulleted list of concrete changes, grouped by area.

## Likely locations
| File / directory | Change |
|---|---|
| `path/to/file.tsx` | What happens here |

## Out of scope
Anything related that this change deliberately does not touch.

## Risks & open questions
Schema changes, token changes (`globals.css` and `lib/design-system/token-values.ts` must stay in sync), auth/RLS impact, extension rebuilds, anything uncertain.

## Tests
The test files to add under `tests/<slug>/` and what each covers (cases, edge cases, error paths). If part of the change can't be unit tested (e.g. pure UI), say which part and why, and what is tested instead.

## Verification
How this will be checked: `npm run lint`, `npm run build`, `npm test`, plus manual steps.
```

Keep it specific to this repo: use real paths you found, not guesses. If you could not confirm a location, say so.

The plan is a permanent log of the change: it is committed and pushed with the feature (see step 7), so keep it accurate. Update it if the plan changes during approval or implementation.

## 4. Approval gate (required)

Show the user a brief summary of the plan (not the whole file; point them to `plan.md`) and ask for approval using AskUserQuestion with these options:

- **Approve** — proceed with implementation
- **Revise** — user will describe changes; update `plan.md` and ask again
- **Cancel** — stop

Do not modify any file other than the plan until the user chooses Approve. If the plan involves a Supabase schema change, call that out explicitly in the question, since CLAUDE.md says backend changes should be coordinated before building frontend around them.

On Cancel, stop and offer to delete the branch and the plan file; do not delete without confirmation.

## 5. Implement

- Follow the approved plan. If you discover the plan needs a materially different approach, pause and ask rather than silently diverging.
- Follow the repo conventions in `CLAUDE.md` (semantic tokens only, PascalCase component files, camelCase utilities, components handle relevant states).
- Make small, logically grouped commits as you go (see step 7 for message format).

### Tests (required for every change)

Write tests for every feature or fix in `tests/<slug>/*.test.ts` (Vitest, Node environment; `tests/` is included in `vitest.config.ts`). Guidance:

- Cover the new or changed behavior, plus edge cases and error paths. For a bug fix, include a regression test that fails without the fix.
- There is no component/DOM test layer. When the change is UI-heavy, move the logic into a pure function or helper (in `lib/` or alongside the component) and test that; don't add new test infrastructure unless the plan approved it.
- Import via the `@` alias. Mock Supabase and network calls; never hit the real database or external services.
- If something truly can't be tested, say so in the plan's Tests section and the PR instead of skipping silently.

## 6. Verify

Run what applies to the files changed, and fix failures before continuing:

- `npm run lint`
- `npm run build` (this is also the typecheck)
- `npm test` (always; the new tests must pass along with the existing suite)
- `npm run build:ext` if `extension/` was touched

If a check fails and you cannot fix it, or you skip one, say so in the PR body. Never report a check as passing if it was not run.

## 7. Commit

- Stage files explicitly by path. Never `git add -A`, and never stage `.env*` or build output.
- Commit the new tests under `tests/<slug>/` with the code they cover.
- Commit `feature logs/<slug>/plan.md` along with the code, after updating it to reflect what was actually built (corrected paths, dropped or added items, resolved questions). It must be part of the pushed branch and the PR.
- Commit messages start with a verb and name the area, e.g. `Add status filter to reviewer dashboard`.
- End every commit message with:
  `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`

## 8. Push and open the PR

- `git push -u origin <branch>`
- Open the PR against `main` with `gh pr create`, passing the body via a heredoc. The body must **mirror `plan.md`**: reuse its sections in the same order and wording (Summary, Proposed changes, Likely locations, Out of scope, Risks & open questions, Tests, Verification), omitting only the `# Plan:` title and the Branch/Type header lines. Before writing the body, re-read `plan.md` and update any section to reflect what was actually built, so the description matches the final code (e.g. corrected file paths, dropped or added items).

```markdown
## Summary
<from plan.md>

## Proposed changes
<from plan.md, updated to what was actually done>

## Likely locations
<table from plan.md, corrected to the files actually changed>

## Out of scope
<from plan.md>

## Risks & open questions
<from plan.md, with resolved items marked resolved>

## Tests
<from plan.md, listing the test files actually added>

## Verification
- [x] `npm run lint`
- [x] `npm run build`
- [x] `npm test`
- [ ] <anything not run, with the reason>

## Deviations from plan
<only if the implementation differed from the approved plan; otherwise "None">

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

- Title: imperative and under 70 characters, matching the commit style.
- Do not use `--force`, and do not merge the PR.

## 9. Report

Tell the user the branch name, the PR URL, what was verified, and anything deviating from the plan. Mention the path of the committed plan log.
