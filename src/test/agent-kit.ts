// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// What the agent tests share (SnippStudio phase 4A.9): a small talk, an edit
// context, and command calls put into the draft as an agent that just read
// the project would send them.
import { useStore } from '../renderer/src/state/store'
import { defaultProject, type Asset, type Clip, type Project } from '../renderer/src/types'
import type { CommandCall } from '../renderer/src/commands'
import { addToDraft, applyDirect, rejectDraft, view, type Added, type Outcome } from '../renderer/src/agent/drafts'
import { enter } from '../renderer/src/agent/replay'
import type { EditContext } from '../renderer/src/agent/edit'
import { useAgentStore } from '../renderer/src/agent/store'

const S = useStore.getState
const T0 = { x: 960, y: 540, scale: 1, rotation: 0 }

export const videoAsset = (id: string, duration = 60): Asset => ({ id, kind: 'video', name: `${id}.mp4`, url: `media://${id}`, size: 1, duration, width: 1920, height: 1080, hasAudio: true }) as Asset
export const clipOf = (id: string, assetId: string, trackId: string, start: number, inPoint: number, duration: number, extra: Partial<Clip> = {}): Clip =>
  ({ id, assetId, trackId, start, inPoint, duration, transform: { ...T0 }, volume: 1, ...extra }) as Clip

/** A talk: one clip c1 (source 0–`length`) on V1; with `lines`, two subtitle
 *  lines with word times (L1 "hello there friends" 1–3 s, L2 "we go on" 6–8 s). */
export function talk(length = 20, lines = false): Project {
  const p = defaultProject()
  p.name = 'Talk'
  p.assets = [videoAsset('a1')]
  const v1 = p.tracks[0]
  p.clips = { c1: clipOf('c1', 'a1', v1.id, 0, 0, length) }
  v1.clipIds = ['c1']
  if (lines) {
    p.captions = [
      { id: 'L1', start: 1, end: 3, text: 'hello there friends', words: [{ text: 'hello', start: 1, end: 1.5 }, { text: 'there', start: 1.6, end: 2.2 }, { text: 'friends', start: 2.3, end: 3 }], soundClip: 'c1' },
      { id: 'L2', start: 6, end: 8, text: 'we go on', words: [{ text: 'we', start: 6, end: 6.4 }, { text: 'go', start: 6.5, end: 7 }, { text: 'on', start: 7.1, end: 8 }], soundClip: 'c1' }
    ]
  }
  return p
}

export function open(p: Project, mode: 'draft' | 'direct' = 'draft'): void {
  rejectDraft()
  S().loadProject(p)
  useAgentStore.getState().setMode(mode)
}

export const ctxOf = (extra: Partial<EditContext> = {}): EditContext => ({ session: 's1', client: 'test', results: new Map(), beforeFirstEdit: async () => undefined, told: () => undefined, ...extra })

/** The version an agent reads now (kept for the client, as a read does). */
export const read = (client = 'test', state?: unknown): string => view(state, client).token

/** Calls into the draft, written on what the agent sees right now. */
export function draftCalls(session: string, client: string, calls: CommandCall[], alive?: (s: string) => boolean): Added {
  return addToDraft(session, client, (head, seq, seed, rc) => enter(head, { seq, seed, label: calls.map((c) => c.name).join(', '), at: 0, baseLive: S().projectVersion }, calls.map((call) => ({ call, base: head })), rc), alive)
}

/** Calls straight onto the timeline, written on the live project as it is. */
export function directCalls(client: string, calls: CommandCall[], session = 's1'): { outcomes: Outcome[]; applied: boolean } {
  return applyDirect(session, client, (head, seq, seed, rc) => enter(head, { seq, seed, label: '', at: 0, baseLive: S().projectVersion }, calls.map((call) => ({ call, base: head })), rc))
}

/** The source seconds the first video track still shows, in order. */
export function kept(p: Project): [number, number][] {
  const v1 = p.tracks.find((t) => t.kind === 'video')!
  return v1.clipIds
    .map((id) => p.clips[id])
    .filter(Boolean)
    .sort((a, b) => a.start - b.start)
    .map((c) => [+c.inPoint.toFixed(3), +(c.inPoint + c.duration * (c.speed ?? 1)).toFixed(3)] as [number, number])
}
/** How much of [a, b] (source seconds) is still shown. */
export const shown = (k: [number, number][], a: number, b: number): number => k.reduce((n, [x, y]) => n + Math.max(0, Math.min(b, y) - Math.max(a, x)), 0)
