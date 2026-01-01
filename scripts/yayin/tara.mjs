// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The scan before publishing (SnippStudio phase 9c, decision 4). Looks for
// what must not be published, in the files of a tree or in the whole history:
//   path      user folder paths (C:\Users\<name>, /Users/<name>, /home/<name>)
//   user      this computer's user name
//   email     e-mail addresses other than noreply ones
//   secret    key and token shapes (sk-…, "Bearer" + a long string, PRIVATE KEY,
//             the agent's key file agent.json)
//   name      the user's film, voice and project names (a list given from
//             OUTSIDE with --names=<file>, one per line; it never enters the repo)
//   binary    binary files over 200 KB
//   media     image, sound and video files (the app's own icons, fonts and
//             test pictures it makes are on the allowed list)
// The report says how many of each kind and WHERE (file, line, commit): it
// never copies what was found.
// Not counted: e-mail addresses inside third-party code kept as it came
// (vendor/: its authors' attribution; package-lock.json: written by npm;
// licenses/: the packages' own licence files, whose notices must stay) and
// git's SSH address form (git@host:owner/repo), which is not a mailbox.
// A name the list holds can also be an ordinary word or a place (a landmark in
// the map template, a city in a test page): --allow=<file> (also kept OUTSIDE
// the repo) lists such places as "<path prefix> <word>" lines, one per line;
// the report counts them apart as "allowed" and says where they are.
//
//   node scripts/yayin/tara.mjs [--tree[=<dir>]] [--history] (--names=<file> | --no-names) [--allow=<file>] [--out=<report.md>] [--rev=<commit>]
//     --tree     the files git tracks at --rev (default HEAD), or every file under <dir>
//     --history  every file of every commit of every branch (unique contents)
//     --names    required: a missing or empty list stops the scan (exit 2);
//                --no-names scans without one and the report says so
// Exit 1 when the tree scan finds anything (the history scan only reports);
// exit 2 when the name or allow list cannot be read.
import { execFileSync } from 'node:child_process'
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync, writeFileSync } from 'node:fs'
import { userInfo } from 'node:os'
import { basename, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP = fileURLToPath(new URL('../..', import.meta.url))
const BIG = 200 * 1024
export const MEDIA = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.icns', '.svg', '.mp4', '.mov', '.mkv', '.webm', '.avi', '.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.opus'])
/** The app's own pictures and type faces (allowed to be published), and the
 *  README's screenshots (docs/images: made by the e2e screens scenario from
 *  the app's own test pictures). */
export const ALLOWED_MEDIA = [/^docs\/images\/[^/]+\.png$/, /^build\/[^/]+\.(ico|icns|png)$/, /^src\/renderer\/src\/assets\/fonts\//, /^src\/renderer\/src\/ui\/fonts\//, /^resources\/kod-sablonlari\//, /^vendor\/three\//, /^src\/renderer\/src\/assets\/(luts|sfx)\//]
/** Placeholders the tests use for a user folder: not anybody's. */
const PLACEHOLDER_USERS = new Set(['u', 'user', 'me', 'you', 'name', 'username', 'someone', 'test', 'runner', 'runneradmin', 'public', 'default', 'x', 'a', '<name>', '<you>', '...', '…', '%username%', 'yourname', 'alice', 'bob'])

/** Third-party text kept as it came: its authors' e-mail addresses are not counted. */
export const THIRD_PARTY = [/^vendor\//, /(^|\/)package-lock\.json$/, /^licenses\//]

/** `allow`: [{ prefix, word }] (lower case): a name hit there is "allowed", not a finding. */
export function patterns(user, names, allow = []) {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return [
    ['path', /(?:[A-Za-z]:[\\/]{1,2}Users[\\/]{1,2}|\/Users\/|\/home\/)([^\\/\s"'`<>|*?:;,)]+)/gi, (m) => m[1].length > 2 && !m[1].includes('.') && !PLACEHOLDER_USERS.has(m[1].toLowerCase())],
    ...(user && !PLACEHOLDER_USERS.has(user.toLowerCase()) ? [['user', new RegExp(`\\b${esc(user)}\\b`, 'gi'), () => true]] : []),
    ['email', /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, (m, path) => !/noreply|no-reply|example\.(com|org)|@users\.noreply\.github\.com$/i.test(m[0]) && !(/^git@/i.test(m[0]) && m.input[m.index + m[0].length] === ':') && !THIRD_PARTY.some((r) => r.test(path))],
    ['secret', /\bsk-[A-Za-z0-9_-]{20,}|\bBearer\s+[A-Za-z0-9._~+/=-]{24,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/g, () => true],
    ...(names.length ? [['name', new RegExp(names.map((n) => `\\b${esc(n)}\\b`).join('|'), 'gi'), (m, path) => (allow.some((a) => path.startsWith(a.prefix) && a.word === m[0].toLowerCase()) ? 'allowed' : true)]] : [])
  ]
}

/** A file, or the first 1 MB of a big one marked as big (its size is all a binary needs). */
function readHead(p) {
  const size = statSync(p).size
  if (size <= 64 * 1024 * 1024) return readFileSync(p)
  const fd = openSync(p, "r")
  try { const b = Buffer.alloc(1 << 20); readSync(fd, b, 0, b.length, 0); b[0] = 0; return Object.assign(Buffer.concat([b, Buffer.alloc(BIG)]), {}) } finally { closeSync(fd) }
}

const isBinary = (buf) => buf.subarray(0, 8000).includes(0)

/** Findings in one file: [{ kind, line }]. */
export function scanContent(path, buf, pats) {
  const out = []
  const ext = extname(path).toLowerCase()
  if (MEDIA.has(ext) && !ALLOWED_MEDIA.some((r) => r.test(path))) out.push({ kind: 'media', line: 0 })
  if (/(^|\/)agent\.json$/.test(path)) out.push({ kind: 'secret', line: 0 })
  if (isBinary(buf)) {
    if (buf.length > BIG && !ALLOWED_MEDIA.some((r) => r.test(path))) out.push({ kind: 'binary', line: 0 })
    return out
  }
  const lines = buf.toString('utf8').split('\n')
  lines.forEach((text, i) => {
    for (const [kind, re, keep] of pats) {
      re.lastIndex = 0
      let allowed = false
      let found = false
      for (const m of text.matchAll(re)) {
        const k = keep(m, path)
        if (k === 'allowed') allowed = true
        else if (k) { found = true; break }
      }
      if (found) out.push({ kind, line: i + 1 })
      else if (allowed) out.push({ kind: 'allowed', line: i + 1 })
    }
  })
  return out
}

const git = (args, opts = {}) => execFileSync('git', ['-C', APP, ...args], { maxBuffer: 1 << 30, ...opts })

function treeFiles(rev) {
  return git(['ls-tree', '-r', '-z', '--full-tree', rev]).toString('utf8').split('\0').filter(Boolean).map((l) => {
    const [meta, path] = l.split('\t')
    return { path, blob: meta.split(' ')[2] }
  })
}

function dirFiles(dir) {
  const out = []
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === '.git' || e.name === 'node_modules') continue
      // (Links and junctions are not the tree's own files: models/ in a work copy.)
      if (e.isSymbolicLink()) continue
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else out.push(relative(dir, p).replace(/\\/g, '/'))
    }
  }
  walk(dir)
  return out
}

/** Contents of many blobs through one `git cat-file --batch`. */
function blobs(ids) {
  const out = new Map()
  for (let i = 0; i < ids.length; i += 2000) {
    const chunk = ids.slice(i, i + 2000)
    const buf = git(['cat-file', '--batch'], { input: chunk.join('\n') + '\n' })
    let at = 0
    for (const id of chunk) {
      const nl = buf.indexOf(10, at)
      const head = buf.subarray(at, nl).toString()
      const size = Number(head.split(' ')[2])
      out.set(id, buf.subarray(nl + 1, nl + 1 + size))
      at = nl + 1 + size + 1
      if (!Number.isFinite(size)) throw new Error(`cat-file: ${head}`)
    }
  }
  return out
}

function scanTree(pats, { dir, rev }) {
  const found = []
  if (dir) {
    for (const f of dirFiles(dir)) for (const x of scanContent(f, readHead(join(dir, f)), pats)) found.push({ ...x, file: f })
    return { files: dirFiles(dir).length, found }
  }
  const files = treeFiles(rev)
  const data = blobs(files.map((f) => f.blob))
  for (const f of files) for (const x of scanContent(f.path, data.get(f.blob), pats)) found.push({ ...x, file: f.path })
  return { files: files.length, found }
}

function scanHistory(pats) {
  const commits = git(['rev-list', '--all']).toString().trim().split('\n').filter(Boolean)
  // Each content once, with the first (oldest) commit and path that hold it.
  const seen = new Map()
  for (const c of [...commits].reverse()) {
    for (const f of treeFiles(c)) if (!seen.has(f.blob)) seen.set(f.blob, { path: f.path, commit: c })
  }
  const ids = [...seen.keys()]
  const data = blobs(ids)
  const found = []
  for (const id of ids) {
    const at = seen.get(id)
    for (const x of scanContent(at.path, data.get(id), pats)) found.push({ ...x, file: at.path, commit: at.commit.slice(0, 7) })
  }
  return { commits: commits.length, blobs: ids.length, found }
}

const KINDS = ['path', 'user', 'email', 'secret', 'name', 'binary', 'media']

export function summary(found) {
  return { ...Object.fromEntries(KINDS.map((k) => [k, found.filter((f) => f.kind === k).length])), allowed: found.filter((f) => f.kind === 'allowed').length }
}

function table(title, found, extra) {
  const lines = [`## ${title}`, '', extra, '', '| Tür | Sayı | Örnek yerler (en çok 8) |', '| --- | --- | --- |']
  for (const k of [...KINDS, 'allowed']) {
    const of = found.filter((f) => f.kind === k)
    if (k === 'allowed' && !of.length) continue
    const files = []
    const seenAt = new Set()
    for (const f of of) { const k = f.file + (f.commit ? '@' + f.commit : ''); if (!seenAt.has(k)) { seenAt.add(k); files.push(f) } }
    const ex = files.slice(0, 8).map((f) => `\`${f.file}${f.line ? ':' + f.line : ''}\`${f.commit ? ` (${f.commit})` : ''}`).join(', ')
    lines.push(`| ${k} | ${of.length} | ${ex || '—'}${files.length > 8 ? ` … (${files.length} dosya)` : ''} |`)
  }
  return lines.join('\n')
}

function main() {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => { const i = a.indexOf('='); return [a.slice(2, i < 0 ? undefined : i), i < 0 ? true : a.slice(i + 1)] }))
  // The name list is required (Faz 9 audit patch P, P3): a wrong path or an
  // empty file would otherwise give a clean-looking "name 0". --no-names runs
  // without it on purpose, and the report says the names were not checked.
  const refuse = (why) => { console.error(`tara: ${why}`); process.exit(2) }
  const noNames = args['no-names'] === true
  if (!noNames && typeof args.names !== 'string') refuse('no name list: give --names=<file> (one name per line), or --no-names to scan without one')
  if (!noNames && !existsSync(args.names)) refuse(`the name list ${basename(args.names)} does not exist`)
  const names = noNames ? [] : readFileSync(args.names, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter((s) => s.length >= 3)
  if (!noNames && !names.length) refuse(`the name list ${basename(args.names)} holds no name (of 3 letters or more)`)
  if (typeof args.allow === 'string' && !existsSync(args.allow)) refuse(`the allow list ${basename(args.allow)} does not exist`)
  const allow = typeof args.allow === 'string'
    ? readFileSync(args.allow, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => { const i = l.lastIndexOf(' '); return { prefix: l.slice(0, i).trim(), word: l.slice(i + 1).toLowerCase() } })
    : []
  const pats = patterns(userInfo().username, names, allow)
  const parts = [`# Yayın taraması`, '', `${new Date().toISOString().slice(0, 16).replace('T', ' ')} · \`scripts/yayin/tara.mjs\` · ${noNames ? '**ad listesi verilmedi (--no-names): adlar taranmadı** (name: not checked)' : `ad listesi: ${names.length} ad`}, izin listesi: ${allow.length} satır (ikisi de dışarıdan verildi, depoya girmez). Bulunan içerik rapora kopyalanmaz: yalnız yeri yazılır. "allowed": izin listesindeki yerde geçen ad (yer adı ya da sıradan sözcük; isabet sayılmaz).`]
  let treeHits = 0
  const totals = {}
  if (args.tree || !args.history) {
    const dir = typeof args.tree === 'string' ? resolve(args.tree) : null
    const rev = typeof args.rev === 'string' ? args.rev : 'HEAD'
    const r = scanTree(pats, { dir, rev })
    treeHits = r.found.filter((f) => f.kind !== 'allowed').length
    totals.tree = summary(r.found)
    parts.push('', table(dir ? `Çalışma ağacı (${basename(dir)})` : `Ağaç (${rev})`, r.found, `${r.files} dosya.`))
  }
  if (args.history) {
    const r = scanHistory(pats)
    totals.history = summary(r.found)
    parts.push('', table('Bütün geçmiş', r.found, `${r.commits} commit, ${r.blobs} ayrı dosya içeriği (her biri ilk göründüğü commit ve yolla).`))
  }
  const report = parts.join('\n') + '\n'
  if (typeof args.out === 'string') writeFileSync(args.out, report)
  else process.stdout.write(report)
  if (noNames) for (const t of Object.values(totals)) t.name = 'not checked'
  if (noNames) console.error('name: not checked (--no-names)')
  console.error(JSON.stringify(totals))
  process.exit(treeHits ? 1 : 0)
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) main()
