# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 SnippStudio contributors
param(
  [string]$Destination = (Join-Path $PSScriptRoot '..\models')
)

$ErrorActionPreference = 'Stop'
$repo = 'onnx-community/whisper-medium_timestamped'
$revision = '9fe933aaa6b0244316eb961f36d33dfedf0c0b0c'
$resolvedDestination = [IO.Path]::GetFullPath($Destination)
New-Item -ItemType Directory -Path $resolvedDestination -Force | Out-Null

# Large-file hashes are from the pinned Hub revision's X-Linked-ETag headers.
# Small-file SHA-256 values were recorded after fetching that same immutable
# revision, and all seven files are rechecked on every run.
$files = @(
  @{ Name = 'config.json'; Length = 1417; Sha256 = '8690388eab438c28ffc0697e2551a60b4f062c7e110e381115c6d9922658293a' },
  @{ Name = 'generation_config.json'; Length = 3779; Sha256 = '6e52512ad5b2131ce01b4c52378617fe6ec5322b452e1598ce929e903da58f94' },
  @{ Name = 'preprocessor_config.json'; Length = 339; Sha256 = 'a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d' },
  @{ Name = 'tokenizer_config.json'; Length = 282713; Sha256 = '21a4fc0483c14b87f4e0bbc177a9a357479bfa7c95aaf21ad53d71e9c5afafb9' },
  @{ Name = 'tokenizer.json'; Length = 3930494; Sha256 = '7b469ff15eb7816315aa45eec391f5943d639b9d73d110f5c003df5192fd54e3' },
  @{ Name = 'onnx/encoder_model_quantized.onnx'; Length = 313154567; Sha256 = '2507d090bf9f1d468f4c1cef274aa34eda025894118f5476e24a0d80308a5315' },
  @{ Name = 'onnx/decoder_model_merged_quantized.onnx'; Length = 672561526; Sha256 = '9ddfe49c075a1ffcdef4738377db2a8681cdd5c5b124fda6df1c902e5722d6d1' }
)

foreach ($entry in $files) {
  $flat = "huggingface.co_$($repo.Replace('/', '_'))_resolve_${revision}_$($entry.Name.Replace('/', '_'))"
  $target = Join-Path $resolvedDestination $flat
  $download = "$target.part"
  $valid = (Test-Path -LiteralPath $target) -and ((Get-Item -LiteralPath $target).Length -eq $entry.Length)
  if ($valid -and $entry.Sha256) {
    $valid = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ieq $entry.Sha256
  }
  if ($valid) {
    Write-Host "Already verified: $($entry.Name)"
    continue
  }
  $url = "https://huggingface.co/$repo/resolve/$revision/$($entry.Name)"
  Write-Host "Downloading $($entry.Name) from pinned Hugging Face revision..."
  & curl.exe --fail --location --retry 4 --retry-delay 3 --output $download $url
  if ($LASTEXITCODE -ne 0) { throw "Download failed: $($entry.Name)" }
  if ((Get-Item -LiteralPath $download).Length -ne $entry.Length) {
    throw "Unexpected size: $($entry.Name)"
  }
  if ($entry.Sha256 -and (Get-FileHash -LiteralPath $download -Algorithm SHA256).Hash -ine $entry.Sha256) {
    throw "SHA-256 mismatch: $($entry.Name)"
  }
  Move-Item -LiteralPath $download -Destination $target -Force
  Write-Host "Verified: $($entry.Name)"
}

Write-Host "Whisper Medium multilingual model ready in $resolvedDestination"
