// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The project file's format version (phase Ç2a.1, report D4.3).
//
// `version: 1` says "a Snipp project" and never changes. `formatVersion` rises
// each time the MEANING of something in the file changes (a field read
// another way, a value renamed, a structure moved). A file without it is
// format 1 (everything written before Ç2a.1).
//
// Opening a file runs, in order, every conversion whose `to` is above the
// file's format. Each conversion is idempotent: running it on a file it has
// already converted changes nothing (a file an older Snipp saved again keeps
// the newer number but may hold older data). After the conversions, the
// project is normalised (defaults filled, data made safe to draw) and
// repaired (model/repair.ts) whatever its format; a conversion marked
// `afterRepair` (one that reads the layout) runs after that.
//
// A file of a NEWER format than this build opens (best effort), and the
// first save over it asks first (media/projectio.ts, App.tsx).
//
// Adding a conversion (FAZC2A-PLAN.md, "How a later session adds a format
// conversion"): bump CURRENT_FORMAT, append { to: CURRENT_FORMAT, what, run }
// to CONVERSIONS, write `run` so it can run twice, add an old sample to
// src/test/format.test.ts.
import type { Project } from '../types'
import { linkTransitionsInPlace } from '../timeline/transition-links'
import { snapFps } from '../timeline/rates'

export const CURRENT_FORMAT = 8

export interface Conversion {
  /** The format a file has after this conversion. */
  to: number
  what: string
  run: (p: Project) => void
  /** Runs after the open's repair (convertProject's `between`): a
   *  conversion that reads the file's layout must read it as it will be
   *  shown (Ç2b patch, item 6: a repaired overlap or a clip shortened to its
   *  media changed which clip meets which). */
  afterRepair?: boolean
}

