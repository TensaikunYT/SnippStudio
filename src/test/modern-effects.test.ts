// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import assert from 'node:assert/strict'
import test from 'node:test'
import { defaultProject, type Clip } from '../renderer/src/types'
import { generateGentlePanMotion, sampleMotionFx } from '../renderer/src/effects/cinematic'

Object.defineProperty(globalThis, 'document', {
  configurable: true,
  value: { createElement: () => ({ width: 0, height: 0, getContext: () => null }) }
})
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: { getItem: () => null, setItem: () => {} }
})

const clip = (id: string, trackId: string, start: number): Clip => ({
  id, assetId: `asset-${id}`, trackId, start, duration: 5, inPoint: 0,
  transform: { x: 960, y: 540, scale: 1, rotation: 0 }, volume: 1
})

test('speed-ramp travel is stepped, monotonic and lands precisely at its endpoints', async () => {
  const { speedRamp } = await import('../renderer/src/playback/render')
  const samples = Array.from({ length: 101 }, (_, index) => speedRamp(index / 100, 0.7))
  assert.equal(samples[0], 0)
  assert.equal(samples.at(-1), 1)
  assert.ok(samples.every((value, index) => index === 0 || value >= samples[index - 1]))
  assert.ok(samples.some((value, index) => index > 0 && value === samples[index - 1]))
  assert.ok(speedRamp(0.6, 0.7) - speedRamp(0.4, 0.7) > speedRamp(0.2, 0.7) - speedRamp(0, 0.7))
})

test('smooth footage ramp changes source velocity without losing clip endpoints or crossing media bounds', async () => {
  const { clipMediaAt, renderList } = await import('../renderer/src/playback/render')
  const project = defaultProject()
  const track = project.tracks[0]
  const outgoing = clip('outgoing', track.id, 0)
  const incoming = clip('incoming', track.id, 5)
  outgoing.transitionOut = { type: 'speed-ramp', duration: 0.7, peakSpeed: 10, direction: 'right' }
  project.clips[outgoing.id] = outgoing
  project.clips[incoming.id] = incoming
  track.clipIds = [outgoing.id, incoming.id]
  project.assets.push(
    { id: outgoing.assetId, name: 'a.mp4', kind: 'video', url: 'media://a', size: 1, duration: 5, width: 1920, height: 1080, hasAudio: true },
    { id: incoming.assetId, name: 'b.mp4', kind: 'video', url: 'media://b', size: 1, duration: 5, width: 1920, height: 1080, hasAudio: true }
  )
  assert.equal(clipMediaAt(project, outgoing, 0).time, outgoing.inPoint)
  assert.ok(Math.abs(clipMediaAt(project, outgoing, 5).time - 5) < 1e-9)
  assert.equal(clipMediaAt(project, incoming, 5).time, incoming.inPoint)
  assert.ok(Math.abs(clipMediaAt(project, incoming, 10).time - 5) < 1e-9)
  assert.ok(clipMediaAt(project, outgoing, 4.999).rate > 7)
  assert.ok(clipMediaAt(project, incoming, 5).rate > 7)
  assert.ok(clipMediaAt(project, outgoing, 4).rate < 1)
  assert.ok(clipMediaAt(project, incoming, 5.6).rate < 1)
  for (const c of [outgoing, incoming]) {
    let previous = -Infinity
    for (let frame = 0; frame <= 300; frame++) {
      const sample = clipMediaAt(project, c, c.start + c.duration * frame / 300)
      assert.ok(sample.time >= previous - 1e-8, `source clock rewound at frame ${frame}`)
      assert.ok(sample.time >= c.inPoint - 1e-8 && sample.time <= c.inPoint + 5 + 1e-8)
      assert.ok(sample.rate > 0 && sample.rate <= 16)
      previous = sample.time
    }
  }
  assert.deepEqual(renderList(project, 4.99).map(entry => entry.clip.id), ['outgoing'])
  assert.deepEqual(renderList(project, 5.01).map(entry => entry.clip.id), ['incoming'])
  assert.ok(renderList(project, 4.99)[0].motionBlur)
  assert.ok(renderList(project, 5.01)[0].motionBlur)
})

