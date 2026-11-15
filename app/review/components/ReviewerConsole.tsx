'use client'

// app/reviewer/_components/ReviewerConsole.tsx
// Split-pane: PDF viewer (left) + annotation panel (right).
// Owns score/comment/annotation state and wires up useReviewAutoSave.

import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { useReviewAutoSave, type CriterionScore, type SaveStatus } from '../../../hooks/useReviewAutoSave'
import { useReviewTracking } from '../../../hooks/useReviewTracking'
import { useRouter } from 'next/navigation'
import type { HighlightTag } from '@/types'
import type { Json } from '@/types/database.types'
import { PDFViewer, type TextSelection, type AnnotationConfirmPayload } from './PDFViewer'
import HtmlViewerCanvas, { type HtmlTextSelection, type H5pSelection } from './HtmlViewerCanvas'
import { TorusAnnotationViewer } from './TorusAnnotationViewer'
import ReviewRightPanel from './ReviewRightPanel'
import { Modal, ModalContent } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { useReviewSaveStatus } from '@/lib/review-save-context'
import ResizablePanelLayout from '@/components/layout/ResizablePanelLayout'
import type { OERDocument, Review, Rubric, RubricItem, ScoreComment, ReviewNotesRow } from './ReviewerApp'

type AnyTextSelection = TextSelection | HtmlTextSelection | H5pSelection

interface ReviewerConsoleProps {
  supabase: SupabaseClient
  userId: string
  document: OERDocument
  review: Review
  rubrics: Rubric[]
  onReviewUpdate: (r: Review) => void
  /** All per-rubric review rows for this document/reviewer (lightweight: id, rubric_id, notes).
   *  Used to bind General Comments to the correct DB row when switching rubric tabs. */
  reviewNotesRows?: ReviewNotesRow[]
  /** True when this OER was submitted to an organization, so completing the
   *  review holds it for coordinator approval before the author can see it. */
  requiresCoordinatorApproval?: boolean
}

export interface ScoreCommentItem {
  id: string
  body: string
}

export interface LocalScore {
  rubricItemId: string
  scores: CriterionScore[]
  comment: string
  proficientSelected: boolean
  niComments: ScoreCommentItem[]
  exceedsComments: ScoreCommentItem[]
  exemplifiesComments: ScoreCommentItem[]
  annotations: { id: string; anchor: Record<string, unknown>; body: string; tag: string | null; created_at?: string }[]
}

const SCORE_COMMENT_KEY: Record<CriterionScore, 'niComments' | 'exceedsComments' | 'exemplifiesComments'> = {
  does_not_meet: 'niComments',
  exceeds: 'exceedsComments',
  exemplifies: 'exemplifiesComments',
}

function computePrimaryScore(
  proficientSelected: boolean,
  niComments: ScoreCommentItem[],
  exceedsComments: ScoreCommentItem[],
): CriterionScore | null {
  if (proficientSelected) return 'exemplifies'
  if (niComments.length > 0) return 'does_not_meet'
  if (exceedsComments.length > 0) return 'exceeds'
  return null
}

