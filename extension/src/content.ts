import type {
  BackgroundMessage,
  BackgroundResponse,
  StoredAuth,
  ReviewAssignment,
  RubricItem,
  AnnotationRecord,
  ReviewScoreRecord,
  ScoreCommentRecord,
  CriterionScore,
  HighlightTag,
  HtmlCharOffsetAnchor,
  BboxAnchor,
  PointAnchor,
  AnchorSelector,
  RangeSelector,
} from './types';
import { tokens } from '../../lib/design-system/token-values';
import { stripSearchParam, isDeepLinkFresh, pickFallbackReview } from './deepLink';
import latoRegular from './fonts/Lato-Regular.woff2';
import latoBold from './fonts/Lato-Bold.woff2';
import newsreaderVariable from './fonts/Newsreader-Variable.woff2';

// ── Constants ─────────────────────────────────────────────────────────────────

const PANEL_WIDTH = 380;
const CONTEXT = 32;
const SCORE_DEBOUNCE_MS = 1500;
// Injected at build time via esbuild `define` — see extension/build.mjs.
// `npm run build:ext:dev` points this at localhost for local testing.
declare const __OERHUB_URL__: string;
const OERHUB_URL = __OERHUB_URL__;
// Overridden at runtime with the origin stored by dashboard.ts on the platform page.
// Falls back to the build-time constant if the user has never visited the platform.
let platformUrl = OERHUB_URL;


const SESSION_KEY = 'oer_review_id';
// How long a captured deep link stays valid — long enough to survive a Torus
// login/enroll round-trip, short enough that a later manual visit isn't hijacked.
const DEEP_LINK_TTL_MS = 5 * 60 * 1000;
const PANEL_GEOM_KEY = 'oer_panel_geom';
const EXPANDED_CRIT_KEY = 'oer_expanded_criteria';

// Torus's student login route. Adjust here if the OLI instance uses a different
// path (e.g. '/session/new'). Used to build the "Sign in to OLI Torus" redirect.
const TORUS_LOGIN_PATH = '/users/log_in';

// ── State ─────────────────────────────────────────────────────────────────────

let currentAuth: StoredAuth | null = null;
let assignments: ReviewAssignment[] = [];
let selectedReview: ReviewAssignment | null = null;
let rubricItems: RubricItem[] = [];
let annotations: AnnotationRecord[] = [];
let scores = new Map<string, ReviewScoreRecord>();

// Deep-link intent (?oer_review_id=) recovered from chrome.storage — the
// background captures it before any Torus login redirect can strip the URL params,
// so routeToReview can honor it even when window.location no longer carries it.
let deepLinkReviewId: string | null = null;

// Torus access gating: which review to reconnect to once the reviewer gains
// course access, and whether they need to log in vs. enroll.
let pendingReviewId: string | null = null;
let torusAccessReason: 'needs-login' | 'needs-enroll' = 'needs-login';
let accessWatcher: ReturnType<typeof setInterval> | null = null;

const scoreTimers = new Map<string, ReturnType<typeof setTimeout>>();
const pendingScores = new Map<string, CriterionScore | null>();
const criterionResizeObservers = new Map<string, ResizeObserver>();
let gcTimer: ReturnType<typeof setTimeout> | null = null;
type ScoreCommentEntry = { id: string | null; body: string };
// Multiple comments are allowed per (criterion, level) — matches the web review
// console and the DB, so comments authored in either client stay in sync.
type ScoreCommentMap = { does_not_meet: ScoreCommentEntry[]; exemplifies: ScoreCommentEntry[]; exceeds: ScoreCommentEntry[] };
function emptyScoreComments(): ScoreCommentMap { return { does_not_meet: [], exemplifies: [], exceeds: [] }; }
const scoreComments = new Map<string, ScoreCommentMap>();

// ── Shadow DOM refs ───────────────────────────────────────────────────────────

let shadow: ShadowRoot;
let panelHost: HTMLElement;
let panelBody: HTMLElement;
let saveStatusEl: HTMLElement;
const completionCountCache = new Map<string, { scored: number; total: number }>();

// ── Panel drag / resize state ─────────────────────────────────────────────────

type ResizeDir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
let isDragging = false;
let isResizing = false;
let resizeDir: ResizeDir | null = null;
let dragOffset = { x: 0, y: 0 };
let resizeSt = { x: 0, y: 0, w: 0, h: 0, l: 0, t: 0 };
let savedPanelH = 560;
const MIN_PANEL_W = 280;
const MIN_PANEL_H = 300;

// ── Popup overlay (page DOM, not shadow) ──────────────────────────────────────

let annotationPopup: HTMLElement;
let annotationTooltip: HTMLElement | null = null;
let hotspotMode = false;

// Watches the page for content changes so highlights/hotspots re-apply no matter
// when Torus finishes painting (reload, session return, or navigating back).
let highlightObserver: MutationObserver | null = null;
let reapplyTimer: ReturnType<typeof setTimeout> | null = null;

// ── Messaging ─────────────────────────────────────────────────────────────────

function send<T = unknown>(msg: BackgroundMessage): Promise<BackgroundResponse<T>> {
  try {
    return (chrome.runtime.sendMessage(msg) as Promise<BackgroundResponse<T>>)
      .catch((err: Error) => {
        if (err?.message?.includes('Extension context invalidated')) {
          showToast('Extension reloaded — please refresh this page to reconnect.');
        }
        return { success: false, error: err?.message ?? 'messaging error' } as BackgroundResponse<T>;
      });
  } catch (err) {
    const errMsg = (err as Error)?.message ?? '';
    if (errMsg.includes('Extension context invalidated')) {
      showToast('Extension reloaded — please refresh this page to reconnect.');
    }
    return Promise.resolve({ success: false, error: errMsg } as BackgroundResponse<T>);
  }
}

// ── Anchoring (ported from lib/anchoring/html.ts) ─────────────────────────────

// ── XPath helpers (element-scoped anchoring, markup.io / hypothes.is style) ────

// Build an XPath from document.body to `el`, using tag + positional index at each
// step (e.g. "/DIV[1]/P[3]"). Element-scoped anchors survive edits elsewhere on the
// page far better than whole-document character offsets.
function xpathForElement(el: Element): string {
  if (el === document.body) return '';
  const segments: string[] = [];
  let node: Element | null = el;
  while (node && node !== document.body && node.nodeType === Node.ELEMENT_NODE) {
    const tag = node.tagName;
    let index = 1;
    let sib = node.previousElementSibling;
    while (sib) {
      if (sib.tagName === tag) index++;
      sib = sib.previousElementSibling;
    }
    segments.unshift(`${tag}[${index}]`);
    node = node.parentElement;
  }
  return '/' + segments.join('/');
}

// Resolve an XPath produced by xpathForElement() back to its element.
function elementForXpath(xpath: string): Element | null {
  if (!xpath || xpath === '') return document.body;
  let node: Element = document.body;
  for (const seg of xpath.split('/').filter(Boolean)) {
    const m = /^([A-Za-z0-9]+)\[(\d+)\]$/.exec(seg);
    if (!m) return null;
    const [, tag, idxStr] = m;
    const idx = parseInt(idxStr, 10);
    let count = 0;
    let found: Element | null = null;
    for (const child of Array.from(node.children)) {
      if (child.tagName === tag.toUpperCase()) {
        count++;
        if (count === idx) { found = child; break; }
      }
    }
    if (!found) return null;
    node = found;
  }
  return node;
}

// For a boundary (container node + offset from a DOM Range), find the nearest
// enclosing element and the character offset of the boundary within that element's
// text content. This lets us store an element XPath + local offset (RangeSelector).
function boundaryToElementOffset(node: Node, offset: number): { element: Element; offset: number } | null {
  let element: Element;
  let charBefore = 0;
  if (node.nodeType === Node.TEXT_NODE) {
    element = node.parentElement as Element;
    if (!element) return null;
    // Count text before this text node within the element's subtree.
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const t = walker.currentNode as Text;
      if (t === node) { charBefore += offset; break; }
      charBefore += t.length;
    }
  } else {
    element = node as Element;
    // offset counts child nodes; sum text length of preceding children.
    for (let i = 0; i < offset && i < element.childNodes.length; i++) {
      charBefore += (element.childNodes[i].textContent ?? '').length;
    }
  }
  return { element, offset: charBefore };
}

// Resolve a RangeSelector (element XPath + local char offset) back into a DOM Range.
function resolveRangeSelector(sel: RangeSelector): Range | null {
  const startEl = elementForXpath(sel.startContainer);
  const endEl = elementForXpath(sel.endContainer);
  if (!startEl || !endEl) return null;

  const locate = (el: Element, localOffset: number): { node: Text; offset: number } | null => {
    let count = 0;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let last: Text | null = null;
    while (walker.nextNode()) {
      const t = walker.currentNode as Text;
      last = t;
      if (localOffset <= count + t.length) {
        return { node: t, offset: Math.max(0, localOffset - count) };
      }
      count += t.length;
    }
    return last ? { node: last, offset: last.length } : null;
  };

  const start = locate(startEl, sel.startOffset);
  const end = locate(endEl, sel.endOffset);
  if (!start || !end) return null;
  try {
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    if (range.collapsed && start.node !== end.node) return null;
    return range;
  } catch {
    return null;
  }
}

function getCharOffset(root: Node, targetNode: Node, targetOffset: number): number {
  let count = 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (node === targetNode) return count + targetOffset;
    count += node.length;
  }
  return count + targetOffset;
}

function resolveCharOffset(root: Node, start: number, end: number): Range | null {
  const doc = root.nodeType === Node.DOCUMENT_NODE
    ? root as Document
    : root.ownerDocument as Document;
  const range = doc.createRange();
  let count = 0;
  let startSet = false;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const nodeEnd = count + node.length;
    if (!startSet && start <= nodeEnd) {
      range.setStart(node, Math.min(start - count, node.length));
      startSet = true;
    }
    if (startSet && end <= nodeEnd) {
      range.setEnd(node, Math.min(end - count, node.length));
      return range;
    }
    count = nodeEnd;
  }
  return startSet ? range : null;
}

function selectionToAnchor(): HtmlCharOffsetAnchor | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.toString().trim()) return null;
  const range = sel.getRangeAt(0);
  const body = document.body;
  const fullText = body.textContent ?? '';
  const start = getCharOffset(body, range.startContainer, range.startOffset);
  const end   = getCharOffset(body, range.endContainer,   range.endOffset);
  if (start >= end) return null;
  const exact  = fullText.slice(start, end);
  const prefix = fullText.slice(Math.max(0, start - CONTEXT), start);
  const suffix = fullText.slice(end, end + CONTEXT);

  const selectors: AnchorSelector[] = [
    { type: 'TextPositionSelector', start, end },
    { type: 'TextQuoteSelector', exact, prefix, suffix },
  ];

  // Element-scoped RangeSelector — the most specific anchor, tried first on resolve.
  const startBoundary = boundaryToElementOffset(range.startContainer, range.startOffset);
  const endBoundary   = boundaryToElementOffset(range.endContainer, range.endOffset);
  if (startBoundary && endBoundary) {
    selectors.unshift({
      type: 'RangeSelector',
      startContainer: xpathForElement(startBoundary.element),
      startOffset: startBoundary.offset,
      endContainer: xpathForElement(endBoundary.element),
      endOffset: endBoundary.offset,
    });
  }

  return {
    type: 'html-char-offset',
    pageIndex: 0,
    selector: selectors,
  };
}

function resolveAnchor(anchor: HtmlCharOffsetAnchor): Range | null {
  const body = document.body;
  const fullText = body.textContent ?? '';
  const selectors = anchor.selector as AnchorSelector[];
  const rangeSel = selectors.find((s): s is RangeSelector => s.type === 'RangeSelector');
  const pos   = selectors.find((s): s is { type: 'TextPositionSelector'; start: number; end: number } =>
    s.type === 'TextPositionSelector');
  const quote = selectors.find((s): s is { type: 'TextQuoteSelector'; exact: string; prefix: string; suffix: string } =>
    s.type === 'TextQuoteSelector');

  // Most specific first: element-scoped RangeSelector. Only trust it when the
  // resolved text matches the recorded quote (guards against DOM having shifted).
  if (rangeSel) {
    const range = resolveRangeSelector(rangeSel);
    if (range) {
      if (!quote || range.toString() === quote.exact) return range;
    }
  }

  if (pos && quote) {
    if (fullText.slice(pos.start, pos.end) === quote.exact) {
      return resolveCharOffset(body, pos.start, pos.end);
    }
  } else if (pos) {
    return resolveCharOffset(body, pos.start, pos.end);
  }
  if (!quote) return null;

  const idx = fullText.indexOf(quote.exact);
  if (idx !== -1) return resolveCharOffset(body, idx, idx + quote.exact.length);

  let bestIdx = -1, bestDist = Infinity, searchFrom = 0;
  while (true) {
    const found = fullText.indexOf(quote.exact, searchFrom);
    if (found === -1) break;
    const dist = Math.abs(found - (pos?.start ?? 0));
    if (dist < bestDist) { bestDist = dist; bestIdx = found; }
    searchFrom = found + 1;
  }
  if (bestIdx !== -1) return resolveCharOffset(body, bestIdx, bestIdx + quote.exact.length);
  return null;
}

// ── Highlight injection ───────────────────────────────────────────────────────

function markRange(
  range: Range,
  annotationId: string,
  color: string,
  onClick: () => void,
): void {
  const segments: [Text, number, number][] = [];
  const ancestor = range.commonAncestorContainer;

  if (ancestor.nodeType === Node.TEXT_NODE) {
    segments.push([ancestor as Text, range.startOffset, range.endOffset]);
  } else {
    const walker = document.createTreeWalker(ancestor, NodeFilter.SHOW_TEXT);
    let inRange = false;
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      const isStart = node === range.startContainer;
      const isEnd   = node === range.endContainer;
      if (isStart) inRange = true;
      if (!inRange) continue;
      const s = isStart ? range.startOffset : 0;
      const e = isEnd   ? range.endOffset   : node.length;
      if (s < e) segments.push([node, s, e]);
      if (isEnd) break;
    }
  }

  for (const [textNode, s, e] of segments) {
    const r = document.createRange();
    r.setStart(textNode, s);
    r.setEnd(textNode, e);
    const mark = document.createElement('mark');
    mark.dataset.annotationId = annotationId;
    mark.style.cssText = `background:${color};border-radius:2px;cursor:pointer;padding:0;`;
    try {
      r.surroundContents(mark);
      mark.addEventListener('click', (ev) => {
        ev.stopPropagation();
        onClick();
      });
      mark.addEventListener('mouseenter', (ev) => showAnnotationTooltipFor(annotationId, (ev as MouseEvent).clientX, (ev as MouseEvent).clientY));
      mark.addEventListener('mouseleave', scheduleHideTooltip);
    } catch {
      // Skip partial overlaps
    }
  }
}

function clearPendingHighlight() {
  document.querySelectorAll('mark[data-annotation-id="pending"]').forEach(m => {
    const parent = m.parentNode;
    if (!parent) return;
    while (m.firstChild) parent.insertBefore(m.firstChild, m);
    parent.removeChild(m);
    parent.normalize();
  });
}

function applyPendingHighlight(range: Range) {
  clearPendingHighlight();
  const segments: [Text, number, number][] = [];
  const ancestor = range.commonAncestorContainer;

  if (ancestor.nodeType === Node.TEXT_NODE) {
    segments.push([ancestor as Text, range.startOffset, range.endOffset]);
  } else {
    const walker = document.createTreeWalker(ancestor, NodeFilter.SHOW_TEXT);
    let inRange = false;
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      const isStart = node === range.startContainer;
      const isEnd   = node === range.endContainer;
      if (isStart) inRange = true;
      if (!inRange) continue;
      const s = isStart ? range.startOffset : 0;
      const e = isEnd   ? range.endOffset   : node.length;
      if (s < e) segments.push([node, s, e]);
      if (isEnd) break;
    }
  }

  for (const [textNode, s, e] of segments) {
    const r = document.createRange();
    r.setStart(textNode, s);
    r.setEnd(textNode, e);
    const mark = document.createElement('mark');
    mark.dataset.annotationId = 'pending';
    mark.style.cssText = 'background:' + tokens.color.annotationActive + ';border-radius:2px;padding:0;';
    try { r.surroundContents(mark); } catch { /* skip partial overlaps */ }
  }
}

function applyHighlights() {
  // Pause the content observer while WE mutate the DOM (adding/removing marks and
  // hotspot markers), otherwise our own writes would retrigger a re-apply loop.
  highlightObserver?.disconnect();

  // Remove saved marks only — pending mark is managed separately
  document.querySelectorAll('mark[data-annotation-id]:not([data-annotation-id="pending"])').forEach(m => {
    const parent = m.parentNode;
    if (!parent) return;
    while (m.firstChild) parent.insertBefore(m.firstChild, m);
    parent.removeChild(m);
    parent.normalize();
  });

  const base = currentPageBase();
  const textAnnotations = annotations
    .filter(a => {
      if (a.anchor.type !== 'html-char-offset') return false;
      const anchor = a.anchor as HtmlCharOffsetAnchor;
      if (!anchor.pageUrl) return true; // legacy annotations without pageUrl
      try {
        const anchorBase = new URL(anchor.pageUrl).origin + new URL(anchor.pageUrl).pathname;
        return anchorBase === base;
      } catch { return true; }
    })
    .sort((a, b) => {
      const getStart = (ann: AnnotationRecord) => {
        if (ann.anchor.type !== 'html-char-offset') return 0;
        const pos = (ann.anchor as HtmlCharOffsetAnchor).selector
          .find(s => s.type === 'TextPositionSelector') as { type: string; start: number } | undefined;
        return pos?.start ?? 0;
      };
      return getStart(b) - getStart(a); // descending — right to left
    });

  for (const ann of textAnnotations) {
    const range = resolveAnchor(ann.anchor as HtmlCharOffsetAnchor);
    if (!range) continue;
    markRange(range, ann.id, tokens.color.annotation, () => scrollToAnnotationInPanel(ann.id));
  }

  applyHotspotMarkers();

  // Resume watching. takeRecords() drops the mutations WE just made so they don't
  // queue a redundant re-apply the instant the observer reconnects.
  reconnectHighlightObserver();
}

// A DOM change big enough to matter (Torus painting/replacing content) schedules a
// debounced re-apply. Guarded so it only runs once a review + annotations are loaded.
function scheduleReapplyHighlights() {
  if (!selectedReview || annotations.length === 0) return;
  if (reapplyTimer) clearTimeout(reapplyTimer);
  reapplyTimer = setTimeout(() => applyHighlights(), 250);
}

function reconnectHighlightObserver() {
  if (!highlightObserver) return;
  highlightObserver.takeRecords();
  highlightObserver.observe(document.body, { childList: true, subtree: true });
}

function startHighlightObserver() {
  if (highlightObserver) return;
  highlightObserver = new MutationObserver((records) => {
    // Ignore mutations that only touch our own overlay elements (marks, markers,
    // panel host, popup, tooltip) — those are our writes, not page content changes.
    const meaningful = records.some(rec => {
      const nodes = [...Array.from(rec.addedNodes), ...Array.from(rec.removedNodes)];
      return nodes.some(n => {
        if (n.nodeType !== Node.ELEMENT_NODE) return true; // text node = real content
        const el = n as Element;
        if (el.tagName === 'MARK' && (el as HTMLElement).dataset.annotationId) return false;
        if (el.id === 'oer-review-host' || el.id === 'oer-ann-popup' || el.id === 'oer-ann-tooltip' || el.id === 'oer-toast' || el.id === 'oer-hotspot-banner') return false;
        if (el.classList?.contains('oer-hotspot-marker')) return false;
        return true;
      });
    });
    if (meaningful) scheduleReapplyHighlights();
  });
  highlightObserver.observe(document.body, { childList: true, subtree: true });
}

// ── Hotspot markers ───────────────────────────────────────────────────────────

// Capture an element-scoped anchor for a hotspot click: the XPath to the element
// under the cursor plus where inside its box the click landed (as 0..1 ratios).
// Ignores our own UI so a click never anchors to the panel/popup/marker.
function buildPointElementAnchor(
  target: HTMLElement,
  clientX: number,
  clientY: number,
): Pick<PointAnchor, 'targetSelector' | 'offsetXRatio' | 'offsetYRatio' | 'targetText'> {
  if (
    target.id === 'oer-review-host' || target.closest('#oer-review-host') ||
    target.closest('#oer-ann-popup') || target.closest('.oer-hotspot-marker')
  ) {
    return {};
  }
  const rect = target.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return {};
  return {
    targetSelector: xpathForElement(target),
    offsetXRatio: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
    offsetYRatio: Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)),
    targetText: (target.textContent ?? '').trim().slice(0, 80) || undefined,
  };
}

// Resolve a point anchor's on-page coordinates. Prefer the element-scoped anchor
// (survives reflow); fall back to the stored absolute pageX/pageY.
function resolvePointPosition(anchor: PointAnchor): { pageX: number; pageY: number } {
  if (anchor.targetSelector) {
    const el = elementForXpath(anchor.targetSelector);
    if (el) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 || rect.height > 0) {
        return {
          pageX: rect.left + window.scrollX + rect.width * (anchor.offsetXRatio ?? 0.5),
          pageY: rect.top + window.scrollY + rect.height * (anchor.offsetYRatio ?? 0.5),
        };
      }
    }
  }
  return { pageX: anchor.pageX, pageY: anchor.pageY };
}

