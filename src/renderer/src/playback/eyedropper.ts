// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The green screen's eyedropper ("cila" part D): the key colour is read from
// the clip's OWN picture at the clicked point, not from the screen.
//
// The screen canvas holds everything drawn so far: the clip already graded
// and keyed, the tracks over it, the guides and the handles. A colour read
// there was whatever happened to lie under the pointer (a handle, a caption,
// a picture after its LUT). Here the clip is drawn alone, where it stands,
// with nothing done to its colours, by the export's own frame drawer (the
// frame the file would hold at that moment), and the colours around the
// point are averaged (compression noise is not the screen's colour).
import type { Clip, Project } from '../types'
import { assetById } from '../types'
import { clipTransformAt } from './pose'

/** The clip's picture alone: its place, size, turn, crop and motion kept;
 *  colour, effects, key, mask, blend, fades and transitions taken off. */
export function sourceOnly(project: Project, clipId: string): Project | null {
  const clip = project.clips[clipId]
  const track = clip && project.tracks.find((t) => t.id === clip.trackId)
  if (!clip || !track) return null
  const plain: Clip = { ...clip }
  for (const k of [
    'grade', 'tone', 'lut', 'lutAmount', 'chroma', 'duotone', 'sharpen', 'vignette', 'grain', 'glow', 'chromaAb', 'videoFx', 'blur', 'mask', 'look', 'cameraLook', 'ambientFx', 'stillImageFx',
    'blendMode', 'bloom', 'halation', 'mosaic', 'isolate', 'fxKeys', 'anim', 'transitionIn', 'transitionOut', 'disabled', 'linkId'
  ] as const) delete (plain as unknown as Record<string, unknown>)[k]
  plain.opacity = 1
  if (plain.channels?.opacity) {
    const { opacity: _gone, ...rest } = plain.channels
    void _gone
    plain.channels = rest
  }
  const { backdrop: _b, cameraLook: _l, ...rest } = project as Project & { cameraLook?: unknown }
  void _b
  void _l
  return {
    ...(rest as Project),
    mode: 'frame',
    tracks: [{ ...track, hidden: false, clipIds: [clipId] }],
    clips: { [clipId]: plain },
    captions: [],
    templates: [],
    unknownTemplates: [],
    groups: [],
    markers: [],
    notes: [],
    shortSegments: []
  }
}

/** Is the point (project pixels) on the clip's picture at `time`? */
export function pointOnClip(project: Project, clip: Clip, time: number, wx: number, wy: number): boolean {
  const asset = assetById(project, clip.assetId)
  const w = clip.nested ? project.settings.width : asset?.width || 0
  const h = clip.nested ? project.settings.height : asset?.height || 0
  if (!w || !h) return false
  const t = clipTransformAt(clip, time - clip.start)
  const dx = wx - t.x
  const dy = wy - t.y
  const cos = Math.cos(-t.rotation)
  const sin = Math.sin(-t.rotation)
  const s = Math.max(1e-6, t.scale)
  let lx = (dx * cos - dy * sin) / s / w + 0.5
  let ly = (dx * sin + dy * cos) / s / h + 0.5
  if (clip.flipH) lx = 1 - lx
  if (clip.flipV) ly = 1 - ly
  const c = clip.crop ?? { l: 0, t: 0, r: 0, b: 0 }
  return lx >= c.l && lx <= 1 - c.r && ly >= c.t && ly <= 1 - c.b
}

/** The average colour of a block of RGBA pixels, as #rrggbb. */
export function averageHex(px: Uint8ClampedArray | number[]): string {
  let r = 0
  let g = 0
  let b = 0
  const n = Math.max(1, Math.floor(px.length / 4))
  for (let i = 0; i + 3 < px.length; i += 4) {
    r += px[i]
    g += px[i + 1]
    b += px[i + 2]
  }
  return '#' + [r, g, b].map((v) => Math.round(v / n).toString(16).padStart(2, '0')).join('')
}

/** The colour of `clipId`'s own picture at a point of the frame (project
 *  pixels) at `time`; null when the point is not on the picture or its frame
 *  cannot be read. */
export async function pickSourceColour(project: Project, clipId: string, time: number, wx: number, wy: number): Promise<string | null> {
  const alone = sourceOnly(project, clipId)
  if (!alone) return null
  if (!pointOnClip(alone, alone.clips[clipId], time, wx, wy)) return null
  const ex = await import('../export/exporter')
  await ex.preloadImagesForExport(alone)
  const { width, height } = alone.settings
  const drawer = ex.frameDrawer(alone, { w: width, h: height, shorts: false, captions: false, quality: 'final', lenient: true })
  try {
    await drawer.draw(time)
    if (drawer.leftOut.length) return null
    const g = drawer.canvas.getContext('2d')
    if (!g) return null
    // Five by five around the point, held inside the frame.
    const x = Math.max(0, Math.min(width - 5, Math.round(wx) - 2))
    const y = Math.max(0, Math.min(height - 5, Math.round(wy) - 2))
    return averageHex(g.getImageData(x, y, Math.min(5, width), Math.min(5, height)).data)
  } finally {
    drawer.close()
  }
}
