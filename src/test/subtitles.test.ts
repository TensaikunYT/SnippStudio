// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { captionsToSrt } from '../renderer/src/subtitles/srt'
import { isSubtitle } from '../renderer/src/types'
import { MODEL_CORE_FILES, MODEL_CPU_FILES, modelFileNeedle, modelRootNeedle, pickInstalledModel, spokenLanguage, WHISPER_MODELS, WHISPER_SPOKEN_LANGUAGES } from '../renderer/src/subtitles/models'
import {
  FULL_SENTENCE_WORDS_PER_CUE,
  PAUSE_AWARE_WORDS_PER_CUE,
  groupWordsIntoCaptions
} from '../renderer/src/subtitles/captions'
import { alignCaptionWordsToText, planCaptionSplit } from '../renderer/src/subtitles/split'
import { estimateWordsFromSegments, hasUsableWordTiming, linkedWordTileEnd, moveCaptionWordEnd, moveCaptionWordStart, normalizeWhisperWordTiming, pullStartBackToOnset, refineWordStartFromAudio, snapChunkStartsToSpeech } from '../renderer/src/subtitles/timing'
import type { Caption } from '../renderer/src/types'

const cap = (over: Partial<Caption> & { id: string }): Caption =>
  ({ start: 0, end: 1, text: 'hello', ...over }) as Caption

test('SRT writes one cue per caption, subtitle lane only', () => {
  const srt = captionsToSrt([
    cap({ id: 'a', start: 0, end: 1.5, text: 'first' }),
    cap({ id: 'b', start: 2, end: 3, text: 'second' }),
    // Layer 1+ is a text overlay, not a subtitle.
    cap({ id: 'c', start: 4, end: 5, text: 'overlay', layer: 1 })
  ])
  assert.match(srt, /^1\r?\n00:00:00,000 --> 00:00:01,500\r?\nfirst/)
  assert.ok(srt.includes('second'))
  assert.ok(!srt.includes('overlay'))
})

test('a shape is never written as a subtitle', () => {
  const srt = captionsToSrt([
    cap({ id: 'a', text: 'real line' }),
    cap({ id: 's', text: '', shape: { kind: 'marker', w: 0.3, h: 0.05 } } as Partial<Caption> & { id: string })
  ])
  assert.equal(srt.trim().split(/\r?\n\r?\n/).length, 1)
  assert.ok(srt.includes('real line'))
})

test('per-word SRT uses the recogniser timings', () => {
  const srt = captionsToSrt(
    [
      cap({
        id: 'a',
        start: 0,
        end: 2,
        text: 'one two',
        words: [
          { text: 'one', start: 0, end: 0.4 },
          { text: 'two', start: 0.9, end: 1.3 }
        ]
      } as Partial<Caption> & { id: string })
    ],
    { perWord: true }
  )
  const blocks = srt.trim().split(/\r?\n\r?\n/)
  assert.equal(blocks.length, 2)
  assert.ok(blocks[0].includes('00:00:00,000 --> 00:00:00,400'))
  assert.ok(blocks[0].endsWith('one'))
  assert.ok(blocks[1].includes('00:00:00,900 --> 00:00:01,300'))
})

test('per-word falls back to the sentence when a caption has no word timings', () => {
  const srt = captionsToSrt([cap({ id: 'a', start: 1, end: 2, text: 'typed by hand' })], { perWord: true })
  assert.equal(srt.trim().split(/\r?\n\r?\n/).length, 1)
  assert.ok(srt.includes('typed by hand'))
})

test('SRT export skips empty or invalid cues instead of writing NaN timestamps', () => {
  const srt = captionsToSrt([
    cap({ id: 'empty', start: 0, end: 1, text: '   ' }),
    cap({ id: 'nan', start: Number.NaN, end: 2, text: 'bad start' }),
    cap({ id: 'reverse', start: 3, end: 2, text: 'bad range' }),
    cap({ id: 'good', start: 4, end: 5, text: 'kept' })
  ])

  assert.ok(!srt.includes('NaN'))
  assert.ok(!srt.includes('bad'))
  assert.ok(srt.includes('kept'))
  assert.equal(srt.trim().split(/\r?\n\r?\n/).length, 1)
})

