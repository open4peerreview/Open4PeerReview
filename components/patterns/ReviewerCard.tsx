'use client'

import { ResourceLink } from '@/components/ui/ResourceLink'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Accordion } from '@/components/ui/Accordion'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { RubricTagList } from '@/components/ui/RubricTagList'
import { Modal } from '@/components/ui/Modal'
import { createClient } from '@/lib/supabase/client'
import { openInTorus } from '@/lib/torus'

export interface RubricProgress {
  rubricId: string
  rubricTitle: string
  ratedCount: number
  totalCount: number
  // Each rubric has its own independent review row (document_id, rubric_id, reviewer_id) —
  // there is no single "the" review for a document once more than one rubric is assigned.
  reviewId: string | null
  status: string | null
}

export interface ReviewerCardProps {
  id: string
  title: string
  platform: string
  authorName: string
  discipline: string
  ccLicense: string
  description: string
  claimedAt: string
  rubrics: RubricProgress[]
  hasGeneralComment: boolean
  sourceUrl?: string | null
  courseAccessCode?: string | null
  publicReview?: boolean
  // Which rubric tab is selected by default (e.g. the one currently in progress)
  defaultRubricId?: string | null
}

export function ReviewerCard({
  id,
  title,
  platform,
  authorName,
  discipline,
  ccLicense,
  description,
  claimedAt,
  rubrics,
  hasGeneralComment,
  sourceUrl,
  courseAccessCode,
  publicReview = false,
  defaultRubricId,
}: ReviewerCardProps) {
  const [showTorusModal, setShowTorusModal] = useState(false)
  const [copied, setCopied] = useState(false)
  const [activeRubricId, setActiveRubricId] = useState(defaultRubricId ?? rubrics[0]?.rubricId ?? null)
  const router = useRouter()

  const activeRubric = rubrics.find(r => r.rubricId === activeRubricId) ?? rubrics[0] ?? null
  const activeReviewId = activeRubric?.reviewId ?? null
  const reviewUrl = activeReviewId
    ? `/review?document=${id}&review=${activeReviewId}`
    : `/review?document=${id}`

  const handleOpenInTorus = async () => {
    setShowTorusModal(false)
    await openInTorus(createClient(), sourceUrl, activeReviewId)
  }

  const pct = (r: RubricProgress) => r.totalCount > 0 ? (r.ratedCount / r.totalCount) * 100 : 0
  const isTorus = platform === 'OLI Torus'

  // CTA label reflects the active rubric tab: opened on the server (in_progress) or has ratings.
  const activeStarted = activeRubric ? pct(activeRubric) > 0 || activeRubric.status === 'in_progress' : false
  // Badge matches the filter pill: in-progress only once at least one criterion is rated across any rubric.
  const anyRated = rubrics.some(r => pct(r) > 0)
  const cardStatus: 'not-started' | 'in-progress' =
    (anyRated || hasGeneralComment) ? 'in-progress' : 'not-started'

  const ctaLabel = cardStatus === 'in-progress' ? 'Continue review' : 'Start review'

  const formattedDate = new Date(claimedAt).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
  })

  function copyAccessCode() {
    if (!courseAccessCode) return
    navigator.clipboard.writeText(courseAccessCode).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const trigger = (
    <div className="w-full">

      {/* Row 1: public/private pill + status badge */}
      <div className="flex items-center gap-2">
        {publicReview ? (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-none bg-[var(--color-primary)] text-[var(--color-on-primary)] text-label-sm font-label font-semibold uppercase tracking-widest">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3 shrink-0">
              <circle cx="8" cy="8" r="6"/>
              <path d="M8 2a8.5 8.5 0 010 12M8 2a8.5 8.5 0 000 12M2 8h12"/>
            </svg>
            Public
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-none border border-[var(--color-status-unassigned-text)] bg-[var(--color-surface-card)] text-[var(--color-status-unassigned-text)] text-label-sm font-label font-semibold uppercase tracking-widest">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3 shrink-0">
              <rect x="3" y="8" width="10" height="7" rx="1"/>
              <path d="M5 8V5a3 3 0 016 0v3"/>
            </svg>
            Private
          </span>
        )}
        <StatusBadge variant={cardStatus} />
      </div>

      {/* Row 2: title */}
      <h2 className="font-heading text-title-lg text-text-primary leading-snug mt-3 truncate">
        {title}
      </h2>

      {/* Row 3: metadata */}
      <div className="flex items-center gap-4 mt-2 text-body-sm text-text-secondary flex-wrap">
        <span className="flex items-center gap-1">
          <svg viewBox="0 0 16 16" fill="none" className="w-3.5 h-3.5 shrink-0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 7a3 3 0 100-6 3 3 0 000 6zM2 14a6 6 0 0112 0" />
          </svg>
          {authorName}
        </span>
        <ResourceLink documentId={id} label={platform} />
        <span className="flex items-center gap-1">
          <svg viewBox="0 0 16 16" fill="none" className="w-3.5 h-3.5 shrink-0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="4" width="12" height="10" rx="1" />
            <path d="M2 8h12M6 2v4M10 2v4" />
          </svg>
          Submitted: {formattedDate}
        </span>
      </div>

      {/* Row 4: rubric tags */}
      <RubricTagList rubrics={rubrics} variant="filled" className="mt-2" />

    </div>
  )

  const ctaButton = isTorus ? (
    <button
      type="button"
      onClick={() => setShowTorusModal(true)}
      className="inline-flex items-center justify-center gap-2 font-medium transition-all duration-[var(--transition-duration-base)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded-md font-semibold bg-primary text-on-primary shadow-1 hover:bg-primary-hover hover:shadow-2 active:scale-[0.99] px-3 py-1.5 text-label-md"
    >
      {ctaLabel}
    </button>
  ) : (
    <Link
      href={reviewUrl}
      className="inline-flex items-center justify-center gap-2 font-medium transition-all duration-[var(--transition-duration-base)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded-md font-semibold bg-primary text-on-primary shadow-1 hover:bg-primary-hover hover:shadow-2 active:scale-[0.99] px-3 py-1.5 text-label-md"
    >
      {ctaLabel}
    </Link>
  )

  return (
    <>
      <Accordion trigger={trigger} rightSlot={ctaButton}>

        {/* Section 1 — Rubric tabs: each rubric is its own independent review */}
        <div className="-mb-3">
          {rubrics.map(rubric => {
            const isActive = rubric.rubricId === activeRubric?.rubricId
            return (
              <button
                key={rubric.rubricId}
                type="button"
                onClick={(e) => { e.stopPropagation(); setActiveRubricId(rubric.rubricId) }}
                className={[
                  'w-full flex items-center justify-between gap-4 py-3 border-t border-border text-left transition-colors',
                  isActive ? 'bg-primary/5' : 'hover:bg-surface-elevated',
                ].join(' ')}
              >
                <span className={[
                  'text-body-md font-medium shrink-0',
                  isActive ? 'text-primary' : 'text-text-primary',
                ].join(' ')}>
                  {rubric.rubricTitle}
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  {rubric.status === 'submitted' && (
                    <span className="inline-flex items-center gap-1 text-label-sm font-label font-semibold uppercase tracking-wide text-success">
                      <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M2 6l3 3 5-5" />
                      </svg>
                      Submitted
                    </span>
                  )}
                  <span className={[
                    'inline-flex items-center px-2 py-0.5 rounded-full text-label-sm font-label font-semibold whitespace-nowrap',
                    pct(rubric) === 100
                      ? 'bg-success-container text-success border border-success'
                      : pct(rubric) === 0
                        ? 'bg-gray-100 text-gray-500 border border-gray-400'
                        : 'bg-amber-100 text-amber-800 border border-amber-800',
                  ].join(' ')}>
                    {rubric.ratedCount}/{rubric.totalCount} criteria rated
                  </span>
                </div>
              </button>
            )
          })}
        </div>

        {/* Section 2 — Metadata + description */}
        <div className="border-t border-border mt-3 pt-3">

          <div className="flex items-center gap-4 flex-wrap text-body-sm text-text-secondary">
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

        </div>

      </Accordion>

      {/* Torus choice modal */}
      <Modal open={showTorusModal} onClose={() => setShowTorusModal(false)}>
        <div
          onClick={e => e.stopPropagation()}
          className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg bg-surface-card rounded-xl shadow-4 overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-4 border-b border-border">
            <div>
              <h2 className="text-title-md font-semibold font-heading text-text-primary">{activeStarted ? 'Continue Review' : 'Begin Review'}</h2>
              <p className="text-body-sm text-text-secondary mt-0.5">
                How would you like to review this OLI Torus course?
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowTorusModal(false)}
              aria-label="Close"
              className="shrink-0 text-text-muted hover:text-text-primary transition-colors mt-0.5"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Options */}
          <div className="p-6 grid grid-cols-2 gap-4">
            {/* Option 1: Open in Torus */}
            <div className="flex flex-col gap-3 rounded-lg border-2 border-border p-4 hover:border-primary/40 transition-colors">
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
              </div>
              <div className="flex-1">
                <p className="text-body-md font-semibold text-text-primary">Review in OLI Torus</p>
                <p className="text-body-sm text-text-secondary mt-1">
                  Open the live course in a new tab and annotate directly within the platform using the Chrome extension.
                </p>
              </div>
              <button
                type="button"
                onClick={handleOpenInTorus}
                className="inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-label-md font-semibold bg-primary text-on-primary hover:bg-primary-hover transition-colors"
              >
                Open in Torus
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </button>
            </div>

            {/* Option 2: Review current annotations */}
            <div className="flex flex-col gap-3 rounded-lg border-2 border-border p-4 hover:border-primary/40 transition-colors">
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
                </svg>
              </div>
              <div className="flex-1">
                <p className="text-body-md font-semibold text-text-primary">Review Current Annotations</p>
                <p className="text-body-sm text-text-secondary mt-1">
                  View screenshots and captured annotations in the review console and score each criterion.
                </p>
              </div>
              <button
                type="button"
                onClick={() => { setShowTorusModal(false); router.push(reviewUrl) }}
                className="inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-label-md font-semibold border border-border text-text-primary hover:bg-surface-elevated transition-colors"
              >
                Open Review Console
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                </svg>
              </button>
            </div>
          </div>

          {/* Access code banner */}
          {courseAccessCode && (
            <div className="mx-6 mb-6 flex items-center gap-3 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3">
              <svg className="w-4 h-4 text-amber-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
              </svg>
              <div className="flex-1 min-w-0">
                <p className="text-label-sm font-semibold text-amber-800">Course access code</p>
                <p className="text-body-sm font-mono text-amber-900 mt-0.5">{courseAccessCode}</p>
              </div>
              <button
                type="button"
                onClick={copyAccessCode}
                className="shrink-0 text-label-sm font-semibold text-amber-700 hover:text-amber-900 transition-colors"
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          )}
        </div>
      </Modal>
    </>
  )
}
