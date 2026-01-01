// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The 5c + 5d audit patch, clock items (FAZ5-PLAN.md "5c + 5d denetim
// yaması"; haritalar\_faz5-denetim-saat.md, whose probe pages these are).
// Each page draws the numbers it reads (performance.now, animations'
// current times, counters) as 24-bit black / white blocks; the same moment is
// asked by several ways (the export's own exactFrame, and exportFramePng) and
// the numbers are read back exactly. Ways:
//   W  fresh load, the bin's strip left to finish, then T
//   AW fresh load, strip, then every 1/30 s from 0 to T (as playing)
//   R  (after AW) T + 2.5, then T (back)
//   B  fresh load, T + 1.3, T − 0.9, then T (scrub)
//   S  fresh load, strip, 2 s, 300 ms idle, then T (e2e 78's way)
//   Z  fresh load, strip, 0, then T
//   E  exportFramePng(T) after a fresh load and the strip
//   EP the preview played 0 → T, then exportFramePng(T)
// Items:
//   S-1 a canvas page "pure" at its first second but with state later (a
//       timer, an interval, a dt integration, free GSAP) is not pure and
//       every way gives the same numbers;
//   S-2 an `animation-play-state` changed later by the page's CSS; S-5 the
//       page's playbackRate change from where it stands;
//   S-3 a start the clock does not drive (a network answer, an animation
//       event, an IntersectionObserver) makes the clip "unstable"; pages
//       with timers and media only do not;
//   S-4 back at 0 the frame 0 is not drawn twice (a page that counts its
//       frames: F3, and a counter);
//   S-7 a video that cannot load does not hold every frame.
import { cpSync, copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TESTDATA } from '../media.mjs'

export const name = 'code-clip-clock-audit'
export const timeoutMs = 1_200_000

