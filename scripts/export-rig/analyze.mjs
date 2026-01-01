// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase Ç3a: reading an exported file back (ffprobe, ffmpeg): its streams,
// its packet timing, the counter code burnt into the sources, the sharpness
// of an edge, the PSNR of two pictures.
import { spawnSync } from 'node:child_process'
import { ff, CODE_BITS } from './sources.mjs'

const BIG = 1 << 30

/** ffprobe's view of a file: the video and audio streams, the format, the
 *  video packets (pts in seconds, key or not). */
export function probeFile(file) {
  const fields = 'codec_type,codec_name,profile,level,width,height,pix_fmt,color_range,color_space,color_primaries,color_transfer,r_frame_rate,avg_frame_rate,time_base,start_time,duration,nb_frames,has_b_frames,bit_rate,sample_rate,channels'
  const r = spawnSync(ff('ffprobe'), ['-v', 'error', '-show_entries', `stream=${fields}:format=duration,bit_rate`, '-of', 'json', file], { encoding: 'utf8', windowsHide: true, maxBuffer: BIG })
  const j = JSON.parse(r.stdout || '{}')
  const v = (j.streams ?? []).find((s) => s.codec_type === 'video') ?? null
  const a = (j.streams ?? []).find((s) => s.codec_type === 'audio') ?? null
  const p = spawnSync(ff('ffprobe'), ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'packet=pts,flags', '-of', 'csv=p=0', file], { encoding: 'utf8', windowsHide: true, maxBuffer: BIG })
  const packets = p.stdout.trim().split(/\r?\n/).filter(Boolean).map((l) => {
    const [pts, flags] = l.split(',')
    return { pts: Number(pts), key: (flags ?? '').includes('K') }
  }).sort((x, y) => x.pts - y.pts)
  return { v, a, format: j.format ?? {}, packets }
}

const ratio = (s) => {
  const [n, d] = String(s ?? '0/1').split('/').map(Number)
  return d ? n / d : n
}

/** The checks a cell of the capability table makes on its file. `fps` is
 *  the rate asked ({ num, den }), `seconds` the length asked. */
export function checkFile(info, { w, h, num, den, seconds }) {
  const v = info.v
  if (!v) return { ok: false, why: 'no video stream' }
  const tb = String(v.time_base)
  const [tbn, tbd] = tb.split('/').map(Number)
  const frames = Math.round((seconds * num) / den)
  const nb = Number(v.nb_frames ?? info.packets.length)
  // pts in time-base units: exactly i × den/num seconds each.
  const ticksPerFrame = (tbd * den) / (num * tbn)
  let worst = 0
  info.packets.forEach((p, i) => (worst = Math.max(worst, Math.abs(p.pts - i * ticksPerFrame))))
  const keys = info.packets.filter((p) => p.key).map((p) => (p.pts * tbn) / tbd)
  const gaps = keys.slice(1).map((k, i) => +(k - keys[i]).toFixed(3))
  return {
    size: `${v.width}×${v.height}`,
    sizeOk: v.width === w && v.height === h,
    rate: v.r_frame_rate,
    rateOk: Math.abs(ratio(v.r_frame_rate) - num / den) < 1e-9,
    rateExact: v.r_frame_rate === `${num}/${den}`,
    timeBase: tb,
    nb,
    frames,
    countOk: nb === frames,
    ptsWorstTicks: +worst.toFixed(3),
    constant: worst <= 0.5,
    keyGaps: [...new Set(gaps)],
    level: v.level,
    profile: v.profile,
    color: `${v.color_primaries ?? '?'}/${v.color_transfer ?? '?'}/${v.color_space ?? '?'}/${v.color_range ?? '?'}`,
    bt709: v.color_primaries === 'bt709' && v.color_transfer === 'bt709' && v.color_space === 'bt709',
    bFrames: v.has_b_frames,
    bitrate: Number(v.bit_rate ?? info.format.bit_rate ?? 0),
    audio: info.a ? `${info.a.codec_name} ${info.a.sample_rate} ${info.a.channels}ch start ${info.a.start_time}` : 'none'
  }
}

/** The frame numbers the counter code shows in each frame of `file`. `rect`
 *  is where the source's picture lies in the output ({ x, y, w, h }, output
 *  pixels): its code strip is the top twelfth. */
