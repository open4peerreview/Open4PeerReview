'use client'

import { useState, useMemo, useCallback, useRef } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import type { CriterionScore, FeedbackResponseStatus, FeedbackTargetType, ReportStatus } from '@/types'
import { Button } from '@/components/ui/Button'
import { CriterionReportCard } from '@/components/ui/CriterionReportCard'
import { EvidenceCard } from '@/components/ui/EvidenceCard'
import { ReviewSummaryPanel } from '@/components/ui/ReviewSummaryPanel'
import { AddressStatusControl } from '@/components/ui/AddressStatusControl'
import ResizablePanelLayout from '@/components/layout/ResizablePanelLayout'
import {
  setFeedbackResponse,
  clearFeedbackResponse,
  setFeedbackComment,
  clearFeedbackComment,
  addRevisionNote,
  updateRevisionNote,
  setReportStatus,
  setRevisedLink,
} from '@/lib/supabase/authorFeedback'
import { OerReadOnlyViewer } from './OerReadOnlyViewer'
import { toOerPages } from '@/lib/oer-pages'
import { TorusReadOnlyViewer } from './TorusReadOnlyViewer'

// ── Types ────────────────────────────────────────────────────────────────────

interface RubricItemRow {
  id: string
  label: string
  sort_order: number
  description: string | null
}

interface ReviewScoreRow {
  id: string
  score: CriterionScore | null
  criterion_scores: string[]
  comment: string | null
  rubric_item: RubricItemRow | null
}

interface ScoreCommentRow {
  id: string
  rubric_item_id: string
  score_level: string
  body: string
}

interface AnnotationRow {
  id: string
  rubric_item_id: string | null
  anchor: unknown
  body: string
  tag: string | null
}

interface ReviewRow {
  id: string
  overall_comment: string | null
  notes: string | null
  submitted_at: string | null
  coordinator_approval?: string | null
  coordinator_note?: string | null
  reviewer: { display_name: string | null; email: string; reviewer_type: string | null } | null
  rubric: { id: string; title: string } | null
  review_rubric_submissions?: { rubric_id: string; submitted_at: string }[]
  review_scores: ReviewScoreRow[]
  annotations: AnnotationRow[]
  score_comments: ScoreCommentRow[]
}

interface FeedbackResponseRow {
  id: string
  target_type: FeedbackTargetType
  target_id: string
  status: FeedbackResponseStatus
  review_id: string
}

interface RevisionNoteRow {
  id: string
  body: string
  review_id: string | null
  created_at: string
  updated_at: string
}

interface FeedbackCommentRow {
  id: string
  target_type: FeedbackTargetType
  target_id: string
  body: string
  review_id: string
}

interface Props {
  document: {
    id: string
    title: string
    file_type?: string | null
    content_fingerprint?: string | null
    pages?: unknown
    platform?: string | null
    source_url?: string | null
    course_access_code?: string | null
    report_status?: ReportStatus | null
    revised_link?: string | null
  }
  reviews: ReviewRow[]
  allRubrics?: { id: string; title: string; itemIds: string[] }[]
  pdfUrl?: string | null
  isAuthor?: boolean
  initialResponses?: FeedbackResponseRow[]
  initialRevisionNotes?: RevisionNoteRow[]
  initialFeedbackComments?: FeedbackCommentRow[]
}

function responseKey(targetType: FeedbackTargetType, targetId: string) {
  return `${targetType}:${targetId}`
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function resolveScores(criterionScores: string[] | null, score: CriterionScore | null): CriterionScore[] {
  const arr = (criterionScores ?? []) as CriterionScore[]
  return arr.length > 0 ? arr : (score ? [score] : [])
}

function formatDate(iso: string | null) {
  if (!iso) return null
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function PrintIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 6V2h8v4" />
      <rect x="2" y="6" width="12" height="7" rx="1" />
      <path d="M4 10h8M4 13h5" />
    </svg>
  )
}

// ── ScratchPadCard ────────────────────────────────────────────────────────────

