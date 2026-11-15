'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import type { SnapshotActivity } from './h5pSnapshot'
import type { SavedAnnotation } from './HtmlViewerCanvas'

interface Props {
  activities: SnapshotActivity[]
  annotations: SavedAnnotation[]
  readOnly: boolean
  onAnnotate: (activity: SnapshotActivity, control: HTMLButtonElement) => void
  onOpenAnnotation: (id: string, control: HTMLButtonElement) => void
}

export function SnapshotH5pPlayers({ activities, annotations, readOnly, onAnnotate, onOpenAnnotation }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const frames = useRef(new Map<string, HTMLIFrameElement>())
  const [heights, setHeights] = useState<Record<string, number>>({})
  const [opened, setOpened] = useState<Set<string>>(new Set())
  const [boxes, setBoxes] = useState<Record<string, { left: number; top: number; width: number }>>({})

  useLayoutEffect(() => {
    const overlay = overlayRef.current
    const doc = activities[0]?.placeholder.ownerDocument
    const snapshotWindow = doc?.defaultView
    if (!overlay || !doc || !snapshotWindow || !activities.length) return

    const measure = () => {
      const bounds = overlay.getBoundingClientRect()
      const frame = snapshotWindow.frameElement?.getBoundingClientRect()
      if (!frame) return
      const next: typeof boxes = {}
      for (const activity of activities) {
        if (activity.row?.hidden) continue
        const rect = activity.placeholder.getBoundingClientRect()
        if (!rect.width) continue
        next[activity.key] = { left: frame.left + rect.left - bounds.left, top: frame.top + rect.top - bounds.top, width: rect.width }
      }
      setBoxes(next)
      setOpened(prev => {
        const newKeys = Object.keys(next).filter(key => !prev.has(key))
        return newKeys.length ? new Set([...prev, ...newKeys]) : prev
      })
    }

    const observer = new ResizeObserver(measure)
    observer.observe(overlay)
    observer.observe(doc.body)
    for (const { placeholder } of activities) observer.observe(placeholder)
    snapshotWindow.addEventListener('scroll', measure, true)
    snapshotWindow.addEventListener('resize', measure)

    const receive = (event: MessageEvent) => {
      if (event.origin !== 'null' || event.data?.context !== 'h5p') return
      const matching = [...frames.current].find(([, frame]) => frame.contentWindow === event.source)
      if (!matching) return
      const [key, frame] = matching
      if (event.data.action === 'hello') {
        frame.contentWindow?.postMessage({ context: 'h5p', action: 'hello' }, '*')
      } else if (event.data.action === 'prepareResize' || event.data.action === 'resize') {
        const preparing = event.data.action === 'prepareResize'
        const height = preparing ? event.data.clientHeight : event.data.scrollHeight
        if (typeof height !== 'number' || !Number.isFinite(height) || height <= 0) return
        const nextHeight = Math.min(2500, Math.max(120, height))
        if (preparing) {
          frame.style.height = `${nextHeight}px`
          frame.contentWindow?.postMessage({ context: 'h5p', action: 'resizePrepared' }, '*')
        } else {
          setHeights(prev => prev[key] === nextHeight ? prev : { ...prev, [key]: nextHeight })
        }
      }
    }
    window.addEventListener('message', receive)
    measure()
    return () => {
      observer.disconnect()
      snapshotWindow.removeEventListener('scroll', measure, true)
      snapshotWindow.removeEventListener('resize', measure)
      window.removeEventListener('message', receive)
    }
  }, [activities])

  useLayoutEffect(() => {
    for (const activity of activities) {
      const count = annotations.filter(a => a.anchor.activityKey === activity.key).length
      const toolbar = !readOnly || count > 0
      const { placeholder } = activity
      placeholder.style.setProperty('height', `${(heights[activity.key] ?? 460) + (toolbar ? 40 : 0)}px`)
    }
  }, [activities, annotations, heights, readOnly])

  return (
    <div ref={overlayRef} className="pointer-events-none absolute inset-0 overflow-hidden">
      {activities.map(activity => {
        const box = boxes[activity.key]
        if (!box && !opened.has(activity.key)) return null
        const notes = annotations.filter(a => a.anchor.activityKey === activity.key)
        return (
          <section key={activity.key} aria-label={activity.title} className="pointer-events-auto absolute bg-surface-card" hidden={!box} style={box}>
            <iframe
              ref={frame => {
                if (frame) frames.current.set(activity.key, frame)
                else frames.current.delete(activity.key)
              }}
              src={activity.url}
              title={activity.title}
              sandbox="allow-scripts"
              referrerPolicy="no-referrer"
              loading="lazy"
              onLoad={event => event.currentTarget.contentWindow?.postMessage({ context: 'h5p', action: 'ready' }, '*')}
              className="block w-full border border-border"
              style={{ height: heights[activity.key] ?? 460 }}
            />
            {(!readOnly || notes.length > 0) && (
              <div className="flex h-10 items-center gap-2 overflow-x-auto border border-border px-2 text-xs">
                {!readOnly && (
                  <button type="button" className="shrink-0 underline hover:text-text-secondary" onClick={e => onAnnotate(activity, e.currentTarget)}>
                    Annotate activity
                  </button>
                )}
                {notes.map((note, index) => (
                  <button key={note.id} type="button" className="annotation-highlight shrink-0 rounded bg-secondary-container px-2 py-1" data-annotation-id={note.id} onClick={e => onOpenAnnotation(note.id, e.currentTarget)}>
                    Note {index + 1}
                  </button>
                ))}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}
