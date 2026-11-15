'use client'

import type { ChangeEventHandler } from 'react'

export interface CheckboxProps {
  checked: boolean
  onChange: ChangeEventHandler<HTMLInputElement>
  disabled?: boolean
  id?: string
  'aria-label'?: string
  className?: string
}

function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ')
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 12 12" fill="none" aria-hidden="true" className="w-3 h-3">
      <path
        d="M1.5 6L4.5 9.5L10.5 3"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function Checkbox({
  checked,
  onChange,
  disabled,
  id,
  'aria-label': ariaLabel,
  className,
}: CheckboxProps) {
  return (
    <span className={cx(
      'relative inline-flex items-center justify-center',
      disabled && 'opacity-40 cursor-not-allowed',
      className,
    )}>
      <input
        type="checkbox"
        id={id}
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        aria-label={ariaLabel}
        className="sr-only peer"
      />
      <span
        aria-hidden="true"
        className={cx(
          'w-5 h-5 rounded-[4px] border-2 flex items-center justify-center transition-colors',
          'peer-focus-visible:ring-2 peer-focus-visible:ring-primary peer-focus-visible:ring-offset-2',
          checked
            ? 'border-primary bg-primary text-on-primary'
            : 'border-border bg-surface-card',
        )}
      >
        {checked && <CheckIcon />}
      </span>
    </span>
  )
}

export default Checkbox
