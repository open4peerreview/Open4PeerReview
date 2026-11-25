'use client'

import { useState, useEffect, useRef, type CSSProperties } from 'react'
import type { CriterionScore, HighlightTag } from '@/types'
import type { LocalScore } from './ReviewerConsole'
import type { RubricItem } from './ReviewerApp'
import { RatingBox } from './RatingBox'
import { AnnotationListCard } from './AnnotationListCard'
import { FreeNoteCard } from './FreeNoteCard'
import { Modal, ModalContent } from '@/components/ui/Modal'
import type { FreeNote, CriterionOption } from './FreeNotesSection'

interface AnnotationSummary {
  id: string
  anchor: Record<string, unknown>
  body: string
  tag: string | null
}

interface CriterionCardProps {
  rubricItem: RubricItem
  score: LocalScore
  criterionIndex: number
  onScoreToggle: (rubricItemId: string, level: CriterionScore) => void
  onAddComment: (rubricItemId: string, level: CriterionScore, body: string) => void
  onEditComment: (rubricItemId: string, commentId: string, level: CriterionScore, body: string) => void
  onDeleteComment: (rubricItemId: string, commentId: string, level: CriterionScore) => void
  onGoToAnnotation: (annotationId: string) => void
  onEditAnnotation: (annotationId: string, changes: { body: string; tag: HighlightTag | null }) => void
  onDeleteAnnotation: (annotationId: string) => void
  onMoveAnnotation?: (annotationId: string, targetRubricItemId: string, body?: string, tag?: HighlightTag | null) => void
  allCriteria?: CriterionOption[]
  expandToAnnotationId?: string | null
  isReadOnly?: boolean
  goToLabel?: string
  annotationIndexMap?: Map<string, number>
}

function TrendingUpIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12L6 8L9 11L14 5" />
      <path d="M10.5 5H14V8.5" />
    </svg>
  )
}

function CheckIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 8.5L6.5 12L13 4" />
    </svg>
  )
}

function TrendingDownIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 4L6 8L9 5L14 11" />
      <path d="M10.5 11H14V7.5" />
    </svg>
  )
}

function BookmarkIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M4 1H12V14L8 11L4 14V1Z" />
    </svg>
  )
}

function InfoIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 7.25V11.25" />
      <circle cx="8" cy="5" r="0.1" fill="currentColor" stroke="currentColor" strokeWidth="1" />
    </svg>
  )
}

const STATUS_BADGE_DEFS = [
  {
    level: 'exceeds' as CriterionScore,
    label: 'EXC',
    Icon: TrendingUpIcon,
    activeClass: 'bg-rating-exceeds-bg text-rating-exceeds-text border border-rating-exceeds-border',
  },
  {
    level: 'exemplifies' as CriterionScore,
    label: 'EXE',
    Icon: CheckIcon,
    activeClass: 'bg-rating-exemplifies-bg text-rating-exemplifies-text border border-primary',
  },
  {
    level: 'does_not_meet' as CriterionScore,
    label: 'DNM',
    Icon: TrendingDownIcon,
    activeClass: 'bg-rating-dnm-bg text-rating-dnm-text border border-rating-dnm-border',
  },
]

