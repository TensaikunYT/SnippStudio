// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The command box's ready commands (SnippStudio phase 4B.2): done here, by
// the app's own local analyses and commands (phase 4A), with no agent and no
// tool call: zero tokens. Their result comes as a DRAFT, the same card and
// the same accept as the agent's (one undo step). Making subtitles writes the
// live project as the subtitle button does (phase 4A K6: the subtitles are
// the user's material, not a decision to review).
import { useStore } from '../state/store'
import { carriesAudio } from '../audio/silence'
import { speechBeds } from '../audio/silence-scope'
import { analyze, chosenItems, type AnalysisResult, type AnalyzeKind } from './analyze'
import { currentDraft, view } from './drafts'
import { runEdit } from './edit'
import { ensureRestorePoint } from './restore'
import type { ReadyId } from './command'

/** The session and program name the ready commands' draft is made under. */
export const LOCAL_SESSION = 'local'
export const LOCAL_CLIENT = 'snipp-ready'

/** What the YouTube-style target is (the clip panel's default too). */
export const LOUDNESS_TARGET = -14

export type ReadyOutcome =
  | { kind: 'drafted'; what: ReadyId; skipped?: number }
  | { kind: 'none'; what: ReadyId }
  | { kind: 'busy' }
  | { kind: 'transcribe' }
  | { kind: 'failed'; error: string }

const KIND: Partial<Record<ReadyId, AnalyzeKind>> = { silences: 'silences', repeats: 'repeats', fillers: 'fillers', images: 'image_plan' }

/** Another program's draft waits: the user decides on it first. */
const othersDraft = (): boolean => {
  const d = currentDraft()
  return !!d && d.session !== LOCAL_SESSION
}

const ctx = (results: Map<string, AnalysisResult>) => ({
  session: LOCAL_SESSION,
  client: LOCAL_CLIENT,
  results,
  beforeFirstEdit: async () => void (await ensureRestorePoint(LOCAL_SESSION)),
  told: () => undefined,
  draft: true,
  alive: () => true
})

let seq = 0

/** Runs one ready command. Nothing here sends anything anywhere. */
export async function runReady(id: ReadyId): Promise<ReadyOutcome> {
  if (id === 'subtitles') return { kind: 'transcribe' }
  if (othersDraft()) return { kind: 'busy' }
  try {
    const v = view(undefined, LOCAL_CLIENT)
    if (id === 'loudness') {
      const { measureClip, correctionFor } = await import('../audio/normalize')
      const ops: Record<string, unknown>[] = []
      // The voice, not the music bed or the sound effects: those keep their
      // own level under it (phase 11b, C19: the bed came up to -14 LUFS too).
      const beds = new Set(await speechBeds(v.project))
      const sfx = new Set(v.project.tracks.filter((t) => t.role === 'sfx').map((t) => t.id))
      const sounding = Object.values(v.project.clips).filter((c) => carriesAudio(v.project, c) && !beds.has(c.trackId) && !sfx.has(c.trackId)).sort((a, b) => a.start - b.start)
      // (Past the first 40 the rest are left as they are: said, not silently.)
      const skipped = Math.max(0, sounding.length - 40)
      for (const clip of sounding.slice(0, 40)) {
        const r = await measureClip(v.project, clip.id)
        if (!Number.isFinite(r.lufs)) continue
        const volume = Math.round(correctionFor(r, LOUDNESS_TARGET, clip.volume ?? 1) * 1000) / 1000
        if (Math.abs(volume - (clip.volume ?? 1)) >= 0.02) ops.push({ op: 'clip.setVolume', clipId: clip.id, volume })
      }
      if (!ops.length) return { kind: 'none', what: id }
      const done = await runEdit({ ops, base: v.token }, ctx(new Map()))
      return done.outcomes.some((o) => o.applied) ? { kind: 'drafted', what: id, ...(skipped ? { skipped } : {}) } : { kind: 'none', what: id }
    }
    const kind = KIND[id]!
    const rid = `local${++seq}`
    const r = await analyze(v.project, { kind }, rid, v.token)
    r.live = useStore.getState().projectVersion
    // (Uncertain items stay out, as a plain apply leaves them: the user
    // reads them in the card's reasons, an agent reads them in its answer.)
    if (!r.apply || chosenItems(r).length === 0) return { kind: 'none', what: id }
    const done = await runEdit({ ops: [{ op: 'apply', result: rid }], base: v.token }, ctx(new Map([[rid, r]])))
    return done.outcomes.some((o) => o.applied) ? { kind: 'drafted', what: id } : { kind: 'none', what: id }
  } catch (e) {
    return { kind: 'failed', error: e instanceof Error ? e.message : String(e) }
  }
}