const B = 16
const BITS_CANVAS = `
function enc(v){ if(typeof v!=='number'||!isFinite(v)) return 0; var e=Math.round(v*10)+8388608; return Math.max(0,Math.min(16777215,e)); }
function drawBits(g, vals, y0){ for(var r=0;r<vals.length;r++){var e=enc(vals[r]); for(var b=0;b<24;b++){ g.fillStyle=((e>>(23-b))&1)?'#fff':'#000'; g.fillRect(b*${B}, y0+r*${B}, ${B}, ${B});} } }
`
const BITS_DOM = (rows) => `
function enc(v){ if(typeof v!=='number'||!isFinite(v)) return 0; var e=Math.round(v*10)+8388608; return Math.max(0,Math.min(16777215,e)); }
var cells=[]; (function(){ var box=document.createElement('div'); box.style.cssText='position:absolute;left:0;top:0;width:${24 * B}px;height:${rows * B}px;background:#000';
 for(var r=0;r<${rows};r++){ cells.push([]); for(var b=0;b<24;b++){ var d=document.createElement('div'); d.style.cssText='position:absolute;width:${B}px;height:${B}px;left:'+(b*${B})+'px;top:'+(r*${B})+'px;background:#000'; box.appendChild(d); cells[r].push(d);} }
 document.body.appendChild(box); })();
function drawBits(_g, vals){ for(var r=0;r<vals.length&&r<cells.length;r++){var e=enc(vals[r]); for(var b=0;b<24;b++){ cells[r][b].style.background=((e>>(23-b))&1)?'#fff':'#000'; } } }
`
const head = (title, more = '') => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>html,body{margin:0;background:#000;overflow:hidden}canvas{display:block}${more}</style>`

const PAGES = {
  // S-1: still for its first second; a timer at 1.5 s marks a start, a 1 s interval counts.
  'p1-pure-trap':
    head('p1') +
    `</head><body><canvas id="c" width="640" height="360"></canvas><script>${BITS_CANVAS}
var g=document.getElementById('c').getContext('2d'); var start=null, count=0;
setTimeout(function(){ start=performance.now() }, 1500);
setInterval(function(){ count++ }, 1000);
function frame(){ var now=performance.now(); g.fillStyle='#123'; g.fillRect(0,0,640,360);
 var x = start===null?0:(now-start)*0.1; g.fillStyle='#f44'; g.fillRect(20+x,140,120,120);
 g.fillStyle='#4f4'; for(var i=0;i<count;i++) g.fillRect(20+i*20,300,14,40);
 drawBits(g,[now, start===null?-1:start, count],0); requestAnimationFrame(frame); }
requestAnimationFrame(frame);
</script></body></html>`,
  // S-1: still for 1.2 s, then x += v*dt; v *= 0.95 (rAF only).
  'p2-dt-late':
    head('p2') +
    `</head><body><canvas id="c" width="640" height="360"></canvas><script>${BITS_CANVAS}
var g=document.getElementById('c').getContext('2d'); var x=0,v=0,last=null;
function frame(t){ var dt = last===null?0:(t-last)/1000; last=t;
 if(t>1200){ if(v===0&&x===0) v=400; x+=v*dt; v*=0.95; }
 g.fillStyle='#222'; g.fillRect(0,0,640,360); g.fillStyle='#fc3'; g.fillRect(20+x,140,120,120);
 drawBits(g,[t,x,v],0); requestAnimationFrame(frame); }
requestAnimationFrame(frame);
</script></body></html>`,
  // S-1: free GSAP tweens (repeat / yoyo, a delayedCall) painting a canvas.
  'p4-gsap-trap':
    head('p4') +
    `<script src="gsap.min.js"></script></head><body><canvas id="c" width="640" height="360"></canvas><script>${BITS_CANVAS}
var g=document.getElementById('c').getContext('2d'); var a={x:0}, b={x:0};
gsap.to(a,{x:300,duration:0.7,repeat:-1,yoyo:true,ease:'none'});
gsap.delayedCall(1.5,function(){ gsap.to(b,{x:500,duration:3,ease:'none'}) });
function paint(){ g.fillStyle='#111'; g.fillRect(0,0,640,360); g.fillStyle='#5af'; g.fillRect(20+a.x,120,60,60); g.fillStyle='#fa5'; g.fillRect(20+b.x,220,120,120);
 drawBits(g,[gsap.ticker.time*1000, a.x, b.x],0); }
gsap.ticker.add(paint);
</script></body></html>`,
  // S-4: a canvas page that counts its frames.
  's4-count':
    head('s4') +
    `</head><body><canvas id="c" width="640" height="360"></canvas><script>${BITS_CANVAS}
var g=document.getElementById('c').getContext('2d'); var frames=0;
function frame(t){ frames++; g.fillStyle='#246'; g.fillRect(0,0,640,360); g.fillStyle='#fff'; g.fillRect(20+(frames%300),200,40,40); drawBits(g,[t,frames],0); requestAnimationFrame(frame) }
requestAnimationFrame(frame);
</script></body></html>`,
  // S-2 (row 2), S-5 (row 3): the animation holder, whole page.
  'h3-holder':
    head('h3') +
    `</head><body><script>window.__config={width:384,height:160,fps:30,duration:10};
var HIDE='visibility:hidden'; var G=null;
${BITS_DOM(10)}
var st=document.createElement('style'); st.textContent='@keyframes k{from{opacity:.2}to{opacity:.9}} .ea{animation:k 2s linear -0.5s infinite alternate} .eb{animation:k 4s linear infinite;animation-play-state:paused} .eb.run{animation-play-state:running} .ee{animation:k 5s linear} .tr{transition:opacity 2s linear;opacity:.1} .tr.on{opacity:.9}'; document.head.appendChild(st);
function mk(cls){ var d=document.createElement('div'); d.className=cls; d.style.cssText='position:absolute;left:0;top:0;width:4px;height:4px;'+HIDE; document.body.appendChild(d); return d; }
var A=mk('ea'), Bb=mk('eb'), C=mk('cc'), Dd=mk('dd'), T=mk('tr'), E=null;
var aC=C.animate([{opacity:.2},{opacity:.9}],{duration:10000,fill:'both'});
var aD=Dd.animate([{opacity:.2},{opacity:.9}],{duration:10000,fill:'both'});
var d0=Date.now();
setTimeout(function(){ Bb.classList.add('run') },1000);
setTimeout(function(){ Bb.classList.remove('run') },3000);
setTimeout(function(){ aC.pause() },1000);
setTimeout(function(){ aC.currentTime=500 },2000);
setTimeout(function(){ aC.play() },2500);
setTimeout(function(){ aC.playbackRate=2 },3000);
setTimeout(function(){ E=mk('ee') },1250);
setTimeout(function(){ T.classList.add('on') },1500);
setTimeout(function(){ aD.startTime=document.timeline.currentTime-300 },500);
var count=0; setInterval(function(){count++},1000);
function cur(el){ if(!el) return -1; var l=el.getAnimations(); return l.length? l[0].currentTime : -2 }
function frame(){ drawBits(G,[performance.now(), cur(A), cur(Bb), aC.currentTime, cur(E), count, cur(T), aD.currentTime, document.timeline.currentTime, Date.now()-d0],0); requestAnimationFrame(frame) }
requestAnimationFrame(frame);
</script></body></html>`,
  // S-3: a transition started by a fetch answer.
  'l2-fetch-transition':
    head('l2', '.bx{position:absolute;left:20px;top:60px;width:60px;height:60px;background:#0af;transition:transform 3s linear}.bx.on{transform:translateX(250px)}') +
    `</head><body><div class="bx" id="bx"></div><script>window.__config={width:384,height:160,fps:30,duration:10};
${BITS_DOM(2)}
var bx=document.getElementById('bx');
setTimeout(function(){ fetch('data.txt').then(function(r){return r.text()}).then(function(){ bx.classList.add('on') }) },1000);
function frame(t){ var l=bx.getAnimations(); drawBits(null,[t, l.length?l[0].currentTime:-2]); requestAnimationFrame(frame) }
requestAnimationFrame(frame);
</script></body></html>`,
  // S-3: an animationend chain (X 1 s ends → Y 5 s starts).
  'h4-chain':
    head('h4', '@keyframes k{from{opacity:.2}to{opacity:.9}} .x{animation:k 1s linear} .y.go{animation:k 5s linear}') +
    `</head><body><script>window.__config={width:384,height:160,fps:30,duration:10};
${BITS_DOM(3)}
function mk(cls){ var d=document.createElement('div'); d.className=cls; d.style.cssText='position:absolute;left:300px;top:0;width:4px;height:4px'; document.body.appendChild(d); return d; }
var X=mk('x'), Y=mk('y'); var ends=0; X.addEventListener('animationend',function(){ ends++; Y.classList.add('go') });
function cur(el){ var l=el.getAnimations(); return l.length?l[0].currentTime:-2 }
function frame(t){ drawBits(null,[t, cur(Y), ends]); requestAnimationFrame(frame) }
requestAnimationFrame(frame);
</script></body></html>`,
  // S-3: motion begun by a fetch answer and by an IntersectionObserver (no Animation object).
  'l1-miss':
    head('l1') +
    `</head><body><script>window.__config={width:384,height:160,fps:30,duration:10};
${BITS_DOM(3)}
var fstart=null; setTimeout(function(){ fetch('data.txt').then(function(r){return r.text()}).then(function(){ fstart=performance.now() }) },1000);
var ostart=null; var tgt=document.createElement('div'); tgt.style.cssText='position:absolute;left:2000px;top:120px;width:20px;height:20px;background:#08f'; document.body.appendChild(tgt);
new IntersectionObserver(function(es){ es.forEach(function(e){ if(e.isIntersecting&&ostart===null) ostart=performance.now() }) }).observe(tgt);
setTimeout(function(){ tgt.style.left='200px' },2000);
function frame(t){ drawBits(null,[t, fstart===null?-1:t-fstart, ostart===null?-1:t-ostart]); requestAnimationFrame(frame) }
requestAnimationFrame(frame);
</script></body></html>`,
  // S-3, no false alarm: a class toggled from a microtask after each frame, a console.log, a layout read.
  'l0-false-late':
    head('l0', '.bx{position:absolute;left:20px;top:80px;width:60px;height:60px;background:#f80;transition:transform .5s linear}.bx.r{transform:translateX(200px)}') +
    `</head><body><div class="bx" id="bx"></div><script>window.__config={width:384,height:160,fps:30,duration:10};
${BITS_DOM(2)}
var bx=document.getElementById('bx'); var n=0;
function frame(t){ n++; var r=bx.getBoundingClientRect(); console.log('frame', n, r.left);
 Promise.resolve().then(function(){ if(n%30===0) bx.classList.toggle('r') });
 var l=bx.getAnimations(); drawBits(null,[t, l.length?l[0].currentTime:-1]); requestAnimationFrame(frame) }
requestAnimationFrame(frame);
</script></body></html>`,
  // S-3, no false alarm: media on the clock (a looping video started by a script, an autoplay one).
  'm1-media':
    head('m1', 'video{position:absolute;width:160px;height:90px}') +
    `</head><body><video id="v1" src="clip.mp4" loop muted playsinline style="left:0;top:80px"></video><video id="v2" src="clip.mp4" autoplay muted playsinline style="left:180px;top:80px"></video><script>window.__config={width:384,height:200,fps:30,duration:12};
${BITS_DOM(5)}
var v1=document.getElementById('v1'), v2=document.getElementById('v2'); var ended=0, tu=0;
v1.addEventListener('ended',function(){ended++}); v2.addEventListener('ended',function(){ended+=1000}); v2.addEventListener('timeupdate',function(){tu++});
setTimeout(function(){ v1.playbackRate=2; v1.play() },1000);
function frame(t){ drawBits(null,[t, v1.currentTime*1000, v2.currentTime*1000, ended, tu]); requestAnimationFrame(frame) }
requestAnimationFrame(frame);
</script></body></html>`,
  // S-7: a video that cannot load, played by a script at 0.5 s.
  'm2-broken-video':
    head('m2', 'video{position:absolute;width:160px;height:90px}') +
    `</head><body><video id="v" src="broken.mp4" muted playsinline style="left:0;top:60px"></video><script>window.__config={width:384,height:160,fps:30,duration:6};
${BITS_DOM(1)}
var v=document.getElementById('v'); setTimeout(function(){ v.play().catch(function(){}) },500);
function frame(t){ drawBits(null,[t]); requestAnimationFrame(frame) }
requestAnimationFrame(frame);
</script></body></html>`
}

function writePages(work) {
  const dirs = {}
  for (const [n, html] of Object.entries(PAGES)) {
    const dir = join(work, n)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'index.html'), html)
    dirs[n] = dir
  }
  copyFileSync(join(TESTDATA, 'kod-klibi-serbest', 'F4-gsap', 'gsap.min.js'), join(dirs['p4-gsap-trap'], 'gsap.min.js'))
  for (const n of ['l2-fetch-transition', 'l1-miss']) writeFileSync(join(dirs[n], 'data.txt'), 'x'.repeat(2000))
  copyFileSync(join(TESTDATA, 'e2e', 'other.mp4'), join(dirs['m1-media'], 'clip.mp4'))
  writeFileSync(join(dirs['m2-broken-video'], 'broken.mp4'), 'this is not a video')
  const f3 = join(work, 'F3-three')
  cpSync(join(TESTDATA, 'kod-klibi-serbest', 'F3-three'), f3, {
    recursive: true
  })
  dirs.F3 = f3
  return dirs
}