export const CONVERSIONS: readonly Conversion[] = [
  {
    to: 2,
    what: 'the canvas board view is gone, the blur-in popup has a neutral name, a code film is never read for sound',
    run: (project) => {
      const legacy = project as unknown as Record<string, unknown>
      // The canvas/board view and its animated camera were removed: the
      // fields are dropped, so nothing downstream can trip over them.
      if (legacy.mode === 'canvas') project.mode = 'frame'
      delete legacy.canvasSegments
      delete legacy.cameraKeyframes
      delete legacy.cameraBase
      delete legacy.cameraMotion
      for (const clip of Object.values(project.clips ?? {})) {
        if (clip && typeof clip === 'object') delete (clip as unknown as Record<string, unknown>).depth
      }
      // A code film's sound is its own linked clip: the film is never read
      // for sound (its address is a page, not a recording).
      for (const asset of Array.isArray(project.assets) ? project.assets : []) if (asset?.kind === 'code') asset.hasAudio = false
      // The blur-in popup style used to be named after a company.
      const styles = [project.captionStyle, project.captionStyleShorts, ...(Array.isArray(project.captions) ? project.captions : []).map((c) => c?.style)]
      for (const style of styles) {
        const popup = style?.popup as { style?: string } | undefined
        if (popup?.style === 'apple') popup.style = 'focus'
      }
    }
  },
  {
    to: 3,
    what: 'the sound effects track is known by its role, not by its name (phase Ç2b.1, L10)',
    run: (project) => {
      // A track the app made for sound effects was found by the name it gave
      // it ("SFX", "SFX 2"…), so renaming it lost it. Those tracks say so now.
      for (const t of Array.isArray(project.tracks) ? project.tracks : []) {
        if (t && t.kind === 'audio' && !t.role && typeof t.name === 'string' && /^SFX(?: \d+)?$/.test(t.name)) t.role = 'sfx'
      }
    }
  },
  {
    to: 4,
    what: 'a transition names the clip it goes into (phase Ç2b.2, report G2)',
    // (The clip that meets it once the open's repair has run.)
    afterRepair: true,
    run: (project) => {
      // It went into whatever touched its clip's end when drawn: it now names
      // that clip (`to`), or null when nothing did (a dissolve or a dip there
      // was a fade-out, and stays one). Only a transition with no `to` is
      // given one, so this can run twice.
      linkTransitionsInPlace(project)
    }
  },
  {
    to: 5,
    what: "a clip's one shared keyframe list becomes its per-property channels (phase Ç2c.1, decision 3; report K8, D10)",
    run: (project) => {
      // The oldest files kept every clip's keys in one list (`keyframes`:
      // x, y, scale, rotation and maybe opacity per key), read through
      // `channelKfs` and migrated by the first edit that thought to. Each
      // channel now takes what was drawn for it: its own keys when it had
      // them, else the old list's (opacity only when a key had one; then a
      // key without it held the clip's opacity), with the ids the Keyframes
      // list showed (`<key id>-<channel>`). The old list goes. Nested
      // children too. A file without the list is left as it is (twice =
      // once).
      const walk = (list: unknown[]): void => {
        for (const c of list) {
          if (!c || typeof c !== 'object') continue
          const clip = c as Record<string, unknown> & { channels?: Record<string, unknown>; opacity?: unknown; nested?: { clips?: unknown } }
          if (clip.nested && Array.isArray(clip.nested.clips)) walk(clip.nested.clips)
          if (!('keyframes' in clip)) continue
          const legacy = Array.isArray(clip.keyframes) ? (clip.keyframes as Record<string, unknown>[]).filter((k) => k && typeof k === 'object') : []
          delete clip.keyframes
          if (legacy.length === 0) continue
          const own = clip.channels && typeof clip.channels === 'object' ? clip.channels : undefined
          const channels: Record<string, unknown[]> = {}
          const hasOpacity = legacy.some((k) => k.opacity !== undefined)
          for (const ch of ['x', 'y', 'scale', 'rotation', 'opacity']) {
            const mine = own?.[ch]
            if (Array.isArray(mine) && mine.length > 0) {
              channels[ch] = mine
              continue
            }
            if (ch === 'opacity' && !hasOpacity) continue
            channels[ch] = legacy.map((k) => ({
              id: `${k.id}-${ch}`,
              time: k.time,
              value: ch === 'opacity' ? (k.opacity ?? clip.opacity ?? 1) : k[ch],
              ...(k.easing !== undefined ? { easing: k.easing } : {})
            }))
          }
          clip.channels = channels
        }
      }
      walk(Object.values(project.clips ?? {}))
    }
  },
  {
    to: 6,
    what: 'a frame rate is its exact value: 29.97 is 30000/1001, 23.976 is 24000/1001, 59.94 is 60000/1001 (phase Ç3a, decision 4)',
    run: (project) => {
      // The project and the export offer the NTSC rates now, kept as their
      // exact value and timed as fractions (timeline/rates.ts). A rate
      // written as a decimal (29.97, by hand or by an agent) meant that one:
      // it is snapped to it. Whole rates and any other stay as they are, and
      // a snapped one snaps to itself (twice = once).
      const s = project.settings as { fps?: unknown } | undefined
      if (s && typeof s.fps === 'number') s.fps = snapFps(s.fps)
    }
  },
  {
    to: 7,
    what: 'a transition with no sound of its own written is silent; an older file wrote none for "the full sound" (DENEME-3, V item 2)',
    run: (project) => {
      // A transition used to sound unless told not to (`sfx` unset = 1),
      // so every dissolve came with a breath and every slide with a swish
      // the user never asked for. Unset is silent now; the transitions of an
      // older file keep the sound they had: theirs is written in as 1.
      // Nested clips too. A transition that says anything is left as it is
      // (twice = once).
      const walk = (list: unknown[]): void => {
        for (const c of list) {
          if (!c || typeof c !== 'object') continue
          const clip = c as { transitionOut?: unknown; nested?: { clips?: unknown } }
          if (clip.nested && Array.isArray(clip.nested.clips)) walk(clip.nested.clips)
          const tr = clip.transitionOut as { sfx?: unknown } | undefined
          if (tr && typeof tr === 'object' && tr.sfx === undefined) tr.sfx = 1
        }
      }
      walk(Object.values(project.clips ?? {}))
    }
  },
  {
    to: 8,
    what: 'a clip may carry a user lock against agents (agentLock); an older file has none, so there is nothing to convert (KAPSAM-AJAN-PLAN.md)',
    run: () => {
      // (No lock in an older file is no lock: nothing to do, twice = once.
      // A build older than this one opens a format-8 file as a newer one
      // and does not know the lock.)
    }
  }
]

/** The format a file's project says it has (1 when it says nothing). */
export function formatOf(raw: Record<string, unknown>): number {
  const v = raw.formatVersion
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : 1
}

/** Runs the conversions above `from`, in order; `between` (the open's
 *  normalising and repair) runs before those marked `afterRepair`. The
 *  project then carries no `formatVersion` (the file writes it:
 *  media/projectio.ts serializeProject). */
export function convertProject(project: Project, from: number, between?: () => void): string[] {
  const done: string[] = []
  const pass = (after: boolean): void => {
    for (const c of CONVERSIONS) {
      if (c.to <= from || !!c.afterRepair !== after) continue
      c.run(project)
      done.push(c.what)
    }
  }
  pass(false)
  between?.()
  pass(true)
  delete (project as unknown as Record<string, unknown>).formatVersion
  return done
}
