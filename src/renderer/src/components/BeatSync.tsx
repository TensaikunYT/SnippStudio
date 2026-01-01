// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import { useMemo, useState } from 'react'
import { analyzeBeats, cutOnBeats, transitionsOnBeats } from '../audio/beats'
import { useStore } from '../state/store'
import { assetById, uid } from '../types'
import { Button, Field, Section, Segmented, Select, Tooltip, notify, t as tr, useT } from '../ui'

/** How many beats apart the cuts fall. */
const EVERY = ['1', '2', '4', '8'] as const

/**
 * Cutting to the music: find the beat of a music clip, then cut a track's
 * pictures on it (every so many beats) or move every transition onto the
 * nearest beat. All from the sound itself, on this machine.
 */
export function BeatSync(): JSX.Element {
  // The folding section since phase 3c.3, the rest of the panel since 3c.4: the building blocks.
  const say = useT()
  const project = useStore((s) => s.project)
  const music = useMemo(
    () =>
      Object.values(project.clips)
        .filter((c) => assetById(project, c.assetId)?.kind === 'audio')
        .sort((a, b) => b.duration - a.duration),
    [project]
  )
  const videoTracks = project.tracks.filter((t) => t.kind === 'video')
  const [clipId, setClipId] = useState<string>('')
  const chosen = clipId && project.clips[clipId] ? clipId : music[0]?.id ?? ''
  const [found, setFound] = useState<{ clip: string; bpm: number; beats: number[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const [every, setEvery] = useState(2)
  const [track, setTrack] = useState('')
  const target = track || videoTracks[0]?.id || ''
  const beats = found && found.clip === chosen ? found.beats : null

  const find = async (): Promise<void> => {
    if (!chosen) return
    setBusy(true)
    try {
      const r = await analyzeBeats(useStore.getState().project, chosen)
      if (!r || r.beats.length < 4) notify({ text: tr('win.beat.none') })
      else setFound({ clip: chosen, bpm: r.bpm, beats: r.beats })
    } finally {
      setBusy(false)
    }
  }
  const edit = (fn: Parameters<ReturnType<typeof useStore.getState>['editTemplates']>[0]): void => useStore.getState().editTemplates(fn)

  return (
    <Section id="Beat sync" icon="eighth-notes" title={say('insp.beat.title')}>
      {music.length === 0 ? (
        <p className="win-hint">{say('win.beat.noMusic')}</p>
      ) : (
        <div className="beat-panel">
          <Field label={say('win.beat.music')}>
            <Select
              value={chosen}
              onChange={setClipId}
              options={music.map((c) => ({ value: c.id, label: say('win.beat.musicItem', { name: assetById(project, c.assetId)?.name ?? say('win.beat.audio'), s: c.duration.toFixed(0) }) }))}
            />
          </Field>
          <Button variant="secondary" icon="eighth-notes" className="grow" disabled={busy} onClick={() => void find()}>
            {busy ? say('win.beat.listening') : beats ? say('win.beat.again', { bpm: Math.round(found!.bpm), n: beats.length }) : say('win.beat.find')}
          </Button>
          {beats && (
            <>
              <Field label={say('win.beat.cut')}>
                <Select value={target} onChange={setTrack} options={videoTracks.map((t) => ({ value: t.id, label: t.name }))} />
              </Field>
              <Field label={say('win.beat.every')}>
                <Segmented
                  value={String(every) as (typeof EVERY)[number]}
                  onChange={(v) => setEvery(Number(v))}
                  label={say('win.beat.every')}
                  options={EVERY.map((k) => ({ value: k, label: say(k === '1' ? 'win.beat.beatOne' : 'win.beat.beatMany', { n: k }) }))}
                />
              </Field>
              <div className="beat-row">
                <Button
                  icon="scissors"
                  className="grow"
                  onClick={() => {
                    let n = 0
                    edit((p) => {
                      n = cutOnBeats(p, target, beats, every)
                    })
                    notify({ text: n ? tr('win.beat.cutDone', { n }) : tr('win.beat.cutNone') })
                  }}
                >
                  {say('win.beat.cutOn')}
                </Button>
                <Button
                  icon="arrow-left-right"
                  className="grow"
                  onClick={() => {
                    let n = 0
                    edit((p) => {
                      n = transitionsOnBeats(p, beats)
                    })
                    notify({ text: n ? tr('win.beat.transDone', { n }) : tr('win.beat.transNone') })
                  }}
                >
                  {say('win.beat.trans')}
                </Button>
              </div>
              <Tooltip content={say('win.beat.bars.hint')}>
                <Button
                  icon="diamond"
                  className="beat-bars"
                  onClick={() =>
                    edit((p) => {
                      p.markers = [...(p.markers ?? []).filter((m) => m.label !== 'beat'), ...beats.filter((_, i) => i % 4 === 0).map((t) => ({ id: uid(), time: t, color: '#ffd23f', note: '', label: 'beat' }))]
                    })
                  }
                >
                  {say('win.beat.bars')}
                </Button>
              </Tooltip>
            </>
          )}
          <p className="win-hint">{say('win.beat.how')}</p>
        </div>
      )}
    </Section>
  )
}
