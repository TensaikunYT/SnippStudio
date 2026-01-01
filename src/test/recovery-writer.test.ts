// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase Ç2a.2, decision 5 (report P3, P17): when the crash snapshot is
// written and when this window's own one is removed (media/recovery-writer.ts),
// on the real store with a stand-in clock. The page-level scenarios (a save
// or another project, then a crash) are e2e 44-recovery-snapshot-life.
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { useStore } from '../renderer/src/state/store'
import { defaultProject } from '../renderer/src/types'
import { RECOVERY_MAX_WAIT_MS, RECOVERY_QUIET_MS, startRecoveryWriter } from '../renderer/src/media/recovery-writer'

const S = useStore.getState

function harness(enabled = true) {
  let now = 1_000_000
  const timers: { at: number; fn: () => void; id: number }[] = []
  let ids = 0
  const writes: string[] = []
  let clears = 0
  const stop = startRecoveryWriter({
    store: useStore,
    write: (p) => void writes.push(p.name),
    clear: () => void clears++,
    enabled: () => enabled,
    now: () => now,
    setTimer: (fn, ms) => {
      const t = { at: now + ms, fn, id: ++ids }
      timers.push(t)
      return t.id
    },
    clearTimer: (id) => {
      const i = timers.findIndex((t) => t.id === id)
      if (i >= 0) timers.splice(i, 1)
    }
  })
  const advance = (ms: number): void => {
    const end = now + ms
    for (;;) {
      timers.sort((a, b) => a.at - b.at)
      const t = timers[0]
      if (!t || t.at > end) break
      timers.shift()
      now = t.at
      t.fn()
    }
    now = end
  }
  return { writes, clears: () => clears, advance, stop }
}

function fresh(name = 'P'): void {
  const p = defaultProject()
  p.name = name
  S().loadProject(p)
}

test('a snapshot 10 s after the last change, of the project as it is then — a project with no clips too (P17)', () => {
  fresh('Title only')
  const h = harness()
  S().addCaptionAtPlayhead('A title')
  h.advance(RECOVERY_QUIET_MS - 1)
  assert.deepEqual(h.writes, [], 'not before 10 s')
  S().setProjectName('Renamed')
  h.advance(RECOVERY_QUIET_MS - 1)
  assert.deepEqual(h.writes, [], 'a new change waits again')
  h.advance(1)
  assert.deepEqual(h.writes, ['Renamed'], 'written, as it is now')
  assert.equal(Object.keys(S().project.clips).length, 0)
  h.stop()
})

test('a long run of changes is still written at least once a minute', () => {
  fresh()
  const h = harness()
  for (let i = 0; i < 20; i++) {
    S().setTime(i)
    S().addMarkerAtPlayhead()
    h.advance(5_000)
  }
  assert.ok(h.writes.length >= Math.floor((20 * 5_000) / RECOVERY_MAX_WAIT_MS), `written ${h.writes.length} times in 100 s of changes`)
  h.stop()
})

test('P3: saved, another project opened, a new one: the own snapshot is removed, and a pending write does not happen', () => {
  fresh()
  const h = harness()
  S().addMarkerAtPlayhead()
  h.advance(RECOVERY_QUIET_MS)
  assert.equal(h.writes.length, 1)
  // A save: nothing unsaved any more.
  S().addMarkerAtPlayhead()
  S().setDirty(false)
  assert.equal(h.clears(), 1, 'removed with the save')
  h.advance(RECOVERY_QUIET_MS * 2)
  assert.equal(h.writes.length, 1, 'the write that was waiting is not made')
  // Changes, then another project opened (they are discarded).
  S().addMarkerAtPlayhead()
  fresh('Other')
  assert.equal(h.clears(), 2, 'removed with the open')
  h.advance(RECOVERY_QUIET_MS * 2)
  assert.equal(h.writes.length, 1)
  // Changes, then a new project.
  S().addMarkerAtPlayhead()
  S().newProject('16:9')
  assert.equal(h.clears(), 3, 'removed with a new project')
  h.stop()
})

test('autosave off: no snapshot', () => {
  fresh()
  const h = harness(false)
  S().addMarkerAtPlayhead()
  h.advance(RECOVERY_QUIET_MS * 3)
  assert.deepEqual(h.writes, [])
  h.stop()
})
