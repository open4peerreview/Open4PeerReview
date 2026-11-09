'use client'

import { ResourceLink } from '@/components/ui/ResourceLink'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Accordion } from '@/components/ui/Accordion'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { StepIndicator } from '@/components/ui/StepIndicator'
import { Button } from '@/components/ui/Button'
import type { ReportStatus } from '@/types'
import { setReportStatus } from '@/lib/supabase/authorFeedback'

function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ')
}

export interface RubricReview {
  rubricId: string
  rubricTitle: string
  status: 'unassigned' | 'assigned' | 'under-review' | 'review-submitted' | 'feedback-ready' | 'published'
}

export interface DocumentCardProps {
  id: string
  title: string
  platform: string
  authors: string
  discipline: string
  ccLicense: string
  description: string
  submittedAt: string
  rubrics: RubricReview[]
  /** Author's publish/revise/private decision on the released report. */
  reportStatus?: ReportStatus | null
  /** True once every rubric has been reviewed and released to the author. */
  reportReady?: boolean
  /** Whether this document is on the public-review track (affects pipeline step labels). */
  publicReview?: boolean
  onDelete?: () => void
  deleteDisabled?: boolean
}

// Badge shown for author report decisions not already covered by pipeline status badges.
// 'published'         → pipeline already shows 'Published' per-rubric when report_status='published' — removed here.
// 'ready to publish'  → pipeline already shows 'Feedback Ready' per-rubric when reportReady is true — removed here.
// 'private'           → kept: on public-track submissions it conveys distinct info from the Public/Private pill.
// 'revising'          → kept: no pipeline-status equivalent for this author action.
function reportBadgeFor(reportStatus: ReportStatus | null | undefined) {
  if (reportStatus === 'private') return { label: 'Private', bg: 'var(--color-status-draft-bg)', text: 'var(--color-status-draft-text)' }
  return null
}

const PRIORITY_ORDER: RubricReview['status'][] = [
  'published',
  'feedback-ready',
  'review-submitted',
  'under-review',
  'assigned',
  'unassigned',
]

const PIPELINE_STEPS_PRIVATE = ['Unassigned', 'Assigned', 'Under Review', 'Review Submitted', 'Feedback Ready']
const PIPELINE_STEPS_PUBLIC  = ['Unassigned', 'Assigned', 'Under Review', 'Review Submitted', 'Feedback Ready', 'Published']

const STATUS_TO_STEP: Record<RubricReview['status'], number> = {
  'unassigned':        1,
  'assigned':          2,
  'under-review':      3,
  'review-submitted':  4,
  'feedback-ready':    5,
  'published':         6,
}

type PendingAction = 'publish' | 'revise' | 'keep-private'

const MODAL_COPY: Record<PendingAction, { title: string; body: string; confirmLabel: string }> = {
  publish: {
    title: 'Publish this review report?',
    body: 'Once published, this review and its feedback will be publicly accessible on the O4PR platform. It will appear on the public certification directory once that surface is live. This cannot be undone.',
    confirmLabel: 'Publish report',
  },
  revise: {
    title: 'Start revising?',
    body: "You'll be taken into the review console where you can address feedback, add revision comments, and mark criteria before deciding whether to publish.",
    confirmLabel: 'Start revising',
  },
  'keep-private': {
    title: 'Keep this report private?',
    body: 'Your review report will remain visible only to you, your reviewer, and any coordinators. You can still change your mind and publish later from the Completed Submissions tab.',
    confirmLabel: 'Keep private',
  },
}

