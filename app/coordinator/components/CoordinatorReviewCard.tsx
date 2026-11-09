'use client'

import Link from 'next/link'
import { ResourceLink } from '@/components/ui/ResourceLink'
import { Accordion } from '@/components/ui/Accordion'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { StepIndicator } from '@/components/ui/StepIndicator'
import { Button } from '@/components/ui/Button'

function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ')
}

export interface RubricReview {
  rubricId: string
  rubricTitle: string
  status: 'unassigned' | 'assigned' | 'under-review' | 'review-submitted' | 'feedback-ready' | 'published'
}

export interface CoordinatorReviewCardProps {
  id: string
  title: string
  platform: string
  authors: string
  discipline: string
  ccLicense: string
  description?: string
  submittedAt: string
  rubrics: RubricReview[]
  publicReview?: boolean
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
  'unassigned':       1,
  'assigned':         2,
  'under-review':     3,
  'review-submitted': 4,
  'feedback-ready':   5,
  'published':        6,
}

export function CoordinatorReviewCard({
  id,
  title,
  platform,
  authors,
  discipline,
  ccLicense,
  description,
  submittedAt,
  rubrics,
  publicReview,
}: CoordinatorReviewCardProps) {
  const distinctStatuses = PRIORITY_ORDER.filter(s => rubrics.some(r => r.status === s))
  const shownStatuses = distinctStatuses.slice(0, 3)
  const hiddenRubricCount = rubrics.filter(r => !shownStatuses.includes(r.status)).length

  // All rubrics submitted, none yet approved — coordinator action required
  const needsApproval = rubrics.length > 0 && rubrics.every(r => r.status === 'review-submitted')

  // Right slot: some work is visible, but not the full-approval state where the banner takes over
  const hasProgress = rubrics.some(r =>
    ['review-submitted', 'feedback-ready', 'published'].includes(r.status)
  )
  const showRightSlot = hasProgress && !needsApproval

  const reviewHref = `/coordinator/review/${id}?from=coordinator`

  // ── Approval banner ───────────────────────────────────────────────────────────

  const approvalBanner = needsApproval ? (
    <div
      className="rounded-lg border border-[var(--color-banner-border)] bg-[var(--color-banner-bg)] px-4 py-3 flex items-center justify-between gap-4"
      onClick={e => e.stopPropagation()}
    >
      <p className="text-body-sm text-[var(--color-banner-text)]">
        All rubrics submitted — ready to release to author, pending your approval.
      </p>
      <Button variant="primary" size="sm" asChild>
        <Link href={reviewHref} onClick={e => e.stopPropagation()}>
          Review report
        </Link>
      </Button>
    </div>
  ) : null

  // ── Accordion body ────────────────────────────────────────────────────────────

  const steps = publicReview ? PIPELINE_STEPS_PUBLIC : PIPELINE_STEPS_PRIVATE

  return (
    <Accordion
      renderTrigger={(isOpen) => (
        <div>

          {/* Header row: compact content left, controls right — chevron centers against this row only */}
          <div className="flex items-center justify-between gap-3">

            <div className="flex-1 min-w-0">

              {/* Row 1: public/private pill + status badges */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className={publicReview
                  ? 'inline-flex items-center gap-1 px-2 py-0.5 rounded-none bg-[var(--color-primary)] text-[var(--color-on-primary)] text-label-sm font-label font-semibold uppercase tracking-widest'
                  : 'inline-flex items-center gap-1 px-2 py-0.5 rounded-none border border-[var(--color-status-unassigned-text)] bg-[var(--color-surface-card)] text-[var(--color-status-unassigned-text)] text-label-sm font-label font-semibold uppercase tracking-widest'
                }>
                  {publicReview ? (
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3 shrink-0" aria-hidden="true">
                      <circle cx="8" cy="8" r="6"/>
                      <path d="M8 2a8.5 8.5 0 010 12M8 2a8.5 8.5 0 000 12M2 8h12"/>
                    </svg>
                  ) : (
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3 shrink-0" aria-hidden="true">
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
              </div>

              {/* Row 2: title */}
              <h2 className="font-heading text-title-lg text-text-primary leading-snug mt-3 truncate">
                {title}
              </h2>

              {/* Row 3: platform + date */}
              <div className="flex items-center gap-4 mt-2 text-body-sm text-text-secondary flex-wrap">
                <ResourceLink documentId={id} label={platform} />
                <span className="flex items-center gap-1">
                  <svg viewBox="0 0 16 16" fill="none" className="w-3.5 h-3.5 shrink-0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="2" y="4" width="12" height="10" rx="1" />
                    <path d="M2 8h12M6 2v4M10 2v4" />
                  </svg>
                  Submitted: {new Date(submittedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
              </div>

            </div>

            {/* Controls: optional Review Report button + chevron, centered against the header content only */}
            <div className="shrink-0 flex items-center gap-2">
              {showRightSlot && (
                <Link
                  href={reviewHref}
                  onClick={e => e.stopPropagation()}
                  className="inline-flex items-center justify-center font-medium transition-all duration-[var(--transition-duration-base)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded-md border border-primary bg-primary text-on-primary hover:bg-[var(--color-primary-hover)] px-3 py-1.5 text-xs"
                >
                  Review report
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

          {/* Approval banner — always visible below the header row */}
          {approvalBanner && (
            <div className="mt-3">
              {approvalBanner}
            </div>
          )}

        </div>
      )}
    >

      {/* Rubric rows */}
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
              steps={steps}
              currentStep={STATUS_TO_STEP[rubric.status]}
              size="compact-labeled"
            />
          </div>
        ))}
      </div>

      {/* Metadata + description */}
      <div className="border-t border-[var(--color-border)] mt-3 pt-3">
        <div className="flex items-center gap-4 flex-wrap text-body-sm text-text-secondary">

          <span className="flex items-center gap-1">
            <svg viewBox="0 0 16 16" fill="none" className="w-3.5 h-3.5 shrink-0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M8 7a3 3 0 100-6 3 3 0 000 6zM2 14a6 6 0 0112 0" />
            </svg>
            {authors}
          </span>

          <span className="flex items-center gap-1">
            <svg viewBox="0 0 16 16" fill="none" className="w-3.5 h-3.5 shrink-0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M2 4a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 010 1.414l-4.586 4.586a1 1 0 01-1.414 0L3 8.414A2 2 0 012 7V4z" />
              <circle cx="5.5" cy="5.5" r="0.75" fill="currentColor" />
            </svg>
            {discipline}
          </span>

          <span className="flex items-center gap-1">
            <svg viewBox="0 0 16 16" fill="none" className="w-3.5 h-3.5 shrink-0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="8" cy="8" r="6" />
              <path d="M9.5 6.5a2 2 0 100 3" />
            </svg>
            {ccLicense}
          </span>

        </div>

        {description && (
          <p className="mt-2 text-body-sm text-text-secondary line-clamp-3">
            {description}
          </p>
        )}
      </div>

    </Accordion>
  )
}
