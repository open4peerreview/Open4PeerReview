import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'

type Listener = (...args: any[]) => any
const store: Record<string, unknown> = {}
const listeners: Record<string, Listener> = {}
const mk = (name: string) => ({ addListener: (fn: Listener) => { listeners[name] = fn } })

beforeAll(async () => {
  vi.stubGlobal('chrome', {
    webNavigation: { onBeforeNavigate: mk('nav') },
    tabs: { onRemoved: mk('removed'), onUpdated: mk('updated') },
    runtime: { onMessage: mk('message') },
    storage: {
      local: {
        get: async (key: any) => {
          if (typeof key === 'string') return key in store ? { [key]: store[key] } : {}
          return { ...store }
        },
        set: async (obj: Record<string, unknown>) => { Object.assign(store, obj) },
        remove: async (key: string) => { delete store[key] },
      },
    },
  })
  await import('../../extension/src/background')
})

beforeEach(() => { for (const k of Object.keys(store)) delete store[k] })

const navigate = (tabId: number, url: string, frameId = 0) =>
  listeners.nav({ tabId, url, frameId })
const consume = (tabId: number) =>
  new Promise<any>(resolve =>
    listeners.message({ type: 'CONSUME_DEEP_LINK' }, { tab: { id: tabId } }, resolve))
const flush = () => new Promise(r => setTimeout(r, 0))

describe('background deep-link capture', () => {
  it('stores the link under a per-tab key', async () => {
    navigate(7, 'https://proton.oli.cmu.edu/sections/x?oer_review_id=rev-1&oer_goto=ann-1')
    await flush()
    expect(store['oer_pending_review:7']).toMatchObject({ reviewId: 'rev-1', annotationId: 'ann-1' })
    expect(store['oer_pending_review']).toBeUndefined()
  })

  it('ignores subframes and URLs without deep-link params', async () => {
    navigate(7, 'https://proton.oli.cmu.edu/x?oer_review_id=rev-1', 3)
    navigate(8, 'https://proton.oli.cmu.edu/x')
    await flush()
    expect(Object.keys(store)).toHaveLength(0)
  })

  it("does not leak one tab's link to another tab", async () => {
    navigate(1, 'https://proton.oli.cmu.edu/x?oer_review_id=A')
    navigate(2, 'https://proton.oli.cmu.edu/x?oer_review_id=B')
    await flush()
    expect((await consume(1)).data.reviewId).toBe('A')
    expect((await consume(2)).data.reviewId).toBe('B')
    expect((await consume(3)).data).toBeNull()
  })

  it('consumes exactly once', async () => {
    navigate(1, 'https://proton.oli.cmu.edu/x?oer_review_id=A')
    await flush()
    expect((await consume(1)).data.reviewId).toBe('A')
    expect((await consume(1)).data).toBeNull()
  })

  it("clears a tab's pending link when the tab closes", async () => {
    navigate(5, 'https://proton.oli.cmu.edu/x?oer_review_id=A')
    await flush()
    listeners.removed(5)
    await flush()
    expect((await consume(5)).data).toBeNull()
  })
})
