import { describe, it, expect } from 'vitest'
import { parseOpenStaxToc, parsePressbooksToc, pressbooksBookRoot, mergeChapterPages } from '@/lib/oer-toc'

const page = (title: string, slug: string) => ({ title, slug })

function openStaxHtml(tree: unknown) {
  const state = { content: { book: { tree } } }
  return `<html><body><script>window.__PRELOADED_STATE__ = ${JSON.stringify(state)}</script><script>other()</script></body></html>`
}

describe('parseOpenStaxToc', () => {
  const url = 'https://openstax.org/books/psychology-2e/pages/2-1-why-is-research-important'

  it('groups each chapter with all of its pages, including end-of-chapter pages', () => {
    const html = openStaxHtml({
      title: 'Psychology 2e',
      contents: [
        page('Preface', 'preface'),
        {
          title: '<span class="os-number">2</span><span class="os-divider"> </span><span class="os-text">Psychological Research</span>',
          contents: [
            page('Introduction', '2-introduction'),
            page('<span class="os-number">2.1</span> Why Is Research Important?', '2-1-why-is-research-important'),
            page('Key Terms', '2-key-terms'),
          ],
        },
      ],
    })
    const toc = parseOpenStaxToc(html, url)!
    expect(toc.bookTitle).toBe('Psychology 2e')
    expect(toc.platform).toBe('OpenStax')
    expect(toc.chapters).toEqual([
      { title: 'Preface', pages: [{ title: 'Preface', url: 'https://openstax.org/books/psychology-2e/pages/preface' }] },
      {
        title: 'Chapter 2: Psychological Research',
        pages: [
          { title: 'Introduction', url: 'https://openstax.org/books/psychology-2e/pages/2-introduction' },
          { title: '2.1 Why Is Research Important?', url: 'https://openstax.org/books/psychology-2e/pages/2-1-why-is-research-important' },
          { title: 'Key Terms', url: 'https://openstax.org/books/psychology-2e/pages/2-key-terms' },
        ],
      },
    ])
  })

  it('walks through units to find chapters', () => {
    const html = openStaxHtml({
      title: 'Biology',
      contents: [{ title: 'Unit 1', contents: [{ title: 'Chapter 1: The Study of Life', contents: [page('1.1 Science', '1-1-science')] }] }],
    })
    expect(parseOpenStaxToc(html, 'https://openstax.org/books/biology/pages/1-1-science')!.chapters.map(c => c.title)).toEqual([
      'Chapter 1: The Study of Life',
    ])
  })

  it('returns null when the page has no book tree', () => {
    expect(parseOpenStaxToc('<html></html>', url)).toBeNull()
  })
})

describe('Pressbooks', () => {
  it('finds the book root from any page URL, on any domain', () => {
    expect(pressbooksBookRoot('https://open.maricopa.edu/com225/chapter/communication-model/')).toBe('https://open.maricopa.edu/com225/')
    expect(pressbooksBookRoot('https://wtcs.pressbooks.pub/nursingfundamentals/')).toBe('https://wtcs.pressbooks.pub/nursingfundamentals/')
    expect(pressbooksBookRoot('https://book.example.edu/part/unit-1/')).toBe('https://book.example.edu/')
  })

  it('turns parts into chapters', () => {
    const toc = parsePressbooksToc(
      {
        parts: [
          {
            title: 'Chapter 1: Scope of Practice',
            chapters: [
              { title: '1.1 Introduction', link: 'https://b.pub/x/chapter/1-1/' },
              { title: '1.2 History &amp; Foundation', link: 'https://b.pub/x/chapter/1-2/' },
            ],
          },
          { title: 'Empty part', chapters: [] },
        ],
      },
      'Nursing Fundamentals',
    )!
    expect(toc.chapters).toEqual([
      {
        title: 'Chapter 1: Scope of Practice',
        pages: [
          { title: '1.1 Introduction', url: 'https://b.pub/x/chapter/1-1/' },
          { title: '1.2 History & Foundation', url: 'https://b.pub/x/chapter/1-2/' },
        ],
      },
    ])
  })

  it('lists pages individually when the book has no real parts', () => {
    const toc = parsePressbooksToc(
      { parts: [{ title: 'Main Body', chapters: [{ title: 'Intro', link: 'https://b.pub/x/chapter/intro/' }, { title: 'Methods', link: 'https://b.pub/x/chapter/methods/' }] }] },
      'Book',
    )!
    expect(toc.chapters.map(c => [c.title, c.pages.length])).toEqual([['Intro', 1], ['Methods', 1]])
  })

  it('lists front matter first and back matter last, one page each', () => {
    const toc = parsePressbooksToc(
      {
        'front-matter': [{ title: 'Overview', link: 'https://b.pub/x/front-matter/overview/' }],
        parts: [{ title: 'Chapter 1: Basics', chapters: [{ title: '1.1 Intro', link: 'https://b.pub/x/chapter/1-1/' }] }],
        'back-matter': [{ title: 'Appendix A', link: 'https://b.pub/x/back-matter/appendix-a/' }],
      },
      'Book',
    )!
    expect(toc.chapters.map(c => [c.title, c.pages.length])).toEqual([['Overview', 1], ['Chapter 1: Basics', 1], ['Appendix A', 1]])
  })

  it('returns null for an empty TOC', () => {
    expect(parsePressbooksToc({ parts: [] }, 'Book')).toBeNull()
  })
})

describe('mergeChapterPages', () => {
  it('makes the first picked page the main URL and keeps existing extra pages', () => {
    expect(mergeChapterPages(['https://x/manual', ''], ['https://x/2-intro', 'https://x/2-1', 'https://x/manual'])).toEqual({
      mainUrl: 'https://x/2-intro',
      extraUrls: ['https://x/manual', 'https://x/2-1'],
    })
  })
})
