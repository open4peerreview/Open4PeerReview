# Plan: Stop H5P embeds rendering as blank boxes in OpenStax/Pressbooks snapshots

**Branch:** `fix/h5p-blank-embeds`
**Type:** fix

## Summary
OpenStax and Pressbooks submissions are shown in the reviewer console as an HTML snapshot inside a sandboxed iframe. H5P interactives in those pages render as an empty box. Likely causes (inferred from the code; not yet reproduced against a live book):
1. `rewriteHtml()` in `app/api/snapshot/[fingerprint]/route.ts` strips every `<script>`. Pressbooks H5P markup is often `<iframe src="about:blank" class="h5p-iframe" data-content-id="N">` which H5P's own JS fills in, so the iframe stays blank.
2. Even where the iframe has a real `src`, the outer viewer iframe in `app/review/components/HtmlViewerCanvas.tsx` uses `sandbox="allow-same-origin allow-popups"` (no `allow-scripts`). Sandbox flags are inherited by nested frames, so the H5P player (which needs JS) can't run.

We can't simply add `allow-scripts`: the snapshot is served from our own origin and the viewer needs `allow-same-origin` to read `contentDocument` for annotations, so scripts + same-origin would let snapshot content escape the sandbox.

## Proposed changes
- Move `rewriteHtml` out of the route into a pure, testable module `lib/snapshot-rewrite.ts` (behavior unchanged for existing rules).
- Add H5P handling to the rewrite step: detect H5P iframes (`src` containing `h5p`, `action=h5p_embed`, class `h5p-iframe`, or `data-content-id`) and replace each with a labeled placeholder card ("Interactive H5P content") containing an "Open interactive in a new tab" link.
  - Link target: the iframe's absolute `src` if present; otherwise, for `about:blank` + `data-content-id`, the standard H5P WordPress embed URL `<origin>/wp-admin/admin-ajax.php?action=h5p_embed&id=<id>`; otherwise the page's own source URL.
  - Placeholder is styled with inline styles using values mirrored from `lib/design-system/token-values.ts` (snapshot docs can't read our CSS variables).
- Add `allow-popups-to-escape-sandbox` to the viewer iframe's sandbox so the opened tab runs normally instead of inheriting the sandbox.
- Placeholders are plain DOM, so text annotations around them keep anchoring as before.

## Likely locations
| File / directory | Change |
|---|---|
| `lib/snapshot-rewrite.ts` (new) | `rewriteHtml` + H5P placeholder logic |
| `app/api/snapshot/[fingerprint]/route.ts` | import `rewriteHtml` from the new module; pass `src` through for fallback link |
| `app/review/components/HtmlViewerCanvas.tsx` | add `allow-popups-to-escape-sandbox` to the iframe `sandbox` (~line 665) |
| `tests/h5p-blank-embeds/*.test.ts` (new) | tests below |

## Out of scope
- Actually running H5P inline in the console (needs serving snapshots from a separate origin; larger architecture change).
- Torus/extension flow, PDF viewer, other embeds (YouTube, Desmos) which already work or are separate issues.
- Re-snapshotting existing documents: rewriting happens at serve time, so existing snapshots are fixed automatically.

## Risks & open questions
- **Decision needed:** placeholder + open-in-new-tab (recommended, safe) vs. attempting inline playback (requires weakening the sandbox or a separate snapshot origin).
- Root cause is inferred from code; I haven't confirmed against a live OpenStax/Pressbooks H5P page. The derived `h5p_embed` URL is the standard H5P WordPress pattern but may not match every host.
- Reviewers can't interact with H5P inside the console; they must open the new tab to review it (annotations on the interactive itself aren't possible).
- No schema, token, auth/RLS, or extension changes.

## Tests
`tests/h5p-blank-embeds/snapshot-rewrite.test.ts` (Node, pure function):
- Pressbooks `about:blank` + `data-content-id` iframe → placeholder with derived `h5p_embed` link, no `<iframe>` left.
- H5P iframe with real absolute `src` → link uses that src; relative `src` resolved against origin.
- `h5p.org`/`h5p.com` embed URLs detected.
- Non-H5P iframes (e.g. YouTube) are left untouched.
- Existing behavior regression: scripts stripped, `<base>` and nav-disable `<style>` injected, with and without `<head>`.
- Edge cases: multiple H5P iframes; attribute order/quoting variations; malicious `src` (`javascript:`) is not emitted as an href (falls back to source URL); HTML-escaping of title/src in the placeholder.
Not unit-testable: the sandbox attribute change in `HtmlViewerCanvas.tsx` (no DOM layer); covered by manual check.

## Verification
`npm run lint`, `npm run typecheck`, `npm test`, `npm run build`. Manual: submit a Pressbooks chapter containing H5P, open it in the reviewer console, confirm the placeholder shows and its link opens the interactive in a normal tab.
