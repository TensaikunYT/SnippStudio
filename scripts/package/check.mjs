// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Checks a built package (SnippStudio phase 9a, decisions 5 and 7):
//   - the app's archive holds no module at all (no onnxruntime-node, no
//     sharp / @img: the renderer bundles what it uses), and nothing of the
//     embedded terminal that went (node-pty: TERMINAL-YOK-PLAN.md);
//   - resources/models holds only the multilingual set (no English model);
//   - no test marker (e2e-test-hooks) is in it;
//   - LICENSE.txt, THIRD-PARTY-NOTICES.md and licenses/ sit beside the
//     program, and no source map is in it (Faz 9 audit patch P: P1, P13);
//   - docs/ (the guides the Settings window's Help page opens) beside it;
//   - check:clean (scripts/qa/clean-bundle.mjs) finds nothing in its out/;
//   - the program is named after the product.
// Prints the sizes. Exit 1 on any failure.
//
//   node scripts/package/check.mjs <output folder>   (the folder holding win-unpacked)
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isPackagedModel } from './models.mjs'

const APP = fileURLToPath(new URL('../..', import.meta.url))
const require = createRequire(import.meta.url)
const asar = require('@electron/asar')
const product = JSON.parse(readFileSync(join(APP, 'src', 'shared', 'product.json'), 'utf8'))

/** The unpacked app folder inside an electron-builder output folder. */
export function unpackedDir(out) {
  for (const n of ['win-unpacked', 'linux-unpacked', 'mac', 'mac-arm64']) if (existsSync(join(out, n))) return join(out, n)
  if (existsSync(join(out, 'resources', 'app.asar'))) return out
  throw new Error(`no unpacked app in ${out}`)
}

/** Every file under a folder (relative, forward slashes). */
function walk(d, base = d) {
  const out = []
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name)
    if (e.isDirectory()) out.push(...walk(p, base))
    else out.push(p.slice(base.length + 1).replace(/\\/g, '/'))
  }
  return out
}

export function dirBytes(d) {
  let n = 0
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name)
    n += e.isDirectory() ? dirBytes(p) : statSync(p).size
  }
  return n
}

/** The licence files the program carries beside it (Faz 9 audit patch P, P1):
 *  LICENSE as LICENSE.txt, the notices, and every file of the repository's
 *  licenses/ (electron-builder.config.cjs extraFiles). */
export function licenceProblems(dir) {
  const want = ['LICENSE.txt', 'THIRD-PARTY-NOTICES.md', ...readdirSync(join(APP, 'licenses')).map((n) => `licenses/${n}`)]
  const problems = want.filter((f) => !existsSync(join(dir, f)) || statSync(join(dir, f)).size === 0).map((f) => `no ${f} beside the program`)
  if (existsSync(join(dir, 'LICENSE.txt')) && !/GNU GENERAL PUBLIC LICENSE\s+Version 3/.test(readFileSync(join(dir, 'LICENSE.txt'), 'utf8'))) problems.push('LICENSE.txt is not the GPL-3.0 text')
  return problems
}

/** The guides beside the program (the Settings window's Help page opens
 *  them; electron-builder.config.cjs extraFiles): docs/ as in the repository. */
export function docsProblems(dir) {
  return readdirSync(join(APP, 'docs')).filter((n) => n.endsWith('.md')).filter((n) => !existsSync(join(dir, 'docs', n))).map((n) => `no docs/${n} beside the program`)
}

/** Source maps among the archive's files (none ship: P13). */
export const mapFiles = (files) => files.filter((f) => f.endsWith('.map'))

/** The platform an electron-builder output folder is for, by its name
 *  (mac, mac-arm64, linux-unpacked, win-unpacked). */
export const layoutPlatform = (dir) => {
  const last = dir.replace(/[\\/]+$/, '').split(/[\\/]/).pop()
  return last.startsWith('mac') ? 'darwin' : last.startsWith('linux') ? 'linux' : 'win32'
}

/** Where things are in an unpacked app (phase 10b.5): Windows and Linux
 *  keep resources/ and the licences beside the program; macOS has them
 *  inside the .app (Contents/Resources, Contents). Linux's program is
 *  lower-case (electron-builder.config.cjs linux.executableName). */
export function packageLayout(dir, platform = layoutPlatform(dir), name = product.name) {
  if (platform === 'darwin') {
    const app = join(dir, `${name}.app`, 'Contents')
    return { res: join(app, 'Resources'), exe: join(app, 'MacOS', name), beside: app, platform }
  }
  return { res: join(dir, 'resources'), exe: join(dir, platform === 'win32' ? `${name}.exe` : name.toLowerCase()), beside: dir, platform }
}

