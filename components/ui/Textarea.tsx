'use client'

import { type TextareaHTMLAttributes, useId } from 'react'

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  error?: string
  helperText?: string
  optional?: boolean
  rows?: number
  resize?: 'none' | 'vertical' | 'both'
  variant?: 'default' | 'exceeds' | 'does-not-meet' | 'exemplifies'
}

function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ')
}

export function Textarea({
  label,
  error,
  helperText,
  optional,
  rows = 3,
  resize = 'vertical',
  variant = 'default',
  className,
  id: idProp,
  ...props
}: TextareaProps) {
  const autoId = useId()
  const id = idProp ?? autoId

  const resizeClass = resize === 'none' ? 'resize-none' : resize === 'vertical' ? 'resize-y' : 'resize'

  const variantClass = {
    'default':       'border-border focus:border-primary',
    'exceeds':       'border-secondary/40 focus:border-secondary',
    'does-not-meet': 'border-error/40 focus:border-error',
    'exemplifies':   'border-primary/40 focus:border-primary',
  }[variant]

  return (
    <div className="flex flex-col">
      {label && (
        <label
          htmlFor={id}
          className="block mb-4 text-label-md font-label font-semibold uppercase tracking-wide text-text-secondary"
        >
          {label}
          {props.required && (
            <span className="ml-1 text-error" aria-hidden="true">*</span>
          )}
          {optional && (
            <span className="ml-1.5 font-normal normal-case tracking-normal text-body-sm text-text-muted" aria-hidden="true">(optional)</span>
          )}
        </label>
      )}
      <textarea
        id={id}
        rows={rows}
        className={cx(
          'w-full bg-transparent border-0 border-b outline-none',
          'px-0 pb-2',
          'text-body-sm font-body text-text-primary',
          'placeholder:text-text-secondary placeholder:opacity-50',
          'transition-colors duration-[var(--transition-duration-fast)]',
          'disabled:text-text-muted disabled:cursor-not-allowed disabled:opacity-60',
          'read-only:cursor-default read-only:select-text',
          resizeClass,
          error ? 'border-error focus:border-error' : variantClass,
          className,
        )}
        {...props}
      />
      {error && (
        <p className="mt-1.5 text-body-sm text-error" role="alert">{error}</p>
      )}
      {!error && helperText && (
        <p className="mt-1.5 text-body-sm text-text-muted">{helperText}</p>
      )}
    </div>
  )
}

export default Textarea