test('one speech model: the multilingual one, its q8 pair complete, nothing else counts (phase 9a, decision 7)', async () => {
  assert.equal(WHISPER_MODELS.length, 1)
  const [model] = WHISPER_MODELS
  assert.equal(model.id, 'onnx-community/whisper-medium_timestamped')
  assert.equal(model.revision, '9fe933aaa6b0244316eb961f36d33dfedf0c0b0c')
  const english = 'whisper-medium.en_timestamped'
  // A disk with these needles' files; the English-only model's files on the
  // disk (a development copy keeps them) are never the model.
  const disk = (files: string[]) => async (needle: string) => files.filter((f) => f.includes(needle)).length
  const full = [...MODEL_CORE_FILES.map((f) => modelRootNeedle(model, f)), ...MODEL_CPU_FILES.map((f) => modelFileNeedle(model, f))]
  const englishFiles = ['config.json', 'tokenizer.json', 'onnx_encoder_model.onnx', 'onnx_decoder_model_merged_fp16.onnx'].map((f) => `${english}_resolve_main_${f}`)
  assert.equal((await pickInstalledModel(disk(full)))?.id, model.id)
  assert.equal((await pickInstalledModel(disk([...full, ...englishFiles])))?.id, model.id)
  assert.equal(await pickInstalledModel(disk(englishFiles)), null, 'the English-only files are not a model')
  assert.equal(await pickInstalledModel(disk([])), null)
  // Without its q8 pair, or without a config file, it is not installed.
  assert.equal(await pickInstalledModel(disk(full.filter((f) => !f.endsWith('decoder_model_merged_quantized.onnx')))), null)
  assert.equal(await pickInstalledModel(disk(full.filter((f) => !f.endsWith('tokenizer.json')))), null)
  assert.ok(modelFileNeedle(model, 'encoder_model_quantized.onnx').includes(model.revision!))
})

test('the spoken language: the project\'s choice; an old project with none says which (phase 9a)', () => {
  assert.equal(spokenLanguage({ model: 'multilingual', language: 'german' }), 'german')
  assert.equal(spokenLanguage({ model: 'english', language: 'turkish' }), 'turkish')
  // A new project (and every project made for the English-only model): English.
  assert.equal(spokenLanguage({ model: 'english', language: 'auto' }), 'english')
  assert.equal(spokenLanguage(undefined), 'english')
  // The multilingual model with "auto" was told Turkish before: still Turkish.
  assert.equal(spokenLanguage({ model: 'multilingual', language: 'auto' }), 'turkish')
  // A language the model does not know is no choice.
  assert.equal(spokenLanguage({ model: 'english', language: 'klingon' }), 'english')
})