export function checkPackage(out) {
  const dir = unpackedDir(out)
  const layout = packageLayout(dir)
  const res = layout.res
  const problems = []
  if (!existsSync(layout.exe)) problems.push(`no ${layout.exe.slice(dir.length + 1)}`)
  const files = asar.listPackage(join(res, 'app.asar')).map((f) => f.replace(/\\/g, '/'))
  const modules = new Set(files.filter((f) => f.startsWith('/node_modules/')).map((f) => f.split('/').slice(2, f.split('/')[2]?.startsWith('@') ? 4 : 3).join('/')))
  const extra = [...modules].filter(Boolean)
  if (extra.length) problems.push(`modules in app.asar: ${extra.join(', ')}`)
  for (const m of ['onnxruntime-node', 'sharp', '@img']) {
    if (files.some((f) => f.startsWith(`/node_modules/${m}`))) problems.push(`${m} in app.asar`)
    if (existsSync(join(res, 'app.asar.unpacked', 'node_modules', m))) problems.push(`${m} in app.asar.unpacked`)
  }
  // (No embedded terminal: TERMINAL-YOK-PLAN.md.)
  if (existsSync(join(res, 'app.asar.unpacked', 'node_modules', 'node-pty'))) problems.push('node-pty in app.asar.unpacked')
  problems.push(...docsProblems(layout.beside))
  const models = existsSync(join(res, 'models')) ? readdirSync(join(res, 'models')) : []
  const foreign = models.filter((n) => !isPackagedModel(n))
  if (foreign.length) problems.push(`model files that are not the multilingual set: ${foreign.join(', ')}`)
  if (!models.some((n) => n.endsWith('_onnx_decoder_model_merged_quantized.onnx'))) problems.push('the multilingual model is missing')
  if (existsSync(join(res, 'e2e-test-hooks'))) problems.push('the e2e test marker is in the package')
  problems.push(...licenceProblems(layout.beside))
  const unpacked = join(res, 'app.asar.unpacked')
  const maps = [...mapFiles(files), ...(existsSync(unpacked) ? mapFiles(walk(unpacked).map((f) => '/' + f)) : [])]
  if (maps.length) problems.push(`source maps in the package: ${maps.length} (${maps.slice(0, 3).join(', ')})`)
  const modelBytes = models.reduce((s, n) => s + statSync(join(res, 'models', n)).size, 0)
  // The packaged app holds no word of the removed parts either (phase 1b's
  // check:clean, run on the archive's out/).
  const tmp = mkdtempSync(join(tmpdir(), 'snipp-pkg-clean-'))
  try {
    asar.extractAll(join(res, 'app.asar'), tmp)
    const r = spawnSync(process.execPath, [join(APP, 'scripts', 'qa', 'clean-bundle.mjs'), join(tmp, 'out')], { encoding: 'utf8' })
    if (r.status !== 0) problems.push(`check:clean in the package: ${(r.stdout + r.stderr).trim().split('\n').slice(-3).join(' | ')}`)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
  const installers = existsSync(out) ? readdirSync(out).filter((n) => /\.(exe|dmg|AppImage|deb|zip)$/i.test(n)) : []
  return {
    dir,
    problems,
    sizes: {
      folderBytes: dirBytes(dir),
      asarBytes: statSync(join(res, 'app.asar')).size,
      modelBytes,
      modelFiles: models.length,
      installers: installers.map((n) => ({ name: n, bytes: statSync(join(out, n)).size }))
    },
    modules: [...modules]
  }
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  const out = resolve(process.argv[2] ?? join(APP, 'release'))
  const r = checkPackage(out)
  const gb = (b) => (b / 2 ** 30).toFixed(2) + ' GiB'
  console.log(`package: ${r.dir}`)
  console.log(`  folder ${gb(r.sizes.folderBytes)}, app.asar ${(r.sizes.asarBytes / 2 ** 20).toFixed(1)} MiB, model ${gb(r.sizes.modelBytes)} (${r.sizes.modelFiles} files)`)
  for (const i of r.sizes.installers) console.log(`  ${i.name}: ${gb(i.bytes)}`)
  console.log(`  modules in app.asar: ${r.modules.join(', ') || 'none'}`)
  if (r.problems.length) {
    for (const p of r.problems) console.error(`FAIL ${p}`)
    process.exit(1)
  }
  console.log('package checks: ok')
}
