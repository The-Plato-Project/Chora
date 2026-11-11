# Installs the pinned portable Windows runtime without altering ordinary Goose profiles.
$ErrorActionPreference = 'Stop'
# The repository owns only this ignored installation directory.
$repoRoot = Split-Path -Parent $PSScriptRoot
$destination = Join-Path $repoRoot '.tmp\goose-runtime'
$archive = Join-Path $destination 'goose.zip'
New-Item -ItemType Directory -Force $destination | Out-Null
Invoke-WebRequest 'https://github.com/aaif-goose/goose/releases/download/v1.59.0/goose-x86_64-pc-windows-msvc.zip' -OutFile $archive
# Release metadata and the extracted binary were independently verified before pinning.
$hash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash
if ($hash -ne '8b9ef7be66f469bdafd018de943a095ed83c32775dd623bebb0ab730da22d0d0')
{
	throw 'The Goose archive failed verification.'
}
Expand-Archive -LiteralPath $archive -DestinationPath $destination -Force
$executable = Join-Path $destination 'goose-package\goose.exe'
$binaryHash = (Get-FileHash -LiteralPath $executable -Algorithm SHA256).Hash
if ($binaryHash -ne '5a424ab992d75aaefdc54ccf27719f62c3995e6d9b283d1cca016ec4d4b055ef')
{
	throw 'The extracted Goose runtime failed verification.'
}
Write-Output "Verified Goose 1.59.0. Set CHORA_GOOSE_BINARY=$executable in .env.local, then restart Chora."
