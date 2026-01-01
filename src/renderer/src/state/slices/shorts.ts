// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The store's Shorts actions: the 9:16 window and its keyframes, segments,
// their bounds and suggestions. Moved out of state/store.ts in SnippStudio
// phase 2B (no change).
import { shortsWindowAt } from '../../playback/pose'
import { projectDuration, uid } from '../../types'
import { panTarget } from '../../commands/ops/base'
import { SEGMENT_COLORS, runKey } from '../shared'
import { keyOnFrame, onFrameGrid } from '../../timeline/key-grid'
import type { EditorState } from '../editor-state'
import type { GetState, Mutate, SetState } from './types'

export type ShortsActions = Pick<EditorState, 
  | 'setShortsBase'
  | 'addShortsKeyframe'
  | 'dragShorts'
  | 'deleteShortsKeyframe'
  | 'setActiveShortSegment'
  | 'addShortSegment'
  | 'updateShortSegment'
  | 'deleteShortSegment'
  | 'markShortBound'
  | 'suggestShortSegments'
>

export function shortsActions(set: SetState, get: GetState, mutate: Mutate): ShortsActions {
  return {
    setShortsBase: (x) =>
      mutate((p) => {
        p.shorts = p.shorts ?? { baseX: p.settings.width / 2, keyframes: [] }
        p.shorts.baseX = x
      }, false, runKey('shorts-base')),

    addShortsKeyframe: () => {
      const { currentTime, project } = get()
      const win = shortsWindowAt(project, currentTime)
      mutate((p) => {
        const target = panTarget(p, currentTime)
        // On the frame grid, merged only on the same frame (phase Ç2c.2,
        // decision 1, K7).
        const at = onFrameGrid(currentTime, p.settings.fps)
        const near = keyOnFrame(target.keyframes, at, p.settings.fps)
        if (near) near.x = win.cx
        else {
          target.keyframes.push({ id: uid(), time: at, x: win.cx })
          target.keyframes.sort((a, b) => a.time - b.time)
        }
      })
    },

    dragShorts: (x) => {
      const { currentTime } = get()
      mutate((p) => {
        const target = panTarget(p, currentTime)
        if (target.keyframes.length === 0) {
          // No keyframes yet: just park the window (none are auto-created).
          target.baseX = x
          return
        }
        const at = onFrameGrid(currentTime, p.settings.fps)
        const near = keyOnFrame(target.keyframes, at, p.settings.fps)
        if (near) near.x = x
        else {
          target.keyframes.push({ id: uid(), time: at, x })
          target.keyframes.sort((a, b) => a.time - b.time)
        }
      }, false, runKey('shorts-drag'))
    },

    deleteShortsKeyframe: (id) =>
      mutate((p) => {
        if (p.shorts) p.shorts.keyframes = p.shorts.keyframes.filter((k) => k.id !== id)
        for (const seg of p.shortSegments ?? []) {
          seg.keyframes = seg.keyframes.filter((k) => k.id !== id)
        }
      }),
    setActiveShortSegment: (activeShortSegmentId) => set({ activeShortSegmentId }),

    addShortSegment: () => {
      const { currentTime, project } = get()
      const duration = projectDuration(project)
      let start = Math.max(0, Math.min(currentTime, Math.max(0, duration - 1)))
      const end = duration > 0 ? Math.min(duration, start + 20) : start + 20
      const id = uid()
      mutate((p) => {
        p.shortSegments = p.shortSegments ?? []
        // Give each segment a distinct tint so neighbouring bands don't blur
        // into one another — reuse the first colour nobody has taken.
        const taken = new Set(p.shortSegments.map((s) => s.color).filter(Boolean))
        const color = SEGMENT_COLORS.find((c) => !taken.has(c)) ?? SEGMENT_COLORS[p.shortSegments.length % SEGMENT_COLORS.length]
        p.shortSegments.push({
          id,
          name: `Short ${p.shortSegments.length + 1}`,
          start,
          end: Math.max(end, start + 1),
          color,
          keyframes: []
        })
        p.shortSegments.sort((a, b) => a.start - b.start)
      })
      set({ activeShortSegmentId: id })
      return id
    },

    updateShortSegment: (id, patch, commit = true) =>
      mutate((p) => {
        const seg = p.shortSegments?.find((s) => s.id === id)
        if (!seg) return
        const wasDur = seg.end - seg.start
        const onlyStart = patch.start !== undefined && patch.end === undefined
        const onlyEnd = patch.end !== undefined && patch.start === undefined
        Object.assign(seg, patch)
        // Length lock: pulling one edge slides the whole band. Enforced HERE
        // rather than in the drag handler so typing a value or nudging with the
        // keyboard obeys it too.
        if (seg.fixedDur && patch.fixedDur === undefined) {
          // Clamp to 0 BEFORE deriving the other edge. Clamping afterwards left
          // the far edge where the un-clamped slide had put it, so dragging a
          // locked band into the start of the timeline squashed it toward zero
          // — the one thing a length lock is supposed to make impossible.
          if (onlyStart) {
            seg.start = Math.max(0, seg.start)
            seg.end = seg.start + wasDur
          } else if (onlyEnd) {
            seg.start = Math.max(0, seg.end - wasDur)
            seg.end = seg.start + wasDur
          }
        }
        // Keep the range valid: at least half a second long, start before end.
        seg.start = Math.max(0, seg.start)
        if (seg.end < seg.start + 0.5) {
          if (patch.start !== undefined) seg.start = seg.end - 0.5
          else seg.end = seg.start + 0.5
        }
        p.shortSegments?.sort((a, b) => a.start - b.start)
      }, commit, `shortSeg:${id}:${Object.keys(patch).join(',')}`),

    deleteShortSegment: (id) => {
      mutate((p) => {
        p.shortSegments = (p.shortSegments ?? []).filter((s) => s.id !== id)
      })
      if (get().activeShortSegmentId === id) set({ activeShortSegmentId: null })
    },

    markShortBound: (which) => {
      const s = get()
      const t = s.currentTime
      let id = s.activeShortSegmentId
      const exists = id && s.project.shortSegments?.some((seg) => seg.id === id)
      if (!exists) {
        // No active segment: I starts one at the playhead; O ends one that
        // reaches back from the playhead.
        id = s.addShortSegment()
        if (which === 'out') {
          get().updateShortSegment(id, { start: Math.max(0, t - 20), end: Math.max(0.5, t) })
        }
        return
      }
      if (which === 'in') get().updateShortSegment(id!, { start: t })
      else get().updateShortSegment(id!, { end: t })
    },

    suggestShortSegments: () => {
      const { project } = get()
      const caps = project.captions
      const duration = projectDuration(project)
      if (caps.length === 0 || duration < 5) return 0

      // Every spoken word's start time — the density signal.
      const words: number[] = []
      for (const c of caps) {
        if (c.words && c.words.length > 0) for (const w of c.words) words.push(w.start)
        else {
          const n = Math.max(1, c.text.trim().split(/\s+/).length)
          for (let i = 0; i < n; i++) words.push(c.start + ((c.end - c.start) * i) / n)
        }
      }
      words.sort((x, y) => x - y)

      const len = Math.min(30, Math.max(10, duration * 0.9))
      // Don't overlap segments that already exist.
      const taken: [number, number][] = (project.shortSegments ?? []).map((s) => [s.start, s.end])
      const made: { start: number; end: number }[] = []

      for (let k = 0; k < 3; k++) {
        let best = -1
        let bestT = 0
        for (let t = 0; t + len <= duration + 0.001; t += 1) {
          if (taken.some(([a, b]) => t < b && t + len > a)) continue
          const score = words.filter((w) => w >= t && w < t + len).length
          if (score > best) {
            best = score
            bestT = t
          }
        }
        // Require some actual speech in the window (~8 words minimum).
        if (best < 8) break
        // Snap to sentence boundaries so shorts don't start or end mid-line.
        let a = bestT
        let b = bestT + len
        const containing = caps.find((c) => c.start <= a && c.end > a)
        if (containing) a = Math.max(0, containing.start)
        else {
          const next = [...caps].filter((c) => c.start >= a).sort((x, y) => x.start - y.start)[0]
          if (next && next.start < b - 5) a = next.start
        }
        const lastIn = [...caps].filter((c) => c.end <= b + 0.001 && c.end > a).sort((x, y) => y.end - x.end)[0]
        if (lastIn && lastIn.end > a + 5) b = lastIn.end
        b = Math.min(duration, Math.min(b, a + 60))
        if (b - a < 3) break
        made.push({ start: a, end: b })
        taken.push([a, b])
      }
      if (made.length === 0) return 0

      mutate((p) => {
        p.shortSegments = p.shortSegments ?? []
        const base = p.shortSegments.length
        made
          .sort((x, y) => x.start - y.start)
          .forEach((m, i) => {
            p.shortSegments!.push({ id: uid(), name: `Short ${base + i + 1}`, start: m.start, end: m.end, keyframes: [] })
          })
        p.shortSegments.sort((x, y) => x.start - y.start)
      })
      return made.length
    }
  }
}
