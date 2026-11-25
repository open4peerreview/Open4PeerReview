// Pure helpers for deep-link routing, kept free of chrome/DOM globals so they can
// be unit-tested (see tests/extension/).

export interface ReviewLike {
  id: string;
  document_id: string;
  status: string;
}

export interface PendingDeepLink {
  reviewId?: string | null;
  annotationId?: string | null;
  ts?: number;
}

// Returns `url` search+hash rebuilt without `name` (pathname-relative), plus the
// removed value. Used to capture one-shot params like oer_review_id and strip them.
export function stripSearchParam(
  pathname: string,
  search: string,
  hash: string,
  name: string,
): { value: string | null; cleanUrl: string } {
  const params = new URLSearchParams(search);
  const value = params.get(name);
  params.delete(name);
  const qs = params.toString();
  return { value, cleanUrl: pathname + (qs ? '?' + qs : '') + hash };
}

export function isDeepLinkFresh(pending: PendingDeepLink | null | undefined, now: number, ttlMs: number): boolean {
  return !!pending && typeof pending.ts === 'number' && now - pending.ts <= ttlMs;
}

// Selection when no explicit deep link resolved to a review.
export function pickFallbackReview<T extends ReviewLike>(
  assignments: T[],
  saved: T | undefined,
  pageMatch: T | null,
): T | undefined {
  if (pageMatch) return saved && saved.document_id === pageMatch.document_id ? saved : pageMatch;
  return saved ?? assignments.find(a => a.status === 'in_progress') ?? assignments[0];
}
