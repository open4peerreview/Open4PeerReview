'use client'

import type { ReactNode } from 'react'
import { Button } from '@/components/ui/Button'

interface ViewerPanelHeaderProps {
  onBack: () => void
  centerSlot?: ReactNode
  rightSlot?: ReactNode
}

export function ViewerPanelHeader({ onBack, centerSlot, rightSlot }: ViewerPanelHeaderProps) {
  return (
    // @container makes this element the query context so the collapse responds
    // to the pane's own width (which changes with the split-pane divider), not
    // the viewport. The 3-column grid replaces absolute centering so the button
    // and navigator can never overlap regardless of pane width.
    <div className="@container grid grid-cols-[1fr_auto_1fr] items-center gap-2 flex-shrink-0 bg-surface-card border-b border-border px-4 py-2">
      {/* Left — back button, left-aligned; symmetric 1fr keeps center truly centered */}
      <div className="flex items-center justify-start">
        <Button
          variant="secondary"
          onClick={onBack}
          aria-label="Back to dashboard"
          title="Back to dashboard"
        >
          <svg
            className="w-4 h-4 shrink-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
          <span className="hidden @[468px]:inline">Back to dashboard</span>
        </Button>
      </div>

      {/* Center — auto column in symmetric grid; always at the absolute center of the header */}
      <div className="flex justify-center items-center min-w-0 overflow-hidden">
        {centerSlot}
      </div>

      {/* Right — flush to the right edge */}
      <div className="flex items-center justify-end">
        {rightSlot}
      </div>
    </div>
  )
}

export default ViewerPanelHeader