export function DocumentCard({
  id,
  title,
  platform,
  authors,
  discipline,
  ccLicense,
  description,
  submittedAt,
  rubrics,
  reportStatus,
  reportReady,
  publicReview,
  onDelete,
  deleteDisabled,
}: DocumentCardProps) {
  const router = useRouter()
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
  const [loading, setLoading] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [publishSuccess, setPublishSuccess] = useState(false)

  const showDecisionBanner    = !!publicReview && reportReady === true && !reportStatus
  const showRevisionBanner    = !!publicReview && reportStatus === 'revising'
  const showChangeOfMindBanner = !!publicReview && reportStatus === 'private'

  const openModal = (action: PendingAction) => {
    setActionError(null)
    setPublishSuccess(false)
    setPendingAction(action)
  }

  const closeModal = () => {
    if (loading || publishSuccess) return
    setPendingAction(null)
    setActionError(null)
  }

  const handleConfirmAction = async () => {
    if (!pendingAction) return
    setLoading(true)
    setActionError(null)
    try {
      if (pendingAction === 'publish') {
        await setReportStatus({ documentId: id, status: 'published' })
        setPublishSuccess(true)
        setTimeout(() => {
          router.refresh()
          setPendingAction(null)
          setPublishSuccess(false)
        }, 2000)
      } else if (pendingAction === 'revise') {
        await setReportStatus({ documentId: id, status: 'revising' })
        setPendingAction(null)
        router.push(`/author/feedback/${id}?from=author`)
      } else {
        await setReportStatus({ documentId: id, status: 'private' })
        setPendingAction(null)
        router.refresh()
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Something went wrong — please try again.')
    } finally {
      setLoading(false)
    }
  }

  const reportBadge = publicReview ? reportBadgeFor(reportStatus) : null
  const canViewReport = rubrics.some(r => r.status === 'feedback-ready' || r.status === 'published')

  const distinctStatuses = PRIORITY_ORDER.filter(s => rubrics.some(r => r.status === s))
  const shownStatuses = distinctStatuses.slice(0, 3)
  const hiddenRubricCount = rubrics.filter(r => !shownStatuses.includes(r.status)).length

  // ── Banners ──────────────────────────────────────────────────────────────────

  const decisionBanner = showDecisionBanner ? (
    <div
      className="rounded-lg border border-[var(--color-banner-border)] bg-[var(--color-banner-bg)] px-4 py-3 flex items-center justify-between gap-4"
      onClick={e => e.stopPropagation()}
    >
      <p className="text-body-sm text-[var(--color-banner-text)]">
        Every rubric has been reviewed and released. Choose how to proceed.
      </p>
      <div className="flex items-center gap-2 shrink-0">
        <Button variant="primary" size="sm" onClick={() => openModal('publish')}>
          Publish now
        </Button>
        <Button variant="secondary" size="sm" onClick={() => openModal('revise')}>
          Revise first
        </Button>
        <Button variant="secondary" size="sm" onClick={() => openModal('keep-private')}>
          Keep private
        </Button>
      </div>
    </div>
  ) : null

  const revisionBanner = showRevisionBanner ? (
    <div
      className="rounded-lg border border-[var(--color-banner-border)] bg-[var(--color-banner-bg)] px-4 py-3 flex items-center justify-between gap-4"
      onClick={e => e.stopPropagation()}
    >
      <div className="flex items-center gap-3 min-w-0">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 shrink-0 text-[var(--color-banner-text)]">
          <path d="M11.5 2.5l2 2-8 8H3.5v-2l8-8z"/>
          <path d="M9.5 4.5l2 2"/>
        </svg>
        <div>
          <p className="text-label-sm font-label font-semibold uppercase tracking-wide text-[var(--color-banner-text)]">
            Under revision
          </p>
          <p className="mt-0.5 text-body-sm text-[var(--color-banner-text)]">
            {"You've chosen to revise your OER before publishing. Continue in the review console."}
          </p>
        </div>
      </div>
      <div className="shrink-0">
        <Link
          href={`/author/feedback/${id}?from=author`}
          onClick={e => e.stopPropagation()}
          className="inline-flex items-center justify-center gap-2 font-medium transition-all duration-[var(--transition-duration-base)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded-md border border-primary bg-primary text-on-primary hover:bg-[var(--color-primary-hover)] px-3 py-1.5 text-xs"
        >
          Continue revising
        </Link>
      </div>
    </div>
  ) : null

  const changeOfMindBanner = showChangeOfMindBanner ? (
    <div
      className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-container)] px-4 py-3"
      onClick={e => e.stopPropagation()}
    >
      <p className="text-label-sm font-label font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
        Changed your mind?
      </p>
      <p className="mt-1 text-body-sm text-[var(--color-text-secondary)]">
        You can publish this review or revise it first. Your reviewer's feedback won't change.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="primary" size="sm" onClick={() => openModal('publish')}>
          Publish
        </Button>
        <Button variant="secondary" size="sm" onClick={() => openModal('revise')}>
          Revise
        </Button>
      </div>
    </div>
  ) : null

  const hasBanner = !!(decisionBanner || revisionBanner || changeOfMindBanner)

  // ── Modal ────────────────────────────────────────────────────────────────────

  const modalCopy = pendingAction ? MODAL_COPY[pendingAction] : null

  return (
    <>
      <Accordion
        renderTrigger={(isOpen) => (
          <div>

            {/* Header row: compact content left, controls right — chevron centers against this row only */}
            <div className="flex items-center justify-between gap-3">

              <div className="flex-1 min-w-0">

                {/* Row 1: public/private pill + status badges + report badge */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={publicReview
                    ? "inline-flex items-center gap-1 px-2 py-0.5 rounded-none bg-[var(--color-primary)] text-[var(--color-on-primary)] text-label-sm font-label font-semibold uppercase tracking-widest"
                    : "inline-flex items-center gap-1 px-2 py-0.5 rounded-none border border-[var(--color-status-unassigned-text)] bg-[var(--color-surface-card)] text-[var(--color-status-unassigned-text)] text-label-sm font-label font-semibold uppercase tracking-widest"
                  }>
                    {publicReview ? (
                      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3 shrink-0">
                        <circle cx="8" cy="8" r="6"/>
                        <path d="M8 2a8.5 8.5 0 010 12M8 2a8.5 8.5 0 000 12M2 8h12"/>
                      </svg>
                    ) : (
                      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3 shrink-0">
                        <rect x="3" y="8" width="10" height="7" rx="1"/>
                        <path d="M5 8V5a3 3 0 016 0v3"/>
                      </svg>
                    )}
                    {publicReview ? 'Public' : 'Private'}
                  </span>
                  {shownStatuses.map(s => <StatusBadge key={s} variant={s} />)}
                  {hiddenRubricCount > 0 && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-sm bg-[var(--color-surface-container-high)] text-[var(--color-text-muted)] text-label-sm font-label font-medium uppercase tracking-widest">
                      +{hiddenRubricCount} others
                    </span>
                  )}
                  {reportBadge && (
                    <span
                      className="inline-flex items-center px-2 py-0.5 rounded-sm text-label-sm font-label font-semibold uppercase tracking-widest"
                      style={{ backgroundColor: reportBadge.bg, color: reportBadge.text }}
                    >
                      {reportBadge.label}
                    </span>
                  )}
                </div>

                {/* Row 2: title */}
                <h2 className="font-heading text-title-lg text-text-primary leading-snug mt-3 truncate">
                  {title}
                </h2>

                {/* Row 3: platform + date */}
                <div className="flex items-center gap-4 mt-2 text-body-sm text-text-secondary flex-wrap">
                  <ResourceLink documentId={id} label={platform} />
                  <span className="flex items-center gap-1">
                    <svg viewBox="0 0 16 16" fill="none" className="w-3.5 h-3.5 shrink-0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="4" width="12" height="10" rx="1" />
                      <path d="M2 8h12M6 2v4M10 2v4" />
                    </svg>
                    Submitted: {new Date(submittedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                </div>

              </div>

              {/* Controls: optional View Report button + chevron, centered against the header content only */}
              <div className="shrink-0 flex items-center gap-2">
                {canViewReport && reportStatus !== 'revising' && (
                  <Link
                    href={`/author/feedback/${id}?from=author&view=report`}
                    onClick={e => e.stopPropagation()}
                    className="inline-flex items-center justify-center font-medium transition-all duration-[var(--transition-duration-base)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded-md px-3 py-1.5 text-xs border border-primary bg-primary text-on-primary hover:bg-[var(--color-primary-hover)]"
                  >
                    View report
                  </Link>
                )}
                <svg
                  viewBox="0 0 16 16"
                  fill="none"
                  aria-hidden="true"
                  className={cx('w-4 h-4 text-[var(--color-text-muted)] transition-transform duration-200 shrink-0', isOpen && 'rotate-180')}
                >
                  <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>

            </div>

            {/* Banners — always visible below the header row */}
            {hasBanner && (
              <div className="mt-3 flex flex-col gap-3">
                {decisionBanner}
                {revisionBanner}
                {changeOfMindBanner}
              </div>
            )}

          </div>
        )}
      >

        {/* Section 1 — Rubric rows */}
        <div className="-mb-3">
          {rubrics.map(rubric => (
            <div
              key={rubric.rubricId}
              className="flex items-center justify-between gap-4 py-3 border-t border-[var(--color-border)]"
            >
              <span className="text-body-md text-text-primary font-medium">
                {rubric.rubricTitle}
              </span>

              <StepIndicator
                steps={publicReview ? PIPELINE_STEPS_PUBLIC : PIPELINE_STEPS_PRIVATE}
                currentStep={STATUS_TO_STEP[rubric.status]}
                size="compact-labeled"
              />
            </div>
          ))}
        </div>

        {/* Section 2 — Metadata + description */}
        <div className="border-t border-[var(--color-border)] mt-3 pt-3">

          <div className="flex items-center gap-4 flex-wrap text-body-sm text-text-secondary">

            <span className="flex items-center gap-1">
              <svg viewBox="0 0 16 16" fill="none" className="w-3.5 h-3.5 shrink-0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 7a3 3 0 100-6 3 3 0 000 6zM2 14a6 6 0 0112 0" />
              </svg>
              {authors}
            </span>

            <span className="flex items-center gap-1">
              <svg viewBox="0 0 16 16" fill="none" className="w-3.5 h-3.5 shrink-0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 4a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 010 1.414l-4.586 4.586a1 1 0 01-1.414 0L3 8.414A2 2 0 012 7V4z" />
                <circle cx="5.5" cy="5.5" r="0.75" fill="currentColor" />
              </svg>
              {discipline}
            </span>

            <span className="flex items-center gap-1">
              <svg viewBox="0 0 16 16" fill="none" className="w-3.5 h-3.5 shrink-0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="8" cy="8" r="6" />
                <path d="M9.5 6.5a2 2 0 100 3" />
              </svg>
              {ccLicense}
            </span>

          </div>

          <p className="mt-2 text-body-sm text-text-secondary line-clamp-3">
            {description}
          </p>

          {(onDelete || deleteDisabled) && (
            <div className="flex justify-end mt-4">
              <Button
                variant="destructive"
                size="sm"
                onClick={onDelete}
                disabled={deleteDisabled}
              >
                Delete submission
              </Button>
            </div>
          )}

        </div>

      </Accordion>

      {/* Confirmation modal */}
      {pendingAction && modalCopy && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={closeModal}
        >
          <div
            className="bg-[var(--color-surface-card)] rounded-lg border border-[var(--color-border)] shadow-[var(--shadow-4)] p-6 max-w-md w-full mx-4"
            onClick={e => e.stopPropagation()}
          >
            {publishSuccess ? (
              <div>
                <p className="font-label font-semibold text-[var(--color-success)]">Published</p>
                <p className="mt-1 text-body-sm text-[var(--color-text-secondary)]">
                  This review report is published. It will appear on the public certification directory once that surface is live.
                </p>
              </div>
            ) : (
              <>
                <h3 className="font-heading text-heading-sm font-semibold text-[var(--color-text-primary)] mb-2 pr-6">
                  {modalCopy.title}
                </h3>
                <p className="text-body-sm text-[var(--color-text-secondary)] mb-6">
                  {modalCopy.body}
                </p>
                {actionError && (
                  <p className="text-body-sm text-[var(--color-error)] mb-4">{actionError}</p>
                )}
                <div className="flex items-center justify-end gap-3">
                  <Button variant="secondary" size="md" disabled={loading} onClick={closeModal}>
                    Cancel
                  </Button>
                  <Button variant="primary" size="md" loading={loading} disabled={loading} onClick={handleConfirmAction}>
                    {modalCopy.confirmLabel}
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
