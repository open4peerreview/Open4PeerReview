# Plan: Torus extension opens the wrong review

Branch: `fix/torus-extension-wrong-review`

## Symptom
Launching a review from the platform ("Open in Torus" on a reviewer card or the
console's Torus viewer) sometimes opens the extension on a different review/rubric
than the one the reviewer clicked.

## How the handoff works today
1. `lib/torus.ts#openInTorus` opens the Torus URL with `?oer_review_id=<id>&oer_token=…&oer_goto=…`.
2. `extension/src/background.ts` (`webNavigation.onBeforeNavigate`) copies `oer_review_id`/`oer_goto`
   into one **global** storage key (`oer_pending_review`) so it survives Torus login redirects.
3. `extension/src/content.ts#init` strips `oer_token` and `oer_goto` from the URL, recovers the
   stored deep link, then `routeToReview()` picks the review.

The platform side (`ReviewerCard`, `TorusAnnotationViewer`) passes the correct review id; the bugs are in the extension.

## Problem points
1. **`oer_review_id` is never stripped from the URL** (`content.ts` init removes only `oer_token` and `oer_goto`).
   `routeToReview()` treats a URL param as authoritative *every* time it runs, so:
   - a reviewer who switches rubric tabs and then reloads / hits the access watcher / follows a Torus
     redirect that keeps the query string is snapped back to the originally linked review;
   - a copied, bookmarked or history URL carrying an old id re-hijacks the session.
2. **`deepLinkReviewId` is never cleared** after use. It stays set for the lifetime of the content script,
   so it keeps overriding the reviewer's explicit tab choice (same effect as #1) on any later `routeToReview()`.
3. **Pending deep link is global, not per tab** (`oer_pending_review`). It is consumed by whichever Torus
   content script loads first within the 5-minute TTL. Opening a review in one tab and a Torus page in
   another (or two launches in quick succession) can deliver review A's id to tab B, or let a later
   launch overwrite an earlier tab's pending link before that tab consumed it.

## Fix
1. Background stores the pending link **per tab** (`oer_pending_review:<tabId>`), removes it on tab close,
   and exposes a `CONSUME_DEEP_LINK` message that reads+clears the key for `sender.tab.id` only.
2. Content script `init` reads `oer_review_id` once, stores it in `deepLinkReviewId`, and strips it from the URL
   (same as `oer_goto`). `recoverDeepLinkFromStorage` uses `CONSUME_DEEP_LINK` (tab-scoped, TTL still enforced).
3. `routeToReview` uses only `deepLinkReviewId` (no live URL read) and clears it once the review is actually
   opened (kept while parked on the Torus login/enroll screen so reconnect still lands on the right review).
   After that, `sessionStorage` (updated on every `selectReview`) is the source of truth for the tab.

## Out of scope
Page-match tie-breaking (`resolveAssignmentForCurrentPage`) only applies without a deep link/session; unchanged.

## Verification
- `npm run build:ext:dev` compiles.
- Manual: (a) launch review B of a multi-rubric doc → opens B; (b) switch to tab A, reload → stays A;
  (c) launch in tab 1, open Torus manually in tab 2 → tab 2 stays dormant; (d) login-redirect flow → lands on B.
