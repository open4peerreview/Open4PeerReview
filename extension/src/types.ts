export type CriterionScore = 'does_not_meet' | 'exemplifies' | 'exceeds';
export type HighlightTag = 'action_item' | 'quick_fix';

export interface TextPositionSelector {
  type: 'TextPositionSelector';
  start: number;
  end: number;
}

export interface TextQuoteSelector {
  type: 'TextQuoteSelector';
  exact: string;
  prefix: string;
  suffix: string;
}

// W3C Web Annotation RangeSelector (the model hypothes.is / markup.io use to pin
// a selection to specific DOM elements rather than a whole-document char offset).
// startContainer/endContainer are XPaths relative to document.body; the offsets
// are character offsets into the concatenated text of that container's subtree.
export interface RangeSelector {
  type: 'RangeSelector';
  startContainer: string;
  startOffset: number;
  endContainer: string;
  endOffset: number;
}

export type AnchorSelector = TextPositionSelector | TextQuoteSelector | RangeSelector;

export type PageType = 'nav' | 'content' | 'checkpoint';

export interface HtmlCharOffsetAnchor {
  type: 'html-char-offset';
  pageIndex: number;
  selector: AnchorSelector[];
  screenshotUrl?: string;
  pageUrl?: string;
  pageName?: string;
  pageType?: PageType;
}

export interface BboxAnchor {
  type: 'bbox';
  x: number;
  y: number;
  width: number;
  height: number;
  screenshotUrl?: string;
  pageUrl?: string;
  pageName?: string;
  pageType?: PageType;
  textQuote?: string;
}

export interface PointAnchor {
  type: 'point';
  pageX: number;
  pageY: number;
  relX: number;
  relY: number;
  // Element-scoped anchoring (markup.io style): pin the hotspot to a specific
  // element plus a fractional offset within it, so the marker survives layout
  // reflow / responsive changes far better than absolute pageX/pageY alone.
  targetSelector?: string;   // XPath to the element under the click
  offsetXRatio?: number;     // 0..1 within the target element's box
  offsetYRatio?: number;     // 0..1 within the target element's box
  targetText?: string;       // short text sample of the target element (disambiguation)
  pageUrl?: string;
  pageName?: string;
  pageType?: PageType;
  screenshotUrl?: string;
}

export type Anchor = HtmlCharOffsetAnchor | BboxAnchor | PointAnchor;

export interface RubricItem {
  id: string;
  rubric_id: string;
  label: string;
  description: string;
  sort_order: number;
}

export interface AnnotationRecord {
  id: string;
  review_id: string;
  rubric_item_id: string | null;
  anchor: Anchor;
  body: string;
  tag: HighlightTag | null;
  created_at: string;
}

export interface ReviewScoreRecord {
  id: string;
  review_id: string;
  rubric_item_id: string;
  score: CriterionScore | null;
  criterion_scores: CriterionScore[] | null;
  comment: string | null;
}

export interface ScoreCommentRecord {
  id: string;
  review_id: string;
  rubric_item_id: string;
  score_level: 'does_not_meet' | 'exemplifies' | 'exceeds';
  body: string;
}

export interface ReviewAssignment {
  id: string;
  document_id: string;
  rubric_id: string;
  status: string;
  notes: string | null;
  updated_at: string | null;
  documents: { title: string; source_url: string | null } | null;
  rubrics: { title: string } | null;
}

export interface StoredAuth {
  access_token: string;
  refresh_token: string;
  user_id: string;
  email: string;
  expires_at: number;
  platformUrl?: string;
}

export type BackgroundMessageType =
  | 'CAPTURE_TAB'
  | 'CONSUME_DEEP_LINK'
  | 'UPLOAD_SCREENSHOT'
  | 'SAVE_ANNOTATION'
  | 'UPDATE_ANNOTATION'
  | 'DELETE_ANNOTATION'
  | 'SAVE_SCORE'
  | 'GET_ASSIGNMENTS'
  | 'GET_REVIEW'
  | 'GET_RUBRIC_ITEMS'
  | 'GET_ANNOTATIONS'
  | 'GET_SCORES'
  | 'GET_SCORE_COMMENTS'
  | 'SAVE_SCORE_COMMENT'
  | 'DELETE_SCORE_COMMENT'
  | 'SET_REVIEW_STATUS'
  | 'UPDATE_REVIEW_NOTES'
  | 'UPDATE_DOCUMENT_PAGES'
  | 'LOGIN'
  | 'LOGOUT'
  | 'GET_AUTH'
  | 'SYNC_AUTH'
  | 'SYNC_AUTH_FROM_COOKIES';

export interface BackgroundMessage {
  type: BackgroundMessageType;
  payload?: Record<string, unknown>;
}

export interface BackgroundResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}