test('back-to-back ramps on a short middle clip remain monotonic and meet at normal speed', async () => {
  const { clipMediaAt } = await import('../renderer/src/playback/render')
  const project = defaultProject()
  const track = project.tracks[0]
  track.clipIds = ['a', 'b', 'c']
  for (const [index, id] of track.clipIds.entries()) {
    project.clips[id] = { ...clip(id, track.id, index * 0.6), duration: 0.6 }
    if (index < 2) project.clips[id].transitionOut = { type: 'speed-ramp', duration: 0.7, peakSpeed: 15 }
  }
  const middle = project.clips.b
  let previous = -Infinity
  for (let frame = 0; frame <= 120; frame++) {
    const sample = clipMediaAt(project, middle, middle.start + middle.duration * frame / 120)
    assert.ok(sample.time >= previous - 1e-8)
    assert.ok(sample.time >= -1e-8 && sample.time <= 0.6 + 1e-8)
    previous = sample.time
  }
  assert.ok(Math.abs(clipMediaAt(project, middle, middle.start + 0.3).rate - 1) < 1e-9)
  assert.ok(Math.abs(clipMediaAt(project, middle, middle.start + 0.6).time - 0.6) < 1e-8)
})

test('speed-ramp entrance and exit stay independent of idle clip motion', async () => {
  const { sampleClipMotion } = await import('../renderer/src/playback/render')
  const item = clip('a', 'v1', 0)
  item.anim = { in: 'ramp-right', out: 'ramp-down', inDur: 0.5, outDur: 0.5 }
  const entering = sampleClipMotion(item, 0, 1920, 1080)
  const settled = sampleClipMotion(item, 0.5, 1920, 1080)
  const exiting = sampleClipMotion(item, 5, 1920, 1080)
  assert.ok(entering.dx < -1920)
  assert.equal(settled.dx, 0)
  assert.ok(exiting.dy > 1080)
  assert.equal(entering.alpha, 0)
  assert.equal(settled.alpha, 1)
})

test('preview handle pose includes the same pan and zoom used to paint the image', async () => {
  const { clipVisualPoseAt } = await import('../renderer/src/playback/render')
  const project = defaultProject()
  const item = clip('posed', project.tracks[0].id, 0)
  item.motionFx = generateGentlePanMotion(0, 'left-to-right', 2.5, project)
  const sample = sampleMotionFx(item.motionFx, 0, 0)
  const pose = clipVisualPoseAt(project, item, 0).transform
  assert.ok(Math.abs(pose.x - (item.transform.x + sample.offsetX)) < 1e-9)
  assert.ok(Math.abs(pose.scale - item.transform.scale * sample.zoom) < 1e-9)
  assert.notEqual(pose.x, item.transform.x)
})

test('new cut styles use the shared preview/export render list', async () => {
  const { renderList } = await import('../renderer/src/playback/render')
  const project = defaultProject()
  const track = project.tracks[0]
  project.clips.a = clip('a', track.id, 0)
  project.clips.b = clip('b', track.id, 5)
  track.clipIds = ['a', 'b']
  for (const id of ['a', 'b']) {
    project.assets.push({ id: `asset-${id}`, name: `${id}.png`, kind: 'image', url: `media://${id}`, size: 1, duration: 0, width: 1920, height: 1080, hasAudio: false })
  }
  project.clips.a.transitionOut = { type: 'ramp-right', duration: 0.8 }
  const right = renderList(project, 5)
  assert.ok((right.find((entry) => entry.clip.id === 'a')?.dx ?? 0) > 0)
  assert.ok((right.find((entry) => entry.clip.id === 'b')?.dx ?? 0) < 0)
  const outgoingRight = right.find((entry) => entry.clip.id === 'a')!
  const incomingRight = right.find((entry) => entry.clip.id === 'b')!
  assert.ok((outgoingRight.motionBlur?.dx ?? 0) > 0)
  assert.ok((incomingRight.motionBlur?.dx ?? 0) > 0)
  assert.equal(outgoingRight.motionBlur?.dy, 0)
  assert.ok((renderList(project, 4.61).find((entry) => entry.clip.id === 'a')?.motionBlur?.dx ?? 0) < outgoingRight.motionBlur!.dx)
  project.clips.a.transitionOut.type = 'ramp-down'
  const down = renderList(structuredClone(project), 5)
  assert.ok((down.find((entry) => entry.clip.id === 'a')?.dy ?? 0) > 0)
  assert.ok((down.find((entry) => entry.clip.id === 'b')?.dy ?? 0) < 0)
  assert.ok((down.find((entry) => entry.clip.id === 'a')?.motionBlur?.dy ?? 0) > 0)
  assert.ok((down.find((entry) => entry.clip.id === 'b')?.motionBlur?.dy ?? 0) > 0)
  project.clips.a.transitionOut.type = 'ramp-left'
  assert.ok((renderList(structuredClone(project), 5).find((entry) => entry.clip.id === 'a')?.motionBlur?.dx ?? 0) < 0)
  project.clips.a.transitionOut.type = 'ramp-up'
  assert.ok((renderList(structuredClone(project), 5).find((entry) => entry.clip.id === 'a')?.motionBlur?.dy ?? 0) < 0)
  project.clips.a.transitionOut.type = 'light-leak'
  assert.ok(renderList(structuredClone(project), 5).some((entry) => entry.lightLeak !== undefined))
})