function ScratchPadCard({
  documentId,
  initialNote,
}: {
  documentId: string
  initialNote: { id: string; body: string } | null
}) {
  const [noteId, setNoteId] = useState<string | null>(initialNote?.id ?? null)
  const [draft, setDraft] = useState(initialNote?.body ?? '')
  const [saving, setSaving] = useState(false)
  const savedRef = useRef(initialNote?.body ?? '')

  const handleBlur = async () => {
    const next = draft.trim()
    if (next === savedRef.current.trim()) return
    setSaving(true)
    try {
      if (noteId) {
        await updateRevisionNote({ id: noteId, body: next })
        savedRef.current = next
      } else if (next !== '') {
        const row = await addRevisionNote({ documentId, reviewId: null, body: next })
        setNoteId(row.id)
        savedRef.current = next
      }
    } catch (err) {
      console.error('Failed to save scratch pad', err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-card)] shadow-[var(--shadow-1)] px-5 py-4"
      data-print-hide
    >
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <span className="block text-body-md font-heading font-semibold text-text-primary">
          Scratch Pad
        </span>
        <span className="text-label-sm font-label text-[var(--color-text-muted)]">Private to you</span>
      </div>
      <p className="text-body-sm text-[var(--color-text-muted)] mb-3">
        Notes for your own planning. Only you can see these.
      </p>
      <div className="relative">
        <textarea
          className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-3 py-2 text-body-sm text-[var(--color-text-primary)] leading-relaxed resize-y min-h-[80px] focus:outline-none focus:border-[var(--color-border-strong)]"
          placeholder="Jot down your revision plans, reminders, or anything else…"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={handleBlur}
        />
        {saving && (
          <span className="absolute bottom-2 right-3 text-label-sm font-label text-[var(--color-text-muted)]">
            Saving…
          </span>
        )}
      </div>
    </div>
  )
}

// ── PublishRevisionsModal ─────────────────────────────────────────────────────

function PublishRevisionsModal({
  initialRevisedLink,
  unfilledRequiredCriteriaCount,
  onPublish,
  onClose,
}: {
  initialRevisedLink: string | null
  unfilledRequiredCriteriaCount: number
  onPublish: (link: string) => Promise<void>
  onClose: () => void
}) {
  const [revisedUrl, setRevisedUrl] = useState(initialRevisedLink ?? '')
  const [linkError, setLinkError] = useState<string | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)

  const urlTrimmed = revisedUrl.trim()
  const urlFilled  = urlTrimmed.length > 0
  const allCommentsFilled = unfilledRequiredCriteriaCount === 0
  const canPublish = urlFilled && allCommentsFilled

  const validateUrl = (): boolean => {
    if (urlTrimmed && !/^https?:\/\//i.test(urlTrimmed)) {
      setLinkError('Enter a full URL starting with http:// or https://')
      return false
    }
    setLinkError(null)
    return true
  }

  const handleConfirm = async () => {
    if (!validateUrl()) return
    setPublishing(true)
    setPublishError(null)
    try {
      await onPublish(urlTrimmed)
      onClose()
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : 'Something went wrong — please try again.')
    } finally {
      setPublishing(false)
    }
  }

  const warnings: string[] = []
  if (!urlFilled) warnings.push('enter your updated OER URL')
  if (!allCommentsFilled) {
    warnings.push(
      `add revision comments for the ${unfilledRequiredCriteriaCount} ${unfilledRequiredCriteriaCount === 1 ? 'criterion' : 'criteria'} you marked Addressed`
    )
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[var(--color-surface-card)] rounded-lg border border-[var(--color-border)] shadow-[var(--shadow-4)] p-6 max-w-md w-full mx-4">
        <h3 className="font-heading text-heading-sm font-semibold text-[var(--color-text-primary)] mb-1">
          Publish revisions?
        </h3>
        <p className="text-body-sm text-[var(--color-text-secondary)] mb-5">
          Once published, your revision comments on each criterion will be visible alongside the original peer review. This cannot be automatically undone.
        </p>

        <div className="flex flex-col gap-1.5 mb-4">
          <label className="text-label-sm font-label font-semibold text-[var(--color-text-primary)]">
            Updated OER URL
          </label>
          <input
            type="url"
            inputMode="url"
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-container-low)] px-3 py-2 text-body-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-border-strong)]"
            placeholder="https://… link to your revised resource"
            value={revisedUrl}
            onChange={e => { setRevisedUrl(e.target.value); setLinkError(null) }}
            onBlur={validateUrl}
          />
          {linkError && (
            <p className="text-body-sm text-[var(--color-error)]">{linkError}</p>
          )}
        </div>

        {warnings.length > 0 && (
          <p className="text-body-sm text-[var(--color-text-muted)] mb-4">
            To publish, {warnings.join(' and ')}.
          </p>
        )}

        <div className="flex items-center gap-3 justify-end">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={publishing}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleConfirm}
            loading={publishing}
            disabled={!canPublish || publishing}
          >
            Publish
          </Button>
        </div>

        {publishError && (
          <p className="mt-3 text-body-sm text-[var(--color-error)]">{publishError}</p>
        )}
      </div>
    </div>
  )
}

