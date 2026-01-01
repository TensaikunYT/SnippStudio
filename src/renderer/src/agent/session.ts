// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The agent connection as the page keeps it (SnippStudio phase 4B;
// TERMINAL-YOK-PLAN.md): agent access and how it stands (from the main
// process), what a ready command last did, the region drawn on the frame and
// the media picked in the media panel — the parts of "what the user points
// at" that are not the project's (an agent reads them in its `project`
// call). A small store of its own, written on events only (never per frame).
import { create } from 'zustand'
import type { AgentSessionStatus } from '../../../preload/index'
import { api } from '../platform'
import type { Selection } from './command'

export interface Sent {
  at: number
  /** Done here by a ready command. */
  local?: boolean
  /** Sent to the agent's inbox: the item's number (agent/inbox.ts). */
  inbox?: number
}

export interface SessionUi {
  status: AgentSessionStatus | null
  lastSent: Sent | null
  /** A region drawn on the preview frame (% of the frame: x, y, w, h). */
  region: [number, number, number, number] | null
  drawingRegion: boolean
  /** Media files picked in the media panel. */
  media: string[]
  /** Bumped when the media tag is removed: the media panel lets go of its picks. */
  mediaCleared: number
  busy: boolean
  setStatus: (s: AgentSessionStatus | null) => void
  setSent: (s: Sent | null) => void
  setRegion: (r: [number, number, number, number] | null) => void
  setDrawingRegion: (on: boolean) => void
  setMedia: (ids: string[]) => void
  clearMedia: () => void
  setBusy: (on: boolean) => void
}

export const useSession = create<SessionUi>((set) => ({
  status: null,
  lastSent: null,
  region: null,
  drawingRegion: false,
  media: [],
  mediaCleared: 0,
  busy: false,
  setStatus: (status) => set({ status }),
  setSent: (lastSent) => set({ lastSent }),
  setRegion: (region) => set({ region, drawingRegion: false }),
  setDrawingRegion: (drawingRegion) => set({ drawingRegion }),
  setMedia: (media) => set((s) => (s.media.length === media.length && s.media.every((m, i) => m === media[i]) ? {} : { media })),
  clearMedia: () => set((s) => ({ media: [], mediaCleared: s.mediaCleared + 1 })),
  setBusy: (busy) => set({ busy })
}))

/** What the user points at now: the selected clips, the marked range
 *  (two cut marks or more), the picked media, the region. */
export function currentSelection(clips: readonly string[], marks: readonly number[]): Selection {
  const s = useSession.getState()
  return {
    clips,
    media: s.media,
    range: marks.length >= 2 ? [Math.min(...marks), Math.max(...marks)] : null,
    region: s.region
  }
}

/** Asks the main process how the connection is (and keeps it). */
export async function refreshSession(): Promise<AgentSessionStatus | null> {
  const s = (await api?.agentSession?.status().catch(() => null)) ?? null
  useSession.getState().setStatus(s)
  return s
}

/** Agent access on or off (the agent server; nothing else starts). */
export async function connectAgent(on: boolean): Promise<AgentSessionStatus | null> {
  const ui = useSession.getState()
  ui.setBusy(true)
  try {
    const s = (await api?.agentSession?.connect(on).catch(() => null)) ?? null
    ui.setStatus(s)
    return s
  } finally {
    useSession.getState().setBusy(false)
  }
}

let listening = false
/** The connection's state as the main process reports it. */
export function listenSession(): void {
  if (listening || !api?.agentSession) return
  listening = true
  // (An agent from outside began or ended work: DIS-MCP-PLAN.md, 6.)
  api.agentSession.onChanged?.(() => void refreshSession())
  void refreshSession()
}

/** Is an agent working from outside now (access on, a session heard from)? */
export const agentConnected = (s: AgentSessionStatus | null): boolean => !!s?.server?.running && !!s.external
