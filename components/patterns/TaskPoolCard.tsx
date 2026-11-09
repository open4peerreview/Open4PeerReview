'use client'

import { ResourceLink } from '@/components/ui/ResourceLink'
import { useState } from 'react'
import { Accordion } from '@/components/ui/Accordion'
import { Select } from '@/components/ui/Select'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { RubricTagList } from '@/components/ui/RubricTagList'

export interface TaskPoolCardProps {
  id: string
  title: string
  platform: string
  authorName: string
  discipline: string
  ccLicense: string
  description: string
  submittedAt: string
  publicReview?: boolean
  rubrics: { rubricId: string; rubricTitle: string }[]
  onAccept?: (id: string) => void
  onDecline?: (id: string, declineNote: string) => void
}

const DECLINE_REASONS: { value: string; label: string; publicOnly?: boolean }[] = [
  { value: 'outside-expertise',     label: 'Outside my area of expertise' },
  { value: 'conflict-of-interest',  label: 'Conflict of interest' },
  { value: 'insufficient-capacity', label: 'Insufficient capacity at this time' },
  // 'public-submissions' is only offered for documents open to public review (see publicReview prop)
  { value: 'public-submissions',    label: 'Prefer not to review public submissions', publicOnly: true },
  { value: 'duplicate-assignment',  label: 'Duplicate assignment' },
  { value: 'other',                 label: 'Other' },
]

export function TaskPoolCard({
  id,
  title,
  platform,
  authorName,
  discipline,
  ccLicense,
  description,
  submittedAt,
  publicReview = false,
  rubrics,
  onAccept,
  onDecline,
}: TaskPoolCardProps) {
  const [declineMode, setDeclineMode] = useState(false)
  const [declineReason, setDeclineReason] = useState('')
  const [declineNote, setDeclineNote] = useState('')

  // Only surface the "public submissions" reason when the document is open to public review.
  const declineReasons = DECLINE_REASONS.filter(r => !r.publicOnly || publicReview)

  const formattedDate = new Date(submittedAt).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
  })

  const trigger = (
    <div className="flex items-start w-full">

      {/* Left column (full width — no right column) */}
      <div className="flex-1 min-w-0">

        {/* Row 1: public/private pill */}
        <div className="flex items-center gap-2 mb-3">
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
        </div>

        {/* Row 2: title */}
        <h2 className="font-heading text-title-lg text-text-primary leading-snug truncate">
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

    </div>
  )

  return (
    <Accordion trigger={trigger}>

      {/* Section 1 — Metadata + description */}
      <div>
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

          <ResourceLink documentId={id} label="View Resource" className="text-primary" />

        </div>

        <p className="mt-3 text-body-sm text-text-secondary">
          {description}
        </p>
      </div>

      {/* Section 2 — Accept / Decline actions */}
      <div className="border-t border-[var(--color-border)] mt-4 pt-4">
        {!declineMode ? (
          <div className="flex items-center gap-3">
            <Button variant="primary" size="sm" onClick={() => onAccept?.(id)}>
              Accept
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setDeclineMode(true)}>
              Decline
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <Select
              label="Reason for declining"
              value={declineReason}
              onChange={(e) => {
                setDeclineReason(e.target.value)
                setDeclineNote('')
              }}
            >
              <option value="" disabled>Select a reason…</option>
              {declineReasons.map(r => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </Select>
            {declineReason === 'other' && (
              <Input
                label="Additional notes"
                placeholder="Please describe your reason..."
                value={declineNote}
                onChange={(e) => setDeclineNote(e.target.value)}
              />
            )}
            <div className="flex items-center gap-3">
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  // Store the human-readable reason; for "Other", use the typed note.
                  const selected = declineReasons.find(r => r.value === declineReason)
                  const finalNote = declineReason === 'other'
                    ? (declineNote.trim() || 'Other')
                    : (selected?.label ?? declineReason)
                  onDecline?.(id, finalNote)
                  setDeclineMode(false)
                }}
                disabled={!declineReason || (declineReason === 'other' && !declineNote.trim())}
              >
                Confirm Decline
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setDeclineMode(false)
                  setDeclineReason('')
                  setDeclineNote('')
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>

    </Accordion>
  )
}
