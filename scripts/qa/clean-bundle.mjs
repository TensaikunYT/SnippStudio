// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// SnippStudio 1b.8 (b): the built app (out\ after `npm run build`) holds
// nothing of the narrator hands, the cut-out characters, the Stage, the
// three hand templates, hand transitions and portals, or the removed film
// tool. Every hit is printed with its surroundings; a hit is allowed only
// when its surroundings are on the list below (the old-project reader,
// media/legacy.ts, which has to name what it takes out; library text; the
// territory map's own "stage by stage").
//
//   node scripts/qa/clean-bundle.mjs [outDir]     exit 1 on any other hit
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve(process.argv[2] ?? 'out')

const PATTERNS = [
  ['hands', /narrator|\bhands\b|handDraw|handMode|restMarks|recordHandMove|handThrowOut|layeredByHands|drawHandsLayer|filmUnderHandsAt|lightHands|hand-(?:swipe|push|pull|flick|toss|grab|wipe|throw|slide)|HandAction|HandLink|RestPad/gi],
  ['characters', /\.characters\b|"characters"|characterSel|editCharacters|Character(?:Inspector|Panel|Lanes)|SampleCharacter|character:(?:import|sample)|"character"|cut-?out characters?/g],
  ['stage', /\bStage\b|stage-?live|stageVersions|StageStudio|Studio(?:Panel|Shell)|SceneTimeline|"stage"|\.stage\b|terrain:read|world:read|file:write-credits|stage-pack|fonts\/stage/g],
  ['choreography', /choreo/gi],
  ['templates', /blackhole|black hole|blackhole-gl/gi],
  ['portal', /\bportal\b/gi],
  ['film tool', /film\.mjs|stage-film/gi],
  ['three.js', /WebGLRenderer|three\.module|THREE\.REVISION|"three"/g],
  ['edition', /__SNIPP_EDITION__|build:studio|FEATURES\./g]
]

// Allowed surroundings (100 characters around the hit).
const ALLOW = [
  // media/legacy.ts: the old-project reader names what it takes out.
  /found\.add\(/,
  /delete p\.characters/,
  /"characters" in p/,
  /role !== "character"/,
  /\["stage", "stageVersions", "credits"\]/,
  /GONE_TEMPLATES|GONE_TRANSITION/,
  /Opened as a copy without its/,
  // React's own names.
  /react\.portal|return "Portal"/,
  // Library text (mediabunny).
  /into our own hands/,
  // The territory map: a territory growing stage by stage.
  /`Stage \$\{index\d* \+ 1\} \(year\)`/,
  // Phase 5c (decision 5): the main process serves its copy of three.js
  // 0.170.0 to code film pages that ask a CDN for it (main/codefilm.ts
  // threePath, main/index.ts threeDir). The app itself draws nothing with it.
  /rel === "build\/three\.module\.min\.js"|return "build\/three\.module\.js"/,
  /"vendor", "three"\)/
]

const files = []
const walk = (d) => {
  for (const n of readdirSync(d)) {
    const p = path.join(d, n)
    if (statSync(p).isDirectory()) walk(p)
    else if (/\.(js|mjs|cjs|css|html)$/.test(n)) files.push(p)
  }
}
walk(root)
if (!files.length) {
  console.error(`No built files under ${root}: run npm run build first.`)
  process.exit(2)
}

