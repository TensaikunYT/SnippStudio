// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase Ç3b: reading an exported file's sound back (ffmpeg): the samples, the
// clicks at cuts, the true peak, the images a resampler leaves, the flashes
// and clicks of the sync source, and a process's memory.
import { spawn, spawnSync } from 'node:child_process'
import { ff } from './sources.mjs'

const BIG = 2 ** 31

/** The sound of `file` as float samples at 48 kHz: { sr, ch, data } with
 *  `data` interleaved (no resampling when it is 48 kHz already). */
export function samples(file, { channels = 2, rate = 48000 } = {}) {
  const r = spawnSync(ff('ffmpeg'), ['-v', 'error', '-i', file, '-vn', '-f', 'f32le', '-acodec', 'pcm_f32le', '-ac', String(channels), '-ar', String(rate), '-'], { windowsHide: true, maxBuffer: BIG })
  if (r.status !== 0) throw new Error('ffmpeg (samples): ' + r.stderr)
  const buf = r.stdout
  const data = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4))
  return { sr: rate, ch: channels, data: new Float32Array(data) }
}

/** Steps |x[n] − x[n−1]| > `step` on any channel within ±`ms` of each cut
 *  time (seconds): the count, and the worst step there. */
export function clicksAt(s, cuts, { ms = 2, step = 0.1 } = {}) {
  const { sr, ch, data } = s
  const frames = data.length / ch
  let count = 0
  let worst = 0
  const per = []
  for (const t of cuts) {
    const a = Math.max(1, Math.floor((t - ms / 1000) * sr))
    const b = Math.min(frames - 1, Math.ceil((t + ms / 1000) * sr))
    let n = 0
    let w = 0
    for (let i = a; i <= b; i++) {
      for (let c = 0; c < ch; c++) {
        const d = Math.abs(data[i * ch + c] - data[(i - 1) * ch + c])
        if (d > w) w = d
        if (d > step) n++
      }
    }
    count += n
    worst = Math.max(worst, w)
    per.push(+w.toFixed(4))
  }
  return { cuts: cuts.length, count, worst: +worst.toFixed(4), worstPerCut: per }
}

/** ffmpeg's EBU R128 meter on `file`: integrated loudness and the true peak
 *  (dBTP), and the sample peak and samples at or past full scale. */
export function truePeak(file) {
  const r = spawnSync(ff('ffmpeg'), ['-hide_banner', '-nostats', '-i', file, '-vn', '-af', 'ebur128=peak=true+sample:framelog=quiet', '-f', 'null', '-'], { encoding: 'utf8', windowsHide: true, maxBuffer: BIG })
  const txt = r.stderr
  const num = (re) => {
    const m = re.exec(txt)
    return m ? Number(m[1]) : null
  }
  const tp = num(/True peak:\s*\n\s*Peak:\s*(-?[\d.]+|-inf)\s*dBFS/)
  const sp = num(/Sample peak:\s*\n\s*Peak:\s*(-?[\d.]+|-inf)\s*dBFS/)
  const I = num(/Integrated loudness:\s*\n\s*I:\s*(-?[\d.]+)\s*LUFS/)
  const s = samples(file)
  let over = 0
  for (const v of s.data) if (Math.abs(v) >= 0.999) over++
  return { truePeak: tp, samplePeak: sp, lufs: I, atFullScale: over }
}

/** Radix-2 FFT in place (re, im of length 2^k). */
function fft(re, im) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j], re[i]]
      ;[im[i], im[j]] = [im[j], im[i]]
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang), wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2
        const xr = re[b] * cr - im[b] * ci
        const xi = re[b] * ci + im[b] * cr
        re[b] = re[a] - xr
        im[b] = im[a] - xi
        re[a] += xr
        im[a] += xi
        const t = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = t
      }
    }
  }
}

/** The images a resampler left in an exported log sweep (f0 → f1 over
 *  `dur` seconds, starting at `start` in the file): per 1024-sample frame
 *  (Blackman-Harris), the strongest bin away from the band the sweep crossed
 *  in that frame, against the frame's peak (dB). The worst over the sweep,
 *  and the frequency it sat at. Frames of the first and last 0.1 s are left
 *  out (the sweep's own on and off). */
export function sweepImages(s, { start = 0, dur = 10, f0 = 20, f1 = 20000, guardBins = 6, from = 200 } = {}) {
  const { sr, ch, data } = s
  const N = 1024
  const win = new Float64Array(N)
  for (let i = 0; i < N; i++) {
    const x = (2 * Math.PI * i) / (N - 1)
    win[i] = 0.35875 - 0.48829 * Math.cos(x) + 0.14128 * Math.cos(2 * x) - 0.01168 * Math.cos(3 * x)
  }
  const fAt = (t) => f0 * Math.exp((t / dur) * Math.log(f1 / f0))
  const hz = sr / N
  let worst = -Infinity
  let worstAt = null
  const frames = data.length / ch
  for (let a = Math.round((start + 0.1) * sr); a + N <= Math.min(frames, Math.round((start + dur - 0.1) * sr)); a += N / 2) {
    const t0 = a / sr - start
    const t1 = (a + N) / sr - start
    const lo = fAt(t0), hi = fAt(t1)
    if (hi < from) continue
    const re = new Float64Array(N), im = new Float64Array(N)
    for (let i = 0; i < N; i++) re[i] = data[(a + i) * ch] * win[i]
    fft(re, im)
    let peak = 0
    const mag = new Float64Array(N / 2)
    for (let k = 1; k < N / 2; k++) {
      mag[k] = Math.hypot(re[k], im[k])
      if (mag[k] > peak) peak = mag[k]
    }
    const kLo = Math.floor(lo / hz) - guardBins, kHi = Math.ceil(hi / hz) + guardBins
    let other = 0, otherK = 0
    for (let k = 2; k < N / 2; k++) {
      if (k >= kLo && k <= kHi) continue
      if (mag[k] > other) {
        other = mag[k]
        otherK = k
      }
    }
    const db = 20 * Math.log10(Math.max(1e-12, other) / Math.max(1e-12, peak))
    if (db > worst) {
      worst = db
      worstAt = { t: +t0.toFixed(3), sweep: Math.round((lo + hi) / 2), image: Math.round(otherK * hz) }
    }
  }
  return { worstDb: +worst.toFixed(1), at: worstAt }
}