/** One page, the moment T asked by each of `paths`: the numbers read back,
 *  the frame's hash, whether the film says "unstable", the time it took. */
async function measure(c, folder, T, rows, paths) {
  return c.run(
    async (folder, T, rows, paths) => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
      const S = window.__store
      const [films, imp] = await window.__codeFilm()
      const info = await window.api.codeFilm.register(folder)
      const a0 = (await imp.codeFilmImport(info)).assets.find((a) => a.kind === 'code')
      a0.duration = Math.max(a0.duration || 0, T + 5)
      const [a] = S.getState().addAssets([a0])
      const id = (a ?? a0).id
      const asset = () => S.getState().project.assets.find((x) => x.id === id)
      const waitReady = async () => {
        const t0 = performance.now()
        while (performance.now() - t0 < 150000) {
          films.codeFilms.ensure(asset())
          const st = films.codeFilms.status(id)
          if (st?.state === 'ready' || st?.state === 'error') break
          await sleep(50)
        }
      }
      await waitReady()
      const out = { status0: { ...films.codeFilms.status(id) }, paths: {} }
      if (out.status0.state !== 'ready') return out
      const decode = (bmp) => {
        const W = bmp.width
        const H = bmp.height
        const g = new OffscreenCanvas(W, H).getContext('2d')
        g.drawImage(bmp, 0, 0)
        const d = g.getImageData(0, 0, W, H).data
        const vals = []
        for (let r = 0; r < rows; r++) {
          let e = 0
          for (let b = 0; b < 24; b++) {
            const i = ((r * 16 + 8) * W + b * 16 + 8) * 4
            e = e * 2 + (d[i] > 127 ? 1 : 0)
          }
          vals.push(Math.round(e - 8388608) / 10)
        }
        let h = 2166136261
        for (let i = 0; i < d.length; i += 3) h = Math.imul(h ^ d[i], 16777619) >>> 0
        return { vals, hash: h.toString(16) }
      }
      const exact = async (t) => {
        const t0 = performance.now()
        const b = await films.codeFilms.exactFrame(asset(), t)
        const r = decode(b)
        b.close()
        return { ...r, ms: Math.round(performance.now() - t0) }
      }
      const reload = async () => {
        films.codeFilms.reload(id)
        await sleep(100)
        await waitReady()
      }
      const strip = () => sleep(6000)
      for (const p of paths) {
        try {
          if (p === 'W') {
            await reload()
            await strip()
            out.paths.W = await exact(T)
          } else if (p === 'AW') {
            await reload()
            await strip()
            let last = null
            for (let k = 0; k <= Math.round(T * 30); k++) last = await exact(k / 30)
            out.paths.AW = last
          } else if (p === 'R') {
            await exact(T + 2.5)
            out.paths.R = await exact(T)
          } else if (p === 'B') {
            await reload()
            await exact(T + 1.3)
            await exact(Math.max(0, T - 0.9))
            out.paths.B = await exact(T)
          } else if (p === 'S') {
            await reload()
            await strip()
            await exact(2)
            await sleep(300)
            out.paths.S = await exact(T)
          } else if (p === 'Z') {
            await reload()
            await strip()
            out.paths.Z0 = await exact(0)
            out.paths.Z = await exact(T)
          } else if (p === 'E' || p === 'EP') {
            await reload()
            await strip()
            if (p === 'EP') for (let k = 0; k <= Math.round(T * 30); k++) await exact(k / 30)
            const ex = await window.__exporter()
            const A = asset()
            const pr = structuredClone(S.getState().project)
            pr.settings = { ...pr.settings, width: A.width, height: A.height }
            pr.tracks = [
              { id: 'V1', kind: 'video', name: 'V1', clipIds: ['k'] },
              { id: 'A1', kind: 'audio', name: 'A1', clipIds: [] }
            ]
            pr.clips = {
              k: {
                id: 'k',
                assetId: id,
                trackId: 'V1',
                start: 0,
                inPoint: 0,
                duration: A.duration,
                transform: {
                  x: A.width / 2,
                  y: A.height / 2,
                  scale: 1,
                  rotation: 0
                },
                volume: 1
              }
            }
            pr.captions = []
            pr.templates = []
            const png = await ex.exportFramePng(pr, T, false, 'final')
            const bmp = await createImageBitmap(new Blob([png], { type: 'image/png' }))
            out.paths[p] = decode(bmp)
            bmp.close()
          } else if (p === 'C') {
            await reload()
            out.paths.C = await exact(T)
          }
          if (out.paths[p]) out.paths[p].unsteady = !!films.codeFilms.status(id)?.unsteady
        } catch (e) {
          out.paths[p] = {
            err: String(e && e.message ? e.message : e).slice(0, 300)
          }
        }
      }
      out.status = { ...films.codeFilms.status(id) }
      out.diag = await Promise.race([films.codeFilms.diag(id), sleep(3000).then(() => null)])
      S.getState().deleteAsset(id)
      films.codeFilms.release?.(new Set())
      return out
    },
    folder,
    T,
    rows,
    paths
  )
}

