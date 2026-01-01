// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// A voice-over take from the press to the clip (REF-AB, worker S, item 8;
// REF-AB-PLAN-S.md): the microphone opened on the Record press, the
// countdown, the timeline rolling from the playhead while the voice is taken
// (silent unless the user chose to hear it), then the WAV written beside the
// project and put on a new audio track where the take started: the import,
// the track and the clip are one undo step.
import { create } from 'zustand'
import { api } from '../platform'
import { engine } from '../playback/engine'
import { useStore } from '../state/store'
import { importWrittenFiles } from '../media/import'
import { notify, t } from '../ui'
import { listMics, MicOpenError, MicSession, type Mic } from './recorder'
import { useVoiceover } from './voiceover-store'
import { VOICEOVER_RATE, wavOfChunks } from './voiceover'

export type TakePhase = 'idle' | 'opening' | 'countdown' | 'recording' | 'saving'

interface TakeState {
  phase: TakePhase
  /** The countdown's number. */
  count: number
  /** Seconds taken so far. */
  seconds: number
  /** The meter (0..1 peak of the last block). */
  peak: number
  /** The microphones (their names once one was allowed). */
  mics: Mic[]
  /** The microphone the take is made with. */
  using: string
}

export const useTake = create<TakeState>(() => ({ phase: 'idle', count: 0, seconds: 0, peak: 0, mics: [], using: '' }))

let session: MicSession | null = null
let cancelCountdown: (() => void) | null = null
let timer = 0
let unmute: (() => void) | null = null
let startAt = 0

/** The list of microphones again (after a permission, a device plugged in). */
export async function refreshMics(): Promise<void> {
  useTake.setState({ mics: await listMics() })
}

/** The preview's sound off the speakers (it still drives the meter): the
 *  voice is taken while the timeline plays, and the speakers would be heard
 *  in the microphone. Returns the way back. */
function muteMonitor(): () => void {
  const an = engine.getAnalyser()
  if (!an) return () => {}
  try {
    an.disconnect()
  } catch {
    return () => {}
  }
  return () => {
    try {
      an.connect(an.context.destination)
    } catch {
      /* the graph is gone */
    }
  }
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Until the playhead rolls (playback primes its media first): the voice
 *  starts with what is seen. At most 1.5 s. */
async function rolling(from: number): Promise<void> {
  const until = performance.now() + 1500
  while (performance.now() < until) {
    const s = useStore.getState()
    if (!s.playing || Math.abs(s.currentTime - from) > 1e-4) return
    await new Promise((r) => requestAnimationFrame(() => r(undefined)))
  }
}

function closeSession(): void {
  window.clearInterval(timer)
  timer = 0
  session?.close()
  session = null
  unmute?.()
  unmute = null
}

const micErrorText = (why: string): string => t(`vo.err.${why}` as Parameters<typeof t>[0])

/** Record pressed: the microphone, the countdown, the take. */
export async function startTake(): Promise<void> {
  const take = useTake.getState()
  if (take.phase !== 'idle') return
  if (!api?.voiceover) {
    notify({ text: t('vo.desktopOnly'), kind: 'error' })
    return
  }
  const st = useStore.getState()
  st.setPlaying(false)
  useTake.setState({ phase: 'opening', seconds: 0, peak: 0 })
  try {
    session = await MicSession.open(useVoiceover.getState().deviceId)
  } catch (err) {
    useTake.setState({ phase: 'idle' })
    notify({ text: micErrorText(err instanceof MicOpenError ? err.why : 'failed'), kind: 'error' })
    return
  }
  session.onLevel = (peak) => useTake.setState({ peak })
  session.onFull = () => void stopTake()
  useTake.setState({ using: session.label })
  void refreshMics()

  // The countdown (Stop during it takes nothing).
  const n = useVoiceover.getState().countdown
  let cancelled = false
  cancelCountdown = () => {
    cancelled = true
  }
  for (let i = n; i > 0 && !cancelled; i--) {
    useTake.setState({ phase: 'countdown', count: i })
    for (let k = 0; k < 10 && !cancelled; k++) await wait(100)
  }
  cancelCountdown = null
  if (cancelled || !session) {
    closeSession()
    useTake.setState({ phase: 'idle', count: 0, peak: 0 })
    return
  }

  // The take: from the playhead, with the timeline rolling.
  const from = useStore.getState().currentTime
  if (!useVoiceover.getState().hearTimeline) unmute = muteMonitor()
  useTake.setState({ phase: 'recording', count: 0, seconds: 0 })
  useStore.getState().setPlaying(true)
  await rolling(from)
  if (!session) return
  startAt = useStore.getState().currentTime
  session.start()
  timer = window.setInterval(() => useTake.setState({ seconds: session?.seconds ?? 0 }), 200)
}

/** Stop pressed (or the take is full): written, imported, placed. */
export async function stopTake(): Promise<void> {
  const { phase } = useTake.getState()
  if (phase === 'countdown' || phase === 'opening') {
    cancelCountdown?.()
    return
  }
  if (phase !== 'recording' || !session) return
  useTake.setState({ phase: 'saving' })
  const taken = await session.stop()
  closeSession()
  const st = useStore.getState()
  st.setPlaying(false)
  try {
    if (taken.frames < VOICEOVER_RATE * 0.3) {
      notify({ text: t('vo.tooShort'), kind: 'error' })
      st.setTime(startAt)
      return
    }
    const written = await api!.voiceover!.write(wavOfChunks(taken.chunks, taken.rate))
    if (!written) throw new Error(t('vo.err.write'))
    const imported = await importWrittenFiles([written])
    const asset = imported.assets[0]
    if (!asset) throw new Error(imported.errors.join(' · ') || t('vo.err.write'))
    const placed = useStore.getState().addClipsAt([asset.id], null, startAt, { assets: [asset], newTrack: 'audio' })
    useStore.getState().setTime(startAt)
    if (placed.clipIds.length) useStore.getState().selectClips(placed.clipIds)
    notify({ text: written.inProject ? t('vo.saved', { name: written.name }) : t('vo.savedProfile', { name: written.name }) })
  } catch (err) {
    notify({ text: t('vo.err.save', { error: err instanceof Error ? err.message : String(err) }), kind: 'error' })
  } finally {
    useTake.setState({ phase: 'idle', seconds: 0, peak: 0 })
  }
}

/** The page left (another category, the window closing): a take in progress
 *  is stopped and kept; a countdown is dropped. */
export function leaveTake(): void {
  const { phase } = useTake.getState()
  if (phase === 'recording') void stopTake()
  else if (phase === 'countdown' || phase === 'opening') cancelCountdown?.()
}