export function ReviewerConsole({
  supabase,
  userId,
  document,
  review,
  rubrics,
  onReviewUpdate,
  reviewNotesRows,
  requiresCoordinatorApproval = false,
}: ReviewerConsoleProps) {
  const [rubricItems, setRubricItems] = useState<RubricItem[]>([])
  const [scores, setScores] = useState<Record<string, LocalScore>>(() => {
    // Synchronously seed from server-provided data so criterion-linked annotations are
    // present when the iframe first becomes ready — closing the timing race where the
    // highlight effect fired before the async rubric-items query resolved.
    // Covers all rubric rows (via reviewNotesRows); the async effect below extends this
    // to include all rubric items (including those never yet scored).
    const seed: Record<string, LocalScore> = {}
    ;(reviewNotesRows ?? []).forEach(notesRow => {
      ;(notesRow.review_scores ?? []).forEach(rs => {
        const linkedAnnotations = (reviewNotesRows ?? [])
          .flatMap(row => row.annotations ?? [])
          .filter(a => a.rubric_item_id === rs.rubric_item_id)
          .sort((a, b) => new Date(b.created_at ?? '').getTime() - new Date(a.created_at ?? '').getTime())
        const itemScoreComments = (notesRow.score_comments ?? []).filter(sc => sc.rubric_item_id === rs.rubric_item_id)
        const niComments = itemScoreComments.filter(sc => sc.score_level === 'does_not_meet').map(sc => ({ id: sc.id, body: sc.body }))
        const exceedsComments = itemScoreComments.filter(sc => sc.score_level === 'exceeds').map(sc => ({ id: sc.id, body: sc.body }))
        const exemplifiesComments = itemScoreComments.filter(sc => sc.score_level === 'exemplifies').map(sc => ({ id: sc.id, body: sc.body }))
        const proficientSelected = (rs.criterion_scores ?? []).includes('exemplifies')
        const derivedScores: CriterionScore[] = [...(rs.criterion_scores ?? [])]
        if (exceedsComments.length > 0 && !derivedScores.includes('exceeds')) derivedScores.push('exceeds')
        if (niComments.length > 0 && !derivedScores.includes('does_not_meet')) derivedScores.push('does_not_meet')
        if (proficientSelected && !derivedScores.includes('exemplifies')) derivedScores.push('exemplifies')
        if (exemplifiesComments.length > 0 && !derivedScores.includes('exemplifies')) derivedScores.push('exemplifies')
        seed[rs.rubric_item_id] = {
          rubricItemId: rs.rubric_item_id,
          scores: derivedScores,
          comment: rs.comment ?? '',
          proficientSelected,
          niComments,
          exceedsComments,
          exemplifiesComments,
          annotations: linkedAnnotations.map(a => ({
            id: a.id,
            anchor: a.anchor as Record<string, unknown>,
            body: a.body,
            tag: a.tag,
            created_at: a.created_at,
          })),
        }
      })
    })
    return seed
  })
  const [activeItemId, setActiveItemId] = useState<string | null>(null)
  const [pendingSelection, setPendingSelection] = useState<AnyTextSelection | null>(null)
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(review.last_saved_at)
  const [overallComment, setOverallComment] = useState(review.overall_comment ?? '')
  // Per-rubric submission: rubric_ids already released to the author, and the rubric
  // the confirm modal currently targets (null = closed).
  const [submittedRubricIds, setSubmittedRubricIds] = useState<Set<string>>(new Set())
  const [submitRubricId, setSubmitRubricId] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [generalAnnotations, setGeneralAnnotations] = useState<
    { id: string; anchor: Record<string, unknown>; body: string; tag: string | null; created_at?: string }[]
  >(() => {
    // Seed from the reviewNotesRows entry for the initial rubric tab so general
    // annotations are correct even when the primary review row is not this rubric's row.
    const notesRow = reviewNotesRows?.find(r => r.rubric_id === review.rubric_id)
    return (notesRow?.annotations ?? review.annotations ?? [])
      .filter((a) => a.rubric_item_id === null)
      .sort((a, b) => new Date(b.created_at ?? '').getTime() - new Date(a.created_at ?? '').getTime())
      .map((a) => ({ id: a.id, anchor: a.anchor as Record<string, unknown>, body: a.body, tag: a.tag, created_at: a.created_at }))
  })
  const [annotationIndexMap, setAnnotationIndexMap] = useState<Map<string, number>>(new Map())
  // General-comment live refresh: serverNotes seeds the field; bumping notesKey remounts it.
  const [serverNotes, setServerNotes] = useState<string | null>(review.notes)
  const [notesKey, setNotesKey] = useState(0)
  // Per-rubric notes: which review row's notes field should the General Comments textarea
  // read/write? Defaults to the primary review's row; switches when the reviewer changes tabs.
  const [activeNotesReviewId, setActiveNotesReviewId] = useState<string>(
    reviewNotesRows?.find(r => r.rubric_id === review.rubric_id)?.id ?? review.id
  )
  // Guards the per-rubric notes reset so it doesn't fire on the first render.
  const isFirstNotesMountRef = useRef(true)

  const isSubmitted = review.status === 'submitted'
  const router = useRouter()

  // ── Load rubric items ──────────────────────────────────────────────────────
  useEffect(() => {
    const rubricIds = rubrics.map((r) => r.id)
    if (rubricIds.length === 0) return

    const rubricTitleById = Object.fromEntries(rubrics.map((r) => [r.id, r.title]))

    supabase
      .from('rubric_items')
      .select('id, label, description, sort_order, rubric_id')
      .in('rubric_id', rubricIds)
      .order('rubric_id')
      .order('sort_order')
      .then(({ data }) => {
        if (!data) return
        const items: RubricItem[] = data.map((item) => ({
          ...item,
          rubric_title: rubricTitleById[item.rubric_id],
        }))
        setRubricItems(items)
        setActiveItemId(items[0]?.id ?? null)

        // Hydrate local scores from existing review_scores, annotations, and score_comments
        const initialScores: Record<string, LocalScore> = {}
        items.forEach((item) => {
          // Pull scores, annotations, and score_comments from the review row that owns
          // this item's rubric — so all rubric tabs are populated correctly regardless
          // of which row is the anchor row passed via ?review=<id>.
          const notesRowForItem = reviewNotesRows?.find(r => r.rubric_id === item.rubric_id)
          const existingScore = notesRowForItem?.review_scores?.find((rs) => rs.rubric_item_id === item.id)
          const existingAnnotations = (notesRowForItem?.annotations ?? review.annotations ?? [])
            .filter((a) => a.rubric_item_id === item.id)
            .sort((a, b) => new Date(b.created_at ?? '').getTime() - new Date(a.created_at ?? '').getTime())
          const itemScoreComments = (notesRowForItem?.score_comments ?? []).filter(
            (sc) => sc.rubric_item_id === item.id
          )
          const niComments = itemScoreComments
            .filter((sc) => sc.score_level === 'does_not_meet')
            .map((sc) => ({ id: sc.id, body: sc.body }))
          const exceedsComments = itemScoreComments
            .filter((sc) => sc.score_level === 'exceeds')
            .map((sc) => ({ id: sc.id, body: sc.body }))
          const exemplifiesComments = itemScoreComments
            .filter((sc) => sc.score_level === 'exemplifies')
            .map((sc) => ({ id: sc.id, body: sc.body }))
          const proficientSelected = (existingScore?.criterion_scores ?? []).includes('exemplifies')
          // Derive scores from both saved criterion_scores and comment presence.
          // score_comments are persisted immediately; criterion_scores go through a
          // 1500ms debounce and may not have been written if the user exited quickly.
          // Merging the two sources keeps badge state consistent across sessions.
          const derivedScores: CriterionScore[] = [...(existingScore?.criterion_scores ?? [])]
          if (exceedsComments.length > 0 && !derivedScores.includes('exceeds')) derivedScores.push('exceeds')
          if (niComments.length > 0 && !derivedScores.includes('does_not_meet')) derivedScores.push('does_not_meet')
          if (proficientSelected && !derivedScores.includes('exemplifies')) derivedScores.push('exemplifies')
          if (exemplifiesComments.length > 0 && !derivedScores.includes('exemplifies')) derivedScores.push('exemplifies')
          initialScores[item.id] = {
            rubricItemId: item.id,
            scores: derivedScores,
            comment: existingScore?.comment ?? '',
            proficientSelected,
            niComments,
            exceedsComments,
            exemplifiesComments,
            annotations: existingAnnotations.map((a) => ({ id: a.id, anchor: a.anchor as Record<string, unknown>, body: a.body, tag: a.tag, created_at: a.created_at })),
          }
        })
        setScores(initialScores)
      })
  // rubrics and reviewNotesRows are stable (set once from server props)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, rubrics])

  // ── Rubric → owning review row ID (single shared resolver) ─────────────────
  // A document has one independent review row per rubric (reviewNotesRows,
  // loaded server-side — see Dimension A). This is the single source of truth
  // for resolving which row a given rubric — or, via `getReviewRowIdForItem`,
  // a given rubric item — actually belongs to. Every score and score-comment
  // write below resolves through here; never the console's anchor `review.id`,
  // which only belongs to whichever rubric happened to be passed via
  // `?review=<id>` and may not be the rubric currently being edited.
  const rubricToReviewRowIdRef = useRef<Record<string, string>>({})
  useEffect(() => {
    rubricToReviewRowIdRef.current = Object.fromEntries(
      (reviewNotesRows ?? []).map(row => [row.rubric_id, row.id])
    )
  // reviewNotesRows is stable server-side data; intentionally excluded from deps.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const getReviewRowIdForRubric = useCallback(
    (rubricId: string | null | undefined): string =>
      (rubricId && rubricToReviewRowIdRef.current[rubricId]) || review.id,
    [review.id]
  )

  // rubric_item_id → rubric_id, kept in sync as rubricItems loads (empty until
  // the async query above resolves). Ref-based (like scoresRef/
  // activeNotesReviewIdRef below) so write-path callbacks declared before
  // rubricItems finishes loading always read the latest mapping instead of
  // closing over a stale/empty one.
  const itemToRubricIdRef = useRef<Record<string, string>>({})
  useEffect(() => {
    itemToRubricIdRef.current = Object.fromEntries(rubricItems.map(item => [item.id, item.rubric_id]))
  }, [rubricItems])

  const getReviewRowIdForItem = useCallback(
    (rubricItemId: string): string => getReviewRowIdForRubric(itemToRubricIdRef.current[rubricItemId]),
    [getReviewRowIdForRubric]
  )

  // ── Load already-submitted rubrics ─────────────────────────────────────────
  // A submission row is filed under the review row for the rubric that was
  // actually submitted (see handleSubmit below), not necessarily the anchor
  // row — so this must read across every rubric row this reviewer has for
  // the document, not just review.id, or a non-anchor rubric's prior
  // submission would never show as submitted here.
  useEffect(() => {
    const allReviewRowIds = Array.from(
      new Set([review.id, ...(reviewNotesRows ?? []).map((r) => r.id)])
    )
    supabase
      .from('review_rubric_submissions')
      .select('rubric_id')
      .in('review_id', allReviewRowIds)
      .then(({ data }) => {
        if (data) setSubmittedRubricIds(new Set(data.map((r) => r.rubric_id)))
      })
  // reviewNotesRows is stable server-side data; intentionally excluded from deps.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, review.id])

  // ── Auto-save hook ─────────────────────────────────────────────────────────
  const {
    saveStatus, onScoreChange, onGeneralCommentChange, saveAnnotation, updateAnnotation, deleteAnnotation,
    addScoreComment, updateScoreComment, deleteScoreComment, saveDraft,
  } = useReviewAutoSave({ supabase, reviewId: review.id, notesReviewId: activeNotesReviewId })

  // ── Broadcast save status to Navbar via context ────────────────────────────
  const { setSaveStatus: setNavSaveStatus, setLastSavedAt: setNavLastSavedAt } = useReviewSaveStatus()
  useEffect(() => { setNavSaveStatus(saveStatus) }, [saveStatus, setNavSaveStatus])
  useEffect(() => { setNavLastSavedAt(lastSavedAt ? new Date(lastSavedAt) : null) }, [lastSavedAt, setNavLastSavedAt])
  useEffect(() => () => { setNavSaveStatus('idle'); setNavLastSavedAt(null) }, [])

  // Stable ref so annotation callbacks can look up rubric_item_id without stale closures
  const scoresRef = useRef(scores)
  const generalAnnotationsRef = useRef(generalAnnotations)
  useEffect(() => { scoresRef.current = scores }, [scores])
  useEffect(() => { generalAnnotationsRef.current = generalAnnotations }, [generalAnnotations])

  // Per-tab cache for general (unlinked) annotations, keyed by review row ID.
  // Seeded from reviewNotesRows (server data); the leaving tab's state is written back
  // here on each tab switch so newly-added annotations survive without a DB re-fetch.
  const generalAnnotationsMapRef = useRef<Record<string, LocalScore['annotations']>>(
    Object.fromEntries(
      (reviewNotesRows ?? []).map(row => [
        row.id,
        (row.annotations ?? [])
          .filter((a) => a.rubric_item_id === null)
          .sort((a, b) => new Date(b.created_at ?? '').getTime() - new Date(a.created_at ?? '').getTime())
          .map((a) => ({ id: a.id, anchor: a.anchor as Record<string, unknown>, body: a.body, tag: a.tag, created_at: a.created_at ?? undefined })),
      ])
    )
  )

  // Per-tab cache for the General Comments textarea text, keyed by review row ID.
  // Mirrors generalAnnotationsMapRef — seeded from server data, updated on every keystroke
  // via handleGeneralCommentChange, and read back on tab switch so typed text is never lost.
  const notesTextMapRef = useRef<Record<string, string>>(
    Object.fromEntries(
      (reviewNotesRows ?? []).map(row => [row.id, row.notes ?? ''])
    )
  )

  // Wrapper around the hook's onGeneralCommentChange — keeps notesTextMapRef current so
  // the tab-switch effect can restore the live typed value rather than stale SSR data.
  const handleGeneralCommentChange = useCallback(
    (val: string) => {
      notesTextMapRef.current[activeNotesReviewIdRef.current] = val
      onGeneralCommentChange(val)
    },
    // onGeneralCommentChange is stable (useCallback in the hook); activeNotesReviewIdRef is a ref (no dep needed)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onGeneralCommentChange]
  )

  // ── Interaction tracking ───────────────────────────────────────────────────
  const { track, flush } = useReviewTracking({ supabase, reviewId: review.id, reviewerId: userId })
  const criterionFocusTime = useRef<{ id: string; at: number } | null>(null)

  // After any save, stamp the current time — last_saved_at on the DB is only
  // updated by a trigger on review_score upserts, so fetching from DB would
  // return a stale value for annotation saves.
  const refreshLastSaved = useCallback(() => {
    setLastSavedAt(new Date().toISOString())
  }, [])

  useEffect(() => {
    if (saveStatus === 'saved') refreshLastSaved()
  }, [saveStatus, refreshLastSaved])

  // ── Live refresh on tab refocus ────────────────────────────────────────────
  // Re-pull score comments + ratings when the reviewer returns to this tab, so
  // per-criterion comments made in the browser extension (or another session)
  // appear without a manual reload. Guards prevent clobbering in-progress edits.
  const saveStatusRef = useRef(saveStatus)
  useEffect(() => { saveStatusRef.current = saveStatus }, [saveStatus])
  // Keeps the live-refresh closure from reading a stale notes review ID.
  const activeNotesReviewIdRef = useRef(activeNotesReviewId)
  useEffect(() => { activeNotesReviewIdRef.current = activeNotesReviewId }, [activeNotesReviewId])
  const refreshInFlight = useRef(false)

  const refreshCommentsFromServer = useCallback(async () => {
    if (isSubmitted || refreshInFlight.current) return
    if (saveStatusRef.current === 'saving') return
    const ae = window.document.activeElement as HTMLElement | null
    if (ae && (ae.tagName === 'TEXTAREA' || ae.tagName === 'INPUT')) return

    refreshInFlight.current = true
    try {
      // Pull from every rubric's review row, not just the anchor — a document
      // has one independent row per rubric, and score_comments/review_scores
      // for a non-anchor rubric live under that rubric's own row.
      const allReviewRowIds = Array.from(
        new Set([review.id, ...(reviewNotesRows ?? []).map((r) => r.id)])
      )

      const [{ data: sc }, { data: rs }, { data: rev }] = await Promise.all([
        supabase
          .from('score_comments')
          .select('id, rubric_item_id, score_level, body')
          .in('review_id', allReviewRowIds)
          .order('created_at', { ascending: true }),
        supabase
          .from('review_scores')
          .select('rubric_item_id, criterion_scores, score, comment')
          .in('review_id', allReviewRowIds),
        supabase
          .from('reviews')
          .select('notes')
          .eq('id', activeNotesReviewIdRef.current)
          .single(),
      ])
      // Re-check guards — the reviewer may have started editing during the fetch.
      // (cast re-widens the ref: TS narrows it across the await above.)
      if ((saveStatusRef.current as SaveStatus) === 'saving') return
      const ae2 = window.document.activeElement as HTMLElement | null
      if (ae2 && (ae2.tagName === 'TEXTAREA' || ae2.tagName === 'INPUT')) return

      setScores((prev) => {
        const next: Record<string, LocalScore> = {}
        for (const itemId of Object.keys(prev)) {
          const existing = prev[itemId]
          // rubric_item_id belongs to exactly one rubric, so filtering the
          // all-rows result by itemId alone already scopes each item to its
          // own rubric's data — no further per-row lookup needed here.
          const itemComments = (sc ?? []).filter((c) => c.rubric_item_id === itemId)
          const niComments = itemComments.filter((c) => c.score_level === 'does_not_meet').map((c) => ({ id: c.id, body: c.body }))
          const exceedsComments = itemComments.filter((c) => c.score_level === 'exceeds').map((c) => ({ id: c.id, body: c.body }))
          const exemplifiesComments = itemComments.filter((c) => c.score_level === 'exemplifies').map((c) => ({ id: c.id, body: c.body }))
          const rsRow = (rs ?? []).find((r) => r.rubric_item_id === itemId)
          const proficientSelected = (rsRow?.criterion_scores ?? []).includes('exemplifies')
          const derived: CriterionScore[] = [...((rsRow?.criterion_scores ?? []) as CriterionScore[])]
          if (exceedsComments.length > 0 && !derived.includes('exceeds')) derived.push('exceeds')
          if (niComments.length > 0 && !derived.includes('does_not_meet')) derived.push('does_not_meet')
          if (proficientSelected && !derived.includes('exemplifies')) derived.push('exemplifies')
          if (exemplifiesComments.length > 0 && !derived.includes('exemplifies')) derived.push('exemplifies')
          next[itemId] = {
            ...existing,
            scores: derived,
            comment: rsRow?.comment ?? existing.comment,
            proficientSelected,
            niComments,
            exceedsComments,
            exemplifiesComments,
            // annotations are managed separately — preserve local state
          }
        }
        return next
      })

      // General comment: if the stored notes changed externally, remount the field
      // with the fresh value. Safe here — the guards above ensure it isn't focused
      // and no save is pending, so no in-progress text is lost.
      // Also keep notesTextMapRef in sync so a subsequent tab-switch restores the fresh value.
      const freshNotes = rev?.notes ?? null
      setServerNotes((prevNotes) => {
        if (freshNotes !== prevNotes) {
          notesTextMapRef.current[activeNotesReviewIdRef.current] = freshNotes ?? ''
          setNotesKey((k) => k + 1)
        }
        return freshNotes
      })
    } finally {
      refreshInFlight.current = false
    }
  // reviewNotesRows is stable server-side data; intentionally excluded from deps.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, review.id, isSubmitted])

  useEffect(() => {
    let debounce: ReturnType<typeof setTimeout> | null = null
    const schedule = () => {
      if (debounce) clearTimeout(debounce)
      debounce = setTimeout(() => { debounce = null; refreshCommentsFromServer() }, 250)
    }
    const onVisibility = () => { if (window.document.visibilityState === 'visible') schedule() }
    window.addEventListener('focus', schedule)
    window.document.addEventListener('visibilitychange', onVisibility)
    return () => {
      if (debounce) clearTimeout(debounce)
      window.removeEventListener('focus', schedule)
      window.document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [refreshCommentsFromServer])

  // ── Criterion focus / blur ─────────────────────────────────────────────────
  const handleActiveItemChange = useCallback((id: string) => {
    const now = performance.now()
    if (criterionFocusTime.current) {
      track('criterion_blur', {
        rubric_item_id: criterionFocusTime.current.id,
        dwell_ms: Math.round(now - criterionFocusTime.current.at),
      })
    }
    criterionFocusTime.current = { id, at: now }
    track('criterion_focus', { rubric_item_id: id })
    setActiveItemId(id)
  }, [track])

  // ── Score / comment change ─────────────────────────────────────────────────
  const handleScoreChange = useCallback(
    (rubricItemId: string, changes: { scores?: CriterionScore[]; comment?: string }) => {
      setScores((prev) => {
        const updated = { ...prev[rubricItemId], ...changes }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(onScoreChange as any)({
          rubricItemId,
          reviewId: getReviewRowIdForItem(rubricItemId),
          scores: updated.scores,
          comment: updated.comment,
        })
        if ('scores' in changes) {
          track('score_set', {
            rubric_item_id: rubricItemId,
            scores: changes.scores,
          })
        }
        return { ...prev, [rubricItemId]: updated }
      })
    },
    [onScoreChange, track, getReviewRowIdForItem]
  )

  // ── Annotation from text selection (PDF or HTML) ─────────────────────────
  const handleTextSelected = useCallback((selection: AnyTextSelection) => {
    if (isSubmitted || rubricItems.length === 0) return
    if ('page' in selection) {
      track('pdf_text_select', { page: selection.page, text_length: selection.text.length, text_preview: selection.text.slice(0, 80) })
    } else {
      track('html_text_select', { text_length: selection.text.length, text_preview: selection.text.slice(0, 80) })
    }
    setPendingSelection(selection)
  }, [isSubmitted, rubricItems.length, track])

  const handlePendingSelectionClear = useCallback(() => {
    if (pendingSelection) {
      track('annotation_abandoned', {
        ...('page' in pendingSelection ? { page: pendingSelection.page } : {}),
        text_length: pendingSelection.text.length,
      })
    }
    setPendingSelection(null)
  }, [pendingSelection, track])

  const handleAnnotationConfirm = useCallback(
    async (payload: AnnotationConfirmPayload) => {
      if (!pendingSelection) return
      const { body, rubricItemId, tag } = payload

      let anchor
      if ('page' in pendingSelection) {
        const { page, text, rects, pageWidth, containerWidth, prefix, suffix } = pendingSelection
        anchor = {
          page, text, rects, pageWidth, containerWidth,
          selector: [{ type: 'TextQuoteSelector' as const, exact: text, prefix, suffix }],
        }
      } else if (pendingSelection.type === 'h5p') {
        anchor = {
          type: 'h5p-activity' as const,
          pageIndex: pendingSelection.pageIndex,
          activityKey: pendingSelection.activityKey,
          text: pendingSelection.text,
        }
      } else {
        const { pageIndex, start, end, text, prefix, suffix } = pendingSelection
        anchor = {
          type: 'html-char-offset' as const,
          pageIndex,
          selector: [
            { type: 'TextPositionSelector' as const, start, end },
            { type: 'TextQuoteSelector' as const, exact: text, prefix, suffix },
          ],
        }
      }

      const validItemId = rubricItemId && scores[rubricItemId] ? rubricItemId : null

      if (!validItemId) {
        const newId = await saveAnnotation({ reviewId: activeNotesReviewIdRef.current, rubricItemId: null, anchor, body, tag })
        if (!newId) return 'Failed to save evidence. Please try again.'
        track('annotation_create', { annotation_id: newId, rubric_item_id: null, tag, char_count: body.length })
        setGeneralAnnotations((prev) => [{ id: newId, anchor, body, tag }, ...prev])
        setPendingSelection(null)
        return null
      }

      const newId = await saveAnnotation({ reviewId: activeNotesReviewIdRef.current, rubricItemId: validItemId, anchor, body, tag })
      if (!newId) return 'Failed to save evidence. Please try again.'
      track('annotation_create', { annotation_id: newId, rubric_item_id: validItemId, tag, char_count: body.length })
      setScores((prev) => ({
        ...prev,
        [validItemId]: {
          ...prev[validItemId],
          annotations: [{ id: newId, anchor, body, tag }, ...prev[validItemId].annotations],
        },
      }))
      setPendingSelection(null)
      return null
    },
    [pendingSelection, scores, saveAnnotation, setGeneralAnnotations, track]
  )

  const handleAddGeneralNote = useCallback(
    async (body: string, tag: HighlightTag | null, rubricItemId: string | null): Promise<string | null> => {
      const newId = await saveAnnotation({ reviewId: activeNotesReviewIdRef.current, rubricItemId, anchor: {}, body, tag })
      if (!newId) return 'Failed to save note. Please try again.'
      track('note_add', { annotation_id: newId, char_count: body.length, rubric_item_id: rubricItemId })
      if (rubricItemId && scoresRef.current[rubricItemId]) {
        setScores(prev => ({
          ...prev,
          [rubricItemId]: {
            ...prev[rubricItemId],
            annotations: [
              { id: newId, anchor: {}, body, tag },
              ...prev[rubricItemId].annotations,
            ],
          },
        }))
      } else {
        setGeneralAnnotations(prev => [{ id: newId, anchor: {}, body, tag }, ...prev])
      }
      return null
    },
    [saveAnnotation, track]
  )

  const handleDeleteGeneralAnnotation = useCallback(async (annotationId: string) => {
    track('note_delete', { annotation_id: annotationId })
    await deleteAnnotation(annotationId)
    setGeneralAnnotations((prev) => prev.filter((a) => a.id !== annotationId))
  }, [deleteAnnotation, track])

  const handleAnnotationDelete = useCallback(
    async (rubricItemId: string, annotationId: string) => {
      track('annotation_delete', { annotation_id: annotationId, rubric_item_id: rubricItemId })
      await deleteAnnotation(annotationId)
      setScores((prev) => ({
        ...prev,
        [rubricItemId]: {
          ...prev[rubricItemId],
          annotations: prev[rubricItemId].annotations.filter((a) => a.id !== annotationId),
        },
      }))
    },
    [deleteAnnotation, track]
  )

  // Called from PDF highlight click — deletes without knowing rubric item
  const handleAnnotationDeleteFromPDF = useCallback(
    async (annotationId: string) => {
      let rubricItemId: string | null = null
      for (const [id, s] of Object.entries(scoresRef.current)) {
        if (s.annotations.some((a) => a.id === annotationId)) { rubricItemId = id; break }
      }
      track('annotation_delete', { annotation_id: annotationId, rubric_item_id: rubricItemId })
      await deleteAnnotation(annotationId)
      setScores((prev) => {
        const next = { ...prev }
        for (const rubricItemId of Object.keys(next)) {
          if (next[rubricItemId].annotations.some((a) => a.id === annotationId)) {
            next[rubricItemId] = {
              ...next[rubricItemId],
              annotations: next[rubricItemId].annotations.filter((a) => a.id !== annotationId),
            }
            break
          }
        }
        return next
      })
      setGeneralAnnotations((prev) => prev.filter((a) => a.id !== annotationId))
    },
    [deleteAnnotation, track]
  )

  // Called from PDF highlight click — edits body/tag without knowing rubric item
  const handleAnnotationEditFromPDF = useCallback(
    async (annotationId: string, changes: { body: string; tag: HighlightTag | null }) => {
      let rubricItemId: string | null = null
      for (const [id, s] of Object.entries(scoresRef.current)) {
        if (s.annotations.some((a) => a.id === annotationId)) { rubricItemId = id; break }
      }
      track('annotation_edit', { annotation_id: annotationId, rubric_item_id: rubricItemId })
      await updateAnnotation(annotationId, changes)
      setScores((prev) => {
        const next = { ...prev }
        for (const rubricItemId of Object.keys(next)) {
          const idx = next[rubricItemId].annotations.findIndex((a) => a.id === annotationId)
          if (idx !== -1) {
            const updated = [...next[rubricItemId].annotations]
            updated[idx] = { ...updated[idx], ...changes }
            next[rubricItemId] = { ...next[rubricItemId], annotations: updated }
            break
          }
        }
        return next
      })
      setGeneralAnnotations((prev) =>
        prev.map((a) => (a.id === annotationId ? { ...a, ...changes } : a))
      )
    },
    [updateAnnotation, track]
  )

  const handleAnnotationRelink = useCallback(
    async (annotationId: string, newRubricItemIds: string[], updates: { body: string; tag: HighlightTag | null }) => {
      const allAnns = [
        ...Object.entries(scoresRef.current).flatMap(([rubricItemId, s]) =>
          s.annotations.map(ann => ({ ...ann, rubricItemId }))
        ),
        ...generalAnnotationsRef.current.map(ann => ({ ...ann, rubricItemId: null as null })),
      ]
      const target = allAnns.find(a => a.id === annotationId)
      if (!target) return

      const anchorStr = JSON.stringify(target.anchor)
      const siblings = allAnns.filter(a => JSON.stringify(a.anchor) === anchorStr)

      track('annotation_relink', {
        annotation_id: annotationId,
        old_rubric_item_ids: siblings.map(s => s.rubricItemId),
        new_rubric_item_ids: newRubricItemIds,
      })

      await Promise.all(siblings.map(s => deleteAnnotation(s.id)))

      const insertIds: (string | null)[] = newRubricItemIds.length > 0 ? newRubricItemIds : [null]
      const results = await Promise.all(
        insertIds.map(id =>
          saveAnnotation({
            reviewId: activeNotesReviewIdRef.current,
            rubricItemId: id,
            anchor: target.anchor as Json,
            body: updates.body,
            tag: updates.tag,
          })
        )
      )

      setScores(prev => {
        const next = { ...prev }
        for (const sib of siblings) {
          if (sib.rubricItemId && next[sib.rubricItemId]) {
            next[sib.rubricItemId] = {
              ...next[sib.rubricItemId],
              annotations: next[sib.rubricItemId].annotations.filter(a => a.id !== sib.id),
            }
          }
        }
        insertIds.forEach((rubricItemId, i) => {
          const newId = results[i]
          if (!newId || !rubricItemId || !next[rubricItemId]) return
          next[rubricItemId] = {
            ...next[rubricItemId],
            annotations: [
              { id: newId, anchor: target.anchor, body: updates.body, tag: updates.tag },
              ...next[rubricItemId].annotations,
            ],
          }
        })
        return next
      })

      const oldGeneralIds = siblings.filter(s => !s.rubricItemId).map(s => s.id)
      if (oldGeneralIds.length > 0) {
        setGeneralAnnotations(prev => prev.filter(a => !oldGeneralIds.includes(a.id)))
      }
      const newGeneralEntries = insertIds
        .map((rubricItemId, i) => ({ rubricItemId, newId: results[i] }))
        .filter(({ rubricItemId, newId }) => !rubricItemId && newId)
      if (newGeneralEntries.length > 0) {
        setGeneralAnnotations(prev => [
          ...newGeneralEntries.map(({ newId }) => ({
            id: newId!,
            anchor: target.anchor,
            body: updates.body,
            tag: updates.tag,
          })),
          ...prev,
        ])
      }
    },
    [deleteAnnotation, saveAnnotation, track]
    // activeNotesReviewIdRef is a ref — intentionally excluded from deps (stable identity, read via .current)
  )

  const handleEditFreeNote = useCallback(
    async (annotationId: string, changes: { body: string; rubricItemId: string | null; tag?: HighlightTag | null }) => {
      if (changes.rubricItemId) {
        track('note_categorize', { annotation_id: annotationId, to_rubric_item_id: changes.rubricItemId, char_count: changes.body.length })
      } else {
        track('note_edit', { annotation_id: annotationId, char_count: changes.body.length })
      }
      await updateAnnotation(annotationId, {
        body: changes.body,
        rubricItemId: changes.rubricItemId,
        ...(changes.tag !== undefined && { tag: changes.tag }),
      })
      if (changes.rubricItemId && scores[changes.rubricItemId]) {
        const fromGeneral = generalAnnotations.find((a) => a.id === annotationId)
        if (fromGeneral) {
          // Move from generalAnnotations into a criterion
          setGeneralAnnotations((prev) => prev.filter((a) => a.id !== annotationId))
          setScores((prev) => ({
            ...prev,
            [changes.rubricItemId!]: {
              ...prev[changes.rubricItemId!],
              annotations: [
                {
                  id: annotationId,
                  anchor: fromGeneral.anchor,
                  body: changes.body,
                  tag: changes.tag !== undefined ? changes.tag : fromGeneral.tag,
                },
                ...prev[changes.rubricItemId!].annotations,
              ],
            },
          }))
        } else {
          // Move from one criterion to another
          setScores((prev) => {
            const next = { ...prev }
            let movedAnn: { id: string; anchor: Record<string, unknown>; body: string; tag: string | null } | null = null
            for (const criterionId of Object.keys(next)) {
              if (criterionId === changes.rubricItemId) continue
              const idx = next[criterionId].annotations.findIndex((a) => a.id === annotationId)
              if (idx !== -1) {
                movedAnn = next[criterionId].annotations[idx]
                next[criterionId] = {
                  ...next[criterionId],
                  annotations: next[criterionId].annotations.filter((a) => a.id !== annotationId),
                }
                break
              }
            }
            if (movedAnn) {
              next[changes.rubricItemId!] = {
                ...next[changes.rubricItemId!],
                annotations: [
                  {
                    id: annotationId,
                    anchor: movedAnn.anchor,
                    body: changes.body,
                    tag: changes.tag !== undefined ? changes.tag : movedAnn.tag,
                  },
                  ...next[changes.rubricItemId!].annotations,
                ],
              }
            }
            return next
          })
        }
      } else {
        setGeneralAnnotations((prev) =>
          prev.map((a) =>
            a.id === annotationId
              ? { ...a, body: changes.body, ...(changes.tag !== undefined && { tag: changes.tag }) }
              : a
          )
        )
      }
    },
    [updateAnnotation, scores, generalAnnotations, track]
  )

  // ── Criterion comment blur ────────────────────────────────────────────────
  const handleCommentBlur = useCallback(
    (rubricItemId: string, comment: string) => {
      track('comment_change', { rubric_item_id: rubricItemId, char_count: comment.length })
    },
    [track]
  )

  // ── Score comment edit ────────────────────────────────────────────────────
  const handleEditScoreComment = useCallback(
    async (rubricItemId: string, commentId: string, scoreLevel: CriterionScore, body: string) => {
      track('score_comment_edit', { rubric_item_id: rubricItemId, comment_id: commentId, score_level: scoreLevel, char_count: body.length })
      await updateScoreComment(commentId, body)
      setScores((prev) => {
        const existing = prev[rubricItemId]
        if (!existing) return prev
        const key = SCORE_COMMENT_KEY[scoreLevel]
        return {
          ...prev,
          [rubricItemId]: {
            ...existing,
            [key]: existing[key].map((c) => (c.id === commentId ? { ...c, body } : c)),
          },
        }
      })
    },
    [updateScoreComment, track]
  )

  // ── Score comments ────────────────────────────────────────────────────────
  const handleAddScoreComment = useCallback(
    async (rubricItemId: string, scoreLevel: CriterionScore, body: string) => {
      const reviewId = getReviewRowIdForItem(rubricItemId)
      const id = await addScoreComment(reviewId, rubricItemId, scoreLevel, body)
      if (!id) return
      track('score_comment_add', { rubric_item_id: rubricItemId, score_level: scoreLevel, char_count: body.length })
      setScores((prev) => {
        const existing = prev[rubricItemId]
        const item: ScoreComment = { id, rubric_item_id: rubricItemId, score_level: scoreLevel, body }
        const updatedScores = existing.scores.includes(scoreLevel)
          ? existing.scores
          : [...existing.scores, scoreLevel]
        const key = SCORE_COMMENT_KEY[scoreLevel]
        const updated: LocalScore = {
          ...existing,
          scores: updatedScores,
          [key]: [...existing[key], { id: item.id, body: item.body }],
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(onScoreChange as any)({ rubricItemId, reviewId, scores: updatedScores, comment: existing.comment })
        return { ...prev, [rubricItemId]: updated }
      })
    },
    [addScoreComment, onScoreChange, track, getReviewRowIdForItem]
  )

  const handleDeleteScoreComment = useCallback(
    async (rubricItemId: string, commentId: string, scoreLevel: CriterionScore) => {
      track('score_comment_delete', { rubric_item_id: rubricItemId, comment_id: commentId, score_level: scoreLevel })
      await deleteScoreComment(commentId)
      setScores((prev) => {
        const existing = prev[rubricItemId]
        const key = SCORE_COMMENT_KEY[scoreLevel]
        const updatedComments = existing[key].filter((c) => c.id !== commentId)
        const updatedScores = updatedComments.length === 0
          ? existing.scores.filter((s) => s !== scoreLevel)
          : existing.scores
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(onScoreChange as any)({
          rubricItemId,
          reviewId: getReviewRowIdForItem(rubricItemId),
          scores: updatedScores,
          comment: existing.comment,
        })
        return {
          ...prev,
          [rubricItemId]: {
            ...existing,
            [key]: updatedComments,
            scores: updatedScores,
          },
        }
      })
    },
    [deleteScoreComment, onScoreChange, track, getReviewRowIdForItem]
  )

  // Distinct rubric ids in play (used by the submit flow and per-rubric read-only state).
  const allRubricIds = useMemo(
    () => Array.from(new Set(rubricItems.map((i) => i.rubric_id))),
    [rubricItems]
  )

  // ── Submit (per rubric) ──────────────────────────────────────────────────────
  // Release a single rubric's feedback to the author. The review row stays
  // 'in_progress' (so the reviewer keeps edit access to the remaining rubrics —
  // RLS write policies require in_progress) until the last rubric is submitted,
  // at which point the whole review flips to 'submitted'.
  const handleSubmit = useCallback(
    async (rubricId: string, finalOverallComment: string): Promise<string | null> => {
      await saveDraft()

      // The review row that owns the rubric actually being submitted — a
      // document has one independent row per rubric, and rubricId here is
      // whichever tab the reviewer was on when they clicked Submit (captured
      // via submitRubricId at click time, not necessarily the anchor row).
      const submittedReviewId = getReviewRowIdForRubric(rubricId)

      const isFirstSubmission = submittedRubricIds.size === 0
      const willAllBeSubmitted = allRubricIds.every(
        (id) => id === rubricId || submittedRubricIds.has(id)
      )
      // Record this rubric as released (idempotent on the unique constraint).
      const { error: subError } = await supabase
        .from('review_rubric_submissions')
        .upsert(
          { review_id: submittedReviewId, rubric_id: rubricId },
          { onConflict: 'review_id,rubric_id', ignoreDuplicates: true }
        )
      if (subError) return subError.message ?? 'Submit failed — please try again'

      // Update the review row. Keep status='in_progress' unless this completes the
      // review; stamp submitted_at on the first release.
      const reviewUpdate: {
        overall_comment: string
        submitted_at?: string
        status?: 'submitted'
        coordinator_approval?: 'pending'
        coordinator_note?: null
      } = { overall_comment: finalOverallComment }
      if (isFirstSubmission) reviewUpdate.submitted_at = new Date().toISOString()
      if (willAllBeSubmitted) reviewUpdate.status = 'submitted'
      // Completing an org submission holds the whole review for coordinator
      // approval; clear any prior send-back note so it re-enters as "pending".
      if (willAllBeSubmitted && requiresCoordinatorApproval) {
        reviewUpdate.coordinator_approval = 'pending'
        reviewUpdate.coordinator_note = null
      }

      const { error } = await supabase
        .from('reviews')
        .update(reviewUpdate)
        .eq('id', submittedReviewId)
      if (error) return error.message ?? 'Submit failed — please try again'

      // When this is the final rubric, every OTHER row for this reviewer+document
      // is also done — willAllBeSubmitted only becomes true once each of them has
      // its own review_rubric_submissions entry — but each of THEM was submitted
      // while willAllBeSubmitted was still false, so its own status update (above)
      // never ran at the time. Flip status on those sibling rows now, so the
      // document actually reads as fully submitted: the reviewer dashboard's
      // "Completed" tab and the coordinator dashboard's per-rubric status both
      // derive from each row's own status column, not from review_rubric_submissions
      // alone. overall_comment is per-rubric and belongs only to submittedReviewId,
      // so this is a separate, narrower update rather than folding into the one
      // above (which would incorrectly overwrite siblings' own overall_comment).
      if (willAllBeSubmitted) {
        const siblingUpdate: { status: 'submitted'; coordinator_approval?: 'pending'; coordinator_note?: null } = {
          status: 'submitted',
        }
        if (requiresCoordinatorApproval) {
          siblingUpdate.coordinator_approval = 'pending'
          siblingUpdate.coordinator_note = null
        }
        const { error: siblingsError } = await supabase
          .from('reviews')
          .update(siblingUpdate)
          .eq('document_id', document.id)
          .eq('reviewer_id', userId)
          .eq('status', 'in_progress')
          .neq('id', submittedReviewId)
        if (siblingsError) return siblingsError.message ?? 'Submit failed — please try again'
      }

      const rubricScoredCount = rubricItems.filter(
        (i) => i.rubric_id === rubricId && (scores[i.id]?.scores.length ?? 0) > 0
      ).length
      const rubricTotal = rubricItems.filter((i) => i.rubric_id === rubricId).length
      track('submit', {
        rubric_id: rubricId,
        all_submitted: willAllBeSubmitted,
        scored_criteria: rubricScoredCount,
        total_criteria: rubricTotal,
        overall_comment_length: finalOverallComment.length,
      })
      await flush()

      setSubmittedRubricIds((prev) => new Set(prev).add(rubricId))
      onReviewUpdate({
        ...review,
        status: willAllBeSubmitted ? 'submitted' : review.status,
        overall_comment: finalOverallComment,
        ...(willAllBeSubmitted && requiresCoordinatorApproval
          ? { coordinator_approval: 'pending' as const, coordinator_note: null }
          : {}),
      })
      return null
    },
    [saveDraft, supabase, review, document, userId, onReviewUpdate, track, flush, scores, rubricItems, submittedRubricIds, allRubricIds, requiresCoordinatorApproval, getReviewRowIdForRubric]
  )

  const handleConfirmSubmit = useCallback(async () => {
    if (!submitRubricId) return
    const rubricId = submitRubricId
    const willAllBeSubmitted = allRubricIds.every(
      (id) => id === rubricId || submittedRubricIds.has(id)
    )
    setIsSubmitting(true)
    setSubmitError(null)
    const error = await handleSubmit(rubricId, overallComment)
    setIsSubmitting(false)
    if (error) {
      setSubmitError(error)
      return
    }
    setSubmitRubricId(null)
    // Only leave the console once every rubric has been released.
    if (willAllBeSubmitted) {
      router.push('/reviewer?tab=completed')
      // The Router Cache is keyed by pathname, not search params, so the
      // already-visited /reviewer segment would otherwise serve stale RSC and
      // keep showing the doc under "My Reviews" instead of "Completed".
      router.refresh()
    }
  }, [handleSubmit, overallComment, router, submitRubricId, allRubricIds, submittedRubricIds])

  const firstRubricId = useMemo(() => {
    for (const item of rubricItems) {
      return item.rubric_id
    }
    return null
  }, [rubricItems])

  // Initialize to the review's own rubric so the ?review=X deep-link always opens that tab.
  const [activeRubricId, setActiveRubricId] = useState<string | null>(review.rubric_id)

  // Per-rubric submission derived state (allRubricIds is declared above, near the submit handler).
  const activeRubricSubmitted = activeRubricId ? submittedRubricIds.has(activeRubricId) : false
  // The active rubric is read-only if it's been submitted, or the whole review is done.
  const activeRubricIsReadOnly = isSubmitted || activeRubricSubmitted
  // Confirm-modal target rubric.
  const submitRubricTitle = submitRubricId
    ? rubricItems.find((i) => i.rubric_id === submitRubricId)?.rubric_title ?? 'this rubric'
    : ''
  const submitIsLastRubric =
    !!submitRubricId &&
    allRubricIds.every((id) => id === submitRubricId || submittedRubricIds.has(id))
  const [scrollToAnnotationId, setScrollToAnnotationId] = useState<string | null>(null)
  const [pulseAnnotationId, setPulseAnnotationId] = useState<string | null>(null)
  const [panelScrollAnnotationId, setPanelScrollAnnotationId] = useState<string | null>(null)
  const [focusAnnotationId, setFocusAnnotationId] = useState<string | null>(null)

  useEffect(() => {
    if (firstRubricId && activeRubricId === null) {
      setActiveRubricId(firstRubricId)
    }
  }, [firstRubricId])

  // When the reviewer switches rubric tabs, update the active notes review row,
  // reset the General Comments textarea, and swap in the new tab's general annotations
  // from the upfront-loaded cache (no DB round-trip needed).
  useEffect(() => {
    if (isFirstNotesMountRef.current) { isFirstNotesMountRef.current = false; return }
    if (activeRubricId === null) return
    // Persist the leaving tab's current general annotations so they survive the switch.
    generalAnnotationsMapRef.current[activeNotesReviewIdRef.current] = generalAnnotationsRef.current
    const notesRow = reviewNotesRows?.find(r => r.rubric_id === activeRubricId)
    const newReviewId = notesRow?.id ?? review.id
    setActiveNotesReviewId(newReviewId)
    // Restore the live cached notes text for the incoming tab — notesTextMapRef holds the
    // last typed value (updated on every keystroke), so typed-but-not-yet-saved text survives
    // the switch instead of being replaced by the stale SSR value from reviewNotesRows.
    const restoredNotes = notesTextMapRef.current[newReviewId] ?? notesRow?.notes ?? null
    setServerNotes(restoredNotes)
    setNotesKey(k => k + 1)
    // All annotations loaded upfront — read from the per-tab cache instead of the network.
    setGeneralAnnotations(generalAnnotationsMapRef.current[newReviewId] ?? [])
  // reviewNotesRows and review.id are stable server-side data; intentionally excluded from deps.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRubricId])

  // Scroll the rubric panel to the target annotation card, expanding its criterion if needed
  useEffect(() => {
    if (!panelScrollAnnotationId) return
    const timer = setTimeout(() => {
      const el = window.document.getElementById(`annotation-card-${panelScrollAnnotationId}`)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setPanelScrollAnnotationId(null)
    }, 150)
    return () => clearTimeout(timer)
  }, [panelScrollAnnotationId])

  const activeViewerCriteria = useMemo(
    () => activeRubricId
      ? rubricItems.filter(item => item.rubric_id === activeRubricId).map(({ id, label }) => ({ id, label }))
      : rubricItems.map(({ id, label }) => ({ id, label })),
    [rubricItems, activeRubricId]
  )

  const handleScoreToggle = useCallback(
    (rubricItemId: string, level: CriterionScore) => {
      const current = scoresRef.current[rubricItemId]
      if (!current) return
      const newScores = current.scores.includes(level)
        ? current.scores.filter(s => s !== level)
        : [...current.scores, level]
      handleScoreChange(rubricItemId, { scores: newScores })
    },
    [handleScoreChange]
  )

  const scoredCount = Object.values(scores).filter((s) => s.scores.length > 0).length
  const totalCount = rubricItems.length

  // Maps each rubric item ID to its parent rubric ID so savedAnnotations can be
  // scoped to the active rubric tab only.
  // Seeded from reviewNotesRows annotations (available at mount, covers all annotated
  // items) and extended from rubricItems state once the async query resolves.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rubricItemIdToRubricId = useMemo<Record<string, string>>(() => {
    const fromNotes = Object.fromEntries(
      (reviewNotesRows ?? []).flatMap(row =>
        (row.annotations ?? [])
          .filter((a): a is typeof a & { rubric_item_id: string } => a.rubric_item_id !== null)
          .map(a => [a.rubric_item_id, row.rubric_id] as [string, string])
      )
    )
    const fromItems = Object.fromEntries(rubricItems.map(item => [item.id, item.rubric_id]))
    // fromItems wins over fromNotes (authoritative once rubricItems is loaded)
    return { ...fromNotes, ...fromItems }
  // reviewNotesRows is stable SSR data; intentionally excluded from deps
  }, [rubricItems])

  // Flatten saved annotations for OER highlight overlays — filtered to the active rubric
  // only, so criterion-linked highlights from other rubric tabs don't bleed through.
  const savedAnnotations = useMemo(() => [
    ...Object.entries(scores)
      .filter(([rubricItemId]) => rubricItemIdToRubricId[rubricItemId] === activeRubricId)
      .flatMap(([rubricItemId, s]) =>
        s.annotations.map((ann) => ({ ...ann, rubricItemId }))
      ),
    ...generalAnnotations.map((ann) => ({ ...ann, rubricItemId: null })),
  ], [scores, generalAnnotations, rubricItemIdToRubricId, activeRubricId])

  function handleViewFullComment(annotationId: string) {
    const ann = savedAnnotations.find(a => a.id === annotationId)
    if (!ann) return
    if (ann.rubricItemId) {
      const item = rubricItems.find(r => r.id === ann.rubricItemId)
      if (item && item.rubric_id !== activeRubricId) {
        setActiveRubricId(item.rubric_id)
      }
    }
    setPanelScrollAnnotationId(annotationId)
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-surface overflow-hidden print:h-auto print:overflow-visible print:block">
      {review.coordinator_approval === 'changes_requested' && review.coordinator_note && (
        <div className="shrink-0 border-b border-[var(--color-border)] bg-[var(--color-error-container)] px-6 py-3 print:hidden">
          <p className="text-label-sm font-label font-semibold uppercase tracking-wide text-[var(--color-error)]">
            Returned by coordinator
          </p>
          <p className="mt-1 text-body-sm text-[var(--color-text-primary)] leading-relaxed whitespace-pre-wrap">
            {review.coordinator_note}
          </p>
          <p className="mt-1 text-label-sm font-label text-[var(--color-text-muted)]">
            Address the requested changes and submit again to send it back for approval.
          </p>
        </div>
      )}
      <ResizablePanelLayout
        defaultLeftPercent={50}
        minLeftWidth={320}
        leftPanel={
          <div className="h-full overflow-hidden print:hidden">
            {document.platform === 'OLI Torus' ? (
              <TorusAnnotationViewer
                supabase={supabase}
                reviewId={review.id}
                sourceUrl={document.source_url}
                courseAccessCode={document.course_access_code}
                savedAnnotations={savedAnnotations}
                rubricItems={activeViewerCriteria}
                onBack={() => { saveDraft().then(() => router.push('/reviewer?tab=my-reviews')) }}
                disabled={activeRubricIsReadOnly}
                scrollToAnnotationId={scrollToAnnotationId}
                onGoToAnnotation={() => setScrollToAnnotationId(null)}
                onAnnotationViewFull={handleViewFullComment}
                pulseAnnotationId={pulseAnnotationId}
                onPulseComplete={() => setPulseAnnotationId(null)}
                submissionTitle={document.title}
                onIndexMapReady={setAnnotationIndexMap}
                onCarouselNavigate={(annotationId) => {
                  handleViewFullComment(annotationId)
                }}
              />
            ) : document.file_type === 'html' && document.content_fingerprint ? (
              <HtmlViewerCanvas
                snapshotSrc={`/api/snapshot/${document.content_fingerprint}${document.source_url ? `?src=${encodeURIComponent(document.source_url)}` : ''}`}
                additionalPages={document.pages ?? undefined}
                onBack={() => { saveDraft().then(() => router.push('/reviewer?tab=my-reviews')) }}
                rubricItems={activeViewerCriteria}
                activeItemId={activeItemId}
                pendingSelection={pendingSelection && 'type' in pendingSelection ? pendingSelection : null}
                savedAnnotations={savedAnnotations}
                onTextSelected={handleTextSelected}
                onAnnotationConfirm={handleAnnotationConfirm}
                onPendingSelectionClear={handlePendingSelectionClear}
                onAnnotationEdit={handleAnnotationEditFromPDF}
                onAnnotationDelete={handleAnnotationDeleteFromPDF}
                onAnnotationRelink={handleAnnotationRelink}
                onTrackEvent={track}
                disabled={activeRubricIsReadOnly}
                scrollToAnnotationId={scrollToAnnotationId}
                onGoToAnnotation={() => setScrollToAnnotationId(null)}
                pulseAnnotationId={pulseAnnotationId}
                onPulseComplete={() => setPulseAnnotationId(null)}
                onAnnotationViewFull={handleViewFullComment}
                focusAnnotationId={focusAnnotationId}
              />
            ) : document.file_url ? (
              <PDFViewer
                fileUrl={document.file_url}
                onBack={() => { saveDraft().then(() => router.push('/reviewer?tab=my-reviews')) }}
                rubricItems={activeViewerCriteria}
                activeItemId={activeItemId}
                pendingSelection={pendingSelection && 'page' in pendingSelection ? pendingSelection : null}
                savedAnnotations={savedAnnotations}
                onTextSelected={handleTextSelected as (sel: TextSelection) => void}
                onAnnotationConfirm={handleAnnotationConfirm}
                onPendingSelectionClear={handlePendingSelectionClear}
                onAnnotationEdit={handleAnnotationEditFromPDF}
                onAnnotationDelete={handleAnnotationDeleteFromPDF}
                onAnnotationRelink={handleAnnotationRelink}
                onTrackEvent={track}
                disabled={activeRubricIsReadOnly}
                scrollToAnnotationId={scrollToAnnotationId}
                onGoToAnnotation={() => setScrollToAnnotationId(null)}
                onAnnotationViewFull={handleViewFullComment}
              />
            ) : null}
          </div>
        }
        rightPanel={
          <div className="h-full overflow-hidden print:w-full print:overflow-visible">
            <ReviewRightPanel
              rubricItems={rubricItems}
              scores={scores}
              generalAnnotations={generalAnnotations}
              activeRubricId={activeRubricId}
              onActiveRubricChange={setActiveRubricId}
              isReadOnly={activeRubricIsReadOnly}
              generalReadOnly={isSubmitted}
              submittedRubricIds={submittedRubricIds}
              onSubmit={() => { if (activeRubricId) setSubmitRubricId(activeRubricId) }}
              onScoreToggle={handleScoreToggle}
              onAddComment={handleAddScoreComment}
              onEditComment={handleEditScoreComment}
              onDeleteComment={handleDeleteScoreComment}
              onEditFreeNote={handleEditFreeNote}
              onGoToAnnotation={(id) => { setScrollToAnnotationId(id); setPulseAnnotationId(id); setFocusAnnotationId(id) }}
              onEditAnnotation={handleAnnotationEditFromPDF}
              onDeleteAnnotation={handleAnnotationDeleteFromPDF}
              expandToAnnotationId={panelScrollAnnotationId}
              initialNotes={serverNotes}
              onGeneralCommentChange={handleGeneralCommentChange}
              saveStatus={saveStatus}
              notesKey={notesKey}
              goToLabel={document.platform === 'OLI Torus' ? 'Go to screenshot' : undefined}
              annotationIndexMap={annotationIndexMap}
            />
          </div>
        }
      />

      <Modal open={submitRubricId !== null} onClose={() => { if (!isSubmitting) setSubmitRubricId(null) }}>
        <ModalContent className="max-w-sm h-auto">
          <div className="p-6">
            <div className="flex items-start justify-between gap-4 mb-3">
              <h2 className="font-heading text-title-lg text-text-primary leading-snug">
                Submit {submitRubricTitle}?
              </h2>
              <button
                type="button"
                onClick={() => { if (!isSubmitting) setSubmitRubricId(null) }}
                className="shrink-0 rounded-md p-1 text-text-muted hover:text-text-primary hover:bg-surface-container transition-colors duration-150"
                aria-label="Close"
              >
                <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 3l10 10M13 3L3 13" />
                </svg>
              </button>
            </div>
            <p className="text-body-md text-text-secondary">
              {submitIsLastRubric
                ? 'This is your last rubric. Submitting it sends this rubric to the author and completes the review — you will no longer be able to edit it.'
                : 'This rubric will be sent to the author and locked. Your other rubrics stay open for editing.'}
            </p>
            {submitError && (
              <p className="text-body-sm text-error mt-3">{submitError}</p>
            )}
            <div className="flex items-center justify-end gap-3 mt-6">
              <Button
                variant="secondary"
                size="md"
                disabled={isSubmitting}
                onClick={() => setSubmitRubricId(null)}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="md"
                disabled={isSubmitting}
                onClick={handleConfirmSubmit}
              >
                {isSubmitting ? 'Submitting…' : 'Submit Rubric'}
              </Button>
            </div>
          </div>
        </ModalContent>
      </Modal>
    </div>
  )
}