function placeHotspotMarker(ann: AnnotationRecord, index: number) {
  const anchor = ann.anchor as PointAnchor;
  const { pageX, pageY } = resolvePointPosition(anchor);
  const el = document.createElement('div');
  el.id = `hotspot-marker-${ann.id}`;
  el.dataset.annotationId = ann.id;
  el.className = 'oer-hotspot-marker';
  el.style.cssText = `
    position: absolute;
    left: ${pageX}px;
    top: ${pageY}px;
    transform: translate(-50%, -100%);
    width: 28px;
    height: 36px;
    cursor: pointer;
    z-index: 2147483645;
    filter: drop-shadow(0 2px 5px rgba(0,0,0,0.35));
    pointer-events: auto;
    transition: filter 0.15s, transform 0.15s;
  `;
  // Tint the pin by its tag so Action Item / Quick Fix hotspots are distinguishable at a glance.
  const pinColor = ann.tag === 'action_item' ? '#c2410c' : ann.tag === 'quick_fix' ? '#1d4ed8' : '#3D6FA9';
  el.innerHTML = `
    <svg width="28" height="36" viewBox="0 0 28 36" fill="none" xmlns="http://www.w3.org/2000/svg" style="position:absolute;top:0;left:0;">
      <path d="M14 0C6.268 0 0 6.268 0 14C0 24.5 14 36 14 36C14 36 28 24.5 28 14C28 6.268 21.732 0 14 0Z" fill="${pinColor}"/>
      <circle cx="14" cy="14" r="7" fill="white" fill-opacity="0.9"/>
    </svg>
    <div style="position:absolute;top:7px;left:0;width:28px;text-align:center;font-size:10px;font-weight:700;color:${pinColor};font-family:${tokens.font.body};line-height:1;">${index}</div>
  `;
  el.addEventListener('mouseenter', (ev) => {
    el.style.filter = 'drop-shadow(0 4px 8px rgba(0,0,0,0.45))';
    el.style.transform = 'translate(-50%, -105%)';
    showAnnotationTooltipFor(ann.id, (ev as MouseEvent).clientX, (ev as MouseEvent).clientY);
  });
  el.addEventListener('mouseleave', () => {
    el.style.filter = 'drop-shadow(0 2px 5px rgba(0,0,0,0.35))';
    el.style.transform = 'translate(-50%, -100%)';
    scheduleHideTooltip();
  });
  el.addEventListener('click', (ev) => {
    ev.stopPropagation();
    scrollToAnnotationInPanel(ann.id);
  });
  document.body.appendChild(el);
}

function currentPageBase(): string {
  return window.location.origin + window.location.pathname;
}

function applyHotspotMarkers() {
  document.querySelectorAll('.oer-hotspot-marker').forEach(m => m.remove());
  const base = currentPageBase();
  const pointAnnotations = annotations.filter(a => {
    if (a.anchor.type !== 'point') return false;
    const anchor = a.anchor as PointAnchor;
    if (!anchor.pageUrl) return true; // legacy annotations without pageUrl
    try {
      const anchorBase = new URL(anchor.pageUrl).origin + new URL(anchor.pageUrl).pathname;
      return anchorBase === base;
    } catch {
      return true;
    }
  });
  pointAnnotations.forEach((ann, idx) => placeHotspotMarker(ann, idx + 1));
}

// Torus renders page content asynchronously (both on a full reload/re-visit and
// on in-app SPA navigation), so a single synchronous applyHighlights() call right
// after fetching annotations can run before the text it's searching for has been
// painted into the DOM. Retry a few times — applyHighlights is idempotent, so the
// extra calls are harmless once the content has already settled.
function scheduleHighlightRetries() {
  setTimeout(applyHighlights, 350);
  setTimeout(applyHighlights, 900);
  setTimeout(applyHighlights, 2200);
}

function scrollToAnnotationInPanel(annotationId: string) {
  const ann = annotations.find(a => a.id === annotationId);

  // Expand the owning criterion accordion — its annotation list is only
  // rendered into the DOM once opened, so the target element won't exist yet.
  if (ann?.rubric_item_id) {
    const body = shadow.getElementById(`crit-body-${ann.rubric_item_id}`);
    if (body && !body.classList.contains('open')) {
      body.classList.add('open');
      const icon = shadow.getElementById(`expand-${ann.rubric_item_id}`);
      if (icon) icon.textContent = '▼';
      saveExpandedCriteria();
    }
    refreshAnnotationList(ann.rubric_item_id);
  }

  // Expand the panel itself if the user had it minimized.
  const panel = shadow.querySelector('.panel');
  if (panel?.classList.contains('collapsed')) {
    panel.classList.remove('collapsed');
    panelHost.style.height = `${savedPanelH}px`;
    const minBtn = shadow.getElementById('btn-min') as HTMLButtonElement | null;
    if (minBtn) minBtn.textContent = '−';
    savePanelGeometry();
  }

  const el = shadow.getElementById(`ann-${annotationId}`);
  el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  el?.classList.remove('card-highlight', 'active');
  requestAnimationFrame(() => {
    el?.classList.add('card-highlight', 'active');
    setTimeout(() => el?.classList.remove('card-highlight', 'active'), 1600);
  });
}

// ── "View annotation" — navigate to page + scroll to location ─────────────────

const GOTO_ANN_KEY = 'oer_goto_annotation_id';

function scrollToAnchorOnPage(anchor: AnnotationRecord['anchor'], annId: string) {
  if (anchor.type === 'point') {
    const pa = anchor as PointAnchor;
    const { pageY } = resolvePointPosition(pa);
    window.scrollTo({ top: Math.max(0, pageY - window.innerHeight / 2), behavior: 'smooth' });
    // Flash the hotspot marker
    setTimeout(() => {
      const marker = document.getElementById(`hotspot-marker-${annId}`);
      if (marker) {
        marker.style.filter = 'drop-shadow(0 0 12px rgba(61,111,169,0.9))';
        marker.style.transform = 'translate(-50%, -110%) scale(1.25)';
        setTimeout(() => {
          marker.style.filter = 'drop-shadow(0 2px 5px rgba(0,0,0,0.35))';
          marker.style.transform = 'translate(-50%, -100%)';
        }, 1500);
      }
    }, 400);
  } else if (anchor.type === 'bbox') {
    const ba = anchor as BboxAnchor;
    window.scrollTo({ top: Math.max(0, ba.y - window.innerHeight / 2), behavior: 'smooth' });
  } else if (anchor.type === 'html-char-offset') {
    const range = resolveAnchor(anchor as HtmlCharOffsetAnchor);
    if (range) {
      const el = range.startContainer.parentElement;
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }
}

function goToAnnotation(ann: AnnotationRecord) {
  const targetUrl = (ann.anchor as { pageUrl?: string }).pageUrl ?? null;

  // Check if navigation to a different page is needed
  if (targetUrl) {
    try {
      const targetBase = new URL(targetUrl).origin + new URL(targetUrl).pathname;
      if (targetBase !== currentPageBase()) {
        // Store annotation ID so we scroll to it after the page loads
        sessionStorage.setItem(GOTO_ANN_KEY, ann.id);
        window.location.href = targetUrl;
        return;
      }
    } catch { /* malformed URL — fall through to same-page scroll */ }
  }

  // Same page — scroll directly
  scrollToAnchorOnPage(ann.anchor, ann.id);
  scrollToAnnotationInPanel(ann.id);
}

// Called during init() — if we navigated here via goToAnnotation, execute the scroll
function checkPendingAnnotationNavigation() {
  const annId = sessionStorage.getItem(GOTO_ANN_KEY);
  if (!annId) return;
  sessionStorage.removeItem(GOTO_ANN_KEY);
  // Wait for annotations to load before scrolling (they load async in selectReview)
  const tryScroll = (attempts = 0) => {
    const ann = annotations.find(a => a.id === annId);
    if (ann) {
      scrollToAnchorOnPage(ann.anchor, ann.id);
      scrollToAnnotationInPanel(ann.id);
    } else if (attempts < 10) {
      setTimeout(() => tryScroll(attempts + 1), 300);
    }
  };
  setTimeout(() => tryScroll(), 600);
}

// ── Save status ───────────────────────────────────────────────────────────────

function setSaveStatus(status: 'saving' | 'saved' | 'error' | 'idle') {
  if (!saveStatusEl) return;
  saveStatusEl.className = `save-status ${status}`;
  if (status === 'saving') saveStatusEl.textContent = 'Saving…';
  else if (status === 'saved') saveStatusEl.textContent = 'Saved ✓';
  else if (status === 'error') saveStatusEl.textContent = 'Save failed';
  else saveStatusEl.textContent = '';
  if (status === 'saved') setTimeout(() => setSaveStatus('idle'), 2500);
}

function setGCSaveStatus(status: 'saving' | 'saved' | 'error' | 'idle') {
  const el = shadow.getElementById('gc-save-status');
  if (!el) return;
  el.className = `gc-save-status ${status}`;
  if (status === 'saving') el.textContent = 'Saving…';
  else if (status === 'saved') el.textContent = 'Saved';
  else if (status === 'error') el.textContent = 'Save failed — please try again';
  else el.textContent = '';
  if (status === 'saved') setTimeout(() => setGCSaveStatus('idle'), 2500);
}

// ── Per-tab completion badge ──────────────────────────────────────────────────

async function prefetchSiblingCompletions() {
  if (!selectedReview) return;
  const siblings = assignments.filter(
    a => a.document_id === selectedReview!.document_id && a.id !== selectedReview!.id
  );
  await Promise.all(siblings.map(async sib => {
    if (completionCountCache.has(sib.id)) return;
    const [itemsResp, scoresResp, commentsResp] = await Promise.all([
      send<RubricItem[]>({ type: 'GET_RUBRIC_ITEMS', payload: { rubricId: sib.rubric_id } }),
      send<ReviewScoreRecord[]>({ type: 'GET_SCORES', payload: { reviewId: sib.id } }),
      send<ScoreCommentRecord[]>({ type: 'GET_SCORE_COMMENTS', payload: { reviewId: sib.id } }),
    ]);
    const items = itemsResp.data ?? [];
    const total = items.length;
    if (total === 0) return;
    const sibScores = new Map<string, ReviewScoreRecord>();
    (scoresResp.data ?? []).forEach(s => sibScores.set(s.rubric_item_id, s));
    const sibComments = new Map<string, ScoreCommentMap>();
    (commentsResp.data ?? []).forEach(c => {
      const map = sibComments.get(c.rubric_item_id) ?? emptyScoreComments();
      map[c.score_level as 'does_not_meet' | 'exceeds'].push({ id: c.id, body: c.body });
      sibComments.set(c.rubric_item_id, map);
    });
    const scored = items.filter(item => {
      const s = sibScores.get(item.id);
      const levels = s?.criterion_scores ?? [];
      if (levels.length === 0) return false;
      const comments = sibComments.get(item.id) ?? emptyScoreComments();
      if (levels.includes('does_not_meet') && !comments.does_not_meet.some(e => e.body.trim())) return false;
      if (levels.includes('exceeds') && !comments.exceeds.some(e => e.body.trim())) return false;
      return true;
    }).length;
    completionCountCache.set(sib.id, { scored, total });
    const badge = shadow.getElementById(`tab-badge-${sib.id}`) as HTMLElement | null;
    if (badge) {
      badge.textContent = `${scored}/${total}`;
      badge.className = `tab-badge ${scored === total ? 'tab-badge-complete' : 'tab-badge-incomplete'}`;
      badge.style.display = '';
    }
  }));
}

function updateCompletion() {
  if (!selectedReview || rubricItems.length === 0) return;
  const total = rubricItems.length;
  const scored = rubricItems.filter(item => {
    const s = scores.get(item.id);
    const levels = s?.criterion_scores ?? [];
    if (levels.length === 0) return false;
    const comments = scoreComments.get(item.id) ?? emptyScoreComments();
    if (levels.includes('does_not_meet') && !comments.does_not_meet.some(e => e.body.trim())) return false;
    if (levels.includes('exceeds') && !comments.exceeds.some(e => e.body.trim())) return false;
    return true;
  }).length;
  completionCountCache.set(selectedReview.id, { scored, total });
  const badge = shadow.getElementById(`tab-badge-${selectedReview.id}`) as HTMLElement | null;
  if (badge) {
    badge.textContent = `${scored}/${total}`;
    badge.className = `tab-badge ${scored === total ? 'tab-badge-complete' : 'tab-badge-incomplete'}`;
    badge.style.display = '';
  }
}

// ── Score handling ────────────────────────────────────────────────────────────

function toggleScore(rubricItemId: string, level: CriterionScore) {
  const current = scores.get(rubricItemId);
  const currentLevels = current?.criterion_scores ?? [];

  let newLevels: CriterionScore[];
  if (currentLevels.includes(level)) {
    newLevels = currentLevels.filter(s => s !== level);
    // Comments are intentionally preserved when a rating is toggled off — matches the
    // web console and avoids silently deleting reviewer text. Removal is explicit (× button).
  } else {
    newLevels = [...currentLevels, level];
  }

  if (newLevels.length === 0) {
    scores.delete(rubricItemId);
  } else {
    const primary: CriterionScore = newLevels.includes('exemplifies') ? 'exemplifies'
      : newLevels.includes('exceeds') ? 'exceeds'
      : 'does_not_meet';
    scores.set(rubricItemId, {
      id: current?.id ?? '',
      review_id: selectedReview!.id,
      rubric_item_id: rubricItemId,
      score: primary,
      criterion_scores: newLevels,
      comment: current?.comment ?? null,
    });
  }

  refreshScoreButtons(rubricItemId);
  updateCompletion();
  setSaveStatus('saving');

  const existing = scoreTimers.get(rubricItemId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => flushScore(rubricItemId), SCORE_DEBOUNCE_MS);
  scoreTimers.set(rubricItemId, timer);
}

async function flushScore(rubricItemId: string) {
  if (!selectedReview) return;
  scoreTimers.delete(rubricItemId);

  const s = scores.get(rubricItemId);
  const levels = s?.criterion_scores ?? [];

  const [scoreResp, dnmOk, exeOk, exceedsOk] = await Promise.all([
    send({
      type: 'SAVE_SCORE',
      payload: {
        review_id: selectedReview.id,
        rubric_item_id: rubricItemId,
        score: levels[0] ?? null,
        criterion_scores: levels,
      },
    }),
    syncScoreComments(rubricItemId, 'does_not_meet'),
    syncScoreComments(rubricItemId, 'exemplifies'),
    syncScoreComments(rubricItemId, 'exceeds'),
  ]);
  setSaveStatus(scoreResp.success && dnmOk && exeOk && exceedsOk ? 'saved' : 'error');
}

// Mirrors the web app's handleAddScoreComment/handleEditScoreComment/handleDeleteScoreComment
// (ReviewerConsole.tsx): every comment in the (criterion, level) list is inserted/updated/
// deleted individually against the shared `score_comments` rows, so multi-comment criteria
// authored in either client stay in sync.
async function syncScoreComments(rubricItemId: string, level: 'does_not_meet' | 'exemplifies' | 'exceeds'): Promise<boolean> {
  if (!selectedReview) return false;
  const entries = (scoreComments.get(rubricItemId) ?? emptyScoreComments())[level];
  const kept: ScoreCommentEntry[] = [];
  let ok = true;

  for (const entry of entries) {
    const body = entry.body.trim();
    if (!body) {
      // Emptied comment — delete its row (if persisted) and drop it from state.
      if (entry.id) {
        const resp = await send({ type: 'DELETE_SCORE_COMMENT', payload: { id: entry.id } });
        ok = ok && resp.success;
      }
      continue;
    }
    if (entry.id) {
      const resp = await send({ type: 'SAVE_SCORE_COMMENT', payload: { id: entry.id, body } });
      ok = ok && resp.success;
      kept.push({ id: entry.id, body });
    } else {
      const resp = await send<ScoreCommentRecord>({
        type: 'SAVE_SCORE_COMMENT',
        payload: { review_id: selectedReview.id, rubric_item_id: rubricItemId, score_level: level, body },
      });
      ok = ok && resp.success;
      kept.push({ id: resp.success && resp.data ? resp.data.id : null, body });
    }
  }

  const cur = scoreComments.get(rubricItemId) ?? emptyScoreComments();
  scoreComments.set(rubricItemId, { ...cur, [level]: kept });
  return ok;
}

function refreshScoreButtons(rubricItemId: string) {
  const score = scores.get(rubricItemId);
  const currentLevels = score?.criterion_scores ?? [];

  // Update rating box active classes
  const rboxExceeds = shadow.getElementById(`rbox-exceeds-${rubricItemId}`);
  const rboxExemplifies = shadow.getElementById(`rbox-exemplifies-${rubricItemId}`);
  const rboxDnm = shadow.getElementById(`rbox-dnm-${rubricItemId}`);
  if (rboxExceeds) rboxExceeds.classList.toggle('active', currentLevels.includes('exceeds'));
  if (rboxExemplifies) rboxExemplifies.classList.toggle('active', currentLevels.includes('exemplifies'));
  if (rboxDnm) rboxDnm.classList.toggle('active', currentLevels.includes('does_not_meet'));

  // Update three independent header mini-badges
  const hdrBadgeExc = shadow.getElementById(`hdr-badge-exc-${rubricItemId}`);
  const hdrBadgeExe = shadow.getElementById(`hdr-badge-exe-${rubricItemId}`);
  const hdrBadgeDnm = shadow.getElementById(`hdr-badge-dnm-${rubricItemId}`);
  if (hdrBadgeExc) hdrBadgeExc.classList.toggle('active', currentLevels.includes('exceeds'));
  if (hdrBadgeExe) hdrBadgeExe.classList.toggle('active', currentLevels.includes('exemplifies'));
  if (hdrBadgeDnm) hdrBadgeDnm.classList.toggle('active', currentLevels.includes('does_not_meet'));

  // Update status circle
  const statusCircle = shadow.getElementById(`status-circle-${rubricItemId}`);
  if (statusCircle) statusCircle.classList.toggle('scored', currentLevels.length > 0);
}

// ── Torus detection & auto-screenshot ────────────────────────────────────────

function isTorusPage(): boolean {
  const href = window.location.href;
  const sourceUrl = selectedReview?.documents?.source_url ?? '';
  if (sourceUrl) {
    try {
      const sourceHost = new URL(sourceUrl).hostname;
      return window.location.hostname === sourceHost;
    } catch { /* ignore */ }
  }
  return /torus|oli\.cmu\.edu|course-author\.oli|torus\.oli/.test(href);
}

interface TorusPageInfo {
  pageName: string;
  pageType: 'nav' | 'content' | 'checkpoint';
}

// Returns a human-readable page name and type classification for the current Torus page.
// Uses a URL-path lookup for fixed platform nav pages; reads the page H1 for content pages;
// detects checkpoints by searching for the "SCORED PAGE" indicator text.
function getTorusPageInfo(): TorusPageInfo {
  const path = window.location.pathname;

  // Coursewide nav pages — fixed platform routes, safe to hardcode
  const NAV_ROUTES: Record<string, string> = {
    '/learn': 'Learn',
    '/assignments': 'Assignments',
    '/welcome': 'Welcome',
    '/explorations': 'Explorations',
    '/practice': 'Practice',
    '/notes': 'Notes',
  };
  // Check each segment of the path for a nav match
  // e.g. /sections/cs101/learn → matches /learn
  for (const [segment, label] of Object.entries(NAV_ROUTES)) {
    if (path === segment || path.endsWith(segment) || path.includes(segment + '/') || path.includes(segment + '?')) {
      return { pageName: label, pageType: 'nav' };
    }
  }
  // Home: section root (no trailing page segment)
  if (/\/sections\/[^/]+\/?$/.test(path)) {
    return { pageName: 'Home', pageType: 'nav' };
  }

  // Content/checkpoint pages — read heading from the page DOM
  // Try the most prominent structural heading in the main content area.
  // Torus typically places the page title in an <h1> inside the main content, or a large heading near the top.
  const heading = (
    document.querySelector<HTMLElement>('main h1') ??
    document.querySelector<HTMLElement>('[role="main"] h1') ??
    document.querySelector<HTMLElement>('article h1') ??
    document.querySelector<HTMLElement>('h1')
  );

  let rawTitle = heading?.textContent?.trim() ?? '';
  // Strip leading module-number prefix: e.g. "32. " or "44. "
  rawTitle = rawTitle.replace(/^\d+\.\s+/, '');
  const pageName = rawTitle || 'OLI Torus';

  // Checkpoint detection — look for "SCORED PAGE" or "Assignment requirement" anywhere in the page text
  const bodyText = document.body.innerText ?? '';
  const isCheckpoint =
    /SCORED\s+PAGE/i.test(bodyText) ||
    /Assignment\s+requirement/i.test(bodyText);

  return { pageName, pageType: isCheckpoint ? 'checkpoint' : 'content' };
}

// Picks the assignment whose OER source_url matches the page open in this tab.
// Returns null when the page is NOT a recognized assigned OER — the caller decides
// the fallback, so a stale session can't be mistaken for a real page match.
function resolveAssignmentForCurrentPage(list: ReviewAssignment[]): ReviewAssignment | null {
  if (list.length === 0) return null;

  const currentHref = window.location.href.replace(/\/$/, '');
  const scored = list
    .map(a => {
      const sourceUrl = a.documents?.source_url;
      if (!sourceUrl) return { a, score: 0 };
      try {
        const src = new URL(sourceUrl);
        const srcHref = src.href.replace(/\/$/, '');
        if (window.location.hostname !== src.hostname) return { a, score: 0 };
        if (currentHref === srcHref) return { a, score: 2 };
        if (currentHref.startsWith(srcHref + '/') || srcHref.startsWith(currentHref + '/')) return { a, score: 1 };
        return { a, score: 0 };
      } catch {
        return { a, score: 0 };
      }
    })
    .filter(s => s.score > 0)
    .sort((x, y) => {
      if (y.score !== x.score) return y.score - x.score;
      // Tie-break by most recently updated — whichever rubric row was touched last
      // (submitted or in_progress) wins, so the Console button always links to the
      // row the reviewer most recently worked on.
      const tA = x.a.updated_at ? new Date(x.a.updated_at).getTime() : 0;
      const tB = y.a.updated_at ? new Date(y.a.updated_at).getTime() : 0;
      return tB - tA;
    });

  return scored.length > 0 ? scored[0].a : null;
}

// ── Torus access gating ──────────────────────────────────────────────────────
// A reviewer can only annotate a course they can actually open in Torus. When
// they lack access, Torus routes them to its own login or enrollment page rather
// than the course content. We detect those pages by URL path and, instead of
// opening the review console, prompt them to sign in / enter the course. Once
// they regain access the extension reconnects them to the right review.

const TORUS_LOGIN_PATTERNS = [
  /\/users\/log_in/i,
  /\/session\/new/i,
  /\/authoring\/session\/new/i,
  /\/users\/reset_password/i,
];
const TORUS_ENROLL_PATTERNS = [
  /\/sections\/[^/]+\/enroll/i,
  /\/sections\/[^/]+\/join/i,
  /\/sections\/[^/]+\/request_access/i,
];

function detectTorusAccess(): 'ok' | 'needs-login' | 'needs-enroll' {
  const path = window.location.pathname;
  if (TORUS_LOGIN_PATTERNS.some(re => re.test(path))) return 'needs-login';
  if (TORUS_ENROLL_PATTERNS.some(re => re.test(path))) return 'needs-enroll';
  return 'ok';
}

// Sends the reviewer to Torus's login page with a return path back to the course,
// so after signing in Torus (and this content script) land them on the review.
function buildTorusLoginUrl(courseUrl: string): string {
  const login = new URL(TORUS_LOGIN_PATH, window.location.origin);
  if (courseUrl) {
    try {
      const ret = new URL(courseUrl);
      login.searchParams.set('request_path', ret.pathname + ret.search);
    } catch { /* ignore malformed course URL */ }
  }
  return login.toString();
}

// While parked on a login/enroll page, watch for the reviewer navigating into the
// course (SPA transitions that don't reload the content script) and reconnect.
function startAccessWatcher() {
  if (accessWatcher !== null) return;
  let lastHref = window.location.href;
  accessWatcher = setInterval(() => {
    if (window.location.href === lastHref) return;
    lastHref = window.location.href;
    if (detectTorusAccess() === 'ok') {
      stopAccessWatcher();
      void routeToReview();
    }
  }, 1000);
}

function stopAccessWatcher() {
  if (accessWatcher !== null) { clearInterval(accessWatcher); accessWatcher = null; }
}

// Reads (and clears) the deep-link intent the background captured from the URL
// before Torus could redirect. Populates deepLinkReviewId and, if present, the
// pending "scroll to annotation" id. Consumed once so it can't hijack later visits.
async function recoverDeepLinkFromStorage() {
  try {
    // Tab-scoped and consumed by the background, so another tab's launch can't leak in.
    const resp = await send<
      { reviewId?: string | null; annotationId?: string | null; ts?: number } | null
    >({ type: 'CONSUME_DEEP_LINK' });
    const pending = resp.success ? resp.data : null;
    if (!pending) return;
    // Consumed regardless of freshness so a stale record can't linger.
    if (!isDeepLinkFresh(pending, Date.now(), DEEP_LINK_TTL_MS)) return;
    if (pending.reviewId) deepLinkReviewId = pending.reviewId;
    if (pending.annotationId) {
      try { sessionStorage.setItem(GOTO_ANN_KEY, pending.annotationId); } catch { /* storage unavailable */ }
    }
  } catch { /* storage unavailable — fall back to URL/session routing */ }
}

// Resolves which review this page/deep-link/session points at, gates on Torus
// access, and either opens the console or shows the sign-in prompt.
async function routeToReview() {
  if (assignments.length === 0) { renderContent('no-assignments'); return; }

  // Resolution priority:
  //   1. Explicit deep link (?oer_review_id=) — the reviewer clicked into a
  //      specific review from the dashboard/console.
  //   2. The OER actually open in this tab (source_url match). If the reviewer
  //      previously picked a specific rubric tab for THAT SAME document, honor it;
  //      otherwise open the page's matched review.
  //   3. Fallback to the last review used in this tab, then most actionable.
  //
  // The page match must outrank a stale session: without this, reviewing OER A and
  // then opening OER B in the same tab would reopen A's rubric (wrong OER entirely).
  // The URL param is authoritative when still present; otherwise fall back to the
  // deep link the background captured before any redirect stripped the params.
  // The URL param is captured once in init() and stripped, so deepLinkReviewId is
  // the only deep-link source here and is cleared once the review opens.
  const urlReviewId = deepLinkReviewId;
  const savedId = sessionStorage.getItem(SESSION_KEY);
  const saved = savedId ? assignments.find(a => a.id === savedId) : undefined;
  const pageMatch = resolveAssignmentForCurrentPage(assignments);

  let target: ReviewAssignment | undefined;
  if (urlReviewId) {
    target = assignments.find(a => a.id === urlReviewId);
    // An explicit deep link is authoritative: the reviewer clicked THIS review on
    // the dashboard. If it isn't in the assignment list (getAssignments only returns
    // assigned/in_progress rows, so a submitted rubric is excluded), fetch it directly
    // rather than silently falling through to an unrelated review — which would open
    // the wrong document and rubric.
    if (!target) {
      const resp = await send<ReviewAssignment | null>({ type: 'GET_REVIEW', payload: { reviewId: urlReviewId } });
      if (resp.success && resp.data) {
        target = resp.data;
        // Make it resolvable to selectReview(), which looks up by id in assignments.
        assignments = [...assignments, target];
      }
    }
  }
  if (!target) {
    target = pickFallbackReview(assignments, saved, pageMatch);
  }

  // Persist now so the correct review is restored after any Torus login/enroll
  // navigation (sessionStorage survives same-origin navigations in this tab).
  sessionStorage.setItem(SESSION_KEY, target.id);

  const access = detectTorusAccess();
  if (access !== 'ok') {
    pendingReviewId = target.id;
    torusAccessReason = access;
    renderContent('torus-access');
    startAccessWatcher();
    return;
  }

  stopAccessWatcher();
  // Deep link fulfilled: from now on the tab's own selection (sessionStorage) rules,
  // so a later rubric-tab switch isn't overridden by the original link.
  deepLinkReviewId = null;
  await selectReview(target.id);
}

// Hide/show the extension's own UI chrome (panel + transient overlays) without
// touching the on-page annotation marks/hotspot pins, which SHOULD appear in the
// screenshot. Uses visibility (not display) so nothing reflows.
function setExtensionChromeVisible(visible: boolean) {
  const ids = ['oer-review-host', 'oer-ann-popup', 'oer-ann-tooltip', 'oer-hotspot-banner', 'oer-toast'];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el) el.style.visibility = visible ? '' : 'hidden';
  }
}