test('moving transitions tile adjacent frames with no exposed black seam', async () => {
  const { renderList } = await import('../renderer/src/playback/render')
  const project = defaultProject()
  const track = project.tracks[0]
  project.clips.a = clip('a', track.id, 0)
  project.clips.b = clip('b', track.id, 5)
  track.clipIds = ['a', 'b']
  for (const id of ['a', 'b']) {
    project.assets.push({ id: `asset-${id}`, name: `${id}.png`, kind: 'image', url: `media://${id}`, size: 1, duration: 0, width: 1920, height: 1080, hasAudio: false })
  }
  for (const type of ['ramp-right', 'ramp-left', 'ramp-up', 'ramp-down', 'slide', 'whip', 'push'] as const) {
    project.clips.a.transitionOut = { type, duration: 0.8 }
    for (const time of [4.62, 4.75, 4.94, 5, 5.06, 5.25, 5.38]) {
      const entries = renderList(project, time)
      const outgoing = entries.find((entry) => entry.clip.id === 'a')!
      const incoming = entries.find((entry) => entry.clip.id === 'b')!
      assert.ok(outgoing && incoming, `${type} at ${time} has both frames`)
      const xSpan = Math.abs((outgoing.dx ?? 0) - (incoming.dx ?? 0))
      const ySpan = Math.abs((outgoing.dy ?? 0) - (incoming.dy ?? 0))
      assert.ok(xSpan <= project.settings.width + 0.001, `${type} at ${time} exposes a horizontal gap`)
      assert.ok(ySpan <= project.settings.height + 0.001, `${type} at ${time} exposes a vertical gap`)
      assert.equal(outgoing.alpha, 1)
      assert.equal(incoming.alpha, 1)
    }
  }
  // A dissolve does not fade both frames against black: since phase Ç2b.2
  // (decision 2) the two halves are a real mix, laid on a surface of their
  // own (incoming at g, outgoing added at 1 − g), so where both cover the
  // sum is whole; before, the incoming one sat under at full strength.
  for (const type of ['mix', 'zoom', 'blur', 'light-leak'] as const) {
    project.clips.a.transitionOut = { type, duration: 0.8 }
    const list = renderList(project, 5)
    const incoming = list.find((entry) => entry.clip.id === 'b')!
    const outgoing = list.find((entry) => entry.clip.id === 'a')!
    assert.equal(incoming.mix, 'in', type)
    assert.equal(outgoing.mix, 'out', type)
    assert.ok(Math.abs(incoming.alpha + outgoing.alpha - 1) < 1e-9, `${type}: the two halves make one whole (${incoming.alpha} + ${outgoing.alpha})`)
  }
})

test('all transition overlays stay below upper video tracks', async () => {
  const { renderList } = await import('../renderer/src/playback/render')
  const project = defaultProject()
  const lower = project.tracks[0]
  lower.clipIds = ['a', 'b']
  project.clips.a = clip('a', lower.id, 0)
  project.clips.b = clip('b', lower.id, 5)
  project.tracks.unshift({ ...lower, id: 'upper', clipIds: ['cover'] })
  project.clips.cover = { ...clip('cover', 'upper', 0), duration: 10 }
  for (const type of ['mix', 'fade', 'slide', 'wipe', 'zoom', 'flash', 'whip', 'blur', 'iris', 'push', 'ramp-right', 'ramp-left', 'ramp-up', 'ramp-down', 'speed-ramp', 'light-leak'] as const) {
    project.clips.a.transitionOut = { type, duration: 0.8 }
    for (const time of [4.65, 4.9, 5, 5.1, 5.35]) {
      const entries = renderList(project, time)
      assert.equal(entries.at(-1)?.clip.id, 'cover', `${type} must not paint over upper track at ${time}`)
      if (type !== 'speed-ramp') {
        assert.ok(entries.some(entry => entry.clip.id === 'a'))
        assert.ok(entries.some(entry => entry.clip.id === 'b'))
      }
    }
  }
})

