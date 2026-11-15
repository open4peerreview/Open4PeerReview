// lib/anchoring/html.ts
// Pure utilities for char-offset anchoring in static HTML snapshots.
// No React — safe to import from both client and server.

// ── W3C selector types ────────────────────────────────────────────────────────

export interface TextPositionSelector {
  type: 'TextPositionSelector'
  start: number
  end: number
}

export interface TextQuoteSelector {
  type: 'TextQuoteSelector'
  /** The verbatim selected text. */
  exact: string
  /** Up to CONTEXT chars immediately before the selection. */
  prefix: string
  /** Up to CONTEXT chars immediately after the selection. */
  suffix: string
}

export type AnchorSelector = TextPositionSelector | TextQuoteSelector

// ── Anchor formats ────────────────────────────────────────────────────────────

/** Current format — written for all new annotations. */
export interface HtmlAnchor {
  type: 'html-char-offset'
  pageIndex: number
  selector: AnchorSelector[]
}

/** Legacy format — stored before the selector array was introduced. Read-only. */
export interface LegacyHtmlAnchor {
  type: 'html-char-offset'
  start: number
  end: number
  text: string
  pageIndex?: number
}

// ── Constants ─────────────────────────────────────────────────────────────────

const CONTEXT = 32

// ── Low-level DOM utilities ───────────────────────────────────────────────────

/**
 * Count characters from `root` up to `targetNode:targetOffset` by walking
 * all text nodes in document order. The snapshot is immutable under a given
 * fingerprint, so these offsets never go stale.
 */
export function getCharOffset(root: Node, targetNode: Node, targetOffset: number): number {
  let count = 0
  const walker = (root.ownerDocument ?? (root as Document)).createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
  )
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    if (node === targetNode) return count + targetOffset
    count += node.length
  }
  return count + targetOffset
}

/**
 * Resolve char offsets back to a DOM Range inside `root`.
 * Returns null if the offsets exceed the document's text length.
 */
export function resolveCharOffset(root: Node, start: number, end: number): Range | null {
  const doc = root.nodeType === Node.DOCUMENT_NODE
    ? (root as Document)
    : (root.ownerDocument as Document)

  const range = doc.createRange()
  let count = 0
  let startSet = false

  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    const nodeEnd = count + node.length

    if (!startSet && start <= nodeEnd) {
      range.setStart(node, Math.min(start - count, node.length))
      startSet = true
    }
    if (startSet && end <= nodeEnd) {
      range.setEnd(node, Math.min(end - count, node.length))
      return range
    }
    count = nodeEnd
  }
  return startSet ? range : null
}

// ── Anchor creation ───────────────────────────────────────────────────────────

/**
 * Convert the current selection inside an iframe window to an HtmlAnchor.
 * Returns null if nothing is selected or the selection is whitespace only.
 */
export function selectionToAnchor(win: Window): Omit<HtmlAnchor, 'pageIndex'> | null {
  const sel = win.getSelection()
  if (!sel || sel.isCollapsed || !sel.toString().trim()) return null

  const range = sel.getRangeAt(0)
  const body = win.document.body
  const fullText = body.textContent ?? ''

  const start = getCharOffset(body, range.startContainer, range.startOffset)
  const end   = getCharOffset(body, range.endContainer,   range.endOffset)
  if (start >= end) return null

  const exact  = fullText.slice(start, end)
  const prefix = fullText.slice(Math.max(0, start - CONTEXT), start)
  const suffix = fullText.slice(end, end + CONTEXT)

  return {
    type: 'html-char-offset',
    selector: [
      { type: 'TextPositionSelector', start, end },
      { type: 'TextQuoteSelector', exact, prefix, suffix },
    ],
  }
}

// ── Anchor resolution ─────────────────────────────────────────────────────────

/**
 * Resolve an anchor (new or legacy format) to a DOM Range within `body`.
 *
 * Phase 1 — position + quote verify: use stored char offsets; confirm the text
 *            at those offsets equals the stored exact string.
 * Phase 2 — quote search: search the full body text for the exact string.
 * Phase 3 — fuzzy near expected position (nearest occurrence to stored start).
 *
 * Returns null only when none of the phases can locate the text.
 */
export function resolveAnchor(body: Element, anchor: Record<string, unknown>): Range | null {
  const fullText = body.textContent ?? ''

  // ── Normalise selectors from both formats ───────────────────────────────────
  let position: TextPositionSelector | undefined
  let quote: TextQuoteSelector | undefined

  if (Array.isArray(anchor.selector)) {
    const selectors = anchor.selector as AnchorSelector[]
    position = selectors.find((s): s is TextPositionSelector => s.type === 'TextPositionSelector')
    quote    = selectors.find((s): s is TextQuoteSelector    => s.type === 'TextQuoteSelector')
  } else if (typeof anchor.start === 'number' && typeof anchor.end === 'number') {
    // Legacy format — no quote available, resolve by position only
    position = { type: 'TextPositionSelector', start: anchor.start as number, end: anchor.end as number }
  }

  if (!position && !quote) return null

  // ── Phase 1: position, verified by quote ────────────────────────────────────
  if (position && quote) {
    const candidate = fullText.slice(position.start, position.end)
    if (candidate === quote.exact) {
      return resolveCharOffset(body, position.start, position.end)
    }
  } else if (position && !quote) {
    // Legacy anchor — no quote to verify; trust the offsets directly
    return resolveCharOffset(body, position.start, position.end)
  }

  if (!quote) return null

  // ── Phase 2: exact text search ──────────────────────────────────────────────
  const idx = fullText.indexOf(quote.exact)
  if (idx !== -1) {
    return resolveCharOffset(body, idx, idx + quote.exact.length)
  }

  // ── Phase 3: nearest occurrence fuzzy search ────────────────────────────────
  // Find all occurrences and return the one closest to the stored position.
  if (quote.exact.length === 0) return null
  const expectedStart = position?.start ?? 0
  let bestIdx = -1
  let bestDist = Infinity
  let searchFrom = 0
  while (true) {
    const found = fullText.indexOf(quote.exact, searchFrom)
    if (found === -1) break
    const dist = Math.abs(found - expectedStart)
    if (dist < bestDist) { bestDist = dist; bestIdx = found }
    searchFrom = found + 1
  }
  if (bestIdx !== -1) {
    return resolveCharOffset(body, bestIdx, bestIdx + quote.exact.length)
  }

  return null
}