async function captureAnnotationScreenshot(): Promise<string | null> {
  if (!selectedReview) return null;
  try {
    // Clear the extension panel/overlays so captureVisibleTab records only the
    // page (and its annotation marks). Wait two frames so the hidden state is
    // actually painted before the tab is captured, then always restore it.
    setExtensionChromeVisible(false);
    await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    let captureResp: BackgroundResponse<{ png: string }>;
    try {
      captureResp = await send<{ png: string }>({ type: 'CAPTURE_TAB' });
    } finally {
      setExtensionChromeVisible(true);
    }
    if (!captureResp.success || !captureResp.data?.png) {
      console.error('[OER] CAPTURE_TAB failed:', captureResp.error);
      return null;
    }
    const uploadResp = await send<{ url: string }>({
      type: 'UPLOAD_SCREENSHOT',
      payload: { png: captureResp.data.png, reviewId: selectedReview.id },
    });
    if (!uploadResp.success) console.error('[OER] UPLOAD_SCREENSHOT failed:', uploadResp.error);
    return uploadResp.success ? (uploadResp.data?.url ?? null) : null;
  } catch (err) {
    setExtensionChromeVisible(true);
    console.error('[OER] captureAnnotationScreenshot threw:', err);
    return null;
  }
}

async function computePageFingerprint(): Promise<string> {
  const text = document.body?.innerText ?? '';
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

async function updateDocumentPages(screenshotUrl: string | null) {
  if (!selectedReview || !isTorusPage()) return;
  const fingerprint = await computePageFingerprint();
  await send({
    type: 'UPDATE_DOCUMENT_PAGES',
    payload: {
      documentId: selectedReview.document_id,
      storagePath: `torus/${selectedReview.document_id}/`,
      pageEntry: {
        url: window.location.href,
        fingerprint,
        storagePath: screenshotUrl ?? '',
      },
    },
  });
}

// ── Annotation handling ───────────────────────────────────────────────────────

async function saveAnnotation(
  rubricItemId: string | null,
  body: string,
  tag: HighlightTag | null,
  anchor: HtmlCharOffsetAnchor | BboxAnchor | PointAnchor,
): Promise<AnnotationRecord | null> {
  if (!selectedReview) return null;
  setSaveStatus('saving');
  const resp = await send<AnnotationRecord>({
    type: 'SAVE_ANNOTATION',
    payload: {
      review_id: selectedReview.id,
      rubric_item_id: rubricItemId,
      anchor: anchor as unknown as Record<string, unknown>,
      body,
      tag,
    },
  });
  if (!resp.success || !resp.data) { setSaveStatus('error'); return null; }
  annotations.push(resp.data);
  setSaveStatus('saved');
  applyHighlights();
  refreshAnnotationList(listKeyForAnnotation(resp.data));
  return resp.data;
}

// Take screenshot AFTER highlights/markers are painted, then patch the annotation anchor.
async function attachScreenshotToAnnotations(savedAnns: AnnotationRecord[]) {
  if (savedAnns.length === 0) return;
  const screenshotUrl = await captureAnnotationScreenshot();

  if (screenshotUrl) {
    for (const ann of savedAnns) {
      const updatedAnchor = { ...(ann.anchor as unknown as Record<string, unknown>), screenshotUrl };
      const resp = await send<AnnotationRecord>({
        type: 'SAVE_ANNOTATION',
        payload: { id: ann.id, anchor: updatedAnchor },
      });
      if (!resp.success) continue;
      const idx = annotations.findIndex(a => a.id === ann.id);
      if (idx !== -1) {
        annotations[idx] = { ...annotations[idx], anchor: updatedAnchor as unknown as HtmlCharOffsetAnchor | BboxAnchor | PointAnchor };
        refreshAnnotationList(listKeyForAnnotation(annotations[idx]));
      }
    }
  }

  // Track annotated Torus pages in documents.pages (fire-and-forget, non-critical)
  updateDocumentPages(screenshotUrl).catch(() => { /* non-critical */ });
}

async function deleteAnnotation(annotationId: string) {
  setSaveStatus('saving');
  const resp = await send({ type: 'DELETE_ANNOTATION', payload: { id: annotationId } });
  if (!resp.success) { setSaveStatus('error'); return; }
  const idx = annotations.findIndex(a => a.id === annotationId);
  if (idx !== -1) annotations.splice(idx, 1);
  setSaveStatus('saved');
  applyHighlights();
  // Remove mark from DOM
  document.querySelectorAll(`mark[data-annotation-id="${annotationId}"]`).forEach(m => {
    const parent = m.parentNode;
    if (!parent) return;
    while (m.firstChild) parent.insertBefore(m.firstChild, m);
    parent.removeChild(m);
    parent.normalize();
  });
  renderRubricCriteria(); // Full re-render to update criterion counts
  // The Unlinked / General Notes lists live outside the criterion accordion, so
  // refresh them explicitly (renderRubricCriteria only rebuilds criterion cards).
  refreshAnnotationList(UNLINKED_LIST_KEY);
  refreshAnnotationList(FREE_LIST_KEY);
}

// Free notes are page-agnostic text notes (the "+ Add Note" / "+ Add Comment"
// flows), stored as a zero-size bbox anchor. Anything else with no criterion is a
// real page anchor that simply hasn't been linked yet → an "unlinked annotation".
const FREE_LIST_KEY = '__free__';
const UNLINKED_LIST_KEY = '__unlinked__';

function isFreeNoteAnchor(anchor: AnnotationRecord['anchor']): boolean {
  if (anchor.type !== 'bbox') return false;
  const b = anchor as BboxAnchor;
  return b.x === 0 && b.y === 0 && b.width === 0 && b.height === 0 && !b.screenshotUrl;
}

// Which panel list an annotation belongs in: its criterion, General Notes, or Unlinked.
function listKeyForAnnotation(ann: AnnotationRecord): string {
  if (ann.rubric_item_id) return ann.rubric_item_id;
  return isFreeNoteAnchor(ann.anchor) ? FREE_LIST_KEY : UNLINKED_LIST_KEY;
}


function refreshAnnotationList(rubricItemId: string) {
  if (!selectedReview) return;
  const relevant = annotations.filter(a => listKeyForAnnotation(a) === rubricItemId);
  if (rubricItemId !== UNLINKED_LIST_KEY) {
    const count = relevant.length;
    const evBadge = shadow.getElementById(`evidence-badge-${rubricItemId}`) as HTMLElement | null;
    if (evBadge) {
      evBadge.style.display = count > 0 ? '' : 'none';
      const countEl = shadow.getElementById(`evidence-count-${rubricItemId}`);
      if (countEl) countEl.textContent = String(count);
    }
    const evLabel = shadow.getElementById(`evidence-label-${rubricItemId}`) as HTMLElement | null;
    if (evLabel) evLabel.textContent = `Evidence (${count})`;
  }
  const container = shadow.getElementById(`ann-list-${rubricItemId}`);
  if (!container) { updateUnlinkedCount(); return; }
  container.innerHTML = relevant.map(ann => renderAnnotationItem(ann)).join('');
  container.querySelectorAll<HTMLButtonElement>('.ann-delete').forEach(btn => {
    btn.addEventListener('click', () => deleteAnnotation(btn.dataset.id!));
  });
  container.querySelectorAll<HTMLButtonElement>('.ann-edit').forEach(btn => {
    btn.addEventListener('click', () => editAnnotation(btn.dataset.id!));
  });
  container.querySelectorAll<HTMLButtonElement>('.ann-goto').forEach(btn => {
    btn.addEventListener('click', () => {
      const annId = btn.dataset.id!;
      const ann = annotations.find(a => a.id === annId);
      if (ann) goToAnnotation(ann);
    });
  });
  container.querySelectorAll<HTMLButtonElement>('.ann-view-screenshot').forEach(btn => {
    btn.addEventListener('click', () => { const u = btn.dataset.url; if (u) openScreenshotModal(u); });
  });
  container.querySelectorAll<HTMLImageElement>('.screenshot-thumb').forEach(img => {
    img.addEventListener('click', () => { const u = img.dataset.url; if (u) openScreenshotModal(u); });
  });
  // Hide expand buttons on fields that already fit in 3 lines (no overflow)
  container.querySelectorAll<HTMLElement>('.field-clamp').forEach(el => {
    if (el.scrollHeight <= el.clientHeight + 2) {
      const rawId = el.id.substring('field-'.length);
      const lastDash = rawId.lastIndexOf('-');
      if (lastDash === -1) return;
      const annId = rawId.substring(0, lastDash);
      const field = rawId.substring(lastDash + 1);
      const btn = container.querySelector(`.ann-expand-btn[data-ann-id="${annId}"][data-field="${field}"]`) as HTMLElement | null;
      if (btn) btn.style.display = 'none';
    }
  });

  container.querySelectorAll<HTMLButtonElement>('.ann-expand-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const annId = btn.dataset.annId!;
      const field = btn.dataset.field!;
      const fieldEl = container.querySelector(`#field-${annId}-${field}`) as HTMLElement | null;
      if (!fieldEl) return;
      const isExpanded = fieldEl.classList.contains('expanded');
      fieldEl.classList.toggle('expanded', !isExpanded);
      btn.textContent = isExpanded ? '(see full text)' : '(collapse)';
    });
  });
  container.querySelectorAll<HTMLSelectElement>('.ann-link').forEach(sel => {
    sel.addEventListener('change', () => {
      const annId = sel.dataset.id!;
      const criterionId = sel.value;
      if (criterionId) linkAnnotationToCriterion(annId, criterionId);
    });
  });
  updateUnlinkedCount();
}

// Keep the "Unlinked" section header count and empty-state in sync.
function updateUnlinkedCount() {
  const count = annotations.filter(a => listKeyForAnnotation(a) === UNLINKED_LIST_KEY).length;
  const badge = shadow.getElementById('unlinked-count');
  if (badge) badge.textContent = String(count);
  const empty = shadow.getElementById('unlinked-empty');
  if (empty) empty.style.display = count === 0 ? 'block' : 'none';
}

// Move an unlinked annotation into a rubric criterion (console parity).
async function linkAnnotationToCriterion(annotationId: string, criterionId: string) {
  const ann = annotations.find(a => a.id === annotationId);
  if (!ann) return;
  setSaveStatus('saving');
  const resp = await send({ type: 'UPDATE_ANNOTATION', payload: { id: annotationId, rubric_item_id: criterionId } });
  if (!resp.success) { setSaveStatus('error'); return; }
  ann.rubric_item_id = criterionId;
  setSaveStatus('saved');
  // Refresh both the source (unlinked) list and the destination criterion, plus counts.
  refreshAnnotationList(UNLINKED_LIST_KEY);
  renderRubricCriteria();
}