export function readCounter(file, rect) {
  const stripH = rect.h / 12
  const cy = Math.round(rect.y + stripH * 0.25)
  const ch = Math.max(2, Math.round(stripH * 0.5))
  const cx = Math.round(rect.x)
  const cw = Math.round(rect.w) - (Math.round(rect.w) % CODE_BITS)
  const r = spawnSync(ff('ffmpeg'), ['-v', 'error', '-i', file, '-vf', `crop=${cw}:${ch}:${cx}:${cy},scale=${CODE_BITS * 4}:1:flags=area,format=gray`, '-f', 'rawvideo', '-'], { windowsHide: true, maxBuffer: BIG })
  if (r.status !== 0) throw new Error('ffmpeg (counter): ' + r.stderr)
  const out = []
  const per = CODE_BITS * 4
  for (let o = 0; o + per <= r.stdout.length; o += per) {
    let n = 0
    // The middle two of each block's four samples (its edges may be soft).
    for (let b = 0; b < CODE_BITS; b++) if ((r.stdout[o + b * 4 + 1] + r.stdout[o + b * 4 + 2]) / 2 > 128) n |= 1 << b
    out.push(n)
  }
  return out
}

/** Repeats and skips in a counter sequence against what the rates ask:
 *  output frame i shows source frame floor(i × srcFps / outFps + ε). */
export function counterReport(seq, srcFps, outFps, startFrame = 0) {
  let wrong = 0, repeats = 0, skips = 0, back = 0, expectedRepeats = 0, expectedSkips = 0
  const firstBad = []
  const want = (i) => startFrame + Math.floor((i * srcFps) / outFps + 1e-6)
  seq.forEach((n, i) => {
    if (n !== want(i)) {
      wrong++
      if (firstBad.length < 5) firstBad.push(`${i}:${n}≠${want(i)}`)
    }
    if (i > 0) {
      // A repeat: the same frame again; a skip: a frame jumped over.
      const d = n - seq[i - 1]
      const w = want(i) - want(i - 1)
      if (d === 0) repeats++
      else if (d < 0) back++
      else if (d > 1) skips += d - 1
      if (w === 0) expectedRepeats++
      else if (w > 1) expectedSkips += w - 1
    }
  })
  return { frames: seq.length, wrong, repeats, expectedRepeats, skips, expectedSkips, back, firstBad }
}

/** A picture as gray bytes: { w, h, px }. `file` is a PNG or a video (its
 *  frame at `at` seconds). */
export function grayFrame(file, at) {
  const args = ['-v', 'error', ...(at !== undefined ? ['-ss', String(at)] : []), '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-']
  const r = spawnSync(ff('ffmpeg'), args, { windowsHide: true, maxBuffer: BIG })
  if (r.status !== 0) throw new Error('ffmpeg (gray): ' + r.stderr)
  const s = spawnSync(ff('ffprobe'), ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file], { encoding: 'utf8', windowsHide: true })
  const [w, h] = s.stdout.trim().split(',').map(Number)
  return { w, h, px: r.stdout }
}

const median = (a) => {
  if (!a.length) return NaN
  const s = [...a].sort((x, y) => x - y)
  return s[Math.floor(s.length / 2)]
}

/** The 10–90 % rise of the sharp edges (black → white, in rows) inside
 *  `region` ({ x, y, w, h }) of a gray picture, in pixels: the median over
 *  every edge found. A crisp edge is about 0.8 px; a 2× upscale about 1.6. */