// ── Highlight injection ───────────────────────────────────────────────────────

const HIGHLIGHT_COLOR = 'rgba(254,214,91,0.45)'

/**
 * Wrap text nodes covered by `range` in <mark> elements with click/hover
 * handlers. Iterates text nodes so multi-line / multi-element selections work.
 */
function markRange(
  doc: Document,
  range: Range,
  annotationId: string,
  color: string,
  onClick:  (x: number, y: number) => void,
  onEnter:  (x: number, y: number) => void,
  onLeave:  () => void,
): void {
  const segments: [Text, number, number][] = []
  const ancestor = range.commonAncestorContainer

  if (ancestor.nodeType === Node.TEXT_NODE) {
    segments.push([ancestor as Text, range.startOffset, range.endOffset])
  } else {
    const walker = doc.createTreeWalker(ancestor, NodeFilter.SHOW_TEXT)
    let inRange = false
    while (walker.nextNode()) {
      const node = walker.currentNode as Text
      const isStart = node === range.startContainer
      const isEnd   = node === range.endContainer

      if (isStart) inRange = true
      if (!inRange) continue

      const s = isStart ? range.startOffset : 0
      const e = isEnd   ? range.endOffset   : node.length
      if (s < e) segments.push([node, s, e])
      if (isEnd) break
    }
  }

  for (const [textNode, s, e] of segments) {
    const r = doc.createRange()
    r.setStart(textNode, s)
    r.setEnd(textNode, e)

    const mark = doc.createElement('mark')
    mark.dataset.annotationId = annotationId
    mark.classList.add('annotation-highlight')
    mark.style.cssText =
      `background:${color};border-radius:2px;cursor:pointer;padding:0;`

    try {
      r.surroundContents(mark)
    } catch {
      // surroundContents fails when the range partially overlaps an element
      // boundary (rare in normal prose). Skip rather than corrupt the DOM.
      continue
    }

    mark.addEventListener('click',      (ev) => { ev.stopPropagation(); onClick((ev as MouseEvent).clientX, (ev as MouseEvent).clientY) })
    mark.addEventListener('mouseenter', (ev) => { onEnter((ev as MouseEvent).clientX, (ev as MouseEvent).clientY) })
    mark.addEventListener('mouseleave', onLeave)
  }
}

/** Remove old highlight wrappers while keeping live players and the document in place. */
export function clearHighlights(doc: Document): void {
  for (const mark of doc.querySelectorAll('mark.annotation-highlight[data-annotation-id]')) {
    const parent = mark.parentNode
    mark.replaceWith(...mark.childNodes)
    parent?.normalize()
  }
}

/**
 * Inject highlights for every annotation into the iframe document.
 * Accepts the full anchor object so `resolveAnchor` can use the
 * TextQuoteSelector as a fallback when char offsets have drifted.
 * Applied right-to-left so earlier offsets are not shifted by DOM mutations.
 */
export function applyHighlights(
  doc: Document,
  annotations: Array<{
    id:     string
    anchor: Record<string, unknown>
    tag:    string | null
    body:   string
  }>,
  onMarkClick: (id: string, x: number, y: number) => void,
  onMarkHover: (id: string | null, x: number, y: number) => void,
): void {
  // Sort descending by stored start offset so right-to-left application
  // keeps earlier ranges valid as the DOM is mutated.
  const getStart = (anchor: Record<string, unknown>): number => {
    if (Array.isArray(anchor.selector)) {
      const pos = (anchor.selector as AnchorSelector[]).find(
        (s): s is TextPositionSelector => s.type === 'TextPositionSelector'
      )
      if (pos) return pos.start
    }
    return typeof anchor.start === 'number' ? anchor.start : 0
  }

  const sorted = [...annotations].sort((a, b) => getStart(b.anchor) - getStart(a.anchor))

  for (const ann of sorted) {
    const range = resolveAnchor(doc.body, ann.anchor)
    if (!range) continue

    markRange(
      doc,
      range,
      ann.id,
      HIGHLIGHT_COLOR,
      (x, y) => onMarkClick(ann.id, x, y),
      (x, y) => onMarkHover(ann.id, x, y),
      ()     => onMarkHover(null, 0, 0),
    )
  }
}
