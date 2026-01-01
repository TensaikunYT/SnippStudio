// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Builds the package (SnippStudio phase 9a, decision 5).
//
//   node scripts/package/dist.mjs [--dir | --release [--allow-dirty]] [--out=<folder>] [--keep-release-build]
//
//   1. the app built as the release copy (SNIPP_CHANNEL=release: the product's
//      own name and profile folder, shared/product.json);
//   2. the one speech model into models-dist/ (models.mjs; SNIPP_MODELS_DIR
//      names the folder holding it when the tree has no models/);
//   3. electron-builder with electron-builder.config.cjs: the unpacked folder
//      (--dir) or the NSIS installer (unsigned; it is built, never run here);
//   4. checks on the result (check.mjs): no onnxruntime-node / sharp in it,
//      only the multilingual model, no test marker, the licence files;
//   5. --release (Faz 9 audit patch P, P5): the release files from this same
//      run (release-files.mjs): the zipped folder, SHA256SUMS.txt and
//      SOURCE.txt (the commit built). A tree with uncommitted changes is
//      refused (its binaries would match no published source), unless
//      --allow-dirty, which SOURCE.txt then says;
//   6. out/ built again as the development copy (the e2e tests and the dev
//      window use it), unless --keep-release-build.
// --out defaults to release/ (git-ignored).
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { unpackedDir } from './check.mjs'
import { sourceOf, writeReleaseFiles } from './release-files.mjs'

const APP = fileURLToPath(new URL('../..', import.meta.url))
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true] }))
const out = resolve(APP, typeof args.out === 'string' ? args.out : 'release')

function run(what, cmd, argv, env = {}) {
  console.log(`\n== ${what}`)
  const r = spawnSync(cmd, argv, { cwd: APP, stdio: 'inherit', env: { ...process.env, ...env } })
  if (r.status !== 0) throw new Error(`${what} failed (${r.status ?? r.error})`)
}

const node = process.execPath
const vite = join(APP, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js')
const builder = join(APP, 'node_modules', 'electron-builder', 'cli.js')
// --platform=mac|linux|win (npm run dist:mac / dist:linux, phase 10b.5):
// electron-builder makes a macOS package on a Mac only and a Linux one on
// Linux only; asked elsewhere it stops with its own reason.
const host = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux'
const platform = `--${typeof args.platform === 'string' ? args.platform : host}`

if (args.release && args.dir) {
  console.error('--release makes the installer and the zip: not with --dir')
  process.exit(2)
}
// The source is read before anything is built (the build writes only
// git-ignored folders).
const source = args.release ? sourceOf(APP) : null
if (source?.dirty && !args['allow-dirty']) {
  console.error(`the tree has uncommitted changes (git status): a release is built from a commit only (--allow-dirty to build anyway, marked in SOURCE.txt)`)
  process.exit(2)
}

let failed = 0
try {
  run('build (release copy)', node, [vite, 'build'], { SNIPP_CHANNEL: 'release' })
  run('speech model', node, [join(APP, 'scripts', 'package', 'models.mjs')])
  run('electron-builder', node, [builder, platform, ...(args.dir ? ['--dir'] : []), '--config', 'electron-builder.config.cjs', `-c.directories.output=${out}`, '--publish', 'never'])
  run('package checks', node, [join(APP, 'scripts', 'package', 'check.mjs'), out])
  if (args.release) {
    console.log('\n== release files')
    const pkg = JSON.parse(readFileSync(join(APP, 'package.json'), 'utf8'))
    const product = JSON.parse(readFileSync(join(APP, 'src', 'shared', 'product.json'), 'utf8'))
    const unpacked = unpackedDir(out).slice(out.length + 1)
    const r = writeReleaseFiles(out, { name: product.name, version: pkg.version, unpacked, source })
    for (const s of r.sums) console.log(`  ${s.hash}  ${s.name}`)
    console.log(`  SOURCE.txt: commit ${source.commit}${source.dirty ? ' (with uncommitted changes)' : ''}`)
  }
} catch (e) {
  failed = 1
  console.error(String(e?.message ?? e))
} finally {
  if (!args['keep-release-build']) {
    const r = spawnSync(node, [vite, 'build'], { cwd: APP, stdio: 'ignore', env: { ...process.env, SNIPP_CHANNEL: '' } })
    console.log(r.status === 0 ? '\nout/ is the development build again' : '\nout/ could not be rebuilt as the development copy: run npm run build')
  }
}
process.exit(failed)