/** The sync source read back: the flash frames (mean luma of a frame over
 *  128) and the clicks (the first sample over 0.3, half a second after the last),
 *  paired second by second: offsets flash − click (ms), the first and last
 *  ten, and the slope of a straight line through them (ms per 10 minutes). */
export function syncReport(file, fps) {
  const r = spawnSync(ff('ffmpeg'), ['-v', 'error', '-i', file, '-an', '-vf', 'scale=8:8:flags=area,format=gray', '-f', 'rawvideo', '-'], { windowsHide: true, maxBuffer: BIG })
  if (r.status !== 0) throw new Error('ffmpeg (luma): ' + r.stderr)
  const flashes = []
  for (let i = 0, o = 0; o + 64 <= r.stdout.length; i++, o += 64) {
    let s = 0
    for (let k = 0; k < 64; k++) s += r.stdout[o + k]
    if (s / 64 > 128) flashes.push(i / fps)
  }
  const a = samples(file, { channels: 1 })
  const clicks = []
  let last = -1
  for (let i = 0; i < a.data.length; i++) {
    if (Math.abs(a.data[i]) > 0.3 && (last < 0 || i - last > 0.5 * a.sr)) {
      clicks.push(i / a.sr)
      last = i
    }
  }
  // Pair each flash with the click nearest it (within half a second).
  const pairs = []
  let j = 0
  for (const f of flashes) {
    while (j + 1 < clicks.length && Math.abs(clicks[j + 1] - f) < Math.abs(clicks[j] - f)) j++
    if (clicks.length && Math.abs(clicks[j] - f) < 0.5) pairs.push([f, (f - clicks[j]) * 1000])
  }
  const n = pairs.length
  let sx = 0, sy = 0, sxx = 0, sxy = 0
  for (const [x, y] of pairs) {
    sx += x
    sy += y
    sxx += x * x
    sxy += x * y
  }
  const slope = n > 1 ? (n * sxy - sx * sy) / (n * sxx - sx * sx) : 0
  const off = pairs.map(([, y]) => y)
  const abs = off.map(Math.abs)
  return {
    flashes: flashes.length,
    clicks: clicks.length,
    pairs: n,
    headMs: off.slice(0, 10).map((v) => +v.toFixed(2)),
    tailMs: off.slice(-10).map((v) => +v.toFixed(2)),
    worstMs: +Math.max(0, ...abs).toFixed(2),
    meanMs: n ? +(sy / n).toFixed(2) : null,
    slopeMsPer10Min: +(slope * 600).toFixed(3)
  }
}

/** Follows the memory of the processes `pids` once a second (PowerShell,
 *  private bytes and working set), until stop(): their peaks (MB). */
export function watchMemory(pids) {
  const script = `$ErrorActionPreference='SilentlyContinue'; while ($true) { foreach ($p in @(${pids.join(',')})) { $g = Get-Process -Id $p; if ($g) { Write-Output ("$p " + $g.PrivateMemorySize64 + " " + $g.WorkingSet64 + " " + $g.PeakWorkingSet64) } }; Start-Sleep -Milliseconds 1000 }`
  const ps = spawn('powershell', ['-NoProfile', '-Command', script], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
  const peak = {}
  const series = []
  const t0 = Date.now()
  let rest = ''
  ps.stdout.on('data', (b) => {
    rest += b.toString()
    const lines = rest.split(/\r?\n/)
    rest = lines.pop()
    for (const l of lines) {
      const [pid, priv, ws, pws] = l.trim().split(/\s+/).map(Number)
      if (!pid) continue
      const e = (peak[pid] ??= { private: 0, workingSet: 0, peakWorkingSet: 0 })
      e.private = Math.max(e.private, priv / 2 ** 20)
      e.workingSet = Math.max(e.workingSet, ws / 2 ** 20)
      e.peakWorkingSet = Math.max(e.peakWorkingSet, pws / 2 ** 20)
      series.push([+((Date.now() - t0) / 1000).toFixed(1), pid, Math.round(priv / 2 ** 20)])
    }
  })
  return {
    peak,
    series,
    stop() {
      try {
        spawnSync('taskkill', ['/PID', String(ps.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
      } catch {
        /* gone */
      }
      for (const k of Object.keys(peak)) for (const f of Object.keys(peak[k])) peak[k][f] = Math.round(peak[k][f])
      return peak
    }
  }
}

/** The app's processes by kind (the electron main process's children). */
export function appProcesses(mainPid) {
  const r = spawnSync('powershell', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process -Filter "ParentProcessId=${mainPid}" | ForEach-Object { "$($_.ProcessId) $($_.CommandLine)" }`], { encoding: 'utf8', windowsHide: true })
  return r.stdout.split(/\r?\n/).filter(Boolean).map((l) => {
    const [pid, ...rest] = l.trim().split(' ')
    const cmd = rest.join(' ')
    const type = /--type=([\w-]+)/.exec(cmd)?.[1] ?? 'main?'
    return { pid: Number(pid), type, utility: /--utility-sub-type=([\w.-]+)/.exec(cmd)?.[1] }
  })
}
