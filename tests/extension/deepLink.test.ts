import { describe, it, expect } from 'vitest'
import {
  stripSearchParam,
  isDeepLinkFresh,
  pickFallbackReview,
  type ReviewLike,
} from '../../extension/src/deepLink'

const r = (id: string, document_id: string, status = 'assigned'): ReviewLike => ({ id, document_id, status })

describe('stripSearchParam', () => {
  it('extracts oer_review_id and removes only it', () => {
    const out = stripSearchParam('/course/x', '?oer_review_id=abc&keep=1', '#h', 'oer_review_id')
    expect(out.value).toBe('abc')
    expect(out.cleanUrl).toBe('/course/x?keep=1#h')
  })
  it('drops the "?" when no params remain', () => {
    expect(stripSearchParam('/p', '?oer_review_id=abc', '', 'oer_review_id').cleanUrl).toBe('/p')
  })
  it('returns null and leaves the URL alone when absent', () => {
    const out = stripSearchParam('/p', '?a=1', '', 'oer_review_id')
    expect(out.value).toBeNull()
    expect(out.cleanUrl).toBe('/p?a=1')
  })
})

describe('isDeepLinkFresh', () => {
  it('accepts within TTL, rejects expired / missing / untimestamped', () => {
    expect(isDeepLinkFresh({ ts: 1000 }, 1500, 1000)).toBe(true)
    expect(isDeepLinkFresh({ ts: 1000 }, 2001, 1000)).toBe(false)
    expect(isDeepLinkFresh(null, 1, 1000)).toBe(false)
    expect(isDeepLinkFresh({}, 1, 1000)).toBe(false)
  })
})

describe('pickFallbackReview', () => {
  const a1 = r('a1', 'docA'), a2 = r('a2', 'docA', 'in_progress'), b1 = r('b1', 'docB')
  const all = [a1, a2, b1]
  it('keeps the saved rubric when it belongs to the page document', () => {
    expect(pickFallbackReview(all, a2, a1)).toBe(a2)
  })
  it('ignores a saved rubric from a different document (stale session)', () => {
    expect(pickFallbackReview(all, b1, a1)).toBe(a1)
  })
  it('without page match restores the session', () => {
    expect(pickFallbackReview(all, b1, null)).toBe(b1)
  })
  it('without page match or session prefers in_progress, then first', () => {
    expect(pickFallbackReview(all, undefined, null)).toBe(a2)
    expect(pickFallbackReview([a1, b1], undefined, null)).toBe(a1)
  })
})