const SVG_PAGE_NAV = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>`;
const SVG_PAGE_CHECKPOINT = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>`;
const SVG_PAGE_CONTENT = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
const SVG_EDIT_ICON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
const SVG_DELETE_ICON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`;
const SVG_TAG_ACTION = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>`;
const SVG_TAG_QUICK = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`;

function annPageLabelHtml(anchor: AnnotationRecord['anchor']): string {
  const pageName = (anchor as { pageName?: string }).pageName ?? null;
  if (!pageName) return '';
  const pageType = (anchor as { pageType?: string }).pageType ?? null;
  const icon = pageType === 'nav' ? SVG_PAGE_NAV : pageType === 'checkpoint' ? SVG_PAGE_CHECKPOINT : SVG_PAGE_CONTENT;
  return `<div class="ann-page-label" title="${escHtml(pageName)}">${icon}<span class="ann-page-text">${escHtml(pageName)}</span></div><div class="ann-divider"></div>`;
}

const SVG_PIN_INLINE = `<svg width="10" height="13" viewBox="0 0 28 36" fill="currentColor" style="flex-shrink:0"><path d="M14 0C6.268 0 0 6.268 0 14C0 24.5 14 36 14 36C14 36 28 24.5 28 14C28 6.268 21.732 0 14 0Z"/></svg>`;

function clampField(text: string, annId: string, field: string, className: string): string {
  return `<div class="${className} field-clamp" id="field-${annId}-${field}">${escHtml(text)}</div><button class="ann-expand-btn" data-ann-id="${annId}" data-field="${field}">(see full text)</button>`;
}

function renderAnnotationItem(ann: AnnotationRecord): string {
  const isHotspot = ann.anchor.type === 'point';
  const quote = ann.anchor.type === 'html-char-offset'
    ? (() => {
        const sel = (ann.anchor as HtmlCharOffsetAnchor).selector
          .find(s => s.type === 'TextQuoteSelector') as { exact?: string } | undefined;
        return sel?.exact ?? '';
      })()
    : '';

  const screenshotUrl = (ann.anchor as { screenshotUrl?: string }).screenshotUrl ?? null;
  const screenshotHtml = screenshotUrl
    ? `<div class="ann-screenshot-row">
        <img class="screenshot-thumb" src="${escHtml(screenshotUrl)}" data-url="${escHtml(screenshotUrl)}" alt="Screenshot" />
        <button class="ann-view-screenshot" data-url="${escHtml(screenshotUrl)}">View full screenshot ↗</button>
      </div>`
    : '';

  const anchorPageUrl = (ann.anchor as { pageUrl?: string }).pageUrl ?? null;
  const gotoBtn = anchorPageUrl
    ? `<button class="ann-goto" data-id="${ann.id}">↗ Go to annotation</button>`
    : '';

  let primarySectionHtml: string;
  if (isHotspot) {
    primarySectionHtml = `
      <div class="ann-sh-row">
        <div class="ann-sh">${SVG_PIN_INLINE} Hotspot</div>
        ${gotoBtn}
      </div>`;
  } else {
    const quoteContent = quote
      ? clampField(quote, ann.id, 'quote', 'ann-quote')
      : `<div class="ann-no-quote">No annotated text</div>`;
    primarySectionHtml = `
      <div class="ann-sh-row">
        <div class="ann-sh">Annotated Text</div>
        ${gotoBtn}
      </div>
      ${quoteContent}`;
  }

  const tagHtml = ann.tag
    ? `<div class="ann-sh">Tags</div>
       <span class="ann-tag">${ann.tag === 'action_item' ? SVG_TAG_ACTION + ' Action Item' : SVG_TAG_QUICK + ' Quick Fix'}</span>`
    : '';

  // Unlinked annotations (real page anchor, no criterion) get a "link to criterion"
  // control so the reviewer can categorize them — mirrors the in-platform console.
  const isUnlinked = !ann.rubric_item_id && !isFreeNoteAnchor(ann.anchor);
  const linkHtml = isUnlinked && rubricItems.length > 0
    ? `<select class="ann-link" data-id="${ann.id}" title="Link to a rubric criterion">
        <option value="">Link to criterion…</option>
        ${rubricItems.map(item => `<option value="${item.id}">${escHtml(item.label.split(' · ')[0] ?? item.label)}</option>`).join('')}
      </select>`
    : '';

  return `
    <div class="ann-item" id="ann-${ann.id}">
      <div class="ann-icon-btns">
        <button class="ann-edit" data-id="${ann.id}" title="Edit">${SVG_EDIT_ICON}</button>
        <button class="ann-delete" data-id="${ann.id}" title="Delete">${SVG_DELETE_ICON}</button>
      </div>
      ${annPageLabelHtml(ann.anchor)}
      ${screenshotHtml}
      ${primarySectionHtml}
      <div class="ann-editable" id="ann-editable-${ann.id}">
        <div class="ann-sh">Comment</div>
        ${ann.body.trim() ? clampField(ann.body.trim(), ann.id, 'body', 'ann-body') : '<div class="ann-no-quote">No comment written</div>'}
        ${tagHtml}
      </div>
      ${linkHtml}
    </div>
  `;
}

function editAnnotation(annotationId: string) {
  const ann = annotations.find(a => a.id === annotationId);
  if (!ann) return;

  const item = shadow?.querySelector<HTMLElement>('#ann-' + annotationId);
  if (!item) return;
  const editableEl = item.querySelector<HTMLElement>('#ann-editable-' + annotationId);
  if (!editableEl) return;

  let currentTag: HighlightTag | null = ann.tag;
  const existingBody = ann.body.trim();

  const criterionOptions = '<option value="">— No criterion —</option>' +
    rubricItems.map(ri =>
      '<option value="' + escHtml(ri.id) + '"' + (ann.rubric_item_id === ri.id ? ' selected' : '') + '>' + escHtml(ri.label) + '</option>'
    ).join('');

  const startDisabled = existingBody === '';

  editableEl.innerHTML =
    '<div class="ann-sh">Comment</div>' +
    '<textarea class="ann-edit-input" rows="3" placeholder="Add a comment...">' + escHtml(existingBody) + '</textarea>' +
    '<div class="ann-sh" style="margin-top:8px;">Tags</div>' +
    '<div class="ann-tag-toggles">' +
      '<button class="ann-tag-btn' + (currentTag === 'action_item' ? ' active' : '') + '" data-tag="action_item">Action Item</button>' +
      '<button class="ann-tag-btn' + (currentTag === 'quick_fix' ? ' active' : '') + '" data-tag="quick_fix">Quick Fix</button>' +
    '</div>' +
    '<div class="ann-sh" style="margin-top:8px;">Link to Criteria</div>' +
    '<select class="ann-criterion-sel">' + criterionOptions + '</select>' +
    '<div class="ann-edit-actions">' +
      '<span class="ann-edit-hint"' + (startDisabled ? '' : ' style="display:none;"') + '>Add a comment to save</span>' +
      '<button class="ann-edit-cancel">Cancel</button>' +
      '<button class="ann-edit-confirm"' + (startDisabled ? ' disabled' : '') + '>Save</button>' +
    '</div>';

  const confirmBtn = editableEl.querySelector<HTMLButtonElement>('.ann-edit-confirm')!;
  const editHintEl = editableEl.querySelector<HTMLElement>('.ann-edit-hint')!;
  const editTextarea = editableEl.querySelector<HTMLTextAreaElement>('.ann-edit-input')!;
  editTextarea.addEventListener('input', () => {
    const disabled = editTextarea.value.trim() === '';
    confirmBtn.disabled = disabled;
    editHintEl.style.display = disabled ? '' : 'none';
  });

  editableEl.querySelectorAll<HTMLButtonElement>('.ann-tag-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tag = btn.dataset.tag as HighlightTag;
      currentTag = currentTag === tag ? null : tag;
      editableEl.querySelectorAll('.ann-tag-btn').forEach(b => b.classList.remove('active'));
      if (currentTag) editableEl.querySelector<HTMLButtonElement>('.ann-tag-btn[data-tag="' + currentTag + '"]')?.classList.add('active');
    });
  });

  editableEl.querySelector('.ann-edit-cancel')?.addEventListener('click', () => {
    refreshAnnotationList(listKeyForAnnotation(ann));
  });

  editableEl.querySelector('.ann-edit-confirm')?.addEventListener('click', async () => {
    const textarea = editableEl.querySelector<HTMLTextAreaElement>('.ann-edit-input')!;
    const newBody = textarea.value.trim();
    const selectEl = editableEl.querySelector<HTMLSelectElement>('.ann-criterion-sel')!;
    const newCriterionId = selectEl.value || null;
    const oldKey = listKeyForAnnotation(ann);
    setSaveStatus('saving');
    const resp = await send({
      type: 'UPDATE_ANNOTATION',
      payload: { id: annotationId, body: newBody, tag: currentTag, rubric_item_id: newCriterionId },
    });
    if (resp.success) {
      ann.body = newBody;
      ann.tag = currentTag;
      ann.rubric_item_id = newCriterionId;
      setSaveStatus('saved');
    } else {
      setSaveStatus('error');
    }
    const newKey = listKeyForAnnotation(ann);
    refreshAnnotationList(oldKey);
    if (newKey !== oldKey) refreshAnnotationList(newKey);
  });
}

// ── Unified annotation popup (create text / create hotspot / edit) ────────────

type PopupConfig =
  | { mode: 'create-text'; anchor: HtmlCharOffsetAnchor }
  | { mode: 'create-hotspot'; anchor: PointAnchor; clientX: number; clientY: number }
  | { mode: 'edit'; annotation: AnnotationRecord };

function openAnnotationPopup(config: PopupConfig) {
  const C = tokens.color;
  const F = tokens.font;
  const isEdit = config.mode === 'edit';
  const ann = isEdit ? config.annotation : null;
  const existingTag: HighlightTag | null = ann?.tag ?? null;
  const existingBody = (ann?.body ?? '').trim();
  const existingCriterionId = ann?.rubric_item_id ?? null;
  const headerTitle = isEdit ? 'EDIT ANNOTATION' : 'ADD ANNOTATION';
  const placeholder = config.mode === 'create-hotspot'
    ? 'Describe this hotspot...'
    : 'Describe what this evidence shows...';

  const criterionOptions =
    '<option value="">(save to unlinked annotations)</option>' +
    rubricItems.map((ri, idx) => {
      const parts = ri.label.split(' · ');
      const code = parts.length > 1 ? parts[0] : 'C' + (idx + 1);
      const raw = parts.length > 1 ? parts.slice(1).join(' · ') : ri.label;
      const name = raw.replace(/^[A-Za-z]?\d+\s+/, '');
      const sel = existingCriterionId === ri.id ? ' selected' : '';
      return '<option value="' + escHtml(ri.id) + '"' + sel + '>' + escHtml(code) + ' — ' + escHtml(name) + '</option>';
    }).join('');

  const sB = C.border + '40';
  const lbl = 'font-size:10px;font-weight:700;font-family:' + F.body + ';color:' + C.textSecondary + ';text-transform:uppercase;letter-spacing:0.06em;';
  const tagBase = 'display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:9999px;cursor:pointer;font-size:10px;font-weight:600;font-family:' + F.body + ';transition:all 0.12s;';
  const tagActInit = existingTag === 'action_item';
  const tagQfxInit = existingTag === 'quick_fix';

  annotationPopup.innerHTML =
    '<div id="oer-pop-header" style="display:flex;align-items:center;justify-content:space-between;background:' + C.surface + ';padding:10px 14px;border-bottom:1px solid ' + sB + ';cursor:grab;user-select:none;">' +
      '<span style="' + lbl + '">' + headerTitle + '</span>' +
      '<button id="oer-pop-close" style="background:none;border:none;cursor:pointer;color:' + C.textMuted + ';padding:0;display:flex;align-items:center;font-family:inherit;" aria-label="Close">' +
        '<svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">' +
          '<path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/>' +
        '</svg>' +
      '</button>' +
    '</div>' +
    '<div style="padding:12px 14px;border-bottom:1px solid ' + sB + ';">' +
      '<div style="' + lbl + 'margin-bottom:8px;">COMMENT</div>' +
      '<textarea id="oer-pop-body" rows="3" placeholder="' + placeholder + '" style="display:block;width:100%;padding:4px 0;border:none;border-bottom:2px solid ' + C.border + ';background:transparent;font-size:12px;font-family:' + F.body + ';color:' + C.textPrimary + ';resize:none;outline:none;box-shadow:none;box-sizing:border-box;">' + escHtml(existingBody) + '</textarea>' +
    '</div>' +
    '<div style="padding:12px 14px;border-bottom:1px solid ' + sB + ';display:flex;align-items:center;gap:10px;">' +
      '<span style="' + lbl + 'flex-shrink:0;">TAGS:</span>' +
      '<div style="display:flex;gap:6px;">' +
        '<button class="oer-tag-btn" data-tag="action_item" style="' + tagBase + 'border:1px solid ' + (tagActInit ? C.secondary + '66' : C.border) + ';background:' + (tagActInit ? C.secondaryContainer + '99' : 'transparent') + ';color:' + (tagActInit ? C.secondary : C.textSecondary) + ';">' + SVG_TAG_ACTION + ' Action Item</button>' +
        '<button class="oer-tag-btn" data-tag="quick_fix" style="' + tagBase + 'border:1px solid ' + (tagQfxInit ? C.secondary + '66' : C.border) + ';background:' + (tagQfxInit ? C.secondaryContainer + '99' : 'transparent') + ';color:' + (tagQfxInit ? C.secondary : C.textSecondary) + ';">' + SVG_TAG_QUICK + ' Quick Fix</button>' +
      '</div>' +
    '</div>' +
    '<div style="padding:12px 14px;border-bottom:1px solid ' + sB + ';">' +
      '<div style="' + lbl + 'margin-bottom:8px;">LINK TO CRITERIA <span style="font-size:10px;font-weight:400;text-transform:none;letter-spacing:normal;color:' + C.textMuted + ';">(optional)</span></div>' +
      '<div style="position:relative;">' +
        '<select id="oer-pop-criterion" style="width:100%;padding:4px 20px 4px 0;border:none;border-bottom:2px solid ' + C.border + ';background:transparent;font-size:12px;font-family:' + F.body + ';color:' + C.textPrimary + ';outline:none;cursor:pointer;box-sizing:border-box;appearance:none;-webkit-appearance:none;">' + criterionOptions + '</select>' +
        '<span id="oer-crit-chevron" style="position:absolute;right:0;top:50%;transform:translateY(-50%);pointer-events:none;color:' + C.textMuted + ';display:flex;align-items:center;transition:transform 150ms ease;">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>' +
        '</span>' +
      '</div>' +
    '</div>' +
    '<div style="padding:10px 14px;display:flex;align-items:center;gap:8px;">' +
      '<span id="oer-pop-hint" style="font-size:10px;color:' + C.textMuted + ';font-style:italic;flex:1;">Add a comment to save</span>' +
      '<button id="oer-pop-cancel" style="padding:5px 12px;border-radius:0;border:1px solid ' + C.border + ';background:' + C.surfaceCard + ';font-size:11px;font-weight:500;font-family:' + F.body + ';color:' + C.textSecondary + ';cursor:pointer;">Cancel</button>' +
      '<button id="oer-pop-save" style="padding:5px 12px;border-radius:0;border:none;background:' + C.primary + ';color:' + C.onPrimary + ';font-size:11px;font-weight:600;font-family:' + F.body + ';cursor:pointer;">Save Evidence</button>' +
    '</div>';

  // Tag toggle
  let selectedTag: HighlightTag | null = existingTag;
  const updateTagStyles = () => {
    annotationPopup.querySelectorAll<HTMLButtonElement>('.oer-tag-btn').forEach(btn => {
      const active = btn.dataset.tag === selectedTag;
      btn.style.background = active ? C.secondaryContainer + '99' : 'transparent';
      btn.style.color = active ? C.secondary : C.textSecondary;
      btn.style.borderColor = active ? C.secondary + '66' : C.border;
    });
  };
  annotationPopup.querySelectorAll<HTMLButtonElement>('.oer-tag-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedTag = selectedTag === (btn.dataset.tag as HighlightTag) ? null : (btn.dataset.tag as HighlightTag);
      updateTagStyles();
    });
  });

  // Close / Cancel
  const doCancel = () => {
    hideAnnotationPopup();
    if (config.mode === 'create-hotspot') exitHotspotMode();
  };
  annotationPopup.querySelector('#oer-pop-close')?.addEventListener('click', doCancel);
  annotationPopup.querySelector('#oer-pop-cancel')?.addEventListener('click', doCancel);

  // Drag header
  const hdrEl = annotationPopup.querySelector<HTMLElement>('#oer-pop-header');
  if (hdrEl) {
    hdrEl.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest('#oer-pop-close')) return;
      e.preventDefault();
      const sMouseX = e.clientX;
      const sMouseY = e.clientY;
      const sLeft = parseInt(annotationPopup.style.left, 10) || 0;
      const sTop  = parseInt(annotationPopup.style.top,  10) || 0;
      hdrEl.style.cursor = 'grabbing';
      const onMove = (ev: PointerEvent) => {
        const nl = Math.max(0, Math.min(sLeft + ev.clientX - sMouseX, window.innerWidth - annotationPopup.offsetWidth));
        const nt = Math.max(0, Math.min(sTop  + ev.clientY - sMouseY, window.innerHeight - annotationPopup.offsetHeight));
        annotationPopup.style.left = nl + 'px';
        annotationPopup.style.top  = nt + 'px';
      };
      const onUp = () => {
        hdrEl.style.cursor = 'grab';
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
      };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    });
  }

  // Save
  const bodyEl = annotationPopup.querySelector<HTMLTextAreaElement>('#oer-pop-body')!;
  const criterionEl = annotationPopup.querySelector<HTMLSelectElement>('#oer-pop-criterion')!;
  const chevronEl = annotationPopup.querySelector<HTMLElement>('#oer-crit-chevron');
  const saveBtn = annotationPopup.querySelector<HTMLButtonElement>('#oer-pop-save')!;
  const hintEl = annotationPopup.querySelector<HTMLElement>('#oer-pop-hint')!;

  const updateSaveState = (disabled: boolean) => {
    saveBtn.disabled = disabled;
    saveBtn.style.background = disabled ? C.surfaceContainerHigh : C.primary;
    saveBtn.style.color = disabled ? C.textMuted : C.onPrimary;
    saveBtn.style.cursor = disabled ? 'not-allowed' : 'pointer';
    hintEl.style.display = disabled ? '' : 'none';
  };
  updateSaveState(existingBody === '');

  bodyEl.addEventListener('input', () => {
    bodyEl.style.borderBottomColor = C.border;
    updateSaveState(bodyEl.value.trim() === '');
  });
  bodyEl.addEventListener('focus', () => { bodyEl.style.borderBottomColor = C.primary; });
  bodyEl.addEventListener('blur',  () => { bodyEl.style.borderBottomColor = C.border; });
  criterionEl.addEventListener('focus', () => { if (chevronEl) chevronEl.style.transform = 'translateY(-50%) rotate(180deg)'; });
  criterionEl.addEventListener('blur',  () => { if (chevronEl) chevronEl.style.transform = 'translateY(-50%)'; });

  saveBtn.addEventListener('click', async () => {
    const body = bodyEl.value.trim();
    const selectedCriterionId = criterionEl.value || null;

    if (config.mode === 'create-text') {
      const rawAnchor = config.anchor;
      hideAnnotationPopup();
      const { pageName: pgName, pageType: pgType } = getTorusPageInfo();
      const finalAnchor = { ...rawAnchor, pageUrl: window.location.href, pageName: pgName, pageType: pgType } as HtmlCharOffsetAnchor;
      const savedAnns: AnnotationRecord[] = [];
      const a = await saveAnnotation(selectedCriterionId, body, selectedTag, finalAnchor);
      if (a) savedAnns.push(a);
      setTimeout(() => attachScreenshotToAnnotations(savedAnns), 200);

    } else if (config.mode === 'create-hotspot') {
      const rawAnchor = config.anchor;
      const { pageName: pgName, pageType: pgType } = getTorusPageInfo();
      const savedAnchor: PointAnchor = { ...rawAnchor, pageUrl: window.location.href, pageName: pgName, pageType: pgType };
      hideAnnotationPopup();
      exitHotspotMode();
      const savedAnns: AnnotationRecord[] = [];
      const a = await saveAnnotation(selectedCriterionId, body, selectedTag, savedAnchor);
      if (a) savedAnns.push(a);
      setTimeout(() => attachScreenshotToAnnotations(savedAnns), 200);

    } else {
      const editAnn = config.annotation;
      const oldKey = listKeyForAnnotation(editAnn);
      setSaveStatus('saving');
      const resp = await send({
        type: 'UPDATE_ANNOTATION',
        payload: { id: editAnn.id, body, tag: selectedTag, rubric_item_id: selectedCriterionId },
      });
      if (resp.success) {
        editAnn.body = body;
        editAnn.tag = selectedTag;
        editAnn.rubric_item_id = selectedCriterionId;
        setSaveStatus('saved');
      } else {
        setSaveStatus('error');
      }
      hideAnnotationPopup();
      const newKey = listKeyForAnnotation(editAnn);
      refreshAnnotationList(oldKey);
      if (newKey !== oldKey) refreshAnnotationList(newKey);
    }
  });

  // Position and show
  hideAnnotationTooltip();
  annotationPopup.style.display = 'block';
  const popW = annotationPopup.offsetWidth || 300;
  const popH = annotationPopup.offsetHeight || 280;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let popLeft = vw / 2 - popW / 2;
  let popTop  = vh / 3;

  if (config.mode === 'create-text') {
    const sel = window.getSelection();
    const selRange = sel && !sel.isCollapsed ? sel.getRangeAt(0).cloneRange() : null;
    const rect = selRange?.getBoundingClientRect();
    if (rect) {
      popTop  = rect.top - popH - 8;
      if (popTop < 8) popTop = rect.bottom + 8;
      popLeft = rect.left;
    }
    if (selRange) { applyPendingHighlight(selRange); sel?.removeAllRanges(); }

  } else if (config.mode === 'create-hotspot') {
    const { clientX, clientY } = config;
    popLeft = clientX + 12;
    popTop  = clientY - popH / 2;
    if (popLeft + popW > vw - PANEL_WIDTH - 8) popLeft = clientX - popW - 12;

  } else {
    const editAnn = config.annotation;
    if (editAnn.anchor.type === 'html-char-offset') {
      const mark = document.querySelector<HTMLElement>('mark[data-annotation-id="' + editAnn.id + '"]');
      if (mark) {
        const rect = mark.getBoundingClientRect();
        popTop  = rect.top - popH - 8;
        if (popTop < 8) popTop = rect.bottom + 8;
        popLeft = rect.left;
      }
    } else if (editAnn.anchor.type === 'point') {
      const pin = document.querySelector<HTMLElement>('.oer-hotspot-marker[data-annotation-id="' + editAnn.id + '"]');
      if (pin) {
        const rect = pin.getBoundingClientRect();
        popLeft = rect.right + 12;
        popTop  = rect.top - popH / 2;
      }
    }
  }

  popLeft = Math.max(8, Math.min(popLeft, vw - popW - 8));
  popTop  = Math.max(8, Math.min(popTop,  vh - popH - 8));
  annotationPopup.style.left = popLeft + 'px';
  annotationPopup.style.top  = popTop  + 'px';
  setTimeout(() => bodyEl.focus(), 0);
}

// ── Text selection popup ──────────────────────────────────────────────────────

function openScreenshotModal(url: string) {
  document.getElementById('oer-screenshot-modal')?.remove();
  const backdrop = document.createElement('div');
  backdrop.id = 'oer-screenshot-modal';
  backdrop.style.cssText = `position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;`;

  const img = document.createElement('img');
  img.src = url;
  img.style.cssText = `max-width:90vw;max-height:90vh;object-fit:contain;border-radius:4px;box-shadow:0 8px 32px rgba(0,0,0,0.5);display:block;`;

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '×';
  closeBtn.style.cssText = `position:absolute;top:16px;right:16px;background:rgba(255,255,255,0.15);border:none;color:#fff;font-size:24px;line-height:1;cursor:pointer;border-radius:4px;width:36px;height:36px;display:flex;align-items:center;justify-content:center;`;

  const close = () => backdrop.remove();
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  closeBtn.addEventListener('click', close);
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);

  backdrop.appendChild(img);
  backdrop.appendChild(closeBtn);
  document.body.appendChild(backdrop);
}

function createAnnotationPopupEl() {
  annotationPopup = document.createElement('div');
  annotationPopup.id = 'oer-ann-popup';
  annotationPopup.style.cssText = [
    'position:fixed',
    'z-index:2147483646',
    'background:' + tokens.color.surfaceCard,
    'border:1px solid ' + tokens.color.border,
    'border-radius:0',
    'box-shadow:0 8px 32px rgba(4,22,39,0.14),0 2px 8px rgba(4,22,39,0.06)',
    'width:300px',
    'font-family:' + tokens.font.body,
    'font-size:12px',
    'color:' + tokens.color.textPrimary,
    'display:none',
    'overflow:hidden',
  ].join(';');
  document.body.appendChild(annotationPopup);

  // Prevent clicks inside popup from propagating in ways that clear selection,
  // but allow interactive elements (textarea, select, button) through so they
  // receive native browser handling (dropdown open, focus, click).
  annotationPopup.addEventListener('mousedown', e => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT' || tag === 'BUTTON') return;
    e.preventDefault();
  });
}

// ── Annotation hover tooltip ──────────────────────────────────────────────────

let tooltipHideTimer: ReturnType<typeof setTimeout> | null = null;

// Grace period before hiding so the cursor can travel from the mark/marker
// into the tooltip to reach its Edit/Delete/Open buttons.
function scheduleHideTooltip() {
  cancelHideTooltip();
  tooltipHideTimer = setTimeout(hideAnnotationTooltip, 200);
}

function cancelHideTooltip() {
  if (tooltipHideTimer) { clearTimeout(tooltipHideTimer); tooltipHideTimer = null; }
}

function createAnnotationTooltip() {
  annotationTooltip = document.createElement('div');
  annotationTooltip.id = 'oer-ann-tooltip';
  annotationTooltip.style.cssText = [
    'position:fixed',
    'z-index:2147483647',
    'min-width:220px',
    'max-width:300px',
    'background:' + tokens.color.surfaceCard,
    'border:1px solid ' + tokens.color.border,
    'border-radius:0',
    'box-shadow:0 12px 40px rgba(28,28,24,0.06)',
    'font-family:' + tokens.font.body,
    'font-size:12px',
    'color:' + tokens.color.textPrimary,
    'pointer-events:auto',
    'display:none',
    'overflow:hidden',
  ].join(';');
  annotationTooltip.addEventListener('mouseenter', cancelHideTooltip);
  annotationTooltip.addEventListener('mouseleave', scheduleHideTooltip);
  document.body.appendChild(annotationTooltip);
}

