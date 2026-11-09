'use client'

import { useState, useEffect, useRef, type CSSProperties } from 'react'
import type { ScoreCommentItem } from './ReviewerConsole'
import { Textarea } from '@/components/ui/Textarea'

interface RatingBoxProps {
  variant: 'exceeds' | 'exemplifies' | 'does_not_meet'
  comments?: ScoreCommentItem[]
  onAddComment?: (body: string) => void
  onEditComment?: (commentId: string, body: string) => void
  onDeleteComment?: (commentId: string) => void
  onActivate?: () => void
  onDeactivate?: () => void
  isActive: boolean
  style?: CSSProperties
  onTextareaFocus?: () => void
  onTextareaBlur?: () => void
  isReadOnly?: boolean
}

const LABELS: Record<string, string> = {
  exceeds:       'Exceeds',
  exemplifies:   'Exemplifies',
  does_not_meet: 'Does Not Meet',
}

const LABEL_COLORS: Record<string, string> = {
  exceeds:       'text-secondary',
  exemplifies:   'text-primary',
  does_not_meet: 'text-error',
}

const ACTIVE_BORDERS: Record<string, string> = {
  exceeds:       'border-2 border-secondary',
  exemplifies:   'border-2 border-primary',
  does_not_meet: 'border-2 border-error',
}

const INACTIVE_BORDER = 'border border-border/40'

const TEXTAREA_VARIANTS: Record<string, 'exceeds' | 'does-not-meet' | 'exemplifies'> = {
  exceeds:       'exceeds',
  does_not_meet: 'does-not-meet',
  exemplifies:   'exemplifies',
}

const PLACEHOLDERS: Record<string, string> = {
  exceeds:       'Note what exceeds the standard...',
  does_not_meet: 'Note what does not meet the standard...',
  exemplifies:   'Note how this exemplifies the standard...',
}

export function RatingBox({
  variant,
  comments,
  onAddComment,
  onEditComment,
  onDeleteComment,
  onActivate,
  onDeactivate,
  isActive,
  style,
  onTextareaFocus,
  onTextareaBlur,
  isReadOnly = false,
}: RatingBoxProps) {
  const [localText, setLocalText] = useState(comments?.[0]?.body ?? '')

  const firstCommentRef = useRef(comments?.[0] ?? null)
  const isActiveRef = useRef(isActive)
  const isReadOnlyRef = useRef(isReadOnly)
  const onAddRef = useRef(onAddComment)
  const onEditRef = useRef(onEditComment)
  const onDeleteRef = useRef(onDeleteComment)
  const onActivateRef = useRef(onActivate)
  const onDeactivateRef = useRef(onDeactivate)

  useEffect(() => { firstCommentRef.current = comments?.[0] ?? null }, [comments])
  useEffect(() => { isActiveRef.current = isActive }, [isActive])
  useEffect(() => { isReadOnlyRef.current = isReadOnly }, [isReadOnly])
  useEffect(() => { onAddRef.current = onAddComment }, [onAddComment])
  useEffect(() => { onEditRef.current = onEditComment }, [onEditComment])
  useEffect(() => { onDeleteRef.current = onDeleteComment }, [onDeleteComment])
  useEffect(() => { onActivateRef.current = onActivate }, [onActivate])
  useEffect(() => { onDeactivateRef.current = onDeactivate }, [onDeactivate])

  // Badge activation/deactivation — short debounce for snappy visual feedback
  useEffect(() => {
    const timer = setTimeout(() => {
      if (localText.trim()) {
        onActivateRef.current?.()
      } else if (isActiveRef.current) {
        onDeactivateRef.current?.()
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [localText, variant])

  // DB save — longer debounce to avoid excess writes
  useEffect(() => {
    const timer = setTimeout(() => {
      if (isReadOnlyRef.current) return
      const trimmed = localText.trim()
      const existing = firstCommentRef.current
      if (!trimmed) {
        if (existing) onDeleteRef.current?.(existing.id)
        return
      }
      if (existing) {
        onEditRef.current?.(existing.id, trimmed)
      } else {
        onAddRef.current?.(trimmed)
      }
    }, 1500)
    return () => clearTimeout(timer)
  }, [localText, variant])

  const containerBase = 'flex flex-col gap-2 p-3 rounded-none flex-1 min-w-0 bg-surface-container'
  const borderClass = isActive ? ACTIVE_BORDERS[variant] : INACTIVE_BORDER
  const labelClass = `text-label-sm font-label font-semibold uppercase tracking-wide ${LABEL_COLORS[variant]}`

  return (
    <div className={`${containerBase} ${borderClass}`} style={style}>
      <span className={labelClass}>{LABELS[variant]}</span>
      <Textarea
        variant={TEXTAREA_VARIANTS[variant]}
        value={localText}
        onChange={isReadOnly ? undefined : e => setLocalText(e.target.value)}
        rows={4}
        resize="none"
        readOnly={isReadOnly}
        placeholder={isReadOnly && !localText.trim() ? '' : PLACEHOLDERS[variant]}
        onFocus={onTextareaFocus}
        onBlur={onTextareaBlur}
        className="flex-1 bg-transparent [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-secondary/40 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb:hover]:bg-secondary/60"
      />
    </div>
  )
}

export default RatingBox
