// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../state/store'
import { modalOpen } from '../shortcuts'
// The words and the filler matching are pure modules (phase 4A): the agent's
// `analyze fillers` uses the same.
import { flattenWords, normalizeWord, type FlatWord } from '../analysis/words'
import { FILLER_DEFAULT, FILLER_DEFAULT_EN, FILLER_SHOWN_EN, fillerLanguage, fillerSet as makeFillerSet } from '../analysis/fillers'
import { fillerRows, pauseSlot, pauseTokens, repeatRows, slotRange, wordSlot, type ReviewRow } from '../analysis/transcript'
import { analyze } from '../agent/analyze'
import { cutPrefs, setKeepMusic } from '../audio/cut-prefs'
import { speechBeds } from '../audio/silence-scope'
import { captionsToVtt } from '../subtitles/srt'
import { safeFileName } from '../export/formats'
import { api, downloadBlob } from '../platform'
import { isSubtitle, type Project } from '../types'
import { Button, Checkbox, IconButton, TextField, Toggle, Tooltip, notify, t as tr, useT, type StringKey } from '../ui'
import { fmtTime as clock } from '../ui/format'
import { revealIn } from '../ui/reveal'

type WordRef = FlatWord

interface Paragraph {
  time: number
  words: { w: WordRef; idx: number }[]
}

const FILLER_KEY = 'snipp-filler-words'
/** Two presses this close in time (ms, Windows' default double-click time)
 *  and place (px) are a double click. */
const DOUBLE_MS = 500
const DOUBLE_PX = 4

// The one time form (ui/format.ts, audit G6).
const fmtTime = (t: number): string => clock(t)

const WHY: Record<NonNullable<ReviewRow['why']>, StringKey> = {
  mark: 'cs.script.why.mark',
  word: 'cs.script.why.word',
  quotes: 'cs.script.why.quotes',
  capital: 'cs.script.why.capital',
  answer: 'cs.script.why.answer',
  opens: 'cs.script.why.opens',
  goesOn: 'cs.script.why.goesOn',
  guessed: 'cs.script.why.guessed',
  island: 'cs.script.why.island',
  repeat: 'cs.script.why.repeat'
}

/** Is there a track that could be a music bed (commands/timeline.ts bedTracks)? */
const mayHaveBed = (tracks: Project['tracks']): boolean => tracks.some((x) => x.kind === 'audio' && !x.locked && x.role !== 'sfx' && x.clipIds.length > 0)

/** The tracks a cut made for the speech leaves alone, when "music is not
 *  cut" is on and the project has a track that could be one (çekirdek cila
 *  S, decision 12). No such track: nothing to wait for. */
function cutScope(project: Project, keepMusic: boolean): Promise<{ keepTracks: string[]; endBeds: boolean } | undefined> | undefined {
  if (!keepMusic) return undefined
  if (!mayHaveBed(project.tracks)) return undefined
  return speechBeds(project).then((keepTracks) => (keepTracks.length ? { keepTracks, endBeds: cutPrefs().endBeds } : undefined))
}

/**
 * Edit the video by editing its text. The transcript reads as paragraphs
 * (split at speech pauses) with timestamps; click a word to jump there,
 * double-click to select the whole sentence, drag or shift-click to extend,
 * search with the box (or Ctrl+F), and Delete ripple-cuts the selection out
 * of video, audio and subtitles at once.
 *
 * Çekirdek cila S: only the subtitles' words are shown (titles and text
 * layers are not speech); a pause of 0.6 s or more is a token between the
 * words that can be selected and cut down to a breath; fillers and repeats
 * are found by the agent's finders and come as a list to tick; a selection
 * can leave a marker or become a Shorts range; and a cut leaves the music
 * alone, as the silence cut does.
 */
