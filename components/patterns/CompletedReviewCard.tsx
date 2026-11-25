'use client'

import { ResourceLink } from '@/components/ui/ResourceLink'
import { useState } from 'react'
import Link from 'next/link'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { RubricTagList } from '@/components/ui/RubricTagList'

function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ')
}

export interface CompletedReviewCardProps {
  id: string
  title: string
  platform: string
  authorName: string
  discipline: string
  publicReview?: boolean
  rubrics: { rubricId: string; rubricTitle: string }[]
  completedAt: string
  reviewUrl: string
}

export function CompletedReviewCard({
  id,
  title,
  platform,
  authorName,
  publicReview = false,
  rubrics,
  completedAt,
  reviewUrl,
}: CompletedReviewCardProps) {
  const [isOpen, setIsOpen] = useState(false)

  const formattedDate = new Date(completedAt).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
  })

  return (
    <div className={cx(
      'rounded-lg bg-[var(--color-surface-card)] border',
      'transition-[box-shadow,border-color,transform] duration-[var(--transition-duration-base)] ease-[var(--transition-timing-function-brand)]',
      isOpen
        ? 'border-[var(--color-border-strong)] shadow-[0_2px_8px_rgba(28,28,24,0.05),0_20px_56px_rgba(28,28,24,0.08)] -translate-y-[2px]'
        : 'border-[var(--color-border)] shadow-[var(--shadow-1)] hover:border-[var(--color-border-strong)] hover:shadow-[var(--shadow-2)] hover:-translate-y-[1px]'
    )}>
      {/* Header — always visible, clickable to toggle */}
      <div
        className="p-5 flex items-start justify-between gap-4 cursor-pointer select-none"
        onClick={() => setIsOpen(prev => !prev)}
      >
        {/* Left column */}
        <div className="flex-1 min-w-0">

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
            <StatusBadge variant="completed" />
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
              Completed: {formattedDate}
            </span>
          </div>

          {/* Row 4: rubric tags */}
          <RubricTagList rubrics={rubrics} variant="filled" className="mt-2" />

        </div>

        {/* Right column: View Report button + chevron */}
        <div className="shrink-0 flex flex-col items-end gap-2">
          <Link
            href={reviewUrl}
            onClick={e => e.stopPropagation()}
            className="inline-flex items-center justify-center font-medium transition-all duration-[var(--transition-duration-base)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded-md px-3 py-1.5 text-xs font-semibold border border-[var(--color-primary)] bg-[var(--color-primary)] text-[var(--color-on-primary)] hover:bg-[var(--color-primary-hover)]"
          >
            View Report
          </Link>
          <svg
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
            className={`w-4 h-4 text-[var(--color-text-muted)] transition-transform duration-200${isOpen ? ' rotate-180' : ''}`}
          >
            <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>

      {/* Expandable body */}
      <div
        className="grid transition-[grid-template-rows] duration-200 ease-out"
        style={{ gridTemplateRows: isOpen ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <div className="border-t border-[var(--color-border)] px-5 pb-5">
            {rubrics.map(r => (
              <div
                key={r.rubricId}
                className="flex items-center py-3 border-b border-[var(--color-border)] last:border-b-0"
              >
                <span className="text-body-md text-text-primary font-medium">
                  {r.rubricTitle}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