// ── ConsoleRevisionView ──────────────────────────────────────────────────────

export function ConsoleRevisionView({
  document,
  reviews,
  allRubrics: allRubricsFromProps,
  isAuthor = false,
  initialResponses = [],
  initialRevisionNotes = [],
  initialFeedbackComments = [],
}: Props) {
  const router = useRouter()
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({})
  const [showPublishModal, setShowPublishModal] = useState(false)
  const [scrollToAnnotationId, setScrollToAnnotationId] = useState<string | null>(null)
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(true)
  const [annotationIndexMap, setAnnotationIndexMap] = useState<Map<string, number>>(new Map())

  // ── Author-side feedback state (statuses + revision notes) ──
  const [responses, setResponses] = useState<Map<string, FeedbackResponseStatus>>(
    () => new Map(initialResponses.map(r => [responseKey(r.target_type, r.target_id), r.status]))
  )
  // Per-item author comments (annotations + rubric criteria), keyed by target.
  const [comments, setComments] = useState<Map<string, string>>(
    () => new Map(initialFeedbackComments.map(c => [responseKey(c.target_type, c.target_id), c.body]))
  )

  const statusFor = useCallback(
    (targetType: FeedbackTargetType, targetId: string): FeedbackResponseStatus | null =>
      responses.get(responseKey(targetType, targetId)) ?? null,
    [responses]
  )

  const handleStatusChange = useCallback(
    async (
      targetType: FeedbackTargetType,
      targetId: string,
      reviewId: string,
      next: FeedbackResponseStatus | null
    ) => {
      const key = responseKey(targetType, targetId)
      const prev = responses.get(key) ?? null
      // Optimistic update
      setResponses(m => {
        const copy = new Map(m)
        if (next === null) copy.delete(key)
        else copy.set(key, next)
        return copy
      })
      try {
        if (next === null) {
          await clearFeedbackResponse({ targetType, targetId })
        } else {
          await setFeedbackResponse({ documentId: document.id, reviewId, targetType, targetId, status: next })
        }
      } catch (err) {
        console.error('Failed to save feedback status', err)
        // Revert
        setResponses(m => {
          const copy = new Map(m)
          if (prev === null) copy.delete(key)
          else copy.set(key, prev)
          return copy
        })
      }
    },
    [responses, document.id]
  )

  const commentFor = useCallback(
    (targetType: FeedbackTargetType, targetId: string): string =>
      comments.get(responseKey(targetType, targetId)) ?? '',
    [comments]
  )

  const handleCommentChange = useCallback(
    async (
      targetType: FeedbackTargetType,
      targetId: string,
      reviewId: string,
      body: string
    ) => {
      const key = responseKey(targetType, targetId)
      const prev = comments.get(key) ?? ''
      const trimmed = body.trim()
      // Optimistic update
      setComments(m => {
        const copy = new Map(m)
        if (trimmed === '') copy.delete(key)
        else copy.set(key, trimmed)
        return copy
      })
      try {
        if (trimmed === '') {
          await clearFeedbackComment({ targetType, targetId })
        } else {
          await setFeedbackComment({ documentId: document.id, reviewId, targetType, targetId, body: trimmed })
        }
      } catch (err) {
        console.error('Failed to save feedback comment', err)
        // Revert
        setComments(m => {
          const copy = new Map(m)
          if (prev === '') copy.delete(key)
          else copy.set(key, prev)
          return copy
        })
      }
    },
    [comments, document.id]
  )

  const handleCriterionClick = (rubricItemId: string) => {
    setExpandedCards(prev => ({ ...prev, [rubricItemId]: true }))
    setTimeout(() => {
      window.document.getElementById(`criterion-${rubricItemId}`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      })
    }, 50)
  }

  const searchParams = useSearchParams()
  const from = searchParams.get('from')
  const requestedRubricId = searchParams.get('rubric')
  const backHref = from === 'reviewer'
    ? '/reviewer?tab=completed'
    : from === 'coordinator'
      ? '/coordinator'
      : '/author'

  const allRubrics: { id: string; title: string; itemIds: string[] }[] = allRubricsFromProps ?? []

  // Author-response controls belong to the author's revision workflow.
  const canLeaveNotes = isAuthor

  // Per-rubric submit: a rubric is visible to the author once the reviewer has released
  // it (a review_rubric_submissions row exists). Legacy fallback: a review with no
  // submission rows predates per-rubric submission — treat all its rubrics as released.
  const submittedRubricIds = new Set<string>(
    reviews.flatMap(rv => {
      const subs = rv.review_rubric_submissions ?? []
      if (subs.length > 0) return subs.map(s => s.rubric_id)
      return allRubrics.map(r => r.id) // legacy whole-review submission
    })
  )

  const firstSubmittedRubricId =
    allRubrics.find(r => submittedRubricIds.has(r.id))?.id ?? null

  const allRubricsReleased = allRubrics.length > 0 && allRubrics.every(r => submittedRubricIds.has(r.id))
  const reportStatus = (document.report_status ?? null) as ReportStatus | null

  const applyReportStatus = useCallback(async (status: ReportStatus | null) => {
    await setReportStatus({ documentId: document.id, status })
    router.refresh()
  }, [document.id, router])

  const applyRevisedLink = useCallback(async (link: string) => {
    await setRevisedLink({ documentId: document.id, link: link || null })
    router.refresh()
  }, [document.id, router])

  const [selectedRubricId, setSelectedRubricId] = useState<string | null>(() => {
    if (!reviews.length) return null
    if (requestedRubricId && submittedRubricIds.has(requestedRubricId)) {
      return requestedRubricId
    }
    return firstSubmittedRubricId
  })

  const review = reviews.find(r => r.rubric?.id === selectedRubricId) ?? reviews[0] ?? null

  const selectedItemIds = new Set(
    allRubrics.find(r => r.id === selectedRubricId)?.itemIds ?? []
  )

  const sortedScores = review
    ? [...review.review_scores]
        .filter(rs => rs.rubric_item !== null && (selectedItemIds.size === 0 || selectedItemIds.has(rs.rubric_item!.id)))
        .sort((a, b) => (a.rubric_item!.sort_order ?? 0) - (b.rubric_item!.sort_order ?? 0))
    : []

  const reviewerName = review?.reviewer?.display_name ?? review?.reviewer?.email ?? 'Anonymous Reviewer'
  const reviewerType = review?.reviewer?.reviewer_type ?? null
  const selectedRubricSubmittedAt =
    review?.review_rubric_submissions?.find(s => s.rubric_id === selectedRubricId)?.submitted_at
    ?? review?.submitted_at
    ?? null
  const submittedDate = formatDate(selectedRubricSubmittedAt)

  const snapshotSrc = document.content_fingerprint
    ? `/api/snapshot/${document.content_fingerprint}${document.source_url ? `?src=${encodeURIComponent(document.source_url)}` : ''}`
    : null

  const allAnnotations = useMemo(
    () => reviews.flatMap(rv => rv.annotations),
    [reviews]
  )

  const rubricItems = useMemo(() => {
    const seen = new Set<string>()
    const result: { id: string; label: string }[] = []
    for (const rv of reviews) {
      for (const rs of rv.review_scores) {
        if (rs.rubric_item && !seen.has(rs.rubric_item.id)) {
          seen.add(rs.rubric_item.id)
          result.push({ id: rs.rubric_item.id, label: rs.rubric_item.label })
        }
      }
    }
    return result
  }, [reviews])

  const unlinkedAnnotations = useMemo(
    () => review
      ? review.annotations.filter(
          a => a.rubric_item_id === null && Object.keys(a.anchor as Record<string, unknown>).length > 0
        )
      : [],
    [review]
  )

  // Doc-level scratch pad note (review_id IS NULL — not tied to a specific review).
  const initialDocNote = useMemo(() => {
    const n = initialRevisionNotes.find(note => note.review_id === null)
    return n ? { id: n.id, body: n.body } : null
  }, [initialRevisionNotes])

  // Criteria where any annotation or score comment is marked Addressed —
  // these require a public revision comment before the author can publish.
  const criteriaRequiringComment = useMemo(() => {
    if (!review) return []
    return sortedScores
      .filter(rs => {
        const itemId = rs.rubric_item!.id
        const anns = review.annotations.filter(a => a.rubric_item_id === itemId)
        const scs  = review.score_comments.filter(c => c.rubric_item_id === itemId)
        return (
          anns.some(a => responses.get(responseKey('annotation', a.id)) === 'addressed') ||
          scs.some(c  => responses.get(responseKey('score_comment', c.id)) === 'addressed')
        )
      })
      .map(rs => rs.rubric_item!.id)
  }, [review, sortedScores, responses])

  const unfilledRequiredCriteriaCount = criteriaRequiringComment.filter(
    itemId => !(comments.get(responseKey('criterion', itemId)) ?? '').trim()
  ).length

  const handlePublish = useCallback(async (link: string) => {
    await setRevisedLink({ documentId: document.id, link: link || null })
    await setReportStatus({ documentId: document.id, status: 'published' })
    router.refresh()
  }, [document.id, router])

  return (
    <div className="flex-1 min-h-0">
      <style>{`
        [data-print-header] { display: none; }
        @media print {
          nav,
          .back-link,
          .export-pdf-btn,
          [data-print-hide] {
            display: none !important;
          }
          [data-criterion-body] {
            display: block !important;
            grid-template-rows: 1fr !important;
          }
          [data-criterion-card] {
            box-shadow: none !important;
            border: none !important;
            border-radius: 0 !important;
            border-top: 1px solid #000 !important;
            page-break-inside: avoid;
          }
          [data-collapse-toggle] {
            display: none !important;
          }
          body {
            background: white !important;
          }
          [data-panel-root] {
            overflow: visible !important;
            height: auto !important;
          }
          [data-panel-right] {
            position: static !important;
            overflow: visible !important;
            height: auto !important;
            width: 100% !important;
          }
          [data-print-header] {
            display: flex !important;
            align-items: center;
            gap: 12px;
            margin-bottom: 24px;
            padding-bottom: 16px;
            border-bottom: 1px solid var(--color-border);
          }
          [data-rating="exemplifies"],
          [data-rubric-tab-selected] {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
            background-color: transparent !important;
            border-color: var(--color-primary) !important;
            color: var(--color-primary) !important;
          }
        }
      `}</style>

      <ResizablePanelLayout
        defaultLeftPercent={50}
        leftPanelCollapsed={leftPanelCollapsed}
        onLeftPanelCollapsedChange={setLeftPanelCollapsed}
        leftPanelLabel={document.platform === 'OLI Torus' ? 'View Torus' : 'View OER'}
        rightPanelLabel="View Report"
        leftPanel={
          document.platform === 'OLI Torus' ? (
            <TorusReadOnlyViewer
              sourceUrl={document.source_url ?? null}
              courseAccessCode={document.course_access_code ?? null}
              annotations={allAnnotations}
              scrollToAnnotationId={scrollToAnnotationId}
              rubricItems={rubricItems}
              onBack={() => setLeftPanelCollapsed(true)}
              onIndexMapReady={setAnnotationIndexMap}
              onViewFullComment={(rubricItemId) => {
                setExpandedCards(prev => ({ ...prev, [rubricItemId]: true }))
                setTimeout(() => {
                  window.document.getElementById(`criterion-${rubricItemId}`)
                    ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }, 50)
              }}
            />
          ) : snapshotSrc ? (
            <OerReadOnlyViewer
              snapshotSrc={snapshotSrc}
              annotations={allAnnotations}
              scrollToAnnotationId={scrollToAnnotationId}
              rubricItems={rubricItems}
              additionalPages={toOerPages(document.pages)}
              onViewFullComment={(rubricItemId) => {
                setExpandedCards(prev => ({ ...prev, [rubricItemId]: true }))
                setTimeout(() => {
                  window.document.getElementById(`criterion-${rubricItemId}`)
                    ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }, 50)
              }}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-[var(--color-text-muted)]">
              OER preview not available for this resource type.
            </div>
          )
        }
        rightPanel={
          <div className="h-full overflow-y-auto">
            <div className="mx-auto max-w-6xl px-6 py-10">

        {/* Print-only branding header */}
        <div
          data-print-header
          style={{ alignItems: 'center', gap: '12px', marginBottom: '24px', paddingBottom: '16px', borderBottom: '1px solid var(--color-border)' }}
        >
          <img src="/logo.svg" alt="" style={{ height: '32px', width: 'auto' }} />
          <span style={{ fontFamily: 'var(--font-newsreader), Newsreader, Georgia, serif', fontWeight: 700, fontSize: '18px', color: 'var(--color-primary)' }}>
            Open 4 Peer Review Hub
          </span>
        </div>

        {/* Back link */}
        <Button
          variant="text"
          size="sm"
          className="back-link mb-6"
          onClick={() => router.push(backHref)}
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M10 3L5 8l5 5" />
          </svg>
          Back to Dashboard
        </Button>

        {/* View tag */}
        <div className="mb-3" data-print-hide>
          <span className="inline-flex items-center px-2 py-0.5 rounded-sm bg-[var(--color-surface-container-high)] text-[var(--color-text-muted)] text-label-sm font-label font-medium uppercase tracking-widest">
            Revision Console
          </span>
        </div>

        {/* Page header */}
        <div className="flex items-start justify-between gap-6 mb-6">
          <div className="min-w-0">
            <h1 className="font-heading text-heading-md font-semibold text-[var(--color-text-primary)] leading-tight">
              {document.title}
            </h1>

            {review && (
              <p className="mt-1.5 text-body-sm text-[var(--color-text-muted)]">
                {submittedDate && <>Review submitted {submittedDate} · </>}
                Reviewed by {reviewerName}{reviewerType === 'student' ? ' (Student Reviewer)' : ''}
              </p>
            )}

            {allRubrics.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-3">
                {allRubrics.map(rubric => {
                  const isSubmitted = submittedRubricIds.has(rubric.id)
                  const isSelected = rubric.id === selectedRubricId
                  return (
                    <button
                      key={rubric.id}
                      disabled={!isSubmitted}
                      onClick={() => isSubmitted && setSelectedRubricId(rubric.id)}
                      {...(isSelected ? { 'data-rubric-tab-selected': '' } : {})}
                      className={[
                        'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-label-sm font-label font-semibold border transition-colors',
                        isSelected
                          ? 'bg-primary text-on-primary border-primary'
                          : isSubmitted
                            ? 'bg-[var(--color-surface-container-high)] text-[var(--color-text-secondary)] border-[var(--color-border)] hover:bg-[var(--color-surface-container)] cursor-pointer'
                            : 'bg-[var(--color-surface-container-high)] text-[var(--color-text-muted)] border-[var(--color-border)] opacity-50 cursor-not-allowed',
                      ].join(' ')}
                    >
                      {rubric.title}
                      {!isSubmitted && (
                        <span className="text-[0.65rem] opacity-75">In progress</span>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {review && (
            <div className="flex items-center gap-2 shrink-0">
              {canLeaveNotes && (allRubricsReleased || reportStatus !== null) && reportStatus !== 'published' && (
                <Button
                  variant="secondary"
                  size="sm"
                  data-print-hide
                  onClick={() => setShowPublishModal(true)}
                >
                  Publish Revisions
                </Button>
              )}
              <Button
                variant="secondary"
                size="sm"
                className="export-pdf-btn"
                onClick={() => {
                  const sanitize = (s: string) => s.replace(/[/\\:*?"<>|]/g, '-')
                  const sub = sanitize(document.title)
                  const rub = review?.rubric?.title ? sanitize(review.rubric.title) : ''
                  const rev = sanitize(reviewerName)
                  const filename = rub ? `${sub} (${rub}) - ${rev}` : `${sub} - ${rev}`
                  const orig = window.document.title
                  window.document.title = filename
                  const restore = () => {
                    window.document.title = orig
                    window.removeEventListener('afterprint', restore)
                  }
                  window.addEventListener('afterprint', restore)
                  window.print()
                }}
              >
                <PrintIcon />
                Export PDF
              </Button>
            </div>
          )}
        </div>

        {/* Published success banner */}
        {canLeaveNotes && reportStatus === 'published' && (
          <div className="mb-6 rounded-lg border border-[var(--color-success)] bg-[var(--color-success-container)] px-5 py-4" data-print-hide>
            <p className="text-body-sm font-label font-semibold text-[var(--color-success)]">Revisions saved</p>
            <p className="mt-0.5 text-body-sm text-[var(--color-text-secondary)]">
              Your revised OER link and revision comments have been saved. The public certification page isn&rsquo;t live yet &mdash; your revisions will appear there once it&rsquo;s built.
            </p>
          </div>
        )}

        {/* Empty state */}
        {!review && (
          <div className="rounded-lg border-2 border-dashed border-[var(--color-border)] py-20 text-center">
            <p className="text-body-md font-medium text-[var(--color-text-secondary)]">No submitted reviews yet</p>
            <p className="mt-1 text-body-sm text-[var(--color-text-muted)]">Reviews will appear here once submitted by a reviewer.</p>
          </div>
        )}

        {review && (
          <>
            {/* Reviewer's summary */}
            {review.overall_comment && (
              <div className="rounded-lg bg-[var(--color-surface-container)] px-5 py-4 mb-6">
                <span className="block text-label-sm font-label font-semibold uppercase tracking-wide text-[var(--color-text-muted)] mb-2">
                  Reviewer&rsquo;s Summary
                </span>
                <p className="text-body-sm text-[var(--color-text-primary)] leading-relaxed">
                  {review.overall_comment}
                </p>
                {canLeaveNotes && (
                  <div className="pt-3 mt-3 border-t border-[var(--color-border)]">
                    <AddressStatusControl
                      status={statusFor('overall_comment', review.id)}
                      onChange={s => handleStatusChange('overall_comment', review.id, review.id, s)}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Review summary panel */}
            <ReviewSummaryPanel
              items={sortedScores.map(rs => ({
                id: rs.rubric_item!.id,
                label: rs.rubric_item!.label,
                scores: resolveScores(rs.criterion_scores, rs.score),
                evidenceCount: review.annotations.filter(
                  a => a.rubric_item_id === rs.rubric_item!.id
                ).length,
              }))}
              onCriterionClick={handleCriterionClick}
              className="mb-6"
            />

            {/* Scratch Pad — private author notes, directly under the review summary */}
            {canLeaveNotes && (
              <div className="mb-6">
                <ScratchPadCard
                  documentId={document.id}
                  initialNote={initialDocNote}
                />
              </div>
            )}

            {/* Detailed feedback heading */}
            <h2 data-print-hide className="font-heading text-heading-sm text-[var(--color-text-primary)]">
              Detailed Feedback
            </h2>

            {/* Criterion report cards + General Comments + Unlinked Annotations */}
            <div className="flex flex-col gap-3 mt-2">
              {/* General Comments — reviews.notes */}
              {review.notes && (
                <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-card)] shadow-[var(--shadow-1)] px-5 py-4">
                  <span className="block text-body-md font-heading font-semibold text-text-primary mb-3">
                    General Comments
                  </span>
                  <p className="text-body-sm text-[var(--color-text-primary)] leading-relaxed whitespace-pre-wrap">
                    {review.notes}
                  </p>
                </div>
              )}

              {/* Unlinked Annotations */}
              {unlinkedAnnotations.length > 0 && (
                <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-card)] shadow-[var(--shadow-1)] px-5 py-4">
                  <span className="block text-body-md font-heading font-semibold text-text-primary mb-3">
                    Unlinked Annotations
                  </span>
                  <div className="flex flex-col gap-2">
                    {unlinkedAnnotations.map(ann => (
                      <EvidenceCard
                        key={ann.id}
                        annotation={ann as { id: string; rubric_item_id: string | null; anchor: Record<string, unknown>; body: string; tag: string | null }}
                        onGoToAnnotation={() => {
                          setLeftPanelCollapsed(false)
                          setScrollToAnnotationId(ann.id)
                          setTimeout(() => setScrollToAnnotationId(null), 500)
                        }}
                        goToLabel={document.platform === 'OLI Torus' ? 'Go to screenshot' : undefined}
                        screenshotNumber={annotationIndexMap.get(ann.id)}
                        showStatusControl={canLeaveNotes}
                        status={statusFor('annotation', ann.id)}
                        onStatusChange={s => handleStatusChange('annotation', ann.id, review.id, s)}
                        showComment={canLeaveNotes}
                        comment={commentFor('annotation', ann.id)}
                        onCommentChange={body => handleCommentChange('annotation', ann.id, review.id, body)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {sortedScores.map((rs, i) => (
                <CriterionReportCard
                  key={rs.id}
                  id={`criterion-${rs.rubric_item!.id}`}
                  isOpen={expandedCards[rs.rubric_item!.id] ?? false}
                  onToggle={() =>
                    setExpandedCards(prev => ({
                      ...prev,
                      [rs.rubric_item!.id]: !(prev[rs.rubric_item!.id] ?? false),
                    }))
                  }
                  rubricItem={{
                    id: rs.rubric_item!.id,
                    label: rs.rubric_item!.label,
                    sort_order: rs.rubric_item!.sort_order,
                    description: rs.rubric_item!.description ?? '',
                  }}
                  criterionScores={resolveScores(rs.criterion_scores, rs.score)}
                  scoreComments={review.score_comments.filter(c => c.rubric_item_id === rs.rubric_item!.id)}
                  annotations={
                    review.annotations.filter(
                      a => a.rubric_item_id === rs.rubric_item!.id
                    ) as { id: string; rubric_item_id: string | null; anchor: Record<string, unknown>; body: string; tag: string | null }[]
                  }
                  index={i + 1}
                  onGoToAnnotation={(annotationId) => {
                    setLeftPanelCollapsed(false)
                    setScrollToAnnotationId(annotationId)
                    setTimeout(() => setScrollToAnnotationId(null), 500)
                  }}
                  goToLabel={document.platform === 'OLI Torus' ? 'Go to screenshot' : undefined}
                  annotationIndexMap={annotationIndexMap}
                  showStatusControls={canLeaveNotes}
                  statusFor={statusFor}
                  onStatusChange={(targetType, targetId, s) => handleStatusChange(targetType, targetId, review.id, s)}
                  commentFor={commentFor}
                  onCommentChange={(targetType, targetId, body) => handleCommentChange(targetType, targetId, review.id, body)}
                />
              ))}
            </div>

            {/* Publish Revisions modal */}
            {showPublishModal && (
              <PublishRevisionsModal
                initialRevisedLink={document.revised_link ?? null}
                unfilledRequiredCriteriaCount={unfilledRequiredCriteriaCount}
                onPublish={handlePublish}
                onClose={() => setShowPublishModal(false)}
              />
            )}
          </>
        )}

            </div>
          </div>
        }
      />
    </div>
  )
}
