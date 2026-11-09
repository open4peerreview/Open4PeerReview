import { describe, it, expect } from 'vitest'
import { rewriteHtml, isH5pIframe } from '@/lib/snapshot-rewrite'

const ORIGIN = 'https://book.pressbooks.pub'
const SOURCE = 'https://book.pressbooks.pub/chapter-1/'
const page = (body: string) => `<html><head><title>t</title></head><body>${body}</body></html>`
const rewrite = (body: string, platform = 'Pressbooks') => rewriteHtml(page(body), ORIGIN, platform, SOURCE)
const hrefOf = (html: string) => /<a href="([^"]*)"/.exec(html)?.[1]

describe('H5P iframes become placeholders', () => {
  it('Pressbooks about:blank iframe uses the standard h5p_embed URL from data-content-id', () => {
    const out = rewrite('<div class="h5p-iframe-wrapper"><iframe id="h5p-iframe-3" class="h5p-iframe" data-content-id="3" src="about:blank"></iframe></div>')
    expect(out).not.toMatch(/<iframe/i)
    expect(out).toContain('data-open4pr="h5p-placeholder"')
    expect(hrefOf(out)).toBe(`${ORIGIN}/wp-admin/admin-ajax.php?action=h5p_embed&amp;id=3`)
  })

  it('keeps the iframe src as the link when it is an absolute URL', () => {
    const out = rewrite('<iframe src="https://book.pressbooks.pub/wp-admin/admin-ajax.php?action=h5p_embed&id=7"></iframe>')
    expect(hrefOf(out)).toContain('action=h5p_embed&amp;id=7')
    expect(out).not.toMatch(/<iframe/i)
  })

  it('resolves a relative src against the snapshot origin', () => {
    const out = rewrite('<iframe src="/h5p/embed/12"></iframe>')
    expect(hrefOf(out)).toBe(`${ORIGIN}/h5p/embed/12`)
  })

  it('detects h5p.org / h5p.com embeds and handles single-quoted, reordered attributes', () => {
    expect(isH5pIframe('<iframe src="https://h5p.org/h5p/embed/1">')).toBe(true)
    expect(isH5pIframe("<iframe width='1' src='https://cdn.h5p.com/x'>")).toBe(true)
    expect(isH5pIframe('<iframe data-content-id="9" src="about:blank">')).toBe(true)
  })

  it('replaces every H5P iframe on the page', () => {
    const out = rewrite('<iframe data-content-id="1" src="about:blank"></iframe><p>between</p><iframe class="h5p-iframe" src="about:blank">fallback</iframe>')
    expect(out.match(/h5p-placeholder/g)).toHaveLength(2)
    expect(out).toContain('<p>between</p>')
    expect(out).not.toContain('fallback')
  })

  it('falls back to the source URL when no usable link can be derived', () => {
    const out = rewrite('<iframe class="h5p-iframe" src="about:blank"></iframe>')
    expect(hrefOf(out)).toBe(SOURCE)
  })

  it('never emits a javascript: link', () => {
    const out = rewrite('<iframe class="h5p-iframe" src="javascript:alert(1)"></iframe>')
    expect(out).not.toMatch(/javascript:/i)
    expect(hrefOf(out)).toBe(SOURCE)
  })

  it('HTML-escapes attacker-controlled src values', () => {
    const out = rewrite(`<iframe src="https://h5p.org/x?a=1&b=\\"><script>alert(1)</script>"></iframe>`)
    expect(out).not.toMatch(/<script/i)
    expect(hrefOf(out)).not.toContain('"')
  })
})

describe('non-H5P content is unchanged', () => {
  it('leaves other iframes alone', () => {
    const yt = '<iframe src="https://www.youtube.com/embed/abc"></iframe>'
    expect(rewrite(yt)).toContain(yt)
  })

  it('does not treat data-src or unrelated attributes as an H5P marker', () => {
    expect(isH5pIframe('<iframe data-src="https://example.com/h5p">')).toBe(false)
  })
})

describe('existing rewrite behavior (regression)', () => {
  it('strips scripts', () => {
    expect(rewrite('<script>boot()</script><p>text</p>')).not.toMatch(/<script/i)
  })

  it('injects <base> and nav-disable CSS into <head>', () => {
    const out = rewrite('<p>x</p>')
    expect(out).toContain(`<base href="${ORIGIN}/">`)
    expect(out).toContain('data-open4pr="nav-disable"')
    expect(out).toContain('.nav-reading a')
  })

  it('prepends base/CSS when there is no <head>', () => {
    const out = rewriteHtml('<p>x</p>', ORIGIN, 'OpenStax')
    expect(out.startsWith(`<base href="${ORIGIN}/">`)).toBe(true)
    expect(out).toContain('a[href^="/books"]')
  })

  it('works without a sourceUrl', () => {
    const out = rewriteHtml(page('<iframe class="h5p-iframe" src="about:blank"></iframe>'), ORIGIN, 'Pressbooks')
    expect(hrefOf(out)).toBe(`${ORIGIN}/`)
  })
})