test('a cut transition takes priority over per-clip ramp in/out at the same cut', async () => {
  const { clipVisualPoseAt, renderList, sampleClipMotion } = await import('../renderer/src/playback/render')
  const project = defaultProject()
  const track = project.tracks[0]
  const outgoing = clip('a', track.id, 0)
  const incoming = clip('b', track.id, 5)
  outgoing.transitionOut = { type: 'ramp-up', duration: 0.8 }
  outgoing.anim = { in: 'none', out: 'ramp-up', inDur: 0.5, outDur: 0.5 }
  incoming.anim = { in: 'ramp-up', out: 'none', inDur: 0.5, outDur: 0.5 }
  project.clips.a = outgoing
  project.clips.b = incoming
  track.clipIds = ['a', 'b']
  assert.equal(sampleClipMotion(outgoing, 5, 1920, 1080).alpha, 0)
  assert.equal(sampleClipMotion(incoming, 0, 1920, 1080).alpha, 0)
  const entries = renderList(project, 5)
  assert.ok(entries.filter((entry) => entry.suppressEdgeMotion).length >= 2)
  assert.equal(clipVisualPoseAt(project, outgoing, 5).animation.alpha, 1)
  assert.equal(clipVisualPoseAt(project, incoming, 5).animation.alpha, 1)
})

test('one-click ambient and transitions touch visual clips only and preserve existing motion', async () => {
  const { useStore } = await import('../renderer/src/state/store')
  const project = defaultProject()
  const video = project.tracks[0]
  const audio = project.tracks[1]
  project.clips.a = clip('a', video.id, 0)
  project.clips.b = clip('b', video.id, 5)
  project.clips.music = clip('music', audio.id, 0)
  project.clips.a.motionFx = { enabled: true, seed: 42, zoomFrom: 1, zoomTo: 1.05, panX: 0, panY: 0, shakeAmp: 0, shakeRotAmp: 0, shakeSpeed: 1, panFrom: 0, panTo: 0 }
  video.clipIds = ['a', 'b']
  audio.clipIds = ['music']
  project.assets.push(
    { id: 'asset-a', name: 'a.png', kind: 'image', url: 'media://a', size: 1, duration: 0, width: 1920, height: 1080, hasAudio: false },
    { id: 'asset-b', name: 'b.mp4', kind: 'video', url: 'media://b', size: 1, duration: 5, width: 1920, height: 1080, hasAudio: true },
    { id: 'asset-music', name: 'music.mp3', kind: 'audio', url: 'media://music', size: 1, duration: 5, width: 0, height: 0, hasAudio: true }
  )
  useStore.getState().loadProject(project)
  useStore.getState().applyAmbientFx('shadow-breathe', 0.4)
  const continuous = useStore.getState().project
  assert.equal(continuous.clips.a.ambientFx?.seed, continuous.clips.b.ambientFx?.seed)
  assert.equal(continuous.clips.a.ambientFx?.timeOffset, continuous.clips.a.start)
  assert.equal(continuous.clips.b.ambientFx?.timeOffset, continuous.clips.b.start)
  useStore.getState().applyTransitionPreset('light-leak', 0.7)
  useStore.getState().applyRampInOut('ramp-right', 0.45)
  const next = useStore.getState().project
  assert.equal(next.clips.a.ambientFx?.style, 'shadow-breathe')
  assert.equal(next.clips.b.ambientFx?.style, 'shadow-breathe')
  assert.equal(next.clips.music.ambientFx, undefined)
  assert.deepEqual(next.clips.a.motionFx, project.clips.a.motionFx)
  assert.equal(next.clips.a.transitionOut?.type, 'light-leak')
  assert.equal(next.clips.b.transitionOut, undefined)
  assert.equal(next.clips.a.anim?.in, 'ramp-right')
  assert.equal(next.clips.b.anim?.out, 'ramp-right')
  assert.equal(next.clips.music.anim, undefined)

  const originalPhase = next.clips.a.ambientFx?.seed
  useStore.getState().applyAmbientFx('living-frame', 0.45, undefined, 'image')
  const living = useStore.getState().project
  assert.equal(living.clips.a.ambientFx?.style, 'living-frame')
  assert.equal(living.clips.a.ambientFx?.seed, originalPhase)
  assert.equal(living.clips.b.ambientFx?.style, 'shadow-breathe')
  assert.deepEqual(living.clips.a.motionFx, project.clips.a.motionFx)
  useStore.getState().clearAmbientFx(undefined, undefined, 'living-frame')
  assert.equal(useStore.getState().project.clips.a.ambientFx, undefined)
  assert.equal(useStore.getState().project.clips.b.ambientFx?.style, 'shadow-breathe')
  useStore.getState().applyAmbientFx('living-frame', 0.45, undefined, 'image')
  useStore.getState().setClipEffect('a', { ambientFx: null })
  assert.equal(useStore.getState().project.clips.a.ambientFx, undefined)
  assert.equal(useStore.getState().project.clips.b.ambientFx?.style, 'shadow-breathe')
  useStore.getState().clearAmbientFx(undefined, 'video')
  assert.equal(useStore.getState().project.clips.a.ambientFx, undefined)
  assert.equal(useStore.getState().project.clips.b.ambientFx, undefined)
})