export function CriterionCard({
  rubricItem,
  score,
  criterionIndex,
  onScoreToggle,
  onAddComment,
  onEditComment,
  onDeleteComment,
  onGoToAnnotation,
  onEditAnnotation,
  onDeleteAnnotation,
  onMoveAnnotation,
  allCriteria,
  expandToAnnotationId,
  isReadOnly = false,
  goToLabel,
  annotationIndexMap,
}: CriterionCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [focusedBox, setFocusedBox] = useState<'exceeds' | 'exemplifies' | 'does_not_meet' | null>(null)
  const [showStandardModal, setShowStandardModal] = useState(false)
  const [isNarrow, setIsNarrow] = useState(false)
  const ratingRowRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ratingRowRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      // +32px accounts for px-4 padding on each side of the expanded content
      setIsNarrow(entry.contentRect.width < 492)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!expandToAnnotationId) return
    if (score.annotations.some(a => a.id === expandToAnnotationId)) {
      setExpanded(true)
    }
  }, [expandToAnnotationId, score.annotations])
  const isRated = score.scores.length > 0

  const getColumnStyle = (variant: 'exceeds' | 'exemplifies' | 'does_not_meet'): CSSProperties => {
    const transition = 'flex 150ms ease, max-width 150ms ease, opacity 150ms ease, padding 150ms ease'
    if (focusedBox === null) {
      return { flex: '1 1 0%', transition }
    }
    if (focusedBox === 'exemplifies') {
      // Exemplifies sits in the middle, so focusing it shrinks both neighbors
      // evenly (20/60/20) instead of hiding the "farthest" one.
      return variant === 'exemplifies'
        ? { flex: '3 1 0%', transition }
        : { flex: '1 1 0%', transition }
    }
    if (variant === 'exemplifies') {
      return { flex: '1 1 0%', transition }
    }
    if (variant === focusedBox) {
      return { flex: '2 1 0%', transition }
    }
    return {
      flex: '0 0 0%',
      maxWidth: 0,
      opacity: 0,
      overflow: 'hidden',
      padding: 0,
      transition,
    }
  }

  const criterionName = rubricItem.label.replace(/^C\d+\s+/, '')
  const standards = rubricItem.description
    ? rubricItem.description.split(/(?=\d+\.\s)/).map(s => s.trim()).filter(Boolean)
    : []

  return (
    <>
    <div ref={ratingRowRef} className="rounded-lg border border-border bg-surface-card transition-colors min-w-0">
      {/* Header — always visible */}
      <div
        className="flex items-center gap-2 px-4 py-3 cursor-pointer select-none"
        onClick={() => setExpanded(v => !v)}
      >
        {/* Status circle */}
        <div
          className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
            isRated
              ? 'border-secondary bg-secondary-container text-secondary'
              : 'border-border bg-transparent'
          }`}
        >
          {isRated && <CheckIcon size={12} />}
        </div>

        {/* Criterion ID + name */}
        <div className="flex-1 flex flex-col gap-0.5 min-w-0">
          <span className="text-label-sm font-label font-semibold uppercase tracking-widest text-secondary">
            C{criterionIndex}
          </span>
          <span className="text-body-md font-heading font-semibold text-text-primary truncate">
            {rubricItem.label.replace(/^C\d+\s+/, '')}
          </span>
        </div>

        {/* Right side: evidence badge + status badges + chevron */}
        <div className="flex-shrink-0 flex items-center gap-1.5">
          {/* Evidence count badge */}
          {score.annotations.length > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-secondary-container/60 text-secondary text-label-sm font-label font-semibold">
              <BookmarkIcon size={12} />
              {score.annotations.length}
            </span>
          )}

          {/* Status badges — always visible */}
          <div className="flex gap-1">
            {STATUS_BADGE_DEFS.map(badge => {
              const isActive = score.scores.includes(badge.level)
              return (
                <span
                  key={badge.level}
                  className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-label-sm font-label font-semibold uppercase tracking-wide ${
                    isActive
                      ? badge.activeClass
                      : 'bg-transparent text-text-secondary/40 border border-border/40'
                  }`}
                >
                  <badge.Icon size={10} />
                  {badge.label}
                </span>
              )
            })}
          </div>

          {/* Expand chevron */}
          <svg
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
            className={`w-4 h-4 text-text-muted transition-transform duration-[var(--transition-duration-base)]${expanded ? ' rotate-180' : ''}`}
          >
            <path
              d="M4 6l4 4 4-4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-border px-4 pb-4 pt-3 flex flex-col gap-4">
          {/* Rubric standard — shown once per criterion, above the rating row */}
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <span className="text-label-sm font-label font-semibold uppercase tracking-wide text-text-secondary">
                Standard
              </span>
              <p className={rubricItem.description ? 'text-body-sm text-text-secondary mt-1' : 'text-body-sm text-text-muted mt-1'}>
                {rubricItem.description ? rubricItem.description.replace(/\d+\.\s+/g, '') : 'No standard defined'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowStandardModal(true)}
              className="text-text-muted hover:text-text-primary transition-colors flex-shrink-0 mt-0.5"
              aria-label="View full rubric standard"
            >
              <InfoIcon size={16} />
            </button>
          </div>

          <div className={`flex gap-3 min-w-0 ${isNarrow ? 'flex-col' : ''}`}>
            {/* display:contents keeps the box mounted (preserving pending timers) while
                display:none hides it; never unmount in read-only so in-flight saves aren't killed */}
            <div style={isReadOnly && !score.scores.includes('exceeds') ? { display: 'none' } : { display: 'contents' }}>
              <RatingBox
                variant="exceeds"
                style={isNarrow ? { flex: 'none', width: '100%' } : getColumnStyle('exceeds')}
                isActive={score.scores.includes('exceeds')}
                comments={score.exceedsComments}
                onAddComment={(body) => onAddComment(rubricItem.id, 'exceeds', body)}
                onEditComment={(id, body) => onEditComment(rubricItem.id, id, 'exceeds', body)}
                onDeleteComment={(id) => onDeleteComment(rubricItem.id, id, 'exceeds')}
                onActivate={() => { if (!score.scores.includes('exceeds')) onScoreToggle(rubricItem.id, 'exceeds') }}
                onDeactivate={() => { if (score.scores.includes('exceeds')) onScoreToggle(rubricItem.id, 'exceeds') }}
                onTextareaFocus={isNarrow || isReadOnly ? undefined : () => setFocusedBox('exceeds')}
                onTextareaBlur={isNarrow || isReadOnly ? undefined : () => setFocusedBox(null)}
                isReadOnly={isReadOnly}
              />
            </div>
            <div style={isReadOnly && !score.scores.includes('exemplifies') ? { display: 'none' } : { display: 'contents' }}>
              <RatingBox
                variant="exemplifies"
                style={isNarrow ? { flex: 'none', width: '100%' } : getColumnStyle('exemplifies')}
                isActive={score.scores.includes('exemplifies')}
                comments={score.exemplifiesComments}
                onAddComment={(body) => onAddComment(rubricItem.id, 'exemplifies', body)}
                onEditComment={(id, body) => onEditComment(rubricItem.id, id, 'exemplifies', body)}
                onDeleteComment={(id) => onDeleteComment(rubricItem.id, id, 'exemplifies')}
                onActivate={() => { if (!score.scores.includes('exemplifies')) onScoreToggle(rubricItem.id, 'exemplifies') }}
                onDeactivate={() => { if (score.scores.includes('exemplifies')) onScoreToggle(rubricItem.id, 'exemplifies') }}
                onTextareaFocus={isNarrow || isReadOnly ? undefined : () => setFocusedBox('exemplifies')}
                onTextareaBlur={isNarrow || isReadOnly ? undefined : () => setFocusedBox(null)}
                isReadOnly={isReadOnly}
              />
            </div>
            <div style={isReadOnly && !score.scores.includes('does_not_meet') ? { display: 'none' } : { display: 'contents' }}>
              <RatingBox
                variant="does_not_meet"
                style={isNarrow ? { flex: 'none', width: '100%' } : getColumnStyle('does_not_meet')}
                isActive={score.scores.includes('does_not_meet')}
                comments={score.niComments}
                onAddComment={(body) => onAddComment(rubricItem.id, 'does_not_meet', body)}
                onEditComment={(id, body) => onEditComment(rubricItem.id, id, 'does_not_meet', body)}
                onDeleteComment={(id) => onDeleteComment(rubricItem.id, id, 'does_not_meet')}
                onActivate={() => { if (!score.scores.includes('does_not_meet')) onScoreToggle(rubricItem.id, 'does_not_meet') }}
                onDeactivate={() => { if (score.scores.includes('does_not_meet')) onScoreToggle(rubricItem.id, 'does_not_meet') }}
                onTextareaFocus={isNarrow || isReadOnly ? undefined : () => setFocusedBox('does_not_meet')}
                onTextareaBlur={isNarrow || isReadOnly ? undefined : () => setFocusedBox(null)}
                isReadOnly={isReadOnly}
              />
            </div>
          </div>

          {score.annotations.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="text-label-sm font-label font-semibold uppercase tracking-wide text-text-secondary">
                Evidence ({score.annotations.length})
              </span>
              {(score.annotations as AnnotationSummary[]).map(ann => {
                const isFreeNote = Object.keys(ann.anchor).length === 0
                return (
                  <div key={ann.id} id={`annotation-card-${ann.id}`}>
                    {isFreeNote ? (
                      <FreeNoteCard
                        note={ann as unknown as FreeNote}
                        criteria={[]}
                        onEdit={onEditAnnotation}
                        onMove={() => {}}
                        onDelete={onDeleteAnnotation}
                        showMoveDropdown={false}
                        isReadOnly={isReadOnly}
                      />
                    ) : (
                      <AnnotationListCard
                        annotation={ann}
                        onGoTo={onGoToAnnotation}
                        onEdit={onEditAnnotation}
                        onDelete={onDeleteAnnotation}
                        showMoveInEdit={!!allCriteria && allCriteria.length > 0}
                        currentCriterionId={rubricItem.id}
                        criteria={allCriteria}
                        onLink={onMoveAnnotation}
                        isReadOnly={isReadOnly}
                        goToLabel={goToLabel}
                        screenshotNumber={annotationIndexMap?.get(ann.id)}
                      />
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>

    {showStandardModal && (
      <Modal open={showStandardModal} onClose={() => setShowStandardModal(false)}>
        <ModalContent className="max-w-xl">
          <div className="h-full overflow-y-auto p-6 flex flex-col gap-5">
            {/* Header */}
            <div className="flex items-start justify-between gap-4">
              <div className="flex flex-col">
                <span className="text-label-sm font-label font-semibold uppercase tracking-wide text-secondary mb-1">
                  C{criterionIndex}
                </span>
                <h2 className="text-title-md font-heading font-semibold text-primary leading-snug">
                  {criterionName}
                </h2>
                <p className="text-label-sm font-label font-semibold uppercase tracking-wide text-text-secondary mt-2">
                  FULL RUBRIC STANDARD
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowStandardModal(false)}
                className="text-text-muted hover:text-text-primary transition-colors flex-shrink-0 mt-0.5"
                aria-label="Close"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M3 3l10 10M13 3L3 13" />
                </svg>
              </button>
            </div>
            <hr className="border-0 border-t-2 border-border/50" />
            {/* Standards list */}
            {standards.length > 0 ? (
              <div>
                <div>
                  {standards.map((item, i) => {
                    const m = item.match(/^(\d+)\.\s+([\s\S]+)/)
                    const num = m ? m[1] : String(i + 1)
                    const text = m ? m[2].trim() : item
                    return (
                      <div
                        key={i}
                        className={`flex items-start gap-3 py-3${i < standards.length - 1 ? ' border-b border-border/20' : ''}`}
                      >
                        <div className="w-6 h-6 rounded-full bg-surface-container border border-border/60 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <span className="text-label-sm font-label font-semibold text-text-secondary">{num}</span>
                        </div>
                        <p className="flex-1 text-body-md font-body leading-relaxed text-text-primary">{text}</p>
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : (
              <p className="text-body-md font-body leading-relaxed text-text-primary">
                {rubricItem.description || 'No standard defined'}
              </p>
            )}
          </div>
        </ModalContent>
      </Modal>
    )}
    </>
  )
}

export default CriterionCard
