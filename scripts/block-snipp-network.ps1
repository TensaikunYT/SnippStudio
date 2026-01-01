# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 SnippStudio contributors
#Requires -RunAsAdministrator
param(
  [string]$Program = (Join-Path $PSScriptRoot '..\release\win-unpacked\Snipp.exe')
)
$ErrorActionPreference = 'Stop'
$snippProgram = (Resolve-Path -LiteralPath $Program).Path
if ([IO.Path]::GetFileName($snippProgram) -ine 'Snipp.exe') { throw 'Only Snipp.exe is supported.' }
$snippHash = [Security.Cryptography.SHA256]::Create()
try {
  $snippKey = ([BitConverter]::ToString($snippHash.ComputeHash([Text.Encoding]::UTF8.GetBytes($snippProgram.ToLowerInvariant())))).Replace('-', '').Substring(0, 16)
} finally { $snippHash.Dispose() }
foreach ($snippDirection in @('Outbound', 'Inbound')) {
  $snippName = "Snipp-Offline-$snippKey-$snippDirection"
  $snippRule = Get-NetFirewallRule -Name $snippName -ErrorAction SilentlyContinue
  if ($snippRule) {
    Set-NetFirewallRule -Name $snippName -Enabled True -Action Block -Profile Any -Direction $snippDirection -Program $snippProgram | Out-Null
  } else {
    New-NetFirewallRule -Name $snippName -DisplayName "Snipp offline ($snippDirection)" -Group 'Snipp Offline' -Program $snippProgram -Direction $snippDirection -Action Block -Enabled True -Profile Any -Protocol Any | Out-Null
  }
}
Get-NetFirewallRule -Group 'Snipp Offline' | Select-Object Name, Enabled, Direction, Action
# Undo only these application-specific rules, if explicitly desired:
# Get-NetFirewallRule -Group 'Snipp Offline' | Remove-NetFirewallRule
