// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Stand-in claude and codex programs for the connection scenarios
// (dis-mcp-register, sihirbaz): --version answers, every mcp call is written
// down beside the program, and mcp get reads get.txt / codex-get.json. They
// never touch a real Claude Code or Codex or their settings.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const FAKE = [
  '@echo off',
  'if "%~1"=="--version" goto version',
  'if "%~1"=="mcp" goto mcp',
  'exit /b 2',
  ':version',
  'echo 2.1.318 (Claude Code)',
  'exit /b 0',
  ':mcp',
  'echo %*>>"%~dp0calls.txt"',
  'if not "%~2"=="get" exit /b 0',
  'if not exist "%~dp0get.txt" goto missing',
  'type "%~dp0get.txt"',
  'exit /b 0',
  ':missing',
  'echo No MCP server named "%~3". Configured servers: videohub',
  'exit /b 1',
  ''
].join('\r\n')

/** The same stand-in for sh (macOS, Linux). */
export const FAKE_SH = [
  '#!/bin/sh',
  'd="$(dirname "$0")"',
  'case "$1" in',
  '  --version) echo "2.1.318 (Claude Code)"; exit 0 ;;',
  '  mcp) echo "$*" >> "$d/calls.txt"',
  '    [ "$2" = get ] || exit 0',
  '    if [ -f "$d/get.txt" ]; then cat "$d/get.txt"; exit 0; fi',
  '    echo "No MCP server named \\"$3\\". Configured servers: videohub"; exit 1 ;;',
  'esac',
  'exit 2',
  ''
].join('\n')

/** A stand-in codex: --version, and mcp: written down; get --json reads codex-get.json. */
export const FAKE_CODEX = [
  '@echo off',
  'if "%~1"=="--version" goto version',
  'if "%~1"=="mcp" goto mcp',
  'exit /b 2',
  ':version',
  'echo codex-cli 0.167.0',
  'exit /b 0',
  ':mcp',
  'echo %*>>"%~dp0codex-calls.txt"',
  'if not "%~2"=="get" exit /b 0',
  'if not exist "%~dp0codex-get.json" goto missing',
  'type "%~dp0codex-get.json"',
  'exit /b 0',
  ':missing',
  "echo Error: No MCP server named '%~3' found.",
  'exit /b 1',
  ''
].join('\r\n')

export const FAKE_CODEX_SH = [
  '#!/bin/sh',
  'd="$(dirname "$0")"',
  'case "$1" in',
  '  --version) echo "codex-cli 0.167.0"; exit 0 ;;',
  '  mcp) echo "$*" >> "$d/codex-calls.txt"',
  '    [ "$2" = get ] || exit 0',
  '    if [ -f "$d/codex-get.json" ]; then cat "$d/codex-get.json"; exit 0; fi',
  '    echo "Error: No MCP server named $3 found."; exit 1 ;;',
  'esac',
  'exit 2',
  ''
].join('\n')

/** Puts the four stand-ins in a folder. */
export function writeFakes(bin) {
  writeFileSync(join(bin, 'claude.cmd'), FAKE)
  writeFileSync(join(bin, 'claude'), FAKE_SH, { mode: 0o755 })
  writeFileSync(join(bin, 'codex.cmd'), FAKE_CODEX)
  writeFileSync(join(bin, 'codex'), FAKE_CODEX_SH, { mode: 0o755 })
}
