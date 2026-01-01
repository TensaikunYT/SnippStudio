// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import { useEffect, useRef, useState } from 'react'
import { projectAudioMono } from '../export/audio'
import { useStore } from '../state/store'
import { linkedWordTileEnd } from '../subtitles/timing'
import type { Caption } from '../types'
import { Button, Tooltip, useT } from '../ui'
import { BareButton } from '../ui/Button'

const BARS = 160

function waveformPeaks(samples: Float32Array): number[] {
  if (!samples.length) return []
  const size = Math.max(1, Math.ceil(samples.length / BARS))
  const peaks = Array.from({ length: BARS }, (_, bar) => {
    let peak = 0
    const end = Math.min(samples.length, (bar + 1) * size)
    for (let at = bar * size; at < end; at += 4) peak = Math.max(peak, Math.abs(samples[at]))
    return peak
  })
  const ceiling = Math.max(0.001, ...peaks)
  return peaks.map((peak) => Math.max(0.05, Math.sqrt(peak / ceiling)))
}

function clock(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  return `${mins}:${(seconds % 60).toFixed(2).padStart(5, '0')}`
}

/** Compact visual karaoke editor. Each word has independent start and end
 * anchors, so a real pause remains visible and moving one edge never ripples. */
export function WordTimingEditor({
  caption, onSelectWord, onSplitAfter
}: {
  caption: Caption
  onSelectWord?: (index: number) => void
  onSplitAfter?: (index: number) => void
}): JSX.Element {
  const tr = useT()
  const words = caption.words ?? []
  const currentTime = useStore((state) => state.currentTime)
  const playing = useStore((state) => state.playing)
  const [peaks, setPeaks] = useState<number[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  const [auditioning, setAuditioning] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const stripRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ index: number; edge: 'start' | 'end' } | null>(null)
  const scrubbingRef = useRef(false)
  const dragOriginRef = useRef(0)
  const dragMovedRef = useRef(false)
  const auditionRef = useRef(false)
  const duration = Math.max(0.05, caption.end - caption.start)
  const minWidth = Math.max(620, words.length * 66)
  const selectWord = (index: number): void => {
    setSelected(index)
    onSelectWord?.(index)
  }

  // Opening the lower editor moves keyboard focus away from the text area.
  // Clicking the text explicitly gives it back for normal typing.
  useEffect(() => { rootRef.current?.focus({ preventScroll: true }) }, [])

  useEffect(() => {
    let alive = true
    const project = useStore.getState().project
    void projectAudioMono(project, 16000, undefined, [caption.start, caption.end])
      .then((audio) => { if (alive) setPeaks(waveformPeaks(audio)) })
      .catch(() => { if (alive) setPeaks([]) })
    return () => { alive = false }
  }, [caption.id, caption.start, caption.end])

  useEffect(() => {
    if (!auditioning || currentTime < caption.end - 0.01) return
    auditionRef.current = false
    setAuditioning(false)
    useStore.getState().setPlaying(false)
  }, [auditioning, currentTime, caption.end])
  useEffect(() => () => {
    if (auditionRef.current) useStore.getState().setPlaying(false)
  }, [])

  useEffect(() => {
    if (!auditioning) return
    const strip = stripRef.current
    const scroller = scrollRef.current
    if (!strip || !scroller) return
    const x = Math.min(1, Math.max(0, (currentTime - caption.start) / duration)) * strip.clientWidth
    const left = scroller.scrollLeft
    if (x < left + 24 || x > left + scroller.clientWidth - 24) {
      scroller.scrollLeft = Math.max(0, x - scroller.clientWidth * 0.4)
    }
  }, [auditioning, currentTime, caption.start, duration])

  const timeAt = (clientX: number): number => {
    const rect = stripRef.current?.getBoundingClientRect()
    if (!rect) return caption.start
    return caption.start + Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * duration
  }
  const move = (clientX: number): void => {
    const drag = dragRef.current
    if (!drag) return
    const time = timeAt(clientX)
    const store = useStore.getState()
    if (auditionRef.current) {
      auditionRef.current = false
      setAuditioning(false)
      store.setPlaying(false)
    }
    if (drag.edge === 'start') store.setCaptionWordStart(caption.id, drag.index, time)
    else store.setCaptionWordEnd(caption.id, drag.index, time)
    const actualWord = useStore.getState().project.captions.find((item) => item.id === caption.id)?.words?.[drag.index]
    const actual = (drag.edge === 'start' ? actualWord?.start : actualWord?.end) ?? time
    store.setTime(Math.min(caption.end - 0.001, actual))
  }
  const stop = (): void => {
    if (!dragRef.current) return
    dragRef.current = null
    dragMovedRef.current = false
    useStore.getState().endGesture()
  }
  const scrub = (clientX: number): void => {
    const store = useStore.getState()
    if (auditionRef.current) {
      auditionRef.current = false
      setAuditioning(false)
    }
    store.setPlaying(false)
    store.setTime(Math.max(caption.start, Math.min(caption.end - 0.001, timeAt(clientX))))
  }
  const togglePlayback = (): void => {
    const store = useStore.getState()
    if (store.playing) {
      auditionRef.current = false
      setAuditioning(false)
      store.setPlaying(false)
      return
    }
    if (store.currentTime < caption.start || store.currentTime >= caption.end - 0.01) store.setTime(caption.start)
    auditionRef.current = true
    setAuditioning(true)
    store.setPlaying(true)
  }

  return (
    <div
      className="word-timing-editor"
      ref={rootRef}
      tabIndex={0}
      onPointerDownCapture={() => rootRef.current?.focus({ preventScroll: true })}
      onKeyDown={(event) => {
        if (event.code !== 'Space' || event.ctrlKey || event.altKey || event.metaKey) return
        event.preventDefault()
        event.stopPropagation()
        if (event.repeat) return
        togglePlayback()
      }}
    >
      <div className="word-timing-heading">
        <span>{tr('wordtiming.title')}</span>
        <span>{tr('wordtiming.help')}</span>
        <span className="word-timing-clock">{clock(currentTime)}</span>
        <Tooltip content={tr('wordtiming.play.hint')}>
          <Button variant="secondary" size="sm" icon={playing && auditioning ? 'pause' : 'play'} onPointerDown={(event) => event.preventDefault()} onClick={togglePlayback}>
            {playing && auditioning ? tr('wordtiming.pause') : tr('wordtiming.play')}
          </Button>
        </Tooltip>
      </div>
      <div className="word-timing-scroll" ref={scrollRef}>
        <div
          className="word-timing-strip"
          ref={stripRef}
          style={{ minWidth }}
          onPointerDown={(event) => event.preventDefault()}
          onClick={(event) => { if (dragRef.current === null) useStore.getState().setTime(timeAt(event.clientX)) }}
        >
          <div
            className="word-timing-ruler"
            title={tr('wordtiming.scrub.hint')}
            onPointerDown={(event) => {
              event.stopPropagation()
              event.preventDefault()
              scrubbingRef.current = true
              event.currentTarget.setPointerCapture(event.pointerId)
              scrub(event.clientX)
            }}
            onPointerMove={(event) => { if (scrubbingRef.current) scrub(event.clientX) }}
            onPointerUp={() => { scrubbingRef.current = false }}
            onPointerCancel={() => { scrubbingRef.current = false }}
            onLostPointerCapture={() => { scrubbingRef.current = false }}
            onClick={(event) => event.stopPropagation()}
          >
            <span className="word-timing-ruler-label">{tr('wordtiming.scrub')}</span>
          </div>
          <div className="word-timing-waveform" aria-hidden="true">
            {peaks.map((peak, index) => (
              <span key={index} style={{ left: `${(index / BARS) * 100}%`, height: `${peak * 100}%` }} />
            ))}
          </div>
          {words.map((word, index) => {
            const nextStart = linkedWordTileEnd(words, index, caption.end)
            const left = Math.min(100, Math.max(0, ((word.start - caption.start) / duration) * 100))
            // Keep the editor's word tiles joined like a continuous timeline.
            // The gold end handle may sit inside a tile, but shortening an end
            // must not make the next word look detached or harder to grab.
            const right = Math.min(100, Math.max(left, ((nextStart - caption.start) / duration) * 100))
            const active = currentTime >= word.start && currentTime < nextStart
            return (
              <div
                key={index}
                className={`word-timing-segment${active ? ' active' : ''}${selected === index ? ' selected' : ''}`}
                style={{ left: `${left}%`, width: `${right - left}%` }}
                title={`${word.text} · ${clock(word.start)}–${clock(word.end)}`}
                onClick={(event) => {
                  event.stopPropagation()
                  selectWord(index)
                  useStore.getState().setTime(word.start)
                }}
              >
                <span>{word.text}</span>
              </div>
            )
          })}
          {words.flatMap((word, index) => (['start', 'end'] as const).map((edge) => {
            const value = edge === 'start' ? word.start : word.end
            const left = Math.min(100, Math.max(0, ((value - caption.start) / duration) * 100))
            return <BareButton
              key={`${index}-${edge}`}
              type="button"
              className={`word-timing-handle ${edge}${selected === index ? ' selected' : ''}${left >= 99.5 ? ' at-right' : left <= 0.5 ? ' at-left' : ''}`}
              style={{ left: `${left}%` }}
              aria-label={edge === 'start' ? tr('wordtiming.edge.start', { word: word.text }) : tr('wordtiming.edge.end', { word: word.text })}
              title={`${edge === 'start' ? tr('wordtiming.edge.start', { word: word.text }) : tr('wordtiming.edge.end', { word: word.text })} · ${clock(value)}`}
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => {
                event.stopPropagation()
                event.preventDefault()
                dragRef.current = { index, edge }
                dragOriginRef.current = event.clientX
                dragMovedRef.current = false
                selectWord(index)
                useStore.getState().armGesture()
                event.currentTarget.setPointerCapture(event.pointerId)
              }}
              onPointerMove={(event) => {
                if (dragRef.current?.index !== index || dragRef.current.edge !== edge) return
                if (Math.abs(event.clientX - dragOriginRef.current) > 2) dragMovedRef.current = true
                if (dragMovedRef.current) move(event.clientX)
              }}
              onPointerUp={(event) => {
                if (dragRef.current?.index === index && dragRef.current.edge === edge) {
                  if (dragMovedRef.current) move(event.clientX)
                  else useStore.getState().setTime(Math.min(caption.end - 0.001, value))
                }
                stop()
              }}
              onPointerCancel={stop}
              onLostPointerCapture={stop}
              onKeyDown={(event) => {
                if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
                event.preventDefault()
                const delta = (event.shiftKey ? 0.1 : 0.02) * (event.key === 'ArrowRight' ? 1 : -1)
                const store = useStore.getState()
                if (edge === 'start') store.setCaptionWordStart(caption.id, index, value + delta)
                else store.setCaptionWordEnd(caption.id, index, value + delta)
                const updated = useStore.getState().project.captions.find((item) => item.id === caption.id)?.words?.[index]
                useStore.getState().setTime(Math.min(caption.end - 0.001, (edge === 'start' ? updated?.start : updated?.end) ?? value))
              }}
            />
          }))}
          <div className="word-timing-playhead" style={{ left: `${Math.min(100, Math.max(0, ((currentTime - caption.start) / duration) * 100))}%` }} />
        </div>
      </div>
      <div className="word-timing-footer">
        <span>{clock(caption.start)}</span>
        <span>{selected === null ? tr('wordtiming.legend') : `“${words[selected]?.text ?? ''}” ${clock(words[selected]?.start ?? caption.start)}–${clock(words[selected]?.end ?? caption.end)}`}</span>
        {selected !== null && selected < words.length - 1 && onSplitAfter && <Tooltip content={tr('capedit.splitWord.hint')}><Button variant="secondary" size="sm" onPointerDown={(event) => event.preventDefault()} onClick={() => onSplitAfter(selected)}>{tr('capedit.splitWord')}</Button></Tooltip>}
        <span>{clock(caption.end)}</span>
      </div>
    </div>
  )
}