test('Living Frame uses one composite treatment and one continuous project-time clock', async () => {
  const { ambientPulse, livingFrameForEntries } = await import('../renderer/src/playback/render')
  const seed = 1502580027
  const cutTime = 5.42
  const beforeCut = ambientPulse(seed, cutTime)
  const afterCut = ambientPulse(seed, 0 + cutTime)
  assert.equal(beforeCut, afterCut)
  const lower = clip('lower', 'v1', 0)
  const upper = clip('upper', 'v2', 0)
  lower.ambientFx = { style: 'living-frame', amount: 0.6, seed, timeOffset: 0 }
  upper.ambientFx = { style: 'living-frame', amount: 0.6, seed, timeOffset: 0 }
  assert.equal(livingFrameForEntries([
    { clip: lower, alpha: 1, ghost: false },
    { clip: upper, alpha: 1, ghost: false }
  ])?.id, 'upper')
  assert.equal(livingFrameForEntries([{ clip: lower, alpha: 0, ghost: false }]), undefined)
  upper.ambientFx.style = 'edge-glow'
  assert.equal(livingFrameForEntries([
    { clip: lower, alpha: 1, ghost: false },
    { clip: upper, alpha: 1, ghost: false }
  ])?.id, 'lower')
})

test('new shapes start in the frame center and undo as one addition', async () => {
  const { useStore } = await import('../renderer/src/state/store')
  useStore.getState().loadProject(defaultProject())
  const id = useStore.getState().addShapeAtPlayhead('rect')
  const shape = useStore.getState().project.captions.find((caption) => caption.id === id)
  assert.equal(shape?.style?.posX, 0.5)
  assert.equal(shape?.style?.posY, 0.5)
  useStore.getState().undo()
  assert.equal(useStore.getState().project.captions.some((caption) => caption.id === id), false)
})

test('highlighting a subtitle places a vivid timed marker behind it', async () => {
  const { useStore } = await import('../renderer/src/state/store')
  const project = defaultProject()
  project.captions.push({ id: 'cue', start: 2, end: 5, text: 'A highlighted phrase', layer: 0 })
  useStore.getState().loadProject(project)
  const id = useStore.getState().addShapeAtPlayhead('marker', 'cue')
  const captions = useStore.getState().project.captions
  const marker = captions.find((caption) => caption.id === id)!
  const text = captions.find((caption) => caption.id === 'cue')!
  assert.equal(marker.start, text.start)
  assert.equal(marker.end, text.end)
  assert.equal(marker.layer, text.layer)
  assert.ok(marker.shape!.w > 0.04)
  assert.equal(marker.style!.bgOpacity, 1)
  assert.equal(marker.style!.bgColor, '#f1ef00')
  assert.equal(marker.anim?.in, 'none')
  assert.equal(marker.shape!.reveal, true)
  assert.ok(captions.indexOf(marker) < captions.indexOf(text))
  useStore.getState().undo()
  assert.equal(useStore.getState().project.captions.some((caption) => caption.id === id), false)
})

test('a fitted text marker stays attached through edits and toggles in one undo', async () => {
  const { useStore } = await import('../renderer/src/state/store')
  const project = defaultProject()
  project.captions.push({ id: 'title', start: 2, end: 5, text: 'A highlighted phrase', layer: 1, manual: true })
  useStore.getState().loadProject(project)
  useStore.getState().undoable(() => useStore.getState().setCaptionOwnStyle('title', {
    marker: { enabled: true, color: '#f1ef00', duration: 0.48, words: [1] }
  }))
  assert.equal(useStore.getState().project.captions.length, 1)
  assert.equal(useStore.getState().project.captions[0].style?.marker?.enabled, true)
  useStore.getState().updateCaption('title', { text: 'A much longer highlighted phrase' })
  assert.equal(useStore.getState().project.captions[0].style?.marker?.color, '#f1ef00')
  assert.deepEqual(useStore.getState().project.captions[0].style?.marker?.words, [3])
  useStore.getState().undo()
  assert.equal(useStore.getState().project.captions[0].text, 'A highlighted phrase')
  useStore.getState().undo()
  assert.equal(useStore.getState().project.captions[0].style?.marker, undefined)
})
