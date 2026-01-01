// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The sample project (SnippStudio phase 9b, decision 3; FAZ9.md 9b karar 3):
// made by the app itself, each time a new copy in a new folder under the
// profile (main/ipc/sample-ipc.ts). No film or sound of anyone's: three
// coloured test clips with a tone (encoded here, H.264 + AAC through
// mediabunny, ≈ 0.5 MB each), a title, a G lane template and a code template
// clip (the title card, copied beside the project the usual way). The project
// is built in the store, saved to its file, and then opened from the file
// like any project (App.tsx), so what the person gets is exactly what is on
// disk. Its words are the interface's language at the time it is made.
import { AudioBufferSource, BufferTarget, CanvasSource, Mp4OutputFormat, Output } from 'mediabunny'
import { api } from '../platform'
import { useStore } from '../state/store'
import { t } from '../ui'
import { fmtSec } from '../ui/format'
import { addCodeTemplate } from './code-templates'
import { importWrittenFiles } from './import'
import { saveProject, setLastProjectPath } from './projectio'

export const SAMPLE_CLIP_SECONDS = 4
const W = 1280
const H = 720
const FPS = 30
const RATE = 48000

/** Each clip's colour (hue), number and tone (Hz). */
const CLIPS = [
  { hue: 205, tone: 330 },
  { hue: 150, tone: 392 },
  { hue: 28, tone: 494 }
] as const

/** One test clip: a coloured field with a light band crossing it, its number
 *  and its time, and a soft tone that fades in and out. */
export async function encodeSampleClip(i: number): Promise<Uint8Array> {
  const { hue, tone } = CLIPS[i]
  const canvas = new OffscreenCanvas(W, H)
  const g = canvas.getContext('2d', { alpha: false })!
  const target = new BufferTarget()
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target })
  const video = new CanvasSource(canvas, { codec: 'avc', bitrate: 1_200_000 })
  output.addVideoTrack(video, { frameRate: FPS })
  const sound = new AudioBufferSource({ codec: 'aac', bitrate: 96_000 })
  output.addAudioTrack(sound)
  await output.start()
  try {
    const length = SAMPLE_CLIP_SECONDS * RATE
    const buf = new AudioBuffer({ length, numberOfChannels: 2, sampleRate: RATE })
    for (let c = 0; c < 2; c++) {
      const ch = buf.getChannelData(c)
      for (let n = 0; n < length; n++) {
        const s = n / RATE
        const env = Math.min(1, s / 0.3, (SAMPLE_CLIP_SECONDS - s) / 0.3)
        ch[n] = 0.12 * env * Math.sin(2 * Math.PI * tone * s)
      }
    }
    await sound.add(buf)
    sound.close()
    const frames = SAMPLE_CLIP_SECONDS * FPS
    for (let f = 0; f < frames; f++) {
      const s = f / FPS
      g.fillStyle = `hsl(${hue} 45% 32%)`
      g.fillRect(0, 0, W, H)
      // A light band crossing the frame: the clip is visibly playing.
      const x = ((s / SAMPLE_CLIP_SECONDS) * (W + 400)) - 400
      g.fillStyle = `hsl(${hue} 45% 42%)`
      g.fillRect(x, 0, 220, H)
      g.fillStyle = 'rgba(255,255,255,0.92)'
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.font = '700 240px Inter, sans-serif'
      g.fillText(String(i + 1), W / 2, H / 2 - 30)
      g.font = '500 36px Inter, sans-serif'
      g.fillText(t('sample.clip', { n: i + 1 }), W / 2, H / 2 + 130)
      g.font = '500 28px "JetBrains Mono", monospace'
      g.fillStyle = 'rgba(255,255,255,0.7)'
      g.fillText(fmtSec(s), W / 2, H - 60)
      await video.add(s, 1 / FPS)
    }
    video.close()
    await output.finalize()
  } catch (err) {
    await output.cancel().catch(() => {})
    throw err
  }
  if (!target.buffer) throw new Error('The sample clip produced no data.')
  return new Uint8Array(target.buffer)
}

/** Makes a new sample project and answers its file (null: this window cannot). */
export async function makeSampleProject(): Promise<string | null> {
  if (!api?.sample) return null
  const made = await api.sample.create()
  if (!made) return null
  const files = []
  for (let i = 0; i < CLIPS.length; i++) {
    const f = await api.sample.write(`clip-${i + 1}.mp4`, await encodeSampleClip(i))
    if (!f) throw new Error('The sample clip could not be written.')
    files.push(f)
  }
  const imported = await importWrittenFiles(files)
  if (imported.errors.length) throw new Error(imported.errors.join(' · '))

  const st = useStore.getState()
  st.newProject('16:9')
  st.setProjectName(t('sample.name'))
  const assets = useStore.getState().addAssets(imported.assets)
  for (const a of assets) useStore.getState().addToTimeline(a.id)
  useStore.getState().runBatch([
    { name: 'text.add', params: { time: 4.4, text: t('sample.title') } },
    { name: 'template.place', params: { kind: 'stat', time: 8.2 } }
  ])
  // The stat template's words in the interface's language (phase 9 audit
  // patch D10): a new template's placeholder words are English (the pure
  // command writes them), the sample's are the user's language.
  useStore.getState().editTemplates((p) => {
    const stat = p.templates?.find((b) => b.kind === 'stat')
    if (stat?.items[0]) stat.items[0].title = t('sample.stat.people')
    if (stat?.items[1]) stat.items[1].title = t('sample.stat.week')
  })
  // Saved once first: a code template is copied beside the project's file.
  setLastProjectPath(made.project)
  await saveProject(useStore.getState().project, { quick: true })
  useStore.getState().setTime(0)
  const clipId = await addCodeTemplate('title-card')
  const code = clipId ? useStore.getState().project.clips[clipId] : undefined
  if (code) useStore.getState().setCodeParams(code.assetId, { title: t('sample.card.title'), subtitle: t('sample.card.subtitle') })
  useStore.getState().selectClips([])
  await saveProject(useStore.getState().project, { quick: true })
  useStore.getState().setDirty(false)
  return made.project
}