const row = (r, i) => (r && r.vals ? r.vals[i] : r && r.err ? 'err: ' + r.err : null)
const show = (n, m) => {
  const parts = Object.entries(m.paths).map(([k, v]) => `${k} ${v.vals ? v.vals.join(' | ') : JSON.stringify(v)}${v.unsteady ? ' UNSTABLE' : ''}${v.ms !== undefined ? ' ' + v.ms + 'ms' : ''}`)
  console.log(`     ${n}: mode ${m.status?.mode} pure ${m.status?.pure} unsteady ${!!m.status?.unsteady}; ${parts.join('; ')}`)
}

export async function run({ c, lib, work }) {
  const { assert } = lib
  await c.run(() => window.api.testFilmProbe({ kind: 'mute', on: true }))
  const dirs = writePages(work)
  const fail = []
  const check = (ok, msg) => {
    if (!ok) fail.push(msg)
  }
  const same = (m, i, list, what) => {
    const v = list.map((p) => row(m.paths[p], i))
    check(
      v.every((x) => x === v[0] && typeof x === 'number'),
      `${what}: ${list.map((p, k) => p + ' ' + v[k]).join(', ')}`
    )
    return v[0]
  }
  // (SNIPP_CLOCK_AUDIT=S-1,S-4 runs only those items.)
  const only = (process.env.SNIPP_CLOCK_AUDIT || '').split(',').filter(Boolean)
  const want = (k) => !only.length || only.includes(k)
  try {
    if (want('S-4')) {
      const s4 = await measure(c, dirs['s4-count'], 3, 2, ['Z', 'C'])
      show('S-4 counter', s4)
      check(row(s4.paths.Z0, 1) === 1, `S-4: frame 0 reached by going back draws the page's frame ${row(s4.paths.Z0, 1)} times (1 expected)`)
      check(row(s4.paths.Z, 1) === row(s4.paths.C, 1), `S-4: frames counted at 3 s after going back to 0: ${row(s4.paths.Z, 1)}, fresh: ${row(s4.paths.C, 1)}`)
      const f3 = await measure(c, dirs.F3, 6, 0, ['W', 'Z'])
      show('S-4 F3', f3)
      check(f3.paths.W?.hash && f3.paths.W.hash === f3.paths.Z?.hash, `S-4: F3 at 6 s differs after going back to 0 (${f3.paths.W?.hash} / ${f3.paths.Z?.hash})`)
    }
    if (want('S-1')) {
      const p1 = await measure(c, dirs['p1-pure-trap'], 5, 3, ['W', 'AW', 'E', 'EP'])
      show('S-1 p1', p1)
      check(p1.status?.pure === false, 'S-1: p1 (a timer and an interval) found pure')
      same(p1, 1, ['W', 'AW', 'E', 'EP'], 'S-1: p1 start')
      same(p1, 2, ['W', 'AW', 'E', 'EP'], 'S-1: p1 count')
      check(row(p1.paths.W, 1) === 1500 && row(p1.paths.W, 2) === 5, `S-1: p1 at 5 s: start ${row(p1.paths.W, 1)} (1500), count ${row(p1.paths.W, 2)} (5)`)
      const p2 = await measure(c, dirs['p2-dt-late'], 3, 3, ['W', 'AW', 'E', 'EP'])
      show('S-1 p2', p2)
      check(p2.status?.pure === false, 'S-1: p2 (still for 1.2 s, then dt) found pure')
      same(p2, 1, ['W', 'AW', 'E', 'EP'], 'S-1: p2 x')
      const p4 = await measure(c, dirs['p4-gsap-trap'], 3.5, 3, ['W', 'AW', 'R', 'B'])
      show('S-1 p4', p4)
      check(p4.status?.pure === false, 'S-1: p4 (free GSAP) found pure')
      same(p4, 0, ['W', 'AW', 'R', 'B'], 'S-1: p4 gsap time')
      same(p4, 1, ['W', 'AW', 'R', 'B'], 'S-1: p4 a.x')
      same(p4, 2, ['W', 'AW', 'R', 'B'], 'S-1: p4 b.x')
    }
    if (want('S-2') || want('S-5')) {
      const h3 = await measure(c, dirs['h3-holder'], 3.5, 10, ['W', 'AW', 'R', 'B', 'E'])
      show('S-2/S-5 h3', h3)
      for (const p of ['W', 'AW', 'R', 'B', 'E']) {
        check(row(h3.paths[p], 2) === 2000, `S-2: animation-play-state paused → running at 1 s → paused at 3 s: ${p} ${row(h3.paths[p], 2)} (2000)`)
        check(row(h3.paths[p], 3) === 2000, `S-5: playbackRate 2 from 3 s: ${p} ${row(h3.paths[p], 3)} (2000)`)
      }
      check(!h3.status?.unsteady, 'S-3: the holder (timers only) taken for unstable')
    }
    if (want('S-3')) {
      for (const [n, T, rows, paths] of [
        ['l2-fetch-transition', 2.5, 2, ['W', 'B', 'S', 'E']],
        ['h4-chain', 3.5, 3, ['W', 'B', 'E']],
        ['l1-miss', 4, 3, ['W', 'B']]
      ]) {
        const m = await measure(c, dirs[n], T, rows, paths)
        show('S-3 ' + n, m)
        for (const p of paths) check(m.paths[p]?.unsteady === true, `S-3: ${n} way ${p} not said to be unstable (${JSON.stringify(m.paths[p]?.vals ?? m.paths[p])})`)
      }
      for (const [n, T, rows, paths] of [
        ['l0-false-late', 4, 2, ['W', 'AW']],
        ['m1-media', 4, 5, ['W', 'B']]
      ]) {
        const m = await measure(c, dirs[n], T, rows, paths)
        show('S-3 (harmless) ' + n, m)
        check(m.status?.state === 'ready' && !m.status?.unsteady, `S-3: ${n} taken for unstable`)
      }
    }
    if (want('S-7')) {
      const m2 = await measure(c, dirs['m2-broken-video'], 1, 1, ['C'])
      show('S-7 m2', m2)
      check(typeof m2.paths.C?.ms === 'number' && m2.paths.C.ms < 2500, `S-7: a frame of a page with a broken video took ${m2.paths.C?.ms} ms`)
      const said = (m2.diag?.errors ?? []).join(' | ')
      check(/broken\.mp4/.test(said), `S-7: the broken video is not reported: ${said}`)
    }
  } finally {
    await c.run(() => window.api.testFilmProbe({ kind: 'mute', on: false }))
  }
  assert.deepEqual(fail, [], fail.join('\n'))
}