export function TranscriptPanel(): JSX.Element {
  const t = useT()
  const captions = useStore((s) => s.project.captions)
  // ~5 Hz updates for the follow-along highlight instead of every frame.
  const timeBucket = useStore((s) => Math.floor(s.currentTime * 5))
  const currentTime = timeBucket / 5

  // Only what was SAID: a title, a lower third or a text layer is a graphic,
  // not a word of the talk (it used to be listed, and deleting it cut video).
  const words = useMemo<WordRef[]>(() => flattenWords(captions.filter(isSubtitle)), [captions])
  const pauses = useMemo(() => pauseTokens(words), [words])

  // Paragraphs: a new block whenever speech pauses for over ~1.5s.
  const paragraphs = useMemo<Paragraph[]>(() => {
    const paras: Paragraph[] = []
    let cur: Paragraph | null = null
    words.forEach((w, idx) => {
      const prev = idx > 0 ? words[idx - 1] : null
      if (!cur || (prev && w.start - prev.end > 1.5)) {
        cur = { time: w.start, words: [] }
        paras.push(cur)
      }
      cur.words.push({ w, idx })
    })
    return paras
  }, [words])

  // The selection, in slots: word i is slot 2i, the pause after it 2i+1
  // (analysis/transcript.ts).
  const [sel, setSel] = useState<[number, number] | null>(null)
  const [query, setQuery] = useState('')
  const [matchPos, setMatchPos] = useState(0)
  const [keepMusic, setKeep] = useState(() => cutPrefs().keepMusic)
  const hasBed = useStore((s) => mayHaveBed(s.project.tracks))
  const dragRef = useRef<{ anchor: number; moved: boolean } | null>(null)
  // The last press on the text: the second press of a double click is told by
  // its place and time, not by what is under it. The first click clears a live
  // selection, its bar above the words goes and the words move up before the
  // second press comes: the browser's dblclick then lands on whatever is there
  // now (another word, or the gap between two lines) and nothing was selected.
  const pressRef = useRef<{ slot: number | null; x: number; y: number; t: number; dbl: boolean } | null>(null)
  const activeRef = useRef<HTMLSpanElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const range = useMemo(() => (sel ? slotRange(words, pauses, sel) : null), [sel, words, pauses])

  const q = query.trim().toLowerCase()
  const matches = useMemo(() => {
    if (!q) return []
    return words.map((w, i) => ({ w, i })).filter(({ w }) => w.text.toLowerCase().includes(q)).map(({ i }) => i)
  }, [q, words])

  // Ctrl+F focuses the transcript search while this panel is on screen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && rootRef.current?.isConnected) {
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Delete/Backspace removes the transcript selection (when not typing).
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel && rootRef.current?.isConnected) {
        const target = e.target as HTMLElement | null
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return
        // Not behind a modal dialog (the editor's shortcuts wait too).
        if (modalOpen(document)) return
        e.preventDefault()
        // This press is the transcript's alone. The editor's own Delete also
        // listens on the window and used to run as well, deleting the selected
        // clips, captions or cut range in the same keystroke.
        e.stopImmediatePropagation()
        deleteSelection()
      }
    }
    // Capture phase: it runs before the editor's window listener, whichever
    // was registered first.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, words, keepMusic])

  useEffect(() => {
    if (useStore.getState().playing) revealIn(activeRef.current, 'nearest')
  }, [timeBucket])

  useEffect(() => setSel(null), [captions])

  // Show the selection on the TIMELINE while it is live: text-based editing is
  // only comfortable if you can see what the words map to before you cut them.
  useEffect(() => {
    const set = useStore.getState().setRangePreview
    if (!range) {
      set(null)
      return
    }
    set({ start: range.start, end: range.end, label: t('script.cutLabel', { s: (range.end - range.start).toFixed(1) }) })
    // Leaving a band behind after the panel closes would be a lie about a
    // pending edit, so it is cleared on unmount too.
    return () => useStore.getState().setRangePreview(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range])

  const jumpToMatch = (pos: number) => {
    if (matches.length === 0) return
    const idx = matches[((pos % matches.length) + matches.length) % matches.length]
    setMatchPos(pos)
    useStore.getState().setTime(words[idx].start)
    revealIn(document.querySelector(`[data-widx="${idx}"]`), 'center')
  }

  const selectSentence = (i: number) => {
    const ci = words[i].capIdx
    let a = i
    let b = i
    while (a > 0 && words[a - 1].capIdx === ci) a--
    while (b < words.length - 1 && words[b + 1].capIdx === ci) b++
    setSel([wordSlot(a), wordSlot(b)])
  }

  /** Ranges out of the timeline as one undo step: every unlocked track, but
   *  not the music while "music is not cut" is on (decision 12). */
  const cut = (ranges: [number, number][]): void => {
    const go = (scope?: { keepTracks: string[]; endBeds: boolean }): void => {
      if (ranges.length === 1) useStore.getState().rippleDelete(ranges[0][0], ranges[0][1], scope)
      else useStore.getState().rippleDeleteMany(ranges, scope)
    }
    // (The speech is found from the sound: the cut follows as soon as it is
    // known. Should the project change meanwhile, it is asked once more for
    // the project as it is; after that the cut is made as it always was.)
    const attempt = (left: number): void => {
      const project = useStore.getState().project
      const scope = cutScope(project, keepMusic)
      if (!scope) {
        go()
        return
      }
      // (The last time: the scope found for the project as it was then, not
      // none — with none the cut took the music too. Phase 11b, B19.)
      if (left === 0) {
        void scope.then((s) => go(s))
        return
      }
      void scope.then((s) => {
        if (useStore.getState().project === project) go(s)
        else attempt(left - 1)
      })
    }
    attempt(2)
  }

  const deleteSelection = () => {
    if (!range) return
    cut([[range.start, range.end]])
    setSel(null)
  }

  // -- fillers and repeats: found by the agent's finders, ticked here -------
  const [fillerList, setFillerList] = useState(() => localStorage.getItem(FILLER_KEY) ?? (useStore.getState().uiLang === 'tr' ? FILLER_DEFAULT : FILLER_SHOWN_EN))
  const [fillerEdit, setFillerEdit] = useState(false)
  const [review, setReview] = useState<{ kind: 'fillers' | 'repeats'; rows: ReviewRow[] | null } | null>(null)
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set())
  const reviewRun = useRef(0)
  // The words the user added to the list themselves (the sounds of the
  // default list are found by their shape, and may be doubted).
  const extraWords = useMemo(() => {
    const known = makeFillerSet(FILLER_DEFAULT_EN)
    return [...makeFillerSet(fillerList)].filter((w) => !known.has(w))
  }, [fillerList])

  const openReview = (kind: 'fillers' | 'repeats'): void => {
    const my = ++reviewRun.current
    setSel(null)
    setReview({ kind, rows: null })
    setTicked(new Set())
    const project = useStore.getState().project
    void analyze(project, kind === 'fillers' ? { kind, ...(extraWords.length ? { words: extraWords.join(',') } : {}) } : { kind }, 'panel', '')
      .then((r) => {
        if (my !== reviewRun.current) return
        const subs = project.captions.filter(isSubtitle)
        const all = flattenWords(subs)
        const rows =
          kind === 'fillers'
            ? fillerRows(r.items, all, fillerLanguage(project.transcription?.language, subs.map((c) => c.text).join(' '), project.transcription?.model), new Set(extraWords), normalizeWord)
            : repeatRows(r.items, all)
        setReview({ kind, rows })
        setTicked(new Set(rows.filter((x) => x.sure).map((x) => x.id)))
      })
      .catch(() => {
        if (my === reviewRun.current) setReview({ kind, rows: [] })
      })
  }
  const closeReview = (): void => {
    reviewRun.current++
    setReview(null)
    setFillerEdit(false)
  }
  // A finding belongs to the words it was made on.
  useEffect(() => {
    reviewRun.current++
    setReview(null)
  }, [captions])
  // The same list with other words of the user's: found again.
  useEffect(() => {
    if (review?.kind === 'fillers') openReview('fillers')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extraWords.join(',')])

  const tickedRows = review?.rows?.filter((r) => ticked.has(r.id)) ?? []
  const tickedSeconds = tickedRows.reduce((sum, r) => sum + (r.cut[1] - r.cut[0]), 0)
  const cutTicked = (): void => {
    if (tickedRows.length === 0) return
    cut(tickedRows.map((r) => r.cut))
    closeReview()
  }
  // The words a ticked finding takes are struck through in the text.
  const struck = useMemo(() => {
    const out = new Set<number>()
    if (tickedRows.length === 0) return out
    words.forEach((w, i) => {
      const mid = (w.start + w.end) / 2
      if (tickedRows.some((r) => mid >= r.cut[0] && mid <= r.cut[1])) out.add(i)
    })
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticked, review, words])

  // Play one finding: from a little before it to a little after.
  const playStop = useRef<number | null>(null)
  const stopWatch = (): void => {
    if (playStop.current !== null) window.clearInterval(playStop.current)
    playStop.current = null
  }
  useEffect(() => stopWatch, [])
  const playRow = (r: ReviewRow): void => {
    stopWatch()
    const s = useStore.getState()
    const end = r.cut[1] + 0.6
    s.setTime(Math.max(0, r.cut[0] - 0.6))
    s.setPlaying(true)
    playStop.current = window.setInterval(() => {
      const now = useStore.getState()
      if (!now.playing || now.currentTime >= end) {
        if (now.playing) now.setPlaying(false)
        stopWatch()
      }
    }, 50)
  }

  // -- from a selection: a marker, a Shorts range ----------------------------
  const selText = (): string => (range && range.firstWord >= 0 ? words.slice(range.firstWord, Math.min(range.lastWord, range.firstWord + 3) + 1).map((w) => w.text).join(' ') : '')
  const markSelection = (): void => {
    if (!range) return
    useStore.getState().markTimes([{ time: range.start, label: selText().slice(0, 80) }])
    notify({ text: tr('cs.script.marked', { t: fmtTime(range.start) }) })
  }
  const rangeSelection = (): void => {
    if (!range) return
    const s = useStore.getState()
    const name = selText()
    // One undo step: the range made, then set to the words picked.
    s.undoable(() => {
      const id = useStore.getState().addShortSegment()
      useStore.getState().updateShortSegment(id, { start: range.start, end: Math.max(range.end, range.start + 0.5), ...(name ? { name: name.slice(0, 60) } : {}) }, false)
    })
    notify({ text: tr('cs.script.ranged', { a: fmtTime(range.start), b: fmtTime(range.end) }) })
  }

  // -- the subtitles as a WebVTT file -----------------------------------------
  const saveVtt = async (): Promise<void> => {
    const project = useStore.getState().project
    const text = captionsToVtt(project.captions)
    if (!text) return
    const name = `${safeFileName(project.name, 'subtitles')}.vtt`
    const data = new TextEncoder().encode(text)
    try {
      if (api) {
        const path = await api.chooseSavePath({ defaultName: name, filterName: 'WebVTT subtitles', extensions: ['vtt'] })
        if (!path) return
        const result = await api.writeChosenFile(path, data)
        if (!result.saved) throw new Error(result.error ?? 'not saved')
      } else downloadBlob(new Blob([text], { type: 'text/vtt' }), name)
      notify({ text: tr('cs.script.vtt.saved', { name }) })
    } catch {
      notify({ text: tr('cs.script.vtt.failed'), kind: 'error' })
    }
  }

  const onDown = (slot: number) => (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    if (e.shiftKey && sel) {
      setSel([Math.min(sel[0], slot), Math.max(sel[1], slot)])
      return
    }
    dragRef.current = { anchor: slot, moved: false }
    const onUp = () => {
      const d = dragRef.current
      dragRef.current = null
      window.removeEventListener('pointerup', onUp)
      if (d && !d.moved) {
        if (d.anchor % 2 === 1) {
          // A click on a pause selects it (there is no word to jump to).
          setSel([d.anchor, d.anchor])
          useStore.getState().setTime(pauses.get((d.anchor - 1) / 2)?.start ?? 0)
          return
        }
        // Plain click: jump the playhead to the word.
        useStore.getState().setTime(words[d.anchor / 2]?.start ?? 0)
        setSel(null)
      }
    }
    window.addEventListener('pointerup', onUp)
  }

  /** Every press on the text, before the word's own (capture phase): a press
   *  where the last one was, and soon after, is the second of a double click
   *  and selects the sentence of the word the FIRST press was on. */
  const onTextPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || e.shiftKey) return
    const prev = pressRef.current
    const now = { x: e.clientX, y: e.clientY, t: e.timeStamp }
    if (prev && now.t - prev.t < DOUBLE_MS && Math.abs(now.x - prev.x) <= DOUBLE_PX && Math.abs(now.y - prev.y) <= DOUBLE_PX) {
      e.preventDefault()
      e.stopPropagation()
      dragRef.current = null
      pressRef.current = { ...prev, t: now.t, dbl: true }
      if (prev.slot !== null && prev.slot % 2 === 0) selectSentence(prev.slot / 2)
      return
    }
    const el = (e.target as HTMLElement).closest?.('[data-slot]') as HTMLElement | null
    const slot = el ? Number(el.dataset.slot) : NaN
    pressRef.current = { ...now, slot: Number.isNaN(slot) ? null : slot, dbl: false }
  }
  /** A double click slower than the above (the system's own setting): the
   *  sentence of the word pressed, as it always was. */
  const onTextDoubleClick = (e: React.MouseEvent) => {
    const p = pressRef.current
    if (!p || p.dbl || p.slot === null || p.slot % 2 !== 0) return
    e.preventDefault()
    selectSentence(p.slot / 2)
  }

  // Drag extension via elementFromPoint: robust even when the pointer moves
  // fast or crosses the gaps between words/paragraphs.
  const onTextPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-slot]') as HTMLElement | null
    if (!el) return
    const i = Number(el.dataset.slot)
    if (Number.isNaN(i)) return
    if (i !== d.anchor) d.moved = true
    if (d.moved) setSel([Math.min(d.anchor, i), Math.max(d.anchor, i)])
  }

  if (words.length === 0) {
    return (
      <div className="section">
        <h3>{t('script.title')}</h3>
        <div className="hint">{t('script.empty')}</div>
      </div>
    )
  }

  const selDur = range ? range.end - range.start : 0
  const inSel = (slot: number): boolean => sel !== null && slot >= Math.min(sel[0], sel[1]) && slot <= Math.max(sel[0], sel[1])
  return (
    <div ref={rootRef} className="transcript-root">
      <div className="transcript-tools">
        <TextField
          ref={searchRef}
          size="sm"
          testid="transcript.search"
          value={query}
          placeholder={t('script.search')}
          label={t('script.search.label')}
          onChange={(v) => {
            setQuery(v)
            setMatchPos(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') jumpToMatch(e.shiftKey ? matchPos - 1 : matchPos + 1)
            if (e.key === 'Escape') setQuery('')
          }}
        />
        {q && (
          <span className="transcript-matchinfo">
            {t(matches.length === 1 ? 'script.matches.one' : 'script.matches.many', { n: matches.length })}
            {matches.length > 0 && t('script.matches.next')}
          </span>
        )}
        {/* (Icons, on the search row: the panel is often only a few rows tall.) */}
        <IconButton size="sm" icon="eraser" label={t('cs.script.fillers.hint')} pressed={review?.kind === 'fillers'} testid="transcript.fillers" onClick={() => (review?.kind === 'fillers' ? closeReview() : openReview('fillers'))} />
        <IconButton size="sm" icon="copy" label={t('cs.script.repeats.hint')} pressed={review?.kind === 'repeats'} testid="transcript.repeats" onClick={() => (review?.kind === 'repeats' ? closeReview() : openReview('repeats'))} />
        <IconButton size="sm" icon="download" label={t('cs.script.vtt.hint')} testid="transcript.vtt" onClick={() => void saveVtt()} />
      </div>
      {/* Only where there is a sound track that could be a music bed. */}
      {hasBed && (
        <Tooltip content={t('cs.keepMusic.hint')}>
          <div className="cs-switch">
            <Toggle
              checked={keepMusic}
              onChange={(on) => {
                setKeep(on)
                setKeepMusic(on)
              }}
              label={t('cs.keepMusic')}
              testid="transcript.keep-music"
            />
          </div>
        </Tooltip>
      )}
      {review && (
        <div className="cs-review" data-testid="transcript.review" data-kind={review.kind} data-busy={review.rows ? '0' : '1'}>
          {!review.rows ? (
            <div className="hint transcript-hint">{t(review.kind === 'fillers' ? 'cs.script.review.listening' : 'win.silence.analyzing')}</div>
          ) : review.rows.length === 0 ? (
            <div className="hint transcript-hint">{t(review.kind === 'fillers' ? 'cs.script.review.none.fillers' : 'cs.script.review.none.repeats')}</div>
          ) : (
            <>
              <div className="transcript-row">
                <span className="cs-review-title">
                  {t(`cs.script.review.${review.kind}.${review.rows.length === 1 ? 'one' : 'many'}` as StringKey, { n: review.rows.length })}
                </span>
                <Button variant="ghost" size="sm" testid="transcript.review.all" onClick={() => setTicked(new Set(review.rows!.map((r) => r.id)))}>
                  {t('cs.script.review.all')}
                </Button>
                <Button variant="ghost" size="sm" testid="transcript.review.none" onClick={() => setTicked(new Set())}>
                  {t('cs.script.review.none')}
                </Button>
              </div>
              <div className="cs-review-list">
                {review.rows.map((r, i) => (
                  <div key={r.id} className={`cs-review-row${ticked.has(r.id) ? ' on' : ''}`} data-testid={`transcript.review.row.${i}`} data-sure={r.sure ? '1' : '0'}>
                    <Checkbox
                      checked={ticked.has(r.id)}
                      onChange={(on) => {
                        const next = new Set(ticked)
                        if (on) next.add(r.id)
                        else next.delete(r.id)
                        setTicked(next)
                      }}
                      ariaLabel={t('cs.script.review.pick', { what: r.text || t(WHY[r.why ?? 'island']) })}
                      testid={`transcript.review.tick.${i}`}
                    />
                    <span className="cs-review-time" onPointerDown={() => useStore.getState().setTime(r.cut[0])}>
                      {fmtTime(r.cut[0])}
                    </span>
                    <span className="cs-review-text">
                      {r.before && <span className="cs-review-ctx">{r.before} </span>}
                      <b>{r.text || t(WHY.island)}</b>
                      {r.after && <span className="cs-review-ctx"> {r.after}</span>}
                      {r.why && r.text && (
                        <span className="cs-review-why">
                          {' · '}
                          {t('cs.script.review.unsure')}
                          {': '}
                          {t(WHY[r.why])}
                          {r.detail ? ` (${r.detail})` : ''}
                        </span>
                      )}
                    </span>
                    <IconButton size="sm" icon="play" label={t('cs.script.review.play')} testid={`transcript.review.play.${i}`} onClick={() => playRow(r)} />
                  </div>
                ))}
              </div>
            </>
          )}
          <div className="transcript-row">
            <Button variant="secondary" size="sm" icon="scissors" className="transcript-grow" disabled={tickedRows.length === 0} testid="transcript.cut-fillers" onClick={cutTicked}>
              {t(tickedRows.length === 1 ? 'cs.script.review.cut.one' : 'cs.script.review.cut.many', { n: tickedRows.length, s: tickedSeconds.toFixed(1) })}
            </Button>
            {review.kind === 'fillers' && <IconButton size="sm" icon="settings" label={t('cs.script.review.words')} pressed={fillerEdit} onClick={() => setFillerEdit(!fillerEdit)} />}
            <Button variant="secondary" size="sm" testid="transcript.review.close" onClick={closeReview}>
              {t('script.cancel')}
            </Button>
          </div>
          {review.kind === 'fillers' && fillerEdit && (
            <TextField
              size="sm"
              value={fillerList}
              placeholder={t('script.fillerWords.placeholder')}
              label={t('cs.script.review.words')}
              onChange={(v) => {
                setFillerList(v)
                localStorage.setItem(FILLER_KEY, v)
              }}
            />
          )}
        </div>
      )}
      {range && (
        <div className="transcript-row transcript-selbar">
          <Button variant="secondary" size="sm" icon="scissors" className="transcript-grow" testid="transcript.delete-selection" onClick={deleteSelection}>
            {range.words > 0
              ? t(range.words === 1 ? 'script.deleteSel.one' : 'script.deleteSel.many', { s: selDur.toFixed(1), n: range.words })
              : t(range.pauses === 1 ? 'cs.script.deletePause.one' : 'cs.script.deletePause.many', { s: selDur.toFixed(1), n: range.pauses })}
          </Button>
          {/* (One row, as the bar always was: the two selection actions are icons.) */}
          <IconButton size="sm" icon="diamond" label={t('cs.script.marker.hint')} testid="transcript.mark-selection" onClick={markSelection} />
          <IconButton size="sm" icon="smartphone" label={t('cs.script.range.hint')} testid="transcript.range-selection" onClick={rangeSelection} />
          <Button variant="secondary" size="sm" testid="transcript.clear-selection" onClick={() => setSel(null)}>
            {t('script.clear')}
          </Button>
        </div>
      )}
      <div className="hint transcript-hint">{t('script.help')}</div>
      <div className="transcript-text" onPointerMove={onTextPointerMove} onPointerDownCapture={onTextPointerDown} onDoubleClick={onTextDoubleClick}>
        {paragraphs.map((para, pi) => (
          <div key={pi} className="transcript-para">
            <span className="transcript-time" title={t('script.paraStart')} onPointerDown={() => useStore.getState().setTime(para.time)}>
              {fmtTime(para.time)}
            </span>
            {para.words.map(({ w, idx }) => {
              const active = currentTime >= w.start && currentTime < w.end
              const selected = inSel(wordSlot(idx))
              const matched = q !== '' && w.text.toLowerCase().includes(q)
              const filler = struck.has(idx)
              const pause = pauses.get(idx)
              return (
                <span key={idx}>
                  <span
                    data-widx={idx}
                    data-slot={wordSlot(idx)}
                    data-testid={`transcript.word.${idx}`}
                    ref={active ? activeRef : undefined}
                    className={`transcript-word${active ? ' on' : ''}${selected ? ' sel' : ''}${matched ? ' hit' : ''}${filler ? ' filler' : ''}`}
                    onPointerDown={onDown(wordSlot(idx))}
                  >
                    {w.text}
                  </span>
                  {pause && (
                    <span
                      data-slot={pauseSlot(idx)}
                      data-testid={`transcript.pause.${idx}`}
                      className={`transcript-word cs-pause${inSel(pauseSlot(idx)) ? ' sel' : ''}`}
                      title={t('cs.script.pause.hint', { s: pause.gap.toFixed(1) })}
                      onPointerDown={onDown(pauseSlot(idx))}
                    >
                      {t('cs.script.pause', { s: pause.gap.toFixed(1) })}
                    </span>
                  )}
                </span>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