let bad = 0
let allowed = 0
for (const f of files) {
  const s = readFileSync(f, 'utf8')
  for (const [what, re] of PATTERNS) {
    for (const m of s.matchAll(re)) {
      const ctx = s.slice(Math.max(0, m.index - 50), m.index + m[0].length + 50).replace(/\s+/g, ' ')
      if (ALLOW.some((a) => a.test(ctx))) {
        allowed++
        continue
      }
      bad++
      console.log(`${path.relative(root, f)}  [${what}]  ${m[0]}  …${ctx}…`)
    }
  }
}
// SnippStudio 4A.8 (rule 25): the agent's test hook window.__agent exists in
// the code only behind the e2e question (api.testE2e), and the main process
// answers that question only when not packaged: the packaged product never
// installs it.
let hooks = 0
for (const f of files) {
  const s = readFileSync(f, 'utf8')
  for (const m of s.matchAll(/__agent\b/g)) {
    hooks++
    const before = s.slice(Math.max(0, m.index - 400), m.index)
    if (!/testE2e/.test(before)) {
      bad++
      console.log(`${path.relative(root, f)}  [test hook]  window.__agent not behind testE2e  …${s.slice(Math.max(0, m.index - 80), m.index + 20).replace(/\s+/g, ' ')}…`)
    }
  }
  for (const m of s.matchAll(/["']test:e2e["']/g)) {
    const around = s.slice(Math.max(0, m.index - 120), m.index)
    if (/ipcMain\.handle\(\s*$|\.handle\(\s*$/.test(around) && !/isPackaged/.test(around)) {
      bad++
      console.log(`${path.relative(root, f)}  [test hook]  test:e2e answered without the isPackaged check`)
    }
  }
}
// Security patch, item 3 (B-G4): the page's own test hooks (window.__store,
// __exporter, __codeFilm, __candidate …; renderer main.tsx) are installed
// only behind api.testHooks, which the main process sets for a source build
// and for a packaged copy under the e2e gate: the packaged product has none.
let pageHooks = 0
for (const f of files) {
  const s = readFileSync(f, 'utf8')
  for (const m of s.matchAll(/\bw\.__(store|engine|exporter|candidate|commands|codeFilm|render|sources|media|subs|exportJob|audioStream|types)\s*=(?!=)/g)) {
    pageHooks++
    if (!/api\?\.testHooks === true\) \{/.test(s.slice(Math.max(0, m.index - 6000), m.index))) {
      bad++
      console.log(`${path.relative(root, f)}  [test hook]  window.__${m[1]} not behind api.testHooks`)
    }
  }
}
if (pageHooks === 0) {
  bad++
  console.log('[test hook]  the page\'s test hooks were not found: this check no longer sees them (renderer main.tsx)')
}
// TERMINAL-YOK-PLAN.md (21 Nov 2026): the embedded terminal went (node-pty,
// its view, the IPC, way D's system terminal). The words "terminal" and
// "pty" are allowed only where the surroundings say why: the G lane's
// "terminal" look (a video template that draws a code window: part of the
// product, nothing to do with an agent), library text, and the help that
// tells the user to run a copied command in a terminal of their own.
const TERMINAL = /\bterminal\b|\bpty\b|node-pty|conpty|xterm/gi
const TERMINAL_ALLOW = [
  // This change's own plan, named in comments that survive the build.
  /TERMINAL-YOK-PLAN/,
  // The G lane's "terminal" template (templates/: a code window a keyboard
  // types into, on the video): its kind, design, fields, words and drawing.
  /tpl(?:f|\.screen|Hint)?\.[a-zA-Z.]*terminal|data\.tpl(?:Hint)?\.terminal|tplf\.(?:head|items)\.terminal|TEMPLATE_DESIGNS|SCREENS? ?=|SCREEN_(?:HEADLINE|ITEMS)|terminalDesign|TerminalFields|drawTerminal|kind === "terminal"|case "terminal"|types your lines into a terminal|terminal: \{ label: "Terminal"|terminal: 5\.5|v === "terminal"|: "terminal";/,
  // The help that tells the user to run a copied command in a terminal of
  // their own (Settings → Agent connection; macOS and Linux words).
  /(?:in|from|the) (?:a|your(?: own)?|the|the same|that) terminal\b|in your own terminal|in a terminal|Copy terminal command|Terminal komutunu kopyala/,
  // The Codex card's steps (den2-t, item 10): run the key command once in the
  // user's own terminal, then open a new one so the variable is seen.
  /open a new terminal|Open a new terminal|YENİ bir terminal aç|yeni bir terminal aç|Yeni bir terminal aç|Terminalde bir kez çalıştır/,
  // The connection wizard (Settings -> Agent, 22 Nov): it tells the user to
  // open the system's own Terminal app and names the Codex that runs in one.
  /“Terminal”|Terminal app|Terminal uygulama|Terminal window|Terminal penceresi|No Terminal in Start|Terminal yoksa|Codex \(terminal\)/,
  // The icon set (Lucide) keeps its "terminal" picture.
  /"terminal": \[\["path"/
]
let terminalHits = 0
let terminalAllowed = 0
for (const f of files) {
  const s = readFileSync(f, 'utf8')
  for (const m of s.matchAll(TERMINAL)) {
    terminalHits++
    const ctx = s.slice(Math.max(0, m.index - 60), m.index + m[0].length + 60).replace(/\s+/g, ' ')
    if (TERMINAL_ALLOW.some((a) => a.test(ctx))) {
      terminalAllowed++
      continue
    }
    bad++
    console.log(`${path.relative(root, f)}  [terminal]  ${m[0]}  …${ctx}…`)
  }
}
console.log(`${files.length} files, ${bad} hits, ${allowed} allowed (the old-project reader, library text); window.__agent ${hooks}× and every one behind testE2e; ${pageHooks} page hooks, every one behind testHooks; the words of the terminal ${terminalHits}×, ${terminalAllowed} allowed.`)
process.exit(bad ? 1 : 0)