function showAnnotationTooltipFor(annId: string, clientX: number, clientY: number) {
  if (!annotationTooltip) return;
  cancelHideTooltip();
  const ann = annotations.find(a => a.id === annId);
  if (!ann) return;
  if (annotationPopup.style.display !== 'none') return;

  const C = tokens.color;

  const ri = ann.rubric_item_id ? rubricItems.find(r => r.id === ann.rubric_item_id) : null;
  const criterionIdx = ri ? rubricItems.indexOf(ri) + 1 : null;
  const labelAlreadyHasPrefix = ri ? /^C\d+\s/.test(ri.label) : false;
  const criterionLabel = ri ? (labelAlreadyHasPrefix ? ri.label : 'C' + criterionIdx + ' ' + ri.label) : null;

  const bodyText = ann.body.trim();
  const bodyDisplay = bodyText
    ? escHtml(bodyText.slice(0, 80)) + (bodyText.length > 80 ? '…' : '')
    : '<em style="color:' + C.textMuted + ';">No comment written</em>';

  const iconBtnBase = 'background:none;border:none;cursor:pointer;padding:2px;display:flex;align-items:center;line-height:1;font-family:inherit;transition:opacity 0.1s;opacity:0.7;';
  const tagStyle = 'display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:600;padding:2px 8px;border-radius:9999px;letter-spacing:0.04em;' +
    'background:' + C.secondaryContainer + '99;color:' + C.secondary + ';border:1px solid ' + C.secondary + '66;';
  const arrowUpRight = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17L17 7"/><path d="M7 7h10v10"/></svg>';

  const html =
    // ── Header ──
    '<div style="padding:12px 16px;border-bottom:1px solid ' + C.border + ';display:flex;align-items:flex-start;gap:8px;background:' + C.surface + ';">' +
      '<span style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.1em;flex:1;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;' +
        (criterionLabel ? 'color:' + C.textSecondary + ';' : 'color:' + C.textMuted + ';font-style:italic;') + '">' +
        (criterionLabel ? escHtml(criterionLabel) : 'No criterion linked') +
      '</span>' +
      '<div style="display:flex;gap:4px;flex-shrink:0;">' +
        '<button class="tt-edit" style="' + iconBtnBase + 'color:' + C.textMuted + ';">' + SVG_EDIT_ICON + '</button>' +
        '<button class="tt-delete" style="' + iconBtnBase + 'color:' + C.error + ';">' + SVG_DELETE_ICON + '</button>' +
      '</div>' +
    '</div>' +
    // ── Comment ──
    '<div style="padding:12px 16px 4px;font-size:12px;color:' + C.textSecondary + ';line-height:1.5;word-break:break-word;">' +
      bodyDisplay +
    '</div>' +
    // ── View full comment (only when truncated) ──
    (bodyText.length > 80
      ? '<div style="padding:0 16px 8px;">' +
          '<button class="tt-view-full" style="background:none;border:none;cursor:pointer;font-size:12px;color:' + C.secondary + ';opacity:0.7;padding:0;display:inline-flex;align-items:center;gap:4px;font-family:inherit;line-height:1.5;transition:opacity 0.1s;">' +
            'View full comment ' + arrowUpRight +
          '</button>' +
        '</div>'
      : '') +
    // ── Tag pill ──
    (ann.tag
      ? '<div style="padding:0 16px 12px;">' +
          '<span style="' + tagStyle + '">' +
            (ann.tag === 'action_item' ? SVG_TAG_ACTION + ' Action Item' : SVG_TAG_QUICK + ' Quick Fix') +
          '</span>' +
        '</div>'
      : (!bodyText && !ann.tag ? '' : (bodyText.length <= 80 ? '<div style="padding-bottom:12px;"></div>' : '')));

  annotationTooltip.innerHTML = html;
  annotationTooltip.style.display = 'block';

  // Edit icon — opacity hover, opens overlay popup
  const editBtn = annotationTooltip.querySelector<HTMLButtonElement>('.tt-edit');
  if (editBtn) {
    editBtn.addEventListener('mouseenter', () => { editBtn.style.opacity = '1'; });
    editBtn.addEventListener('mouseleave', () => { editBtn.style.opacity = '0.7'; });
    editBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      hideAnnotationTooltip();
      const annToEdit = annotations.find(a => a.id === annId);
      if (annToEdit) openAnnotationPopup({ mode: 'edit', annotation: annToEdit });
    });
  }

  // Delete icon — opacity hover, deletes annotation
  const deleteBtn = annotationTooltip.querySelector<HTMLButtonElement>('.tt-delete');
  if (deleteBtn) {
    deleteBtn.addEventListener('mouseenter', () => { deleteBtn.style.opacity = '1'; });
    deleteBtn.addEventListener('mouseleave', () => { deleteBtn.style.opacity = '0.7'; });
    deleteBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      hideAnnotationTooltip();
      deleteAnnotation(annId);
    });
  }

  // View full comment — opacity hover, scrolls to evidence card in panel
  const viewFullBtn = annotationTooltip.querySelector<HTMLButtonElement>('.tt-view-full');
  if (viewFullBtn) {
    viewFullBtn.addEventListener('mouseenter', () => { viewFullBtn.style.opacity = '1'; });
    viewFullBtn.addEventListener('mouseleave', () => { viewFullBtn.style.opacity = '0.7'; });
    viewFullBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      hideAnnotationTooltip();
      scrollToAnnotationInPanel(annId);
    });
  }

  const tipW = 300;
  let left = clientX - tipW / 2;
  let top = clientY - (annotationTooltip.offsetHeight || 80) - 12;
  left = Math.max(8, Math.min(left, window.innerWidth - tipW - 8));
  if (top < 8) top = clientY + 20;
  annotationTooltip.style.left = left + 'px';
  annotationTooltip.style.top = top + 'px';
}

function hideAnnotationTooltip() {
  cancelHideTooltip();
  if (annotationTooltip) annotationTooltip.style.display = 'none';
}

function showAnnotationPopup(anchor: HtmlCharOffsetAnchor) {
  openAnnotationPopup({ mode: 'create-text', anchor });
}

function hideAnnotationPopup() {
  clearPendingHighlight();
  annotationPopup.style.display = 'none';
}

// ── Hotspot mode ──────────────────────────────────────────────────────────────

function enterHotspotMode() {
  hotspotMode = true;
  document.body.style.cursor = 'crosshair';
  shadow.getElementById('btn-hotspot')?.classList.add('active');

  const banner = document.createElement('div');
  banner.id = 'oer-hotspot-banner';
  banner.style.cssText = `
    position: fixed;
    top: 12px;
    left: calc(50% - ${PANEL_WIDTH / 2}px);
    transform: translateX(-50%);
    background: ${tokens.color.secondaryContainer};
    color: ${tokens.color.onSecondaryContainer};
    padding: 8px 16px;
    border-radius: 20px;
    font-family: ${tokens.font.body};
    font-size: 12px;
    font-weight: 500;
    z-index: 2147483646;
    box-shadow: 0 4px 12px rgba(0,0,0,0.2);
    display: flex;
    align-items: center;
    gap: 8px;
    pointer-events: none;
    white-space: nowrap;
  `;
  banner.innerHTML = `📍 Click anywhere to place a hotspot &nbsp;<span style="background:rgba(0,0,0,0.1);padding:2px 7px;border-radius:10px;font-size:11px;">Esc to cancel</span>`;
  document.body.appendChild(banner);
}

function exitHotspotMode() {
  hotspotMode = false;
  document.body.style.cursor = '';
  shadow.getElementById('btn-hotspot')?.classList.remove('active');
  document.getElementById('oer-hotspot-banner')?.remove();
}

function showHotspotPopup(anchor: PointAnchor, clientX: number, clientY: number) {
  openAnnotationPopup({ mode: 'create-hotspot', anchor, clientX, clientY });
}

