import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SYNC_COALESCE_MS } from '../src/native-mobile.js'

/**
 * A streaming reply rewrites the transcript many times per frame. The shell
 * adapter used to observe the whole body subtree and run a full `sync()` —
 * a dozen document queries — on every animation frame of that churn, which is
 * the dominant cost of an active Session on a phone. These assertions pin the
 * two properties that keep that cost bounded: the body observer no longer sees
 * descendant churn, and passes are coalesced.
 */
const source = readFileSync(new URL('../src/native-mobile.ts', import.meta.url), 'utf8')

/** The `observer.observe(document.body, ...)` call, with its option object. */
function bodyObserverOptions(): string {
  const at = source.indexOf('observer.observe(document.body, {')
  expect(at).toBeGreaterThan(-1)
  const end = source.indexOf('})', at)
  expect(end).toBeGreaterThan(at)
  return source.slice(at, end + 2)
}

describe('mobile shell mutation cost', () => {
  it('does not observe body descendants', () => {
    // `subtree: true` on document.body delivers every token of a reply.
    expect(bodyObserverOptions()).not.toContain('subtree: true')
  })

  it('still observes body children so a replaced column re-syncs', () => {
    expect(bodyObserverOptions()).toContain('childList: true')
  })

  it('coalesces a mutation burst instead of syncing per frame', () => {
    expect(SYNC_COALESCE_MS).toBeGreaterThan(0)
    // One timer per burst: a second schedule while one is pending is dropped.
    expect(source).toContain('if (scheduled !== 0) return')
    expect(source).toContain('window.setTimeout(() => { scheduled = 0; sync() }, SYNC_COALESCE_MS)')
  })

  it('clears the pending coalescing timer on dispose', () => {
    // Cancelling an animation frame here would leave the timeout armed.
    expect(source).toContain('if (scheduled !== 0) window.clearTimeout(scheduled)')
  })

  it('watches the transcript on its own container rather than the body', () => {
    expect(source).toContain('conversationObserver.observe(next, { childList: true, subtree: true })')
    expect(source).toContain('observeConversation(conversation ?? undefined)')
  })

  it('re-scans table wrappers only when the transcript container changes', () => {
    // The wrap itself is idempotent; re-querying every table on each pass is not.
    expect(source).toContain('if (tableWrapTarget !== center) {')
    expect(source).toContain('tableWrapTarget = center')
  })
})