export function edgeWidth(g, region) {
  const widths = []
  const esf = []
  const x0 = Math.max(1, region.x), x1 = Math.min(g.w - 2, region.x + region.w)
  const y0 = Math.max(0, region.y), y1 = Math.min(g.h, region.y + region.h)
  const step = Math.max(1, Math.floor((y1 - y0) / 60))
  for (let y = y0; y < y1; y += step) {
    const row = g.px.subarray(y * g.w, (y + 1) * g.w)
    for (let x = x0; x < x1; x++) {
      // A rising crossing of the middle, with flat ground on both sides.
      if (!(row[x - 1] < 128 && row[x] >= 128)) continue
      let a = x - 1, b = x
      while (a > x0 - 1 && a > x - 12 && row[a - 1] < row[a]) a--
      while (b < x1 && b < x + 12 && row[b + 1] > row[b]) b++
      const lo = row[a], hi = row[b]
      if (hi - lo < 160) continue
      const at = (v) => {
        for (let i = a; i < b; i++) if (row[i] <= v && row[i + 1] > v) return i + (v - row[i]) / (row[i + 1] - row[i])
        return NaN
      }
      const w = at(lo + 0.9 * (hi - lo)) - at(lo + 0.1 * (hi - lo))
      if (Number.isFinite(w)) {
        widths.push(w)
        // The slanted-edge pool: every sample of this edge, placed by its
        // distance from the edge's 50 % crossing (sub-pixel), normalised.
        const x50 = at(lo + 0.5 * (hi - lo))
        // Only the near-vertical edges: the rows above and below cross the
        // middle within two pixels of here too (a near-horizontal edge does
        // not: the row above is all dark or all light there).
        const mid = lo + 0.5 * (hi - lo)
        const near = (yy) => {
          if (yy < 0 || yy >= g.h) return false
          const r2 = g.px.subarray(yy * g.w, (yy + 1) * g.w)
          return r2[Math.max(0, Math.floor(x50) - 3)] < mid && r2[Math.min(g.w - 1, Math.ceil(x50) + 3)] > mid
        }
        if (Number.isFinite(x50) && w < 6 && near(y - 1) && near(y + 1)) for (let i = Math.max(0, Math.floor(x50) - 6); i <= Math.min(g.w - 1, Math.ceil(x50) + 6); i++) esf.push([i - x50, (row[i] - lo) / (hi - lo)])
      }
      x = b
    }
  }
  // The edge spread function, 8 bins a pixel, from every edge at its own
  // phase (the checker is turned 5°, so the edges cross the pixel grid at
  // every phase): its 10–90 % rise is the phase-free width (a crisp edge
  // ≈ 0.8 px whatever its phase; one row's own rise varies 0.8–1.6).
  const B = 8
  const bins = new Map()
  for (const [d, v] of esf) {
    const k = Math.round(d * B)
    const e = bins.get(k) ?? [0, 0]
    e[0] += v
    e[1]++
    bins.set(k, e)
  }
  const keys = [...bins.keys()].sort((a, b) => a - b)
  const curve = keys.map((k) => [k / B, bins.get(k)[0] / bins.get(k)[1]])
  const cross = (v) => {
    for (let i = 1; i < curve.length; i++) if (curve[i - 1][1] < v && curve[i][1] >= v) return curve[i - 1][0] + ((v - curve[i - 1][1]) / (curve[i][1] - curve[i - 1][1])) * (curve[i][0] - curve[i - 1][0])
    return NaN
  }
  return { median: +median(widths).toFixed(3), esf: +(cross(0.9) - cross(0.1)).toFixed(3), edges: widths.length }
}

/** The PSNR of two pictures of one size (RGB, dB; Infinity when equal). */
export function psnr(fileA, fileB) {
  const rgb = (f) => {
    const r = spawnSync(ff('ffmpeg'), ['-v', 'error', '-i', f, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { windowsHide: true, maxBuffer: BIG })
    if (r.status !== 0) throw new Error('ffmpeg (rgb): ' + r.stderr)
    return r.stdout
  }
  const a = rgb(fileA), b = rgb(fileB)
  if (a.length !== b.length) throw new Error(`psnr: sizes differ (${a.length} vs ${b.length} bytes)`)
  let se = 0
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i]
    se += d * d
  }
  const mse = se / a.length
  return mse === 0 ? Infinity : +(10 * Math.log10((255 * 255) / mse)).toFixed(2)
}

/** PSNR of two RGBA byte arrays of one size (the alpha left out). */
export function psnrBytes(a, b) {
  let se = 0, n = 0
  for (let i = 0; i < a.length; i++) {
    if (i % 4 === 3) continue
    const d = a[i] - b[i]
    se += d * d
    n++
  }
  const mse = se / n
  return mse === 0 ? Infinity : +(10 * Math.log10((255 * 255) / mse)).toFixed(2)
}