function handleMouseUp(e: MouseEvent) {
  if (!selectedReview) return;

  const target = e.target as HTMLElement;
  if (target.closest('#oer-ann-popup') || target.closest('#oer-review-host')) return;

  if (annotationPopup.style.display !== 'none') {
    if (!target.closest('#oer-ann-popup')) hideAnnotationPopup();
    return;
  }

  if (hotspotMode) {
    if (target.classList.contains('oer-hotspot-marker') || target.closest('.oer-hotspot-marker')) return;
    const anchor: PointAnchor = {
      type: 'point',
      pageX: e.pageX,
      pageY: e.pageY,
      relX: e.pageX / document.documentElement.scrollWidth,
      relY: e.pageY / document.documentElement.scrollHeight,
      pageUrl: window.location.href,
      ...buildPointElementAnchor(target, e.clientX, e.clientY),
    };
    showHotspotPopup(anchor, e.clientX, e.clientY);
    return;
  }

  setTimeout(() => {
    const anchor = selectionToAnchor();
    if (anchor) showAnnotationPopup(anchor);
  }, 0);
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function showToast(message: string) {
  let toast = document.getElementById('oer-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'oer-toast';
    toast.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: ${tokens.color.secondaryContainer};
      color: ${tokens.color.onSecondaryContainer};
      padding: 8px 14px;
      border-radius: 6px;
      font-size: 12px;
      font-family: ${tokens.font.body};
      z-index: 2147483647;
      opacity: 0;
      transition: opacity 0.2s;
      max-width: 240px;
      pointer-events: none;
    `;
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.style.opacity = '1';
  setTimeout(() => { toast!.style.opacity = '0'; }, 2500);
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function escHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderContent(state: 'loading' | 'login' | 'no-assignments' | 'torus-access' | 'review') {
  if (!panelBody) return;

  // Footer lives outside panel-body in the outer shell — hide it for all
  // states except 'review', where a hotspot placement is meaningful.
  const panelFt = shadow?.querySelector<HTMLElement>('.panel-ft');
  if (panelFt) panelFt.style.display = state === 'review' ? '' : 'none';

  switch (state) {
    case 'loading':
      panelBody.innerHTML = `
        <div class="state-box">
          <div class="spinner"></div>
          <p class="state-sub">Loading…</p>
        </div>
      `;
      break;

    case 'login':
      panelBody.innerHTML = `
        <div class="state-box" style="padding:24px 20px;">
          <svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg" style="width:44px;height:44px;display:block;margin-bottom:12px;flex-shrink:0;">
            <circle cx="40" cy="40" r="39.75" fill="#FEF5DE" stroke="#C4C6CD" stroke-width="0.5"/>
            <path d="M53.9643 27H44.6429C43.8389 27 43.046 27.1883 42.3269 27.5499C41.6079 27.9115 40.9824 28.4365 40.5 29.0833C40.0176 28.4365 39.3921 27.9115 38.6731 27.5499C37.954 27.1883 37.1611 27 36.3571 27H27.0357C26.761 27 26.4976 27.1097 26.3034 27.3051C26.1091 27.5004 26 27.7654 26 28.0417V46.7917C26 47.0679 26.1091 47.3329 26.3034 47.5282C26.4976 47.7236 26.761 47.8333 27.0357 47.8333H36.3571C37.1812 47.8333 37.9715 48.1626 38.5542 48.7486C39.1369 49.3347 39.4643 50.1295 39.4643 50.9583C39.4643 51.2346 39.5734 51.4996 39.7676 51.6949C39.9619 51.8903 40.2253 52 40.5 52C40.7747 52 41.0381 51.8903 41.2324 51.6949C41.4266 51.4996 41.5357 51.2346 41.5357 50.9583C41.5357 50.1295 41.8631 49.3347 42.4458 48.7486C43.0285 48.1626 43.8188 47.8333 44.6429 47.8333H53.9643C54.239 47.8333 54.5024 47.7236 54.6966 47.5282C54.8909 47.3329 55 47.0679 55 46.7917V28.0417C55 27.7654 54.8909 27.5004 54.6966 27.3051C54.5024 27.1097 54.239 27 53.9643 27ZM36.3571 45.75H28.0714V29.0833H36.3571C37.1812 29.0833 37.9715 29.4126 38.5542 29.9986C39.1369 30.5847 39.4643 31.3795 39.4643 32.2083V46.7917C38.5688 46.1138 37.4779 45.7481 36.3571 45.75ZM52.9286 45.75H44.6429C43.5221 45.7481 42.4312 46.1138 41.5357 46.7917V32.2083C41.5357 31.3795 41.8631 30.5847 42.4458 29.9986C43.0285 29.4126 43.8188 29.0833 44.6429 29.0833H52.9286V45.75ZM44.6429 32.2083H49.8214C50.0961 32.2083 50.3596 32.3181 50.5538 32.5134C50.748 32.7088 50.8571 32.9737 50.8571 33.25C50.8571 33.5263 50.748 33.7912 50.5538 33.9866C50.3596 34.1819 50.0961 34.2917 49.8214 34.2917H44.6429C44.3682 34.2917 44.1047 34.1819 43.9105 33.9866C43.7163 33.7912 43.6071 33.5263 43.6071 33.25C43.6071 32.9737 43.7163 32.7088 43.9105 32.5134C44.1047 32.3181 44.3682 32.2083 44.6429 32.2083ZM50.8571 37.4167C50.8571 37.6929 50.748 37.9579 50.5538 38.1532C50.3596 38.3486 50.0961 38.4583 49.8214 38.4583H44.6429C44.3682 38.4583 44.1047 38.3486 43.9105 38.1532C43.7163 37.9579 43.6071 37.6929 43.6071 37.4167C43.6071 37.1404 43.7163 36.8754 43.9105 36.6801C44.1047 36.4847 44.3682 36.375 44.6429 36.375H49.8214C50.0961 36.375 50.3596 36.4847 50.5538 36.6801C50.748 36.8754 50.8571 37.1404 50.8571 37.4167ZM50.8571 41.5833C50.8571 41.8596 50.748 42.1246 50.5538 42.3199C50.3596 42.5153 50.0961 42.625 49.8214 42.625H44.6429C44.3682 42.625 44.1047 42.5153 43.9105 42.3199C43.7163 42.1246 43.6071 41.8596 43.6071 41.5833C43.6071 41.3071 43.7163 41.0421 43.9105 40.8468C44.1047 40.6514 44.3682 40.5417 44.6429 40.5417H49.8214C50.0961 40.5417 50.3596 40.6514 50.5538 40.8468C50.748 41.0421 50.8571 41.3071 50.8571 41.5833Z" fill="#512906"/>
          </svg>
          <p class="state-title">Log In</p>
          <p class="state-sub" style="margin-bottom:4px;">Use your O4PR Hub account credentials</p>
          <div style="width:100%;max-width:400px;margin:0 auto;text-align:left;">
            <div class="form-group">
              <label class="form-label">Email</label>
              <input id="login-email" type="email" class="input" placeholder="you@institution.edu" />
            </div>
            <div class="form-group">
              <label class="form-label">Password</label>
              <input id="login-password" type="password" class="input" placeholder="Password" />
            </div>
            <div id="login-error" style="color:${tokens.color.error};font-size:12px;margin-bottom:8px;display:none;"></div>
            <button id="btn-login" class="btn btn-primary btn-full" style="margin-top:4px;">Sign In</button>
          </div>
        </div>
      `;
      shadow.getElementById('btn-login')?.addEventListener('click', handleLogin);
      shadow.getElementById('login-password')?.addEventListener('keydown', (e) => {
        if ((e as KeyboardEvent).key === 'Enter') handleLogin();
      });
      break;

    case 'no-assignments':
      panelBody.innerHTML = `
        <div class="state-box">
          <div style="font-size:28px;">📋</div>
          <p class="state-title">No active assignments</p>
          <p class="state-sub">You have no in-progress review assignments. Check the OER Hub dashboard for new tasks.</p>
        </div>
      `;
      break;

    case 'torus-access': {
      const isEnroll = torusAccessReason === 'needs-enroll';
      const target = pendingReviewId ? assignments.find(a => a.id === pendingReviewId) : null;
      const docTitle = target?.documents?.title ?? 'this course';
      const courseUrl = target?.documents?.source_url ?? '';
      panelBody.innerHTML = `
        <div class="state-box" style="padding:24px 20px;">
          <div style="font-size:28px;margin-bottom:8px;">🔐</div>
          <p class="state-title">${isEnroll ? 'Course access required' : 'Sign in to OLI Torus'}</p>
          <p class="state-sub" style="margin-bottom:16px;">
            ${isEnroll
              ? `You need access to <strong>${escHtml(docTitle)}</strong> in OLI Torus before you can review it. Enter the course, then we'll connect you to your review automatically.`
              : `Sign in to OLI Torus to open <strong>${escHtml(docTitle)}</strong>. Once you're in the course, we'll connect you to your review automatically.`}
          </p>
          <button id="btn-torus-login" class="btn btn-primary btn-full">${isEnroll ? 'Go to course' : 'Sign in to OLI Torus'}</button>
        </div>
      `;
      shadow.getElementById('btn-torus-login')?.addEventListener('click', () => {
        window.location.href = isEnroll
          ? (courseUrl || window.location.origin)
          : buildTorusLoginUrl(courseUrl);
      });
      break;
    }

    case 'review':
      renderReviewInterface();
      break;
  }
}

function renderReviewInterface() {
  if (!panelBody || !selectedReview) return;

  // A document can have several independent per-rubric reviews assigned to the
  // same reviewer — surface them as tabs instead of only ever showing the one
  // the extension happened to land on.
  const siblingReviews = assignments.filter(a => a.document_id === selectedReview!.document_id);
  const rubricTabsHtml = siblingReviews.length > 0
    ? `<div class="rubric-tabs" id="rubric-tabs">${siblingReviews.map(sib => {
        const cached = completionCountCache.get(sib.id);
        const badge = cached
          ? `<span class="tab-badge ${cached.scored === cached.total ? 'tab-badge-complete' : 'tab-badge-incomplete'}" id="tab-badge-${sib.id}">${cached.scored}/${cached.total}</span>`
          : `<span class="tab-badge tab-badge-incomplete" id="tab-badge-${sib.id}" style="display:none"></span>`;
        return `<button class="rubric-tab${sib.id === selectedReview!.id ? ' active' : ''}" data-review-id="${sib.id}">${escHtml(sib.rubrics?.title ?? 'Untitled rubric')}${badge}</button>`;
      }).join('')}</div>`
    : '';

  panelBody.innerHTML = `
    <div class="sticky-hd-group">
      <div class="rubric-header">
        <div style="flex:1;min-width:0;">
          <div class="doc-title">${escHtml(selectedReview.documents?.title ?? 'Untitled')}</div>
        </div>
        <div class="rubric-header-btns">
          <button class="btn-hotspot" id="btn-hotspot" title="Add Hotspot (Alt+H)"><svg width="12" height="15" viewBox="0 0 28 36" fill="currentColor"><path d="M14 0C6.268 0 0 6.268 0 14C0 24.5 14 36 14 36C14 36 28 24.5 28 14C28 6.268 21.732 0 14 0Z"/></svg>Add Hotspot</button>
          <a class="btn-open-console" id="btn-open-console" href="${platformUrl}/review?document=${selectedReview.document_id}&review=${selectedReview.id}" target="_blank" title="Open review console with snapshots and rubric grading">&#8599; Console</a>
        </div>
      </div>
      ${rubricTabsHtml}
    </div>

    <div class="side-cards">
      <div class="side-card">
        <div class="side-card-hd" id="side-card-gc-hd">
          <span class="side-card-title">General Comments</span>
          <span class="gc-save-status" id="gc-save-status"></span>
          <span class="expand-icon expanded" id="expand-gc"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></span>
        </div>
        <div class="side-card-bd open" id="side-card-gc-bd">
          <textarea class="gc-textarea" id="general-comment-ta" placeholder="Add comments not tied to a specific criterion…"></textarea>
        </div>
      </div>
      <div class="side-card">
        <div class="side-card-hd" id="side-card-ua-hd">
          <div class="side-card-title-group">
            <span class="side-card-title-text">Unlinked Annotations</span>
            <span class="unlinked-count-badge" id="unlinked-count">0</span>
          </div>
          <span class="expand-icon" id="expand-ua"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></span>
        </div>
        <div class="side-card-bd" id="side-card-ua-bd">
          <p class="ann-empty" id="unlinked-empty" style="display:none">All annotations have been linked to a criterion</p>
          <div class="ann-list" id="ann-list-__unlinked__"></div>
        </div>
      </div>
    </div>

    <div class="criterion-list" id="criterion-list"></div>
  `;

  shadow.querySelectorAll<HTMLButtonElement>('.rubric-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const targetId = tab.dataset.reviewId!;
      if (targetId !== selectedReview?.id) selectReview(targetId);
    });
  });

  shadow.getElementById('btn-hotspot')?.addEventListener('click', () => {
    if (!selectedReview) { showToast('Select a review first'); return; }
    if (hotspotMode) { exitHotspotMode(); } else { enterHotspotMode(); }
  });

  // Side card accordion toggles
  shadow.getElementById('side-card-gc-hd')?.addEventListener('click', () => {
    const bd = shadow.getElementById('side-card-gc-bd');
    const icon = shadow.getElementById('expand-gc');
    if (!bd) return;
    const isOpen = bd.classList.toggle('open');
    if (icon) icon.classList.toggle('expanded', isOpen);
  });

  shadow.getElementById('side-card-ua-hd')?.addEventListener('click', () => {
    const bd = shadow.getElementById('side-card-ua-bd');
    const icon = shadow.getElementById('expand-ua');
    if (!bd) return;
    const isOpen = bd.classList.toggle('open');
    if (icon) icon.classList.toggle('expanded', isOpen);
  });

  // General Comments autosave — writes to reviews.notes (same field the platform reads)
  const gcTa = shadow.getElementById('general-comment-ta') as HTMLTextAreaElement;
  if (gcTa) {
    gcTa.value = selectedReview?.notes ?? '';
    gcTa.addEventListener('input', () => {
      if (gcTimer) clearTimeout(gcTimer);
      setGCSaveStatus('saving');
      gcTimer = setTimeout(async () => {
        if (!selectedReview) return;
        const resp = await send({ type: 'UPDATE_REVIEW_NOTES', payload: { reviewId: selectedReview.id, notes: gcTa.value } });
        if (resp.success) {
          selectedReview.notes = gcTa.value;
          setGCSaveStatus('saved');
        } else {
          setGCSaveStatus('error');
        }
      }, SCORE_DEBOUNCE_MS);
    });
  }

  renderRubricCriteria();
  updateCompletion();
  refreshAnnotationList(UNLINKED_LIST_KEY);
  refreshAnnotationList(FREE_LIST_KEY);
}

// Renders the list of comment inputs for one (criterion, level), plus an "Add comment"
// button — mirrors the web console's multi-comment support. Always renders at least one
// input row so a reviewer can type to activate the rating (matching prior UX).
function renderCommentList(
  itemId: string,
  level: 'does_not_meet' | 'exemplifies' | 'exceeds',
  entries: ScoreCommentEntry[],
  placeholder: string,
): string {
  const rows = entries.length > 0 ? entries : [{ id: null, body: '' } as ScoreCommentEntry];
  const rowsHtml = rows.map((entry, i) => {
    const isLoneEmptyStarter = rows.length === 1 && !entry.id && !entry.body.trim();
    const del = isLoneEmptyStarter
      ? ''
      : `<button type="button" class="score-comment-del" data-item="${itemId}" data-level="${level}" data-index="${i}" title="Remove comment" aria-label="Remove comment">&times;</button>`;
    return `
      <div class="score-comment-row" data-index="${i}">
        <textarea class="score-comment-input" data-item="${itemId}" data-level="${level}" data-index="${i}" rows="3" placeholder="${i === 0 ? escHtml(placeholder) : 'Add another comment...'}">${escHtml(entry.body)}</textarea>
        ${del}
      </div>`;
  }).join('');
  return `<div class="score-comment-list" data-item="${itemId}" data-level="${level}">${rowsHtml}</div>`;
}

function renderRubricCriteria() {
  const list = shadow.getElementById('criterion-list');
  if (!list) return;

  list.innerHTML = rubricItems.map((item, idx) => {
    const labelParts = item.label.split(' · ');
    const code = labelParts.length > 1 ? labelParts[0] : `C${idx + 1}`;
    const rawName = labelParts.length > 1 ? labelParts.slice(1).join(' · ') : item.label;
    const name = rawName.replace(/^[A-Za-z]?\d+\s+/, '');
    const score = scores.get(item.id);
    const selectedLevels = score?.criterion_scores ?? [];
    const annCount = annotations.filter(a => a.rubric_item_id === item.id).length;
    const savedComments = scoreComments.get(item.id) ?? emptyScoreComments();

    return `
      <div class="criterion-item" id="criterion-item-${item.id}">
        <div class="criterion-hd" data-id="${item.id}">
          <div class="status-circle${selectedLevels.length > 0 ? ' scored' : ''}" id="status-circle-${item.id}"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div>
          <span class="crit-code">${escHtml(code)}</span>
          <span class="crit-name">${escHtml(name)}</span>
          <span class="evidence-badge" id="evidence-badge-${item.id}"${annCount === 0 ? ' style="display:none"' : ''}><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg><span id="evidence-count-${item.id}">${annCount}</span></span>
          <div class="hdr-badges">
            <span class="hdr-badge hdr-badge-exc${selectedLevels.includes('exceeds') ? ' active' : ''}" id="hdr-badge-exc-${item.id}">EXC</span>
            <span class="hdr-badge hdr-badge-exe${selectedLevels.includes('exemplifies') ? ' active' : ''}" id="hdr-badge-exe-${item.id}">EXE</span>
            <span class="hdr-badge hdr-badge-dnm${selectedLevels.includes('does_not_meet') ? ' active' : ''}" id="hdr-badge-dnm-${item.id}">DNM</span>
          </div>
          <span class="expand-icon" id="expand-${item.id}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></span>
        </div>
        <div class="criterion-bd" id="crit-body-${item.id}">
          <div class="standard-block">
            <span class="standard-label">Standard</span>
            <p class="standard-text">${escHtml(item.description.replace(/\d+\.\s+/g, ''))}</p>
          </div>
          <div class="rating-row">
            <div class="rating-box rating-box-exceeds${selectedLevels.includes('exceeds') ? ' active' : ''}" id="rbox-exceeds-${item.id}" data-variant="exceeds" data-item="${item.id}">
              <div class="rbox-label rbox-label-exceeds">Exceeds</div>
              ${renderCommentList(item.id, 'exceeds', savedComments.exceeds, 'Note what exceeds the standard...')}
            </div>
            <div class="rating-box rating-box-exemplifies${selectedLevels.includes('exemplifies') ? ' active' : ''}" id="rbox-exemplifies-${item.id}" data-variant="exemplifies" data-item="${item.id}">
              <div class="rbox-label rbox-label-exemplifies">Exemplifies</div>
              ${renderCommentList(item.id, 'exemplifies', savedComments.exemplifies, 'Note what exemplifies the standard...')}
            </div>
            <div class="rating-box rating-box-dnm${selectedLevels.includes('does_not_meet') ? ' active' : ''}" id="rbox-dnm-${item.id}" data-variant="does_not_meet" data-item="${item.id}">
              <div class="rbox-label rbox-label-dnm">Does Not Meet</div>
              ${renderCommentList(item.id, 'does_not_meet', savedComments.does_not_meet, 'Note what does not meet the standard...')}
            </div>
          </div>
          <div class="ann-section-label" id="evidence-label-${item.id}">Evidence (${annCount})</div>
          <div class="ann-list" id="ann-list-${item.id}"></div>
        </div>
      </div>
    `;
  }).join('');

  // Accordion toggles
  list.querySelectorAll<HTMLElement>('.criterion-hd').forEach(hd => {
    hd.addEventListener('click', () => {
      const id = hd.dataset.id!;
      const body = shadow.getElementById(`crit-body-${id}`);
      const icon = shadow.getElementById(`expand-${id}`);
      if (!body) return;
      const isOpen = body.classList.toggle('open');
      if (icon) icon.classList.toggle('expanded', isOpen);
      if (isOpen) refreshAnnotationList(id);
      saveExpandedCriteria();
    });
  });

  // Rating box click handlers (toggle score; textarea clicks pass through)
  list.querySelectorAll<HTMLElement>('.rating-box').forEach(box => {
    box.addEventListener('click', (e) => {
      e.stopPropagation();
      const target = e.target as HTMLElement;
      if (target.tagName === 'TEXTAREA' || target.closest('textarea')) return;
      toggleScore(box.dataset.item!, box.dataset.variant as CriterionScore);
    });
  });

  // Focus-expand behavior (wide mode only — collapses the other textarea box)
  list.querySelectorAll<HTMLTextAreaElement>('.score-comment-input').forEach(ta => {
    ta.addEventListener('focus', () => {
      const itemId = ta.dataset.item!;
      const level = ta.dataset.level as 'does_not_meet' | 'exemplifies' | 'exceeds';
      const cardEl = shadow.getElementById(`criterion-item-${itemId}`);
      if (!cardEl || cardEl.classList.contains('is-narrow')) return;
      const transition = 'flex 150ms ease, max-width 150ms ease, opacity 150ms ease, padding 150ms ease';
      const excEl = shadow.getElementById(`rbox-exceeds-${itemId}`);
      const exeEl = shadow.getElementById(`rbox-exemplifies-${itemId}`);
      const dnmEl = shadow.getElementById(`rbox-dnm-${itemId}`);
      if (level === 'exceeds') {
        if (excEl) { excEl.style.flex = '2 1 0%'; excEl.style.transition = transition; }
        if (exeEl) { exeEl.style.flex = '1 1 0%'; exeEl.style.transition = transition; }
        if (dnmEl) Object.assign(dnmEl.style, { flex: '0 0 0%', maxWidth: '0', opacity: '0', overflow: 'hidden', padding: '0', transition });
      } else if (level === 'does_not_meet') {
        if (dnmEl) { dnmEl.style.flex = '2 1 0%'; dnmEl.style.transition = transition; }
        if (exeEl) { exeEl.style.flex = '1 1 0%'; exeEl.style.transition = transition; }
        if (excEl) Object.assign(excEl.style, { flex: '0 0 0%', maxWidth: '0', opacity: '0', overflow: 'hidden', padding: '0', transition });
      } else {
        if (exeEl) { exeEl.style.flex = '2 1 0%'; exeEl.style.transition = transition; }
        if (excEl) { excEl.style.flex = '1 1 0%'; excEl.style.transition = transition; }
        if (dnmEl) { dnmEl.style.flex = '1 1 0%'; dnmEl.style.transition = transition; }
      }
    });
    ta.addEventListener('blur', () => {
      const itemId = ta.dataset.item!;
      const cardEl = shadow.getElementById(`criterion-item-${itemId}`);
      if (!cardEl || cardEl.classList.contains('is-narrow')) return;
      const transition = 'flex 150ms ease, max-width 150ms ease, opacity 150ms ease, padding 150ms ease';
      [
        shadow.getElementById(`rbox-exceeds-${itemId}`),
        shadow.getElementById(`rbox-exemplifies-${itemId}`),
        shadow.getElementById(`rbox-dnm-${itemId}`),
      ].forEach(box => {
        if (box) Object.assign(box.style, { flex: '1 1 0%', maxWidth: '', opacity: '', overflow: '', padding: '', transition });
      });
    });
  });

  // Score comment inputs: save text and auto-activate/deactivate the rating on typing.
  list.querySelectorAll<HTMLTextAreaElement>('.score-comment-input').forEach(ta => {
    ta.addEventListener('input', () => {
      const itemId = ta.dataset.item!;
      const level = ta.dataset.level as 'does_not_meet' | 'exemplifies' | 'exceeds';
      const index = Number(ta.dataset.index ?? '0');
      // Update in-memory body first so toggleScore → flushScore → syncScoreComments sees the new value.
      const map = scoreComments.get(itemId) ?? emptyScoreComments();
      const arr = map[level].slice();
      arr[index] = { id: arr[index]?.id ?? null, body: ta.value };
      scoreComments.set(itemId, { ...map, [level]: arr });

      const anyNonEmpty = arr.some(e => e.body.trim());
      const currentLevels = scores.get(itemId)?.criterion_scores ?? [];
      if (anyNonEmpty && !currentLevels.includes(level)) {
        // First non-empty comment in this level — activate the rating; toggleScore handles UI + scheduling.
        toggleScore(itemId, level);
        return;
      }
      if (!anyNonEmpty && currentLevels.includes(level)) {
        // All comments cleared — deactivate this rating.
        toggleScore(itemId, level);
        return;
      }
      // Score unchanged — just persist the updated comment text.
      updateCompletion();
      setSaveStatus('saving');
      const existing = scoreTimers.get(itemId);
      if (existing) clearTimeout(existing);
      scoreTimers.set(itemId, setTimeout(() => flushScore(itemId), SCORE_DEBOUNCE_MS));
    });
  });

  // "×" — remove a single comment (deleting its row if persisted).
  list.querySelectorAll<HTMLButtonElement>('.score-comment-del').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const itemId = btn.dataset.item!;
      const level = btn.dataset.level as 'does_not_meet' | 'exemplifies' | 'exceeds';
      const index = Number(btn.dataset.index ?? '0');
      const map = scoreComments.get(itemId) ?? emptyScoreComments();
      const arr = map[level].slice();
      const entry = arr[index];
      if (!entry) return;
      if (entry.id) {
        setSaveStatus('saving');
        const resp = await send({ type: 'DELETE_SCORE_COMMENT', payload: { id: entry.id } });
        if (!resp.success) { setSaveStatus('error'); return; }
      }
      arr.splice(index, 1);
      scoreComments.set(itemId, { ...map, [level]: arr });
      renderRubricCriteria();
      updateCompletion();
      if (entry.id) setSaveStatus('saved');
    });
  });

  // Restore which criterion accordions were expanded before this render
  // (e.g. after a reload/navigation, or a full re-render triggered by delete).
  const expanded = new Set(loadExpandedCriteria());
  rubricItems.forEach(item => {
    if (!expanded.has(item.id)) return;
    const body = shadow.getElementById(`crit-body-${item.id}`);
    const icon = shadow.getElementById(`expand-${item.id}`);
    if (!body) return;
    body.classList.add('open');
    if (icon) icon.classList.add('expanded');
    refreshAnnotationList(item.id);
  });

  // ResizeObservers — toggle .is-narrow on each criterion card at 492px
  criterionResizeObservers.forEach(obs => obs.disconnect());
  criterionResizeObservers.clear();
  rubricItems.forEach(item => {
    const cardEl = shadow.getElementById(`criterion-item-${item.id}`);
    if (!cardEl) return;
    const obs = new ResizeObserver(([entry]) => {
      const isNarrow = entry.contentRect.width < 492;
      cardEl.classList.toggle('is-narrow', isNarrow);
      if (isNarrow) {
        // Clear any JS-applied focus-expand inline styles
        [
          shadow.getElementById(`rbox-exceeds-${item.id}`),
          shadow.getElementById(`rbox-exemplifies-${item.id}`),
          shadow.getElementById(`rbox-dnm-${item.id}`),
        ].forEach(box => {
          if (box) Object.assign(box.style, { flex: '', maxWidth: '', opacity: '', overflow: '', padding: '' });
        });
      }
    });
    obs.observe(cardEl);
    criterionResizeObservers.set(item.id, obs);
  });
}

// ── Persisted UI state (survives page reload / same-tab navigation) ───────────

function saveExpandedCriteria() {
  const openIds = Array.from(shadow.querySelectorAll('.criterion-bd.open'))
    .map(el => el.id.replace('crit-body-', ''));
  try { sessionStorage.setItem(EXPANDED_CRIT_KEY, JSON.stringify(openIds)); } catch { /* storage unavailable */ }
}

function loadExpandedCriteria(): string[] {
  try {
    const raw = sessionStorage.getItem(EXPANDED_CRIT_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch { return []; }
}

interface PanelGeometry {
  left: number | null;
  top: number;
  right: number | null;
  width: number;
  height: number;
  collapsed: boolean;
}

function savePanelGeometry() {
  if (!panelHost || !shadow) return;
  const panel = shadow.querySelector('.panel');
  const collapsed = panel?.classList.contains('collapsed') ?? false;
  const rect = panelHost.getBoundingClientRect();
  const usesLeft = panelHost.style.left !== '' && panelHost.style.left !== 'auto';
  const geom: PanelGeometry = {
    left: usesLeft ? rect.left : null,
    top: rect.top,
    right: usesLeft ? null : window.innerWidth - rect.right,
    width: rect.width,
    height: collapsed ? savedPanelH : rect.height,
    collapsed,
  };
  try { sessionStorage.setItem(PANEL_GEOM_KEY, JSON.stringify(geom)); } catch { /* storage unavailable */ }
}

function loadPanelGeometry(): PanelGeometry | null {
  try {
    const raw = sessionStorage.getItem(PANEL_GEOM_KEY);
    return raw ? (JSON.parse(raw) as PanelGeometry) : null;
  } catch { return null; }
}

// ── Panel creation ────────────────────────────────────────────────────────────

function createPanel() {
  const host = document.createElement('div');
  host.id = 'oer-review-host';
  panelHost = host;
  const defaultW = PANEL_WIDTH;
  const defaultH = Math.round(window.innerHeight * 0.95);
  const initRight = 16;
  const initTop = 16;

  // Restore prior position/size so reloading or navigating the OLI Torus page
  // doesn't reset the console back to its default corner and dimensions.
  const savedGeom = loadPanelGeometry();
  const startW = savedGeom?.width ?? defaultW;
  const expandedH = savedGeom?.height ?? defaultH;
  const startH = savedGeom?.collapsed ? defaultH : expandedH;
  savedPanelH = expandedH; // height to restore to when un-collapsing

  host.style.cssText = `
    position: fixed !important;
    top: ${savedGeom?.top ?? initTop}px !important;
    ${savedGeom?.left != null
      ? `left: ${savedGeom.left}px !important;`
      : `right: ${savedGeom?.right ?? initRight}px !important;`}
    width: ${startW}px !important;
    height: ${startH}px !important;
    z-index: 2147483647 !important;
    pointer-events: auto !important;
    overflow: visible !important;
    border-radius: 12px !important;
  `;

  shadow = host.attachShadow({ mode: 'open' });

  shadow.innerHTML = `
    <style>
      @font-face {
        font-family: 'Lato';
        font-weight: 400;
        src: url(${latoRegular}) format('woff2');
      }
      @font-face {
        font-family: 'Lato';
        font-weight: 700;
        src: url(${latoBold}) format('woff2');
      }
      @font-face {
        font-family: 'Newsreader';
        font-weight: 200 800;
        src: url(${newsreaderVariable}) format('woff2-variations');
      }

      * { box-sizing: border-box; margin: 0; padding: 0; }
      :host { display: block; }

      .panel {
        width: 100%;
        height: 100%;
        background: ${tokens.color.surfaceCard};
        border: 1px solid ${tokens.color.border};
        border-radius: 12px;
        display: flex;
        flex-direction: column;
        font-family: ${tokens.font.body};
        font-size: 14px;
        color: ${tokens.color.textPrimary};
        box-shadow: 0 8px 40px rgba(0,0,0,0.16), 0 2px 8px rgba(0,0,0,0.08);
        overflow: hidden;
      }
      .panel.collapsed .panel-body { display: none; }
      .panel.collapsed .panel-ft   { display: none; }

      .panel-hd {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 14px;
        background: ${tokens.color.primary};
        color: ${tokens.color.onPrimary};
        flex-shrink: 0;
        gap: 8px;
        cursor: grab;
        border-radius: 11px 11px 0 0;
        user-select: none;
      }
      .panel-hd.dragging { cursor: grabbing; }

      /* Resize handles — positioned relative to :host */
      .resize-handle {
        position: absolute;
        z-index: 10;
      }
      .rh-n  { top: -5px; left: 12px; right: 12px; height: 10px; cursor: n-resize; }
      .rh-s  { bottom: -5px; left: 12px; right: 12px; height: 10px; cursor: s-resize; }
      .rh-e  { right: -5px; top: 12px; bottom: 12px; width: 10px; cursor: e-resize; }
      .rh-w  { left: -5px; top: 12px; bottom: 12px; width: 10px; cursor: w-resize; }
      .rh-ne { top: -5px; right: -5px; width: 16px; height: 16px; cursor: ne-resize; }
      .rh-nw { top: -5px; left: -5px; width: 16px; height: 16px; cursor: nw-resize; }
      .rh-se { bottom: -5px; right: -5px; width: 16px; height: 16px; cursor: se-resize; }
      .rh-sw { bottom: -5px; left: -5px; width: 16px; height: 16px; cursor: sw-resize; }

      .logo {
        display: flex;
        align-items: center;
        gap: 7px;
        font-weight: 600;
        font-size: 13px;
        letter-spacing: 0.01em;
      }

      .hd-btn {
        background: rgba(255,255,255,0.15);
        border: none;
        color: ${tokens.color.onPrimary};
        cursor: pointer;
        width: 26px;
        height: 26px;
        border-radius: 5px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 15px;
        transition: background 0.15s;
        flex-shrink: 0;
        font-family: inherit;
        line-height: 1;
      }
      .hd-btn:hover { background: rgba(255,255,255,0.25); }

      .panel-body {
        flex: 1;
        overflow-y: auto;
        overflow-x: hidden;
        background: ${tokens.color.surface};
      }

      .panel-body::-webkit-scrollbar { width: 4px; }
      .panel-body::-webkit-scrollbar-track { background: transparent; }
      .panel-body::-webkit-scrollbar-thumb { background: ${tokens.color.border}; border-radius: 4px; }

      .panel-ft {
        padding: 10px 14px;
        border-top: 1px solid ${tokens.color.border};
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-shrink: 0;
        gap: 8px;
      }

      .submit-reminder { font-size: 10px; color: ${tokens.color.textMuted}; font-style: italic; }

      /* "saving" uses textMuted (matches platform's FreeNotesSection autosave pattern) */
      .save-status { font-size: 11px; color: ${tokens.color.textMuted}; }
      .save-status.saving { color: ${tokens.color.textMuted}; }
      .save-status.saved  { color: ${tokens.color.success}; }
      .save-status.error  { color: ${tokens.color.error}; }

      /* State boxes */
      .state-box {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 40px 20px;
        text-align: center;
        gap: 8px;
        min-height: 200px;
      }

      .state-title {
        font-size: 14px;
        font-weight: 600;
        color: ${tokens.color.textPrimary};
        font-family: ${tokens.font.heading};
      }

      .state-sub {
        font-size: 11px;
        color: ${tokens.color.textSecondary};
        line-height: 1.5;
        max-width: 280px;
      }

      .spinner {
        width: 24px;
        height: 24px;
        border: 2.5px solid ${tokens.color.border};
        border-top-color: ${tokens.color.primary};
        border-radius: 50%;
        animation: spin 0.7s linear infinite;
      }
      @keyframes spin { to { transform: rotate(360deg); } }

      /* Forms */
      .input {
        width: 100%;
        padding: 0 0 8px;
        border: none;
        border-bottom: 2px solid ${tokens.color.border};
        border-radius: 0;
        font-size: 11px;
        color: ${tokens.color.textPrimary};
        background: transparent;
        outline: none;
        font-family: inherit;
        transition: border-color 0.15s;
      }
      .input::placeholder { color: ${tokens.color.textMuted}; }
      .input:focus { border-bottom-color: ${tokens.color.primary}; }
      .input.error { border-bottom-color: ${tokens.color.error}; }

      .form-group { margin-bottom: 16px; }
      .form-label { display: block; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.1em; color: ${tokens.color.textSecondary}; margin-bottom: 6px; }

      .btn { display: inline-flex; align-items: center; justify-content: center; padding: 8px 14px; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer; border: none; font-family: inherit; transition: all 0.2s; }
      .btn:active { transform: scale(0.99); }
      .btn:focus-visible { outline: 2px solid ${tokens.color.primary}; outline-offset: 2px; }
      .btn-primary { background: ${tokens.color.primary}; color: ${tokens.color.onPrimary}; }
      .btn-primary:hover { background: ${tokens.color.primaryHover}; }
      .btn-full { width: 100%; }

      /* Side cards: General Comments + Unlinked Annotations */
      .side-cards { display: flex; flex-direction: column; gap: 8px; padding: 16px 12px 0; }
      .side-card { border: 1px solid ${tokens.color.border}; border-radius: 8px; background: ${tokens.color.surfaceCard}; overflow: hidden; box-shadow: inset 3px 0 0 ${tokens.color.secondary}; }
      .side-card-hd { display: flex; align-items: center; gap: 8px; padding: 12px 16px; cursor: pointer; user-select: none; transition: background 0.1s; }
      .side-card-title { flex: 1; font-size: 13px; font-weight: 600; color: ${tokens.color.textPrimary}; font-family: ${tokens.font.heading}; }
      .side-card-title-group { display: flex; align-items: center; gap: 6px; flex: 1; }
      .side-card-title-text { font-size: 13px; font-weight: 600; color: ${tokens.color.textPrimary}; font-family: ${tokens.font.heading}; }
      .side-card-bd { display: none; border-top: 1px solid ${tokens.color.border}; padding: 12px 16px 16px; flex-direction: column; gap: 8px; }
      .side-card-bd.open { display: flex; }
      .ann-empty { font-size: 11px; font-style: italic; color: ${tokens.color.textMuted}; padding: 4px 0; }
      .gc-textarea { width: 100%; padding: 8px 0; border: none; border-bottom: 2px solid ${tokens.color.border}; border-radius: 0; font-size: 12px; resize: vertical; min-height: 80px; font-family: inherit; color: ${tokens.color.textPrimary}; background: transparent; box-sizing: border-box; outline: none; transition: border-color 0.15s; }
      .gc-textarea:focus { border-bottom-color: ${tokens.color.primary}; }
      .gc-textarea::placeholder { color: ${tokens.color.textMuted}; }
      .gc-save-status { font-size: 10px; flex-shrink: 0; }
      .gc-save-status.saving { color: ${tokens.color.textMuted}; }
      .gc-save-status.saved  { color: ${tokens.color.success}; }
      .gc-save-status.error  { color: ${tokens.color.error}; }
      .unlinked-count-badge { font-size: 10px; font-weight: 700; padding: 1px 7px; border-radius: 9999px; flex-shrink: 0; background: ${tokens.color.surfaceContainer}; color: ${tokens.color.textMuted}; }
      .unlinked-count-badge.has-items { background: ${tokens.color.secondaryContainer}99; color: ${tokens.color.secondary}; }

      /* Sticky header + tab group */
      .sticky-hd-group {
        position: sticky;
        top: 0;
        z-index: 5;
        background: ${tokens.color.surfaceCard};
      }

      /* Rubric header */
      .rubric-header {
        padding: 10px 14px;
        background: ${tokens.color.surfaceCard};
        border-bottom: 1px solid ${tokens.color.border};
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        flex-shrink: 0;
      }
      .doc-title { font-size: 13px; font-weight: 600; color: ${tokens.color.textPrimary}; font-family: ${tokens.font.heading}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .rubric-header-btns { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }

      .rubric-tabs { display: flex; gap: 2px; padding: 0 10px; background: ${tokens.color.surfaceCard}; border-bottom: 1px solid ${tokens.color.border}; overflow-x: auto; flex-shrink: 0; scrollbar-width: none; }
      .rubric-tabs::-webkit-scrollbar { display: none; }
      .rubric-tab {
        display: inline-flex; align-items: center; gap: 6px;
        background: ${tokens.color.surfaceCard}; border: none; border-bottom: 2px solid transparent;
        padding: 7px 10px; font-size: 11px; font-weight: 600; color: ${tokens.color.textSecondary};
        cursor: pointer; white-space: nowrap; font-family: inherit; transition: color 0.15s, border-color 0.15s;
      }
      .rubric-tab:hover { color: ${tokens.color.primary}; }
      .rubric-tab.active { color: ${tokens.color.primary}; border-bottom-color: ${tokens.color.primary}; background: ${tokens.color.surface}; }
      .tab-badge { font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 9999px; border: 1px solid; flex-shrink: 0; }
      .tab-badge-complete { background: ${tokens.color.successContainer}; color: ${tokens.color.success}; border-color: ${tokens.color.success}; }
      .tab-badge-incomplete { background: ${tokens.color.secondaryContainer}; color: ${tokens.color.secondary}; border-color: ${tokens.color.secondary}; }

      /* Criterion cards */
      .criterion-list { display: flex; flex-direction: column; gap: 8px; padding: 8px 12px; }
      .criterion-item { border: 1px solid ${tokens.color.border}; border-radius: 8px; background: ${tokens.color.surfaceCard}; overflow: hidden; }
      .criterion-hd { display: flex; align-items: center; gap: 8px; padding: 12px 16px; cursor: pointer; transition: background 0.1s; user-select: none; }
      .expand-icon { color: ${tokens.color.textMuted}; flex-shrink: 0; display: flex; align-items: center; transition: transform 150ms ease; }
      .expand-icon.expanded { transform: rotate(180deg); }

      .status-circle { width: 20px; height: 20px; border-radius: 50%; border: 2px solid ${tokens.color.border}; background: transparent; flex-shrink: 0; display: flex; align-items: center; justify-content: center; color: transparent; transition: border-color 0.1s, background 0.1s, color 0.1s; }
      .status-circle.scored { border-color: ${tokens.color.secondary}; background: ${tokens.color.secondaryContainer}; color: ${tokens.color.onSecondaryContainer}; }

      .crit-code { font-size: 10px; font-weight: 700; color: ${tokens.color.secondary}; min-width: 28px; flex-shrink: 0; text-transform: uppercase; letter-spacing: 0.07em; }
      .crit-name { flex: 1; font-size: 13px; font-weight: 600; color: ${tokens.color.textPrimary}; font-family: ${tokens.font.heading}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .evidence-badge { display: flex; align-items: center; gap: 4px; background: ${tokens.color.secondaryContainer}99; color: ${tokens.color.secondary}; border-radius: 9999px; padding: 2px 8px; font-size: 10px; font-weight: 700; flex-shrink: 0; }

      .hdr-badges { display: flex; flex-direction: row; gap: 4px; flex-shrink: 0; }
      .hdr-badge { font-size: 9px; font-weight: 700; padding: 2px 6px; border-radius: 0; text-transform: uppercase; letter-spacing: 0.04em; border: 1px solid ${tokens.color.border}66; color: ${tokens.color.textSecondary}66; background: transparent; }
      .hdr-badge-exc.active { background: ${tokens.rating.exceedsBg}; color: ${tokens.rating.exceedsText}; border-color: ${tokens.rating.exceedsBorder}; }
      .hdr-badge-exe.active { background: ${tokens.rating.exemplifiesBg}; color: ${tokens.rating.exemplifiesText}; border-color: ${tokens.color.primary}; }
      .hdr-badge-dnm.active { background: ${tokens.rating.dnmBg}; color: ${tokens.rating.dnmText}; border-color: ${tokens.rating.dnmBorder}; }

      .criterion-bd { display: none; border-top: 1px solid ${tokens.color.border}; padding: 12px 16px 16px; flex-direction: column; gap: 16px; }
      .criterion-bd.open { display: flex; }

      /* Rating row — replaces .score-btns */
      .rating-row { display: flex; flex-direction: row; gap: 8px; min-width: 0; }
      .criterion-item.is-narrow .rating-row { flex-direction: column; }

      .rating-box {
        flex: 1 1 0%;
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 10px;
        border-radius: 0;
        border: 1px solid ${tokens.color.border};
        background: ${tokens.color.surfaceContainer};
        cursor: pointer;
        min-width: 0;
        overflow: hidden;
        transition: flex 150ms ease, max-width 150ms ease, opacity 150ms ease, padding 150ms ease;
      }
      .criterion-item.is-narrow .rating-box { flex: none !important; width: 100%; max-width: none !important; opacity: 1 !important; overflow: hidden; }

      .rating-box-exceeds.active    { border: 2px solid ${tokens.color.secondary}; }
      .rating-box-exemplifies.active { border: 2px solid ${tokens.color.primary}; }
      .rating-box-dnm.active        { border: 2px solid ${tokens.color.error}; }

      .rbox-label { font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }
      .rbox-label-exceeds     { color: ${tokens.color.secondary}; }
      .rbox-label-exemplifies { color: ${tokens.color.primary}; }
      .rbox-label-dnm         { color: ${tokens.color.error}; }
      .standard-block { display: flex; flex-direction: column; gap: 3px; }
      .standard-label { font-size: 9px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: ${tokens.color.textSecondary}; }
      .standard-text { font-size: 11px; color: ${tokens.color.textSecondary}; line-height: 1.5; margin: 0; }

      .score-comment-input { flex: 1; width: 100%; padding: 0 0 8px; border: none; border-bottom: 1px solid ${tokens.color.border}; border-radius: 0; font-size: 12px; resize: none; font-family: inherit; color: ${tokens.color.textPrimary}; box-sizing: border-box; outline: none; background: transparent; }
      .score-comment-input::placeholder { color: ${tokens.color.textMuted}; opacity: 0.7; }
      .rating-box-exceeds .score-comment-input { border-bottom-color: rgba(115,92,0,0.4); }
      .rating-box-exceeds .score-comment-input:focus { border-bottom-color: ${tokens.color.secondary}; }
      .rating-box-exemplifies .score-comment-input { border-bottom-color: rgba(4,22,39,0.25); }
      .rating-box-exemplifies .score-comment-input:focus { border-bottom-color: ${tokens.color.primary}; }
      .rating-box-dnm .score-comment-input { border-bottom-color: rgba(186,26,26,0.4); }
      .rating-box-dnm .score-comment-input:focus { border-bottom-color: ${tokens.color.error}; }

      .score-comment-list { display: flex; flex-direction: column; gap: 8px; width: 100%; }
      .score-comment-row { display: flex; align-items: flex-start; gap: 4px; }
      .score-comment-row .score-comment-input { flex: 1; }
      .score-comment-del { flex-shrink: 0; border: none; background: transparent; color: ${tokens.color.textMuted}; cursor: pointer; font-size: 15px; line-height: 1; padding: 2px 4px; border-radius: 4px; font-family: inherit; }
      .score-comment-del:hover { color: ${tokens.color.error}; background: rgba(186,26,26,0.08); }

      .btn-open-console { display: flex; align-items: center; gap: 5px; padding: 5px 9px; border-radius: 5px; border: 1px solid ${tokens.color.border}; background: ${tokens.color.surfaceCard}; color: ${tokens.color.primary}; font-size: 11px; font-weight: 600; cursor: pointer; font-family: inherit; transition: all 0.15s; text-decoration: none; flex-shrink: 0; }
      .btn-open-console:hover { background: ${tokens.color.surface}; border-color: ${tokens.color.primary}; }

      .ann-section-label { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.07em; color: ${tokens.color.textMuted}; margin-bottom: 4px; }

      .ann-list { display: flex; flex-direction: column; gap: 6px; }
      .ann-item { position: relative; background: ${tokens.color.surfaceContainerLow}; border: 1px solid ${tokens.color.border}; border-radius: 0; padding: 10px 48px 12px 12px; font-size: 12px; color: ${tokens.color.textSecondary}; line-height: 1.5; }
      @keyframes card-highlight-pulse {
        0%   { box-shadow: 0 0 0 3px rgba(115, 92, 0, 0.5); }
        40%  { box-shadow: 0 0 0 3px rgba(234, 179, 8, 0.8); }
        100% { box-shadow: 0 0 0 3px rgba(234, 179, 8, 0.8); }
      }
      .ann-item.card-highlight.active { animation: card-highlight-pulse 1.6s ease-out; }

      .ann-page-label { display: flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 500; color: ${tokens.color.textSecondary}; overflow: hidden; }
      .ann-page-label svg { flex-shrink: 0; }
      .ann-page-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
      .ann-divider { height: 1px; background: ${tokens.color.border}; margin: 6px 0; }

      .ann-screenshot-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
      .screenshot-thumb { width: 44px; height: 44px; flex-shrink: 0; object-fit: cover; border-radius: 4px; border: 1px solid ${tokens.color.border}; cursor: pointer; display: block; }
      .ann-view-screenshot { background: none; border: none; color: ${tokens.color.secondary}; font-size: 10px; font-weight: 600; cursor: pointer; font-family: inherit; padding: 0; }
      .ann-view-screenshot:hover { text-decoration: underline; }

      .ann-sh { font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.07em; color: ${tokens.color.textMuted}; margin-top: 8px; margin-bottom: 3px; display: flex; align-items: center; gap: 4px; }
      .ann-sh-row { display: flex; align-items: center; gap: 8px; margin-top: 8px; margin-bottom: 3px; }
      .ann-sh-row .ann-sh { margin-top: 0; margin-bottom: 0; }
      .ann-quote { font-style: italic; font-family: ${tokens.font.heading}; font-size: 11px; color: ${tokens.color.textPrimary}; line-height: 1.5; }
      .ann-no-quote { font-style: italic; font-size: 11px; color: ${tokens.color.textMuted}; }
      .ann-body { font-size: 12px; color: ${tokens.color.textSecondary}; }
      .field-clamp { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
      .field-clamp.expanded { display: block; -webkit-line-clamp: unset; overflow: visible; }
      .ann-expand-btn { background: none; border: none; color: ${tokens.color.secondary}; font-size: 10px; font-weight: 600; cursor: pointer; font-family: inherit; padding: 0; }
      .ann-expand-btn:hover { text-decoration: underline; }
      .ann-tag { display: inline-flex; align-items: center; gap: 4px; font-size: 10px; font-weight: 600; padding: 2px 8px; border-radius: 9999px; background: ${tokens.color.secondaryContainer}99; color: ${tokens.color.secondary}; border: 1px solid ${tokens.color.secondary}66; letter-spacing: 0.04em; }
      .ann-tag svg { flex-shrink: 0; }

      .ann-icon-btns { position: absolute; top: 8px; right: 8px; display: flex; align-items: center; gap: 2px; }
      .ann-goto { background: none; border: none; color: ${tokens.color.secondary}; font-size: 10px; font-weight: 600; cursor: pointer; font-family: inherit; padding: 0; }
      .ann-goto:hover { text-decoration: underline; }
      .ann-edit { background: none; border: none; cursor: pointer; color: ${tokens.color.textMuted}; padding: 3px; border-radius: 3px; display: flex; align-items: center; line-height: 1; font-family: inherit; }
      .ann-edit:hover { color: ${tokens.color.primary}; }
      .ann-delete { background: none; border: none; cursor: pointer; color: ${tokens.color.textMuted}; padding: 3px; border-radius: 3px; display: flex; align-items: center; line-height: 1; font-family: inherit; }
      .ann-delete:hover { color: ${tokens.color.error}; }
      .ann-link { display: block; margin-top: 6px; width: 100%; padding: 4px 6px; border-radius: 5px; border: 1px solid ${tokens.color.border}; background: ${tokens.color.surfaceCard}; color: ${tokens.color.textSecondary}; font-size: 11px; font-family: inherit; cursor: pointer; outline: none; }
      .ann-link:hover { border-color: ${tokens.color.borderStrong}; }
      .ann-link:focus { border-color: ${tokens.color.secondary}; box-shadow: 0 0 0 2px ${tokens.color.secondaryContainer}66; }

      .ann-edit-input { width: 100%; padding: 6px 0; border: none; border-bottom: 2px solid ${tokens.color.border}; background: transparent; font-size: 12px; resize: vertical; font-family: inherit; color: ${tokens.color.textPrimary}; box-sizing: border-box; outline: none; transition: border-color 0.15s; }
      .ann-edit-input:focus { border-bottom-color: ${tokens.color.primary}; }
      .ann-tag-toggles { display: flex; gap: 6px; flex-wrap: wrap; }
      .ann-tag-btn { display: inline-flex; align-items: center; gap: 4px; font-size: 10px; font-weight: 600; padding: 2px 8px; border-radius: 9999px; border: 1px solid ${tokens.color.border}; background: transparent; color: ${tokens.color.textSecondary}; cursor: pointer; font-family: inherit; transition: all 0.12s; letter-spacing: 0.04em; }
      .ann-tag-btn.active { background: ${tokens.color.secondaryContainer}99; color: ${tokens.color.secondary}; border-color: ${tokens.color.secondary}66; }
      .ann-criterion-sel { width: 100%; padding: 6px 0; border: none; border-bottom: 2px solid ${tokens.color.border}; background: transparent; font-size: 12px; font-family: inherit; color: ${tokens.color.textPrimary}; outline: none; cursor: pointer; }
      .ann-criterion-sel:focus { border-bottom-color: ${tokens.color.primary}; }
      .ann-edit-actions { display: flex; justify-content: flex-end; gap: 6px; margin-top: 10px; }
      .ann-edit-cancel { padding: 5px 12px; border-radius: 0; border: 1px solid ${tokens.color.border}; background: ${tokens.color.surfaceCard}; font-size: 11px; cursor: pointer; font-family: inherit; color: ${tokens.color.textSecondary}; }
      .ann-edit-confirm { padding: 5px 12px; border-radius: 0; border: none; background: ${tokens.color.primary}; color: ${tokens.color.onPrimary}; font-size: 11px; font-weight: 600; cursor: pointer; font-family: inherit; }
      .ann-edit-confirm:disabled { background: ${tokens.color.surfaceContainerHigh}; color: ${tokens.color.textMuted}; cursor: not-allowed; }
      .ann-edit-hint { font-size: 10px; color: ${tokens.color.textMuted}; font-style: italic; flex: 1; }

      .btn-hotspot { display: flex; align-items: center; gap: 5px; padding: 5px 9px; border-radius: 5px; border: 1px solid ${tokens.color.primary}; background: ${tokens.color.primary}; color: ${tokens.color.onPrimary}; font-size: 11px; font-weight: 600; cursor: pointer; font-family: inherit; transition: all 0.15s; }
      .btn-hotspot:hover { background: ${tokens.color.primaryHover}; border-color: ${tokens.color.primaryHover}; }
      .btn-hotspot.active { background: ${tokens.color.secondaryContainer}; border-color: ${tokens.color.secondary}; color: ${tokens.color.secondary}; }

    </style>

    <div class="panel">
      <div class="panel-hd" id="panel-hd">
        <div class="logo">
          <svg width="20" height="20" viewBox="0 0 499 495" fill="none" aria-hidden="true" style="flex-shrink:0;"><path d="M244.705 -1H258.179C277.607 3.98984 288.908 7.99885 299.979 26.692C306.601 37.8721 308.9 52.5449 305.763 65.2819C302.18 79.8258 292.843 88.0392 284.694 98.3417C296.371 100.39 316.286 118.929 322.857 128.452C336.716 148.537 343.287 170.421 339.065 194.861C338.845 196.123 338.604 197.381 338.344 198.635C347.571 190.399 362.459 176.262 374.166 174.078C358.618 157.888 352.507 150.516 352.542 127.095C352.361 94.9411 378.171 73.4958 409.116 74.4122C439.955 75.3257 464.246 96.8907 464.157 129.208C464.113 145.268 453.521 165.127 440.54 174.006C475.233 181.28 495.515 218.684 497.33 251.649C497.494 254.593 498.757 262.784 500 265.032V314.974C496.178 329.009 499.303 350.753 497.097 365.199C493.498 387.815 465.386 382.138 449.404 381.641C440.942 381.377 429.544 381.58 421.384 380.3C421.882 386.065 421.818 393.911 421.973 399.894C422.394 413.703 422.6 427.517 422.591 441.332C422.622 453.145 423.128 465.305 422.294 477.062C421.461 488.801 414.703 498.16 402.34 498.484C386.472 498.897 370.638 498.612 354.778 498.681L251.336 498.96C213.375 499.103 175.414 498.862 137.457 498.239C124.286 497.939 111.01 498.327 97.8844 497.473C90.5969 496.997 81.1243 491.377 79.9318 483.495C78.6837 475.241 78.7916 466.051 78.5821 457.644C78.1661 440.856 78.1772 424.059 78.6145 407.271C78.8003 398.967 78.8927 387.601 79.8433 379.563C73.8063 380.277 65.3748 381.255 59.4631 381.162C38.6908 381.079 1.60658 391.986 1.86147 358.475C2.29112 301.986 -13.0981 224.023 37.7918 184.708C44.74 179.34 52.3977 174.76 61.2966 174.239C47.2229 166.265 38.1455 144.997 37.9931 129.192C37.9073 120.287 41.5864 106.332 46.2507 98.9111C65.0318 69.0315 110.5 66.1777 134.613 90.6491C153.201 109.512 153.555 142.309 137.299 162.899C134.233 166.783 129.702 170.876 126.215 174.349C139.41 178.561 153.661 190.51 162.507 201.253C160.657 191.715 159.606 185.045 160.594 175.392C163.02 151.703 172.098 129.94 190.348 114.316C195.676 109.754 208.566 98.9469 215.677 98.8423L216.167 98.8394L216.239 98.163C208.141 90.6417 198.948 79.2771 197.189 67.8668C191.257 29.3956 205.924 6.11055 244.705 -1ZM170.699 214.582C177.945 228.575 180.187 243.297 181.883 258.78C201.881 257.761 220.625 262.536 235.79 276.395C238.358 278.704 240.747 281.21 242.937 283.889C245.032 286.486 252.532 298.176 253.947 298.613L254.382 297.792C262.241 274.046 296.624 256.737 320.255 259.159C320.569 246.474 320.908 236.126 325.659 223.984C327.455 219.394 330.511 213.763 331.998 209.353C330.235 201.399 329.73 192.294 328.781 184.511C324.519 149.538 306.201 121.319 271.596 111.556C263.779 109.35 256.004 107.51 247.714 108.596C224.235 112.611 203.99 120.484 190.099 141.037C178.76 157.814 175.519 175.4 173.88 195.111C173.363 201.328 170.993 208.34 170.699 214.582ZM258.161 305.907C257.998 311.223 258.677 316.798 259.028 322.154C260.639 347.934 259.869 373.803 257.729 399.531C256.943 408.965 255.856 419.182 254.748 428.615C252.959 443.829 253.447 460.254 251.792 475.189C251.723 477.128 251.457 479.79 252.379 481.476C254.01 480.736 254.87 479.316 255.976 477.87C256.627 477.034 258.422 473.043 259.012 471.799C262.157 465.157 265.834 459.299 271.625 454.714C276.04 451.219 283.592 445.685 288.977 443.777C306.485 437.574 326.79 436.915 345.113 437.305C354.538 437.505 365.58 436.904 374.63 437.852C373.822 417.189 374.294 393.719 374.182 372.798L373.022 276.479C366.167 277.422 348.744 276.425 341.947 275.979C331.296 275.282 324.375 275.265 313.68 275.919C308.663 275.813 304.659 277.281 300.152 277.449C285.517 281.594 274.739 286.794 264.196 298.379C262.367 300.388 259.494 303.593 258.161 305.907ZM126.098 437.28C132.922 436.673 140.89 436.875 147.778 436.768C168.335 436.448 188.312 436.675 208.386 441.775C216.259 443.776 217.69 445.087 224.236 449.158C235.812 456.357 239.657 460.474 246.615 472.071L247.997 475.15C248.849 474.626 248.6 474.752 249.149 473.748C249.134 465.898 248.245 456.676 247.779 448.722L245.169 400.458L243.302 358.562C242.395 335.487 243.081 312.008 227.929 293.2C224.853 289.383 217.951 286.109 213.619 284.036C192.89 274.116 168.987 275.589 146.66 275.474C140.448 275.449 133.285 276.135 127.109 275.741C128.044 282.632 127.615 303.435 127.587 311.403C127.552 335.204 127.356 359.005 126.999 382.803C126.798 394.16 126.663 405.519 126.593 416.878C126.552 422.567 126.773 432.143 126.098 437.28ZM405.349 479.397C404.995 473.77 405.388 466.156 405.48 460.286L405.9 430.64C406.611 400.184 406.181 369.543 408.432 339.136C409.154 329.377 409.576 326.799 407.39 317.226C403.114 316.985 395.456 315.103 390.142 314.543L390.472 320.103C387.87 324.368 388.85 354.811 388.359 362.027C388.082 366.092 388.238 379.884 388.663 384.037C388.342 389.362 389.218 410.15 390.101 415.419C390.454 420.219 390.157 446.467 388.374 450.16C386.537 451.807 383.21 452.618 380.822 452.761C355.346 454.289 330.271 450.669 304.81 453.689C281.845 456.412 275.202 462.892 261.44 480.606L340.384 480.131C361.789 480.039 384.024 480.294 405.349 479.397ZM244.998 481.378C219.784 446.573 200.261 449.975 161.365 450.81L133.542 451.263C128.082 451.352 119.784 451.973 114.618 450.021C112.992 449.407 112.441 445.48 112.361 443.771C111.749 430.585 111.837 416.809 111.837 403.616L111.613 336.546C111.604 332.564 112.039 316.446 111.144 313.738C109.851 313.11 107.943 312.926 106.53 312.96C99.9046 313.117 89.0024 314.718 89.4073 323.581C89.7706 330.273 90.312 336.958 90.6835 343.653C92.9267 384.044 93.1933 424.156 93.0375 464.604C93.067 465.92 93.097 467.381 93.1173 468.684C93.2436 476.788 91.3351 478.888 99.1446 482.506C100.456 482.458 101.783 482.524 103.095 482.564C113.545 482.891 124.002 482.627 134.461 482.536L218.951 481.6C226.651 480.994 237.436 480.544 244.998 481.378ZM88.2695 81.5551C76.1096 84.0584 69.0475 88.1885 62.1621 98.5891C55.1823 109.132 50.259 122.988 53.1955 135.756C57.2876 153.548 78.003 169.85 95.8371 167.802C109.796 164.185 117.483 160.619 125.05 147.397C130.838 137.284 133 128.097 130.323 116.572C126.182 98.7388 107.071 80.6097 88.2695 81.5551ZM413.604 166.001C435.2 161.944 449.516 140.955 445.651 119.018C441.786 97.0807 421.19 82.4249 399.546 86.2093C377.71 90.0277 363.109 111.15 367.009 133.282C370.908 155.413 391.816 170.096 413.604 166.001ZM250.94 91.5783C264.818 90.2103 275.262 85.7882 282.601 73.327C291.692 57.8917 290.463 40.0041 279.402 25.9618C270.712 14.8315 263.143 6.59129 248.041 7.0118C235.272 9.34506 225.551 14.5369 217.972 25.5139C197.975 54.4739 215.68 91.5891 250.94 91.5783ZM484.297 333.923C484.984 295.513 490.9 238.183 462.577 208.384C449.281 194.396 428.866 185.763 409.825 185.451C390.258 185.13 367.994 193.509 353.887 207.374C340.059 220.965 331.495 240.044 327.498 258.924C344.28 258.637 360.482 257.929 377.222 256.916C384.518 256.474 389.564 260.709 390.221 268.207C391.088 280.896 390.995 295.62 389.991 308.243C400.805 308.14 403.751 307.928 414.091 311.535C421.642 319.749 419.29 336.322 419.893 347.26C420.373 355.979 420.887 366.324 420.7 375.009C438.92 374.386 457.702 370.668 476.013 369.346C489.202 368.393 484.428 343.491 484.307 334.108L484.297 333.923ZM92.4536 184.268C71.3256 185.211 51.2377 192.267 36.9232 208.609C18.2165 229.964 19.2661 253.37 19.8534 279.822C20.0937 290.343 20.1695 300.866 20.0806 311.389C19.9455 321.125 16.6524 357.878 20.9896 364.828C26.2738 368.244 55.0275 368.654 63.3347 370.86C70.2565 372.698 72.0957 369.914 79.8863 375.671C80.0334 366.683 80.1321 357.694 80.1819 348.705C80.7547 331.464 76.7704 308.704 100.732 307.623C104.356 307.46 107.986 307.489 111.611 307.401C111.127 298.092 107.798 268.352 113.413 261.951C115.694 259.352 121.062 258.476 124.333 258.319C133.259 257.89 142.599 259.024 151.571 259.22C159.4 259.391 167.505 258.541 175.266 259.483C174.978 240.742 163.976 220.052 150.809 207.3C137.773 194.675 110.608 182.771 92.4536 184.268Z" fill="${tokens.color.onPrimary}"/></svg>
          Open 4 Peer Review Hub
        </div>
        <button class="hd-btn" id="btn-min" title="Collapse">−</button>
      </div>

      <div class="panel-body" id="panel-body"></div>

      <div class="panel-ft">
        <span class="submit-reminder">Once finished, submit your review from the platform review console.</span>
        <span class="save-status" id="save-status"></span>
      </div>
    </div>

    <!-- Resize handles (positioned relative to :host) -->
    <div class="resize-handle rh-n"  data-dir="n"></div>
    <div class="resize-handle rh-s"  data-dir="s"></div>
    <div class="resize-handle rh-e"  data-dir="e"></div>
    <div class="resize-handle rh-w"  data-dir="w"></div>
    <div class="resize-handle rh-ne" data-dir="ne"></div>
    <div class="resize-handle rh-nw" data-dir="nw"></div>
    <div class="resize-handle rh-se" data-dir="se"></div>
    <div class="resize-handle rh-sw" data-dir="sw"></div>
  `;

  document.body.appendChild(host);

  panelBody = shadow.getElementById('panel-body') as HTMLElement;
  saveStatusEl = shadow.getElementById('save-status') as HTMLElement;

  // Re-apply the collapsed state now that the shadow DOM (and its .panel
  // element) actually exists.
  if (savedGeom?.collapsed) {
    const panel = shadow.querySelector('.panel');
    const minBtn = shadow.getElementById('btn-min') as HTMLButtonElement | null;
    panel?.classList.add('collapsed');
    host.style.height = 'auto';
    if (minBtn) minBtn.textContent = '+';
  }

  // ── Minimize / collapse ──────────────────────────────────────────────────────
  shadow.getElementById('btn-min')?.addEventListener('click', () => {
    const panel = shadow.querySelector('.panel')!;
    const willCollapse = !panel.classList.contains('collapsed');
    const btn = shadow.getElementById('btn-min') as HTMLButtonElement;
    if (willCollapse) {
      savedPanelH = host.offsetHeight;
      panel.classList.add('collapsed');
      host.style.height = 'auto';
      if (btn) btn.textContent = '+';
    } else {
      panel.classList.remove('collapsed');
      host.style.height = `${savedPanelH}px`;
      if (btn) btn.textContent = '−';
    }
    savePanelGeometry();
  });

  // ── Drag to move (header) ────────────────────────────────────────────────────
  const hd = shadow.getElementById('panel-hd')!;
  hd.addEventListener('mousedown', (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return; // don't drag on buttons
    isDragging = true;
    const rect = host.getBoundingClientRect();
    dragOffset.x = e.clientX - rect.left;
    dragOffset.y = e.clientY - rect.top;
    hd.classList.add('dragging');
    e.preventDefault();
  });

  // ── Resize handles ───────────────────────────────────────────────────────────
  shadow.querySelectorAll<HTMLElement>('.resize-handle').forEach(handle => {
    handle.addEventListener('mousedown', (e: MouseEvent) => {
      isResizing = true;
      resizeDir = handle.dataset.dir as ResizeDir;
      const rect = host.getBoundingClientRect();
      resizeSt = { x: e.clientX, y: e.clientY, w: rect.width, h: rect.height, l: rect.left, t: rect.top };
      document.body.style.userSelect = 'none';
      e.preventDefault();
      e.stopPropagation();
    });
  });

  // ── Global mousemove / mouseup ───────────────────────────────────────────────
  document.addEventListener('mousemove', (e: MouseEvent) => {
    if (isDragging) {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const w = host.offsetWidth;
      const h = host.offsetHeight;
      let l = e.clientX - dragOffset.x;
      let t = e.clientY - dragOffset.y;
      l = Math.max(0, Math.min(l, vw - w));
      t = Math.max(0, Math.min(t, vh - 40));
      host.style.left  = `${l}px`;
      host.style.top   = `${t}px`;
      host.style.right = 'auto';
    }
    if (isResizing && resizeDir) {
      const dx = e.clientX - resizeSt.x;
      const dy = e.clientY - resizeSt.y;
      let w = resizeSt.w, h = resizeSt.h, l = resizeSt.l, t = resizeSt.t;
      const maxH = window.innerHeight - 16;

      if (resizeDir.includes('e')) w = Math.max(MIN_PANEL_W, resizeSt.w + dx);
      if (resizeDir.includes('s')) h = Math.max(MIN_PANEL_H, Math.min(maxH, resizeSt.h + dy));
      if (resizeDir.includes('w')) {
        const clamped = Math.max(MIN_PANEL_W, resizeSt.w - dx);
        l = resizeSt.l + (resizeSt.w - clamped);
        w = clamped;
      }
      if (resizeDir.includes('n')) {
        const clamped = Math.max(MIN_PANEL_H, Math.min(maxH, resizeSt.h - dy));
        t = resizeSt.t + (resizeSt.h - clamped);
        h = clamped;
      }

      host.style.width  = `${w}px`;
      host.style.height = `${h}px`;
      host.style.left   = `${l}px`;
      host.style.top    = `${t}px`;
      host.style.right  = 'auto';
    }
  });

  document.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      hd.classList.remove('dragging');
      savePanelGeometry();
    }
    if (isResizing) {
      isResizing = false;
      resizeDir = null;
      document.body.style.userSelect = '';
      savePanelGeometry();
    }
  });
}

// ── Review selection ──────────────────────────────────────────────────────────

async function selectReview(reviewId: string) {
  const review = assignments.find(a => a.id === reviewId);
  if (!review) return;
  selectedReview = review;
  sessionStorage.setItem(SESSION_KEY, reviewId);

  renderContent('loading');

  // Set status to in_progress if assigned
  if (review.status === 'assigned') {
    await send({ type: 'SET_REVIEW_STATUS', payload: { reviewId, status: 'in_progress' } });
  }

  const [itemsResp, annResp, scoresResp, scoreCommentsResp] = await Promise.all([
    send<RubricItem[]>({ type: 'GET_RUBRIC_ITEMS', payload: { rubricId: review.rubric_id } }),
    send<AnnotationRecord[]>({ type: 'GET_ANNOTATIONS', payload: { reviewId } }),
    send<ReviewScoreRecord[]>({ type: 'GET_SCORES', payload: { reviewId } }),
    send<ScoreCommentRecord[]>({ type: 'GET_SCORE_COMMENTS', payload: { reviewId } }),
  ]);

  rubricItems = itemsResp.data ?? [];
  annotations = annResp.data ?? [];
  scores.clear();
  scoreComments.clear();
  (scoresResp.data ?? []).forEach(s => scores.set(s.rubric_item_id, s));
  // All comments per (item, level) are surfaced (ordered by created_at.asc), matching
  // the web console — nothing is dropped, so multi-comment criteria stay in sync.
  // 'exemplifies' comments are skipped: the extension only manages does_not_meet/exceeds.
  (scoreCommentsResp.data ?? []).forEach(c => {
    const map = scoreComments.get(c.rubric_item_id) ?? emptyScoreComments();
    const arr = map[c.score_level as keyof ScoreCommentMap];
    if (arr) arr.push({ id: c.id, body: c.body });
    scoreComments.set(c.rubric_item_id, map);
  });

  renderContent('review');
  prefetchSiblingCompletions();
  applyHighlights();
  scheduleHighlightRetries();
  checkPendingAnnotationNavigation();
}

// ── Live refresh ────────────────────────────────────────────────────────────────
// Re-pull scores, score comments, and the general comment when the reviewer returns
// to this tab, so edits made in the web review console (or another session) show up
// without a manual reload. Guards skip the refresh whenever a save is pending or the
// reviewer is actively editing, so in-progress text is never clobbered.

let focusRefreshInFlight = false;

function isEditingReview(): boolean {
  if (scoreTimers.size > 0 || gcTimer) return true;
  const active = shadow.activeElement as HTMLElement | null;
  return !!active && (active.classList.contains('score-comment-input') || active.id === 'general-comment-ta');
}

async function refreshSelectedReviewFromServer() {
  if (!selectedReview || focusRefreshInFlight || isEditingReview()) return;
  const reviewId = selectedReview.id;
  focusRefreshInFlight = true;
  try {
    const [scoresResp, commentsResp, assignmentsResp] = await Promise.all([
      send<ReviewScoreRecord[]>({ type: 'GET_SCORES', payload: { reviewId } }),
      send<ScoreCommentRecord[]>({ type: 'GET_SCORE_COMMENTS', payload: { reviewId } }),
      send<ReviewAssignment[]>({ type: 'GET_ASSIGNMENTS' }),
    ]);
    // Re-check guards: the reviewer may have started editing during the fetch, or
    // switched reviews. Abandon rather than overwrite their in-flight work.
    if (!selectedReview || selectedReview.id !== reviewId || isEditingReview()) return;

    if (scoresResp.success) {
      scores.clear();
      (scoresResp.data ?? []).forEach(s => scores.set(s.rubric_item_id, s));
    }
    if (commentsResp.success) {
      scoreComments.clear();
      (commentsResp.data ?? []).forEach(c => {
        const map = scoreComments.get(c.rubric_item_id) ?? emptyScoreComments();
        const arr = map[c.score_level as keyof ScoreCommentMap];
        if (arr) arr.push({ id: c.id, body: c.body });
        scoreComments.set(c.rubric_item_id, map);
      });
    }
    if (assignmentsResp.success) {
      const fresh = (assignmentsResp.data ?? []).find(a => a.id === reviewId);
      if (fresh) {
        selectedReview.notes = fresh.notes ?? '';
        const gcTa = shadow.getElementById('general-comment-ta') as HTMLTextAreaElement | null;
        if (gcTa && shadow.activeElement !== gcTa) gcTa.value = selectedReview.notes;
      }
    }

    if (scoresResp.success || commentsResp.success) {
      renderRubricCriteria();
      updateCompletion();
    }
  } finally {
    focusRefreshInFlight = false;
  }
}

// ── Login ─────────────────────────────────────────────────────────────────────

async function handleLogin() {
  const emailEl = shadow.getElementById('login-email') as HTMLInputElement;
  const passEl  = shadow.getElementById('login-password') as HTMLInputElement;
  const errEl   = shadow.getElementById('login-error') as HTMLElement;
  const btn     = shadow.getElementById('btn-login') as HTMLButtonElement;

  const email = emailEl.value.trim();
  const password = passEl.value;
  if (!email || !password) return;

  btn.disabled = true;
  btn.textContent = 'Signing in…';
  errEl.style.display = 'none';

  const resp = await send<StoredAuth>({ type: 'LOGIN', payload: { email, password } });

  if (!resp.success || !resp.data) {
    errEl.textContent = resp.error ?? 'Sign in failed';
    errEl.style.display = 'block';
    btn.disabled = false;
    btn.textContent = 'Sign In';
    return;
  }

  currentAuth = resp.data;
  if (resp.data.platformUrl && isAllowedPlatformOrigin(resp.data.platformUrl)) {
    platformUrl = resp.data.platformUrl;
  }
  renderContent('loading');

  const assignResp = await send<ReviewAssignment[]>({ type: 'GET_ASSIGNMENTS' });
  assignments = assignResp.data ?? [];
  await routeToReview();
}

// ── Init ──────────────────────────────────────────────────────────────────────

// Allowed platform origins for the Console button destination and for guard use.
// The *.vercel.app manifest permission is broad; this regex narrows it at runtime.
const ALLOWED_CONSOLE_HOSTNAMES = ['annotation-platform-seven.vercel.app', 'localhost'];
const PREVIEW_CONSOLE_RE = /^open4peerreview-[a-z0-9]+-allimaeeees-projects\.vercel\.app$/;

function isAllowedPlatformOrigin(origin: string): boolean {
  try {
    const hostname = new URL(origin).hostname;
    return ALLOWED_CONSOLE_HOSTNAMES.includes(hostname) || PREVIEW_CONSOLE_RE.test(hostname);
  } catch { return false; }
}

// Decides whether this page load is part of a platform-initiated review session.
// The extension must stay dormant on Torus pages the reviewer reached on their own
// (see gate in init) — it should only surface when the platform sent them here.
//
// A session is "platform-initiated" when any of these hold:
//   1. Deep-link params are still on the URL (fresh launch from openInTorus()).
//   2. The background captured a still-valid deep link before a Torus login/enroll
//      redirect stripped the params (recovered into deepLinkReviewId just above).
//   3. This tab already has an active review session — set once a review opens and
//      preserved across same-tab reloads / SPA navigation via sessionStorage. This
//      keeps the panel alive as the reviewer moves through the OER; it can't leak to
//      an independently-opened tab because sessionStorage is per-tab.
function isPlatformInitiatedSession(hadDeepLinkParams: boolean): boolean {
  if (hadDeepLinkParams) return true;
  if (deepLinkReviewId) return true;
  try { if (sessionStorage.getItem(SESSION_KEY)) return true; } catch { /* storage unavailable */ }
  return false;
}

async function init() {
  // ── Read platform deep-link intent BEFORE mounting anything ───────────────────
  // The panel must not auto-appear when a reviewer navigates to Torus independently,
  // so resolve the launch signals first and bail out (staying fully dormant — no
  // panel, listeners, or observers) if this isn't a platform-initiated session.
  const urlParams = new URLSearchParams(window.location.search);
  const hadDeepLinkParams =
    urlParams.has('oer_review_id') || urlParams.has('oer_token') || urlParams.has('oer_goto');

  // ── Auto-login from platform deep link ───────────────────────────────────────
  // When the dashboard opens Torus with ?oer_token=, decode and store auth so
  // the reviewer never sees the login form.
  const rawToken = urlParams.get('oer_token');
  if (rawToken) {
    try {
      const auth = JSON.parse(decodeURIComponent(atob(rawToken))) as StoredAuth;
      if (auth.access_token && auth.user_id) {
        // Merge: preserve platformUrl from existing storage — the oer_token payload
        // is generated by the platform without a platformUrl field, so a plain
        // replace would wipe whatever stampPlatformUrl() just wrote.
        const existingOerAuth = await new Promise<StoredAuth | undefined>(resolve =>
          chrome.storage.local.get('auth', r => resolve((r as { auth?: StoredAuth }).auth))
        );
        const authToStore = { ...auth, platformUrl: existingOerAuth?.platformUrl };
        await new Promise<void>(resolve => chrome.storage.local.set({ auth: authToStore }, resolve));
        // Remove the token from browser history so it isn't exposed in the URL bar
        urlParams.delete('oer_token');
        const clean = window.location.pathname
          + (urlParams.toString() ? '?' + urlParams.toString() : '')
          + window.location.hash;
        window.history.replaceState({}, '', clean);
      }
    } catch { /* malformed token — fall through to normal auth */ }
  }

  // ── Deep link to a specific annotation (from the in-platform console) ─────────
  // ?oer_goto=<annotationId> asks us to scroll to that annotation once its review
  // loads and expand its criterion. Stash it for checkPendingAnnotationNavigation()
  // (invoked at the end of selectReview) and strip it from the URL.
  const gotoAnnId = urlParams.get('oer_goto');
  if (gotoAnnId) {
    try { sessionStorage.setItem(GOTO_ANN_KEY, gotoAnnId); } catch { /* storage unavailable */ }
    urlParams.delete('oer_goto');
    const clean = window.location.pathname
      + (urlParams.toString() ? '?' + urlParams.toString() : '')
      + window.location.hash;
    window.history.replaceState({}, '', clean);
  }

  // ?oer_review_id=<reviewId> — capture once and strip so it can't re-hijack later
  // routing (reloads, history, copied URLs) after the reviewer switches rubrics.
  const reviewParam = stripSearchParam(
    window.location.pathname, urlParams.toString() ? '?' + urlParams.toString() : '',
    window.location.hash, 'oer_review_id',
  );
  if (reviewParam.value) {
    deepLinkReviewId = reviewParam.value;
    urlParams.delete('oer_review_id');
    window.history.replaceState({}, '', reviewParam.cleanUrl);
  }

  // Recover the deep-link intent captured pre-redirect (survives Torus login),
  // in case window.location no longer carries oer_review_id / oer_goto.
  await recoverDeepLinkFromStorage();

  // Gate: only surface on Torus when the platform sent the reviewer here. An
  // independent visit leaves the extension dormant — nothing is mounted below.
  if (!isPlatformInitiatedSession(hadDeepLinkParams)) return;

  createPanel();
  createAnnotationPopupEl();
  createAnnotationTooltip();

  document.addEventListener('mouseup', handleMouseUp);
  document.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Escape') {
      hideAnnotationPopup();
      exitHotspotMode();
    } else if ((e as KeyboardEvent).altKey && (e as KeyboardEvent).key.toLowerCase() === 'h') {
      e.preventDefault();
      if (!selectedReview) { showToast('Select a review first'); return; }
      if (hotspotMode) { exitHotspotMode(); } else { enterHotspotMode(); }
    }
  });

  // Re-apply all highlights and hotspot markers when Torus navigates (SPA routing).
  const origPush = history.pushState.bind(history);
  const origReplace = history.replaceState.bind(history);
  history.pushState = (...args) => { origPush(...args); scheduleHighlightRetries(); };
  history.replaceState = (...args) => { origReplace(...args); scheduleHighlightRetries(); };
  window.addEventListener('popstate', scheduleHighlightRetries);

  // Watch for late/async content paint so highlights survive reload, session
  // return, and back-navigation regardless of when Torus renders the page.
  startHighlightObserver();

  // Re-anchor when the viewport reflows — element-scoped hotspots depend on live
  // element geometry, which changes on resize/orientation change.
  window.addEventListener('resize', () => { if (selectedReview) applyHotspotMarkers(); });

  // Live refresh: when the reviewer returns to this tab, pull the latest scores/comments
  // so edits made in the web console show up without a manual reload. A short debounce
  // collapses the visibilitychange+focus pair that fires on a single tab switch.
  let refreshDebounce: ReturnType<typeof setTimeout> | null = null;
  const scheduleFocusRefresh = () => {
    if (refreshDebounce) clearTimeout(refreshDebounce);
    refreshDebounce = setTimeout(() => { refreshDebounce = null; refreshSelectedReviewFromServer(); }, 250);
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleFocusRefresh();
  });
  window.addEventListener('focus', scheduleFocusRefresh);

  // Let the popup query current state
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'GET_CURRENT_REVIEW') {
      sendResponse({ success: true, data: selectedReview });
    }
    return false;
  });

  const authResp = await send<StoredAuth>({ type: 'GET_AUTH' });
  if (!authResp.success || !authResp.data) {
    renderContent('login');
    return;
  }
  currentAuth = authResp.data;
  if (authResp.data.platformUrl && isAllowedPlatformOrigin(authResp.data.platformUrl)) {
    platformUrl = authResp.data.platformUrl;
  }
  renderContent('loading');

  const assignResp = await send<ReviewAssignment[]>({ type: 'GET_ASSIGNMENTS' });
  if (!assignResp.success) { renderContent('login'); return; }

  assignments = assignResp.data ?? [];
  await routeToReview();
}

init();