test('the offline language picker matches every language accepted by bundled Transformers.js', () => {
  const source = readFileSync(join(process.cwd(), 'node_modules/@huggingface/transformers/src/models/whisper/common_whisper.js'), 'utf8')
  const section = source.split('const WHISPER_LANGUAGES = [')[1]?.split('\n]')[0] ?? ''
  const bundled = [...section.matchAll(/\["[a-z]+", "([^"]+)"\]/g)].map((match) => match[1]).sort()
  assert.ok(bundled.length >= 90)
  assert.deepEqual([...WHISPER_SPOKEN_LANGUAGES].sort(), bundled)
})

test('invalid multilingual word alignment cannot place subtitles outside the audio', () => {
  assert.equal(hasUsableWordTiming([
    { text: 'Merhaba', timestamp: [0, 0.8] },
    { text: 'dünya', timestamp: [1.2, 1.7] }
  ], 2), true)
  assert.equal(hasUsableWordTiming([{ text: 'late', timestamp: [15.6, 15.6] }], 7.8), false)
  assert.equal(hasUsableWordTiming(Array.from({ length: 5 }, (_, index) =>
    ({ text: String(index), timestamp: [3, 3] })), 7.8), false)
  assert.equal(hasUsableWordTiming([], 7.8), false)
})

test('multilingual phrase fallback stays inside audio and marks approximate words', () => {
  const estimated = estimateWordsFromSegments([
    { text: 'Merhaba dünya bugün', timestamp: [0.4, 2.1] },
    { text: 'nasılsın?', timestamp: [2.8, 3.6] }
  ], 4)
  assert.equal(estimated.length, 4)
  assert.ok(estimated.every((word) => word.estimated && word.timestamp[0] >= 0 && word.timestamp[1]! <= 4))
  assert.equal(estimated[0].timestamp[0], 0.4)
  assert.equal(estimated[2].timestamp[1], 2.1)
  const cues = groupWordsIntoCaptions(estimated, { wordsPerCue: 2 })
  assert.ok(cues.every((cue) => cue.words?.every((word) => word.estimated)))
  assert.equal(estimateWordsFromSegments([{ text: 'bad timing', timestamp: [15, 16] }], 4).length, 0)
  assert.equal(estimateWordsFromSegments([{ text: 'no interval', timestamp: [2, 2] }], 4).length, 0)
})

test('a clipped Turkish last word is trimmed without losing accurate earlier words', () => {
  const words = [
    { text: 'Okulda', timestamp: [0, 0.56] as [number, number] },
    { text: 'bulandı', timestamp: [7.7, 8.8] as [number, number] }
  ]
  const normalized = normalizeWhisperWordTiming(words, 8)
  assert.equal(normalized?.length, 2)
  assert.deepEqual(normalized?.[0].timestamp, [0, 0.56])
  assert.deepEqual(normalized?.[1].timestamp, [7.7, 8])
  assert.equal(normalized?.[1].estimated, true)
  assert.deepEqual(normalizeWhisperWordTiming([
    { text: 'Asıl', timestamp: [23.1, 23.4] },
    { text: 'bilgiyi', timestamp: [24.58, 29.96] }
  ], 25)?.[1].timestamp, [24.58, 25])
  assert.equal(normalizeWhisperWordTiming([
    { text: 'interior', timestamp: [10, 29.96] },
    { text: 'later', timestamp: [24, 24.5] }
  ], 25), null)
  assert.equal(normalizeWhisperWordTiming([{ text: 'bad', timestamp: [15.6, 15.6] }], 7.8), null)
})

test('only transcribed subtitles are the recogniser’s to replace', () => {
  // Running Auto captions used to swap the whole caption array, which deleted
  // every title and every shape in the project. This predicate is the rule
  // that stops it, used by the full run, the range re-run and the compactor.
  assert.equal(isSubtitle(cap({ id: 'a', text: 'heard this' })), true)
  assert.equal(isSubtitle(cap({ id: 'b', text: 'a title', manual: true })), false)
  assert.equal(isSubtitle(cap({ id: 'c', text: 'overlay', layer: 2 })), false)
  assert.equal(
    isSubtitle(cap({ id: 'd', text: '', shape: { kind: 'rect', w: 0.2, h: 0.2 } } as Partial<Caption> & { id: string })),
    false
  )
})

test('a caption dragged along the timeline takes its word timings with it', () => {
  // Word times are ABSOLUTE. A move shifts both ends by the same amount, so
  // the words shift too; a trim moves one end and the speech stays put.
  const move = (c: { start: number; end: number; words: { start: number; end: number }[] }, start: number, end: number) => {
    const dStart = start - c.start
    const dEnd = end - c.end
    const words =
      Math.abs(dStart) > 1e-9 && Math.abs(dStart - dEnd) < 1e-6
        ? c.words.map((w) => ({ ...w, start: w.start + dStart, end: w.end + dStart }))
        : c.words
    return { start, end, words }
  }
  const cap = { start: 10, end: 12, words: [{ start: 10, end: 10.5 }, { start: 11, end: 11.4 }] }
  const moved = move(cap, 30, 32)
  assert.deepEqual(moved.words.map((w) => w.start), [30, 31])
  // Trimming the head shows less of the same speech — the words do not slide.
  const trimmed = move(cap, 10.5, 12)
  assert.deepEqual(trimmed.words.map((w) => w.start), [10, 11])
})

test('full-sentence grouping ignores automatic duration and pause limits for readable sentences', () => {
  const captions = groupWordsIntoCaptions(
    [
      { text: 'This', timestamp: [0, 0.2] },
      { text: 'deliberately', timestamp: [0.3, 0.7] },
      { text: 'long', timestamp: [2, 2.2] },
      { text: 'sentence', timestamp: [2.3, 2.6] },
      { text: 'stays', timestamp: [7, 7.2] },
      { text: 'together.', timestamp: [7.3, 7.8] },
      { text: 'Next', timestamp: [8, 8.2] },
      { text: 'one!', timestamp: [8.3, 8.7] }
    ],
    { wordsPerCue: FULL_SENTENCE_WORDS_PER_CUE, maxChars: 8, maxDuration: 1, maxGap: 0.1 }
  )

  assert.equal(captions.length, 2)
  assert.equal(captions[0].text, 'This deliberately long sentence stays together.')
  assert.equal(captions[0].start, 0)
  assert.equal(captions[0].end, 7.8)
  assert.equal(captions[1].text, 'Next one!')
})

test('full-sentence grouping splits a visually long sentence at ten words', () => {
  const text = ['Extraordinary', 'narrators', 'sometimes', 'produce', 'unusually', 'descriptive', 'phrases', 'without', 'helpful', 'punctuation', 'afterwards.']
  const captions = groupWordsIntoCaptions(
    text.map((word, index) => ({ text: word, timestamp: [index * 0.3, index * 0.3 + 0.25] as [number, number] })),
    { wordsPerCue: FULL_SENTENCE_WORDS_PER_CUE, maxChars: 42 }
  )

  assert.deepEqual(captions.map((caption) => caption.text), [
    text.slice(0, 10).join(' '),
    'afterwards.'
  ])
})

test('full-sentence grouping lets ten short words continue until the hard cap', () => {
  const text = ['I', 'am', 'in', 'a', 'bit', 'of', 'a', 'fun', 'new', 'AI', 'job', 'for', 'you', 'now', 'done.']
  const captions = groupWordsIntoCaptions(
    text.map((word, index) => ({ text: word, timestamp: [index * 0.2, index * 0.2 + 0.15] as [number, number] })),
    { wordsPerCue: FULL_SENTENCE_WORDS_PER_CUE, maxChars: 42 }
  )

  assert.equal(captions[0].words?.length, 14)
  assert.equal(captions[1].text, 'done.')
})

test('full-sentence grouping recognises multilingual punctuation and closing quotes', () => {
  const captions = groupWordsIntoCaptions(
    [
      { text: 'Bitti mi?', timestamp: [0, 0.5] },
      { text: 'Evet.\u201d', timestamp: [0.6, 1] },
      { text: '\u4e0b\u4e00\u53e5\u3002', timestamp: [1.1, 1.6] }
    ],
    { wordsPerCue: FULL_SENTENCE_WORDS_PER_CUE }
  )

  assert.deepEqual(captions.map((caption) => caption.text), ['Bitti mi?', 'Evet.\u201d', '\u4e0b\u4e00\u53e5\u3002'])
})

test('full-sentence grouping also breaks long sentences at commas', () => {
  const captions = groupWordsIntoCaptions(
    [
      { text: 'This', timestamp: [0, 0.2] },
      { text: 'opening', timestamp: [0.2, 0.5] },
      { text: 'clause,', timestamp: [0.5, 0.9] },
      { text: 'continues', timestamp: [1, 1.3] },
      { text: 'after', timestamp: [1.3, 1.5] },
      { text: 'it.', timestamp: [1.5, 1.9] }
    ],
    { wordsPerCue: FULL_SENTENCE_WORDS_PER_CUE }
  )

  assert.deepEqual(captions.map((caption) => caption.text), ['This opening clause,', 'continues after it.'])
})

test('pause-aware grouping starts the right block at its first Whisper word', () => {
  const captions = groupWordsIntoCaptions(
    [
      { text: 'The', timestamp: [0, 0.2] },
      { text: 'first', timestamp: [0.28, 0.55] },
      { text: 'part', timestamp: [0.63, 0.9] },
      { text: 'continues', timestamp: [1.8, 2.1] },
      { text: 'later.', timestamp: [2.18, 2.5] }
    ],
    { wordsPerCue: PAUSE_AWARE_WORDS_PER_CUE, pauseThreshold: 0.55 }
  )

  assert.deepEqual(captions.map((caption) => caption.text), ['The first part', 'continues later.'])
  assert.equal(captions[0].end, 0.9)
  assert.equal(captions[1].start, 1.8)
  assert.equal(captions[1].words?.[0].start, 1.8)
})

test('pause-aware grouping keeps ordinary word gaps together in Auto', () => {
  const captions = groupWordsIntoCaptions(
    [
      { text: 'These', timestamp: [0, 0.22] },
      { text: 'words', timestamp: [0.32, 0.58] },
      { text: 'stay', timestamp: [0.7, 0.9] },
      { text: 'together.', timestamp: [1.02, 1.3] }
    ],
    { wordsPerCue: PAUSE_AWARE_WORDS_PER_CUE }
  )

  assert.deepEqual(captions.map((caption) => caption.text), ['These words stay together.'])
})

test('pause-aware grouping never strands delayed standalone punctuation', () => {
  const captions = groupWordsIntoCaptions(
    [
      { text: 'Hello', timestamp: [0, 0.3] },
      { text: ',', timestamp: [1.2, 1.25] },
      { text: 'again.', timestamp: [1.8, 2.1] }
    ],
    { wordsPerCue: PAUSE_AWARE_WORDS_PER_CUE, pauseThreshold: 0.4 }
  )

  assert.deepEqual(captions.map((caption) => caption.text), ['Hello,', 'again.'])
})

test('automatic grouping does not gain comma-only breaks', () => {
  const captions = groupWordsIntoCaptions(
    [
      { text: 'Short,', timestamp: [0, 0.3] },
      { text: 'still', timestamp: [0.3, 0.6] },
      { text: 'together.', timestamp: [0.6, 1] }
    ],
    { maxChars: 100, maxDuration: 5, maxGap: 2 }
  )

  assert.deepEqual(captions.map((caption) => caption.text), ['Short, still together.'])
})

test('standalone punctuation joins the preceding word without an extra space', () => {
  const captions = groupWordsIntoCaptions(
    [
      { text: 'Hello', timestamp: [0, 0.3] },
      { text: '.', timestamp: [0.3, 0.35] },
      { text: 'Next', timestamp: [0.5, 0.8] },
      { text: '!', timestamp: [0.8, 0.85] }
    ],
    { wordsPerCue: FULL_SENTENCE_WORDS_PER_CUE }
  )

  assert.deepEqual(captions.map((caption) => caption.text), ['Hello.', 'Next!'])
  assert.deepEqual(captions.map((caption) => caption.words?.map((word) => word.text)), [['Hello.'], ['Next!']])
})

test('automatic grouping checks the incoming word against the duration limit', () => {
  const captions = groupWordsIntoCaptions(
    [
      { text: 'first', timestamp: [0, 4.9] },
      { text: 'second', timestamp: [5.1, 5.4] }
    ],
    { maxChars: 100, maxDuration: 5, maxGap: 10 }
  )

  assert.deepEqual(captions.map((caption) => caption.text), ['first', 'second'])
})

test('caption grouping drops invalid starts and repairs invalid word ends', () => {
  const captions = groupWordsIntoCaptions(
    [
      { text: 'ignored', timestamp: [Number.NaN, 1] },
      { text: 'kept.', timestamp: [2, Number.NaN] }
    ],
    { wordsPerCue: FULL_SENTENCE_WORDS_PER_CUE }
  )

  assert.equal(captions.length, 1)
  assert.equal(captions[0].text, 'kept.')
  assert.equal(captions[0].start, 2)
  assert.equal(captions[0].end, 2.3)
})

test('caption split uses the Whisper word boundary nearest the cursor', () => {
  const caption = cap({
    id: 'split',
    start: 10,
    end: 14,
    text: 'one two three four',
    words: [
      { text: 'one', start: 10, end: 10.5 },
      { text: 'two', start: 10.8, end: 11.4 },
      { text: 'three', start: 12.2, end: 12.8 },
      { text: 'four', start: 13.1, end: 13.7 }
    ]
  })
  const plan = planCaptionSplit(caption, caption.text, 8)

  assert.ok(plan)
  assert.equal(plan.leftText, 'one two')
  assert.equal(plan.rightText, 'three four')
  assert.equal(plan.leftEnd, 11.4)
  assert.equal(plan.rightStart, 12.2)
  assert.deepEqual(plan.leftWords?.map((word) => word.text), ['one', 'two'])
  assert.deepEqual(plan.rightWords?.map((word) => word.text), ['three', 'four'])
})

test('caption split falls back to proportional time for an SRT cue', () => {
  const caption = cap({ id: 'srt-split', start: 20, end: 30, text: 'first half second half' })
  const plan = planCaptionSplit(caption, caption.text, 11)

  assert.ok(plan)
  assert.equal(plan.leftText, 'first half')
  assert.equal(plan.rightText, 'second half')
  assert.equal(plan.leftEnd, plan.rightStart)
  assert.ok(plan.leftEnd > 24 && plan.leftEnd < 26)
})

test('caption split preserves the right word start when word timings overlap', () => {
  const caption = cap({
    id: 'overlap-split',
    start: 0,
    end: 4,
    text: 'left side right side',
    words: [
      { text: 'left', start: 0, end: 0.7 },
      { text: 'side', start: 0.65, end: 2 },
      { text: 'right', start: 1.8, end: 2.5 },
      { text: 'side', start: 2.6, end: 3.5 }
    ]
  })
  const plan = planCaptionSplit(caption, caption.text, 10)

  assert.ok(plan)
  assert.equal(plan.rightStart, 1.8)
  assert.equal(plan.leftEnd, 1.8)
  assert.equal(plan.rightWords?.[0].start, 1.8)
})

test('caption split keeps Whisper timing when punctuation is a separate chunk', () => {
  const caption = cap({
    id: 'punctuation-split',
    start: 0,
    end: 4,
    text: 'Hello, right side',
    words: [
      { text: 'Hello', start: 0, end: 0.45 },
      { text: ',', start: 0.45, end: 0.5 },
      { text: 'right', start: 2, end: 2.4 },
      { text: 'side', start: 2.5, end: 3 }
    ]
  })
  const plan = planCaptionSplit(caption, caption.text, 7)

  assert.ok(plan)
  assert.equal(plan.leftText, 'Hello,')
  assert.equal(plan.leftEnd, 0.5)
  assert.equal(plan.rightStart, 2)
  assert.deepEqual(plan.leftWords?.map((word) => word.text), ['Hello,'])
})

test('caption split keeps Turkish number and suffix fragments at their actual word starts', () => {
  const number = cap({
    id: 'number-fragment', start: 32.74, end: 36.64,
    text: "İnsan beyni ortalama 1.4 kg'dır ama sırf hayatta kalmak",
    words: [
      { text: 'İnsan', start: 32.74, end: 33.04 },
      { text: 'beyni', start: 33.04, end: 33.28 },
      { text: 'ortalama', start: 33.28, end: 33.72 },
      { text: '1', start: 33.72, end: 33.96 },
      { text: '.4', start: 33.96, end: 34.5 },
      { text: "kg'dır", start: 34.5, end: 35.02 },
      { text: 'ama', start: 35.02, end: 35.5 },
      { text: 'sırf', start: 35.5, end: 35.86 },
      { text: 'hayatta', start: 35.86, end: 36.22 },
      { text: 'kalmak', start: 36.22, end: 36.64 }
    ]
  })
  const numberSplit = planCaptionSplit(number, number.text, number.text.indexOf(' kg'))
  assert.equal(numberSplit?.rightStart, 34.5)
  assert.equal(numberSplit?.rightWords?.[0].text, "kg'dır")
  assert.equal(numberSplit?.leftWords?.at(-1)?.text, '1.4')

  const suffix = cap({
    id: 'suffix-fragment', start: 36.64, end: 40.08,
    text: "için bile vücuttaki toplam enerjinin%20'sini harcar.",
    words: [
      { text: 'için', start: 36.64, end: 36.84 },
      { text: 'bile', start: 36.84, end: 37.06 },
      { text: 'vücuttaki', start: 37.06, end: 37.56 },
      { text: 'toplam', start: 37.74, end: 37.96 },
      { text: 'enerjinin', start: 37.96, end: 38.48 },
      { text: "%20'sini", start: 38.48, end: 39.18 },
      { text: 'harcar.', start: 39.18, end: 39.6 }
    ]
  })
  const suffixSplit = planCaptionSplit(suffix, suffix.text, suffix.text.indexOf(' toplam'))
  assert.equal(suffixSplit?.rightStart, 37.74)
  assert.equal(suffixSplit?.rightWords?.[1].text, "enerjinin%20'sini")
  assert.equal(suffixSplit?.rightWords?.[1].start, 37.96)
})

test('editing one caption word does not redistribute unchanged Whisper anchors', () => {
  const aligned = alignCaptionWordsToText([
    { text: 'one', start: 1, end: 1.2 },
    { text: 'two', start: 1.5, end: 1.8 },
    { text: 'three', start: 2.4, end: 2.9 }
  ], 'one inserted two three', 1, 2.9)
  assert.deepEqual(aligned.map((word) => word.text), ['one', 'inserted', 'two', 'three'])
  assert.equal(aligned[0].start, 1)
  assert.equal(aligned[2].start, 1.5)
  assert.equal(aligned[3].start, 2.4)
  assert.equal(aligned[1].estimated, true)
})

test('splitting a legacy cue with words beyond its end restores the spoken right edge', () => {
  const caption = cap({
    id: 'shortened-legacy', start: 68.2366666667, end: 68.8225686054,
    text: 'ilk adımı bu.',
    words: [
      { text: 'ilk', start: 68.2366666667, end: 68.7344444444 },
      { text: 'adımı', start: 68.7344444444, end: 69.2322222222 },
      { text: 'bu.', start: 69.2322222222, end: 69.73 }
    ]
  })
  const plan = planCaptionSplit(caption, caption.text, caption.text.indexOf(' adımı'), 69.73)
  assert.equal(plan?.rightStart, 68.7344444444)
  assert.equal(plan?.rightEnd, 69.73)
  assert.equal(plan?.leftEnd, 68.7344444444)
})

test('caption split refuses a one-word or too-short cue', () => {
  assert.equal(planCaptionSplit(cap({ id: 'one', start: 0, end: 2, text: 'unsplittable' }), 'unsplittable', 5), null)
  assert.equal(planCaptionSplit(cap({ id: 'tiny', start: 0, end: 0.1, text: 'two words' }), 'two words', 4), null)
})

test('word timing skips silence Whisper attached before the spoken word', () => {
  const sampleRate = 1000
  const audio = new Float32Array(1200)
  // A little tail from the previous word, then a real gap, then the new word.
  for (let i = 0; i < 40; i++) audio[i] = 0.15
  for (let i = 620; i < 1000; i++) audio[i] = i % 2 === 0 ? 0.2 : -0.2
  const refined = refineWordStartFromAudio(0, 1, audio, 0, sampleRate)

  assert.ok(refined >= 0.59 && refined <= 0.63, `expected speech onset near 0.62s, got ${refined}`)
})

test('word timing does not move a boundary without a clear quiet run', () => {
  const sampleRate = 1000
  const audio = new Float32Array(600)
  for (let i = 0; i < audio.length; i++) audio[i] = i % 2 === 0 ? 0.04 : -0.04
  assert.equal(refineWordStartFromAudio(0, 0.5, audio, 0, sampleRate), 0)
})

test('word onset refinement ignores an internal pause and is stable on a second pass', () => {
  const sampleRate = 1000
  const audio = new Float32Array(1200)
  for (const [start, end] of [[0, 40], [620, 820], [920, 1120]]) {
    for (let i = start; i < end; i++) audio[i] = i % 2 === 0 ? 0.2 : -0.2
  }
  const first = refineWordStartFromAudio(0, 1.12, audio, 0, sampleRate)
  const second = refineWordStartFromAudio(first, 1.12, audio, 0, sampleRate)
  assert.ok(first >= 0.59 && first <= 0.63)
  assert.equal(second, first)
})

test('a word timed after its first syllable is pulled back to where its sound began', () => {
  const sampleRate = 16000
  const audio = new Float32Array(sampleRate * 3)
  // Speech 0.2–1.0 s, a pause, then the next word's sound from 1.40 s on.
  for (const [a, b] of [[0.2, 1.0], [1.4, 2.6]]) {
    for (let i = Math.round(a * sampleRate); i < Math.round(b * sampleRate); i++) audio[i] = Math.sin(i * 0.3) * 0.3
  }
  // Whisper put it at 1.82 s: a syllable in.
  const pulled = pullStartBackToOnset(1.82, 0.25, audio, 0, sampleRate)
  assert.ok(pulled >= 1.37 && pulled <= 1.41, `expected the onset near 1.40 s, got ${pulled}`)
  // Never past the previous word's start, never more than 0.6 s.
  assert.equal(pullStartBackToOnset(2.3, 0.25, audio, 0, sampleRate), 2.3)
  assert.equal(pullStartBackToOnset(1.82, 1.6, audio, 0, sampleRate), 1.82)
  // A start in silence is the forward case, not this one.
  assert.equal(pullStartBackToOnset(1.2, 0.25, audio, 0, sampleRate), 1.2)
})

test('word starts snap to the speech onset both ways, in any language, and cues follow', () => {
  const sampleRate = 16000
  const audio = new Float32Array(sampleRate * 4)
  for (const [a, b] of [[0.3, 1.1], [1.5, 2.3], [2.9, 3.7]]) {
    for (let i = Math.round(a * sampleRate); i < Math.round(b * sampleRate); i++) audio[i] = Math.sin(i * 0.21) * 0.25
  }
  const words = snapChunkStartsToSpeech([
    { text: 'Dedenle', timestamp: [0.3, 1.1] },
    { text: 'nenenin', timestamp: [1.12, 2.3] }, // in the pause: forward to 1.5
    { text: 'araya', timestamp: [3.25, 3.7], estimated: true } // a syllable late: back to 2.9
  ], audio, 0, sampleRate)
  assert.equal(words[0].timestamp[0], 0.3)
  assert.ok(Math.abs(words[1].timestamp[0] - 1.5) <= 0.03, `forward: ${words[1].timestamp[0]}`)
  assert.ok(Math.abs(words[2].timestamp[0] - 2.9) <= 0.03, `back: ${words[2].timestamp[0]}`)
  // The word before never runs over the moved start.
  assert.ok((words[1].timestamp[1] ?? 0) <= words[2].timestamp[0])
  // Snapping again changes nothing.
  assert.deepEqual(snapChunkStartsToSpeech(words, audio, 0, sampleRate).map((w) => w.timestamp[0]), words.map((w) => w.timestamp[0]))
})

test("a Turkish apostrophe suffix stays on its word: B'nin, never 'nin on its own", () => {
  const caps = groupWordsIntoCaptions([
    { text: 'götürürse,', timestamp: [249.12, 249.84] },
    { text: 'B', timestamp: [249.96, 250.22] },
    { text: "'nin", timestamp: [250.22, 250.38] },
    { text: 'geleceğine', timestamp: [250.38, 250.88] }
  ], { wordsPerCue: 2 })
  assert.deepEqual(caps.map((c) => c.text), ["götürürse, B'nin", 'geleceğine'])
  assert.deepEqual(caps[0].words?.map((w) => w.text), ['götürürse,', "B'nin"])
  assert.equal(caps[0].words?.[1].end, 250.38)
})

test('manual karaoke timing changes only the chosen word and never ripples later starts', () => {
  const words = [
    { text: 'one', start: 1, end: 1.25 },
    { text: 'two', start: 1.3, end: 1.5, estimated: true },
    { text: 'three', start: 1.7, end: 2 }
  ]
  const moved = moveCaptionWordStart(words, 1, 1.58, 1, 2)
  assert.equal(moved[1].start, 1.58)
  assert.ok(moved[1].end >= 1.59)
  assert.equal(moved[1].estimated, false)
  assert.deepEqual(moved[0], words[0])
  assert.deepEqual(moved[2], words[2])
  assert.equal(words[1].start, 1.3)
  const limited = moveCaptionWordStart(moved, 1, 1.95, 1, 2)
  assert.ok(limited[1].start < words[2].start)
  assert.equal(limited[2].start, words[2].start)
})

test('manual word end exposes a pause without moving the following word', () => {
  const words = [
    { text: 'bulanıklaştığında', start: 7.77, end: 8.61, estimated: true },
    { text: 'genelde', start: 9.12, end: 9.55 }
  ]
  const ended = moveCaptionWordEnd(words, 0, 8.3, 6.9, 9.6)
  assert.equal(ended[0].start, 7.77)
  assert.equal(ended[0].end, 8.3)
  assert.equal(ended[0].estimated, false)
  assert.deepEqual(ended[1], words[1])
  assert.equal(moveCaptionWordEnd(ended, 0, 9.5, 6.9, 9.6)[0].end, 9.12)
  assert.ok(Math.abs(moveCaptionWordEnd(ended, 0, 7, 6.9, 9.6)[0].end - 7.78) < 1e-6)
  // The visual tile remains attached to the next one; the gold handle alone
  // shows the precise word end, so the timing UI never opens a dead gap.
  assert.equal(linkedWordTileEnd(ended, 0, 9.6), ended[1].start)
  assert.equal(linkedWordTileEnd(ended, 1, 9.6), 9.6)
})

test('splitting after an edited word uses its end and the next exact onset', () => {
  const caption = cap({
    id: 'manual-end', start: 6.9, end: 9.6, text: 'zihniniz bulanıklaştığında genelde',
    words: [
      { text: 'zihniniz', start: 6.9, end: 7.4 },
      { text: 'bulanıklaştığında', start: 7.77, end: 8.3 },
      { text: 'genelde', start: 9.12, end: 9.55 }
    ]
  })
  const cursor = caption.text.indexOf('genelde')
  const plan = planCaptionSplit(caption, caption.text, cursor)
  assert.equal(plan?.leftEnd, 8.3)
  assert.equal(plan?.rightStart, 9.12)
  assert.equal(plan?.leftWords?.[1].end, 8.3)
  assert.equal(plan?.rightWords?.[0].start, 9.12)
})

test('the hand-drawn wobble is the same every time it is rendered', () => {
  // The whole requirement: preview and export draw one frame from the same
  // numbers. A wobble reaching for Math.random would look different in the
  // file than it did on screen, and there would be no way to tell until after
  // the render.
  const hash2 = (a: number, b: number): number => {
    const n = Math.sin(a * 127.1 + b * 311.7) * 43758.5453
    return (n - Math.floor(n)) * 2 - 1
  }
  const sample = (char: number, time: number, fps = 10): number => hash2(char, Math.floor(time * fps))
  assert.equal(sample(3, 1.234), sample(3, 1.234))
  // It HOLDS across a frame and then jumps — that is what makes it read as
  // redrawn ink rather than as a vibration.
  assert.equal(sample(3, 1.21), sample(3, 1.29), 'same tenth of a second, same offset')
  assert.notEqual(sample(3, 1.21), sample(3, 1.31), 'next tenth, new offset')
  // Neighbouring letters do not move together.
  assert.notEqual(sample(3, 1.21), sample(4, 1.21))
  for (const v of [sample(0, 0), sample(9, 5.5), sample(31, 100)]) {
    assert.ok(v >= -1 && v <= 1, 'stays in range')
  }
})
