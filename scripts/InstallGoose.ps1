# Verifies the installed signed runtime or downloads the pinned official installer.
$ErrorActionPreference = 'Stop'
# Goose Desktop installs its signed CLI next to its other bundled resources.
$executable = Join-Path $env:LOCALAPPDATA 'Programs\Goose\resources\bin\goose.exe'
if (Test-Path -LiteralPath $executable)
{
	$signature = Get-AuthenticodeSignature -LiteralPath $executable
	$binaryHash = (Get-FileHash -LiteralPath $executable -Algorithm SHA256).Hash
	if ($signature.Status -ne 'Valid' -or $binaryHash -ne 'cd4a06fe6811a50394138916517668ba816dee20fa482c0e157b3bbd4279ffcf')
	{
		throw 'The installed runtime is not the verified signed Goose 1.59.0 build.'
	}
	Write-Output "Verified signed Goose 1.59.0. Set CHORA_GOOSE_BINARY=$executable in .env.local, then restart Chora."
	Write-Output 'Use the Ollama provider with the existing Chora model profile; no Hugging Face download is needed.'
}
else
{
	# The repository owns only this ignored download directory; the installer is not run automatically.
	$repoRoot = Split-Path -Parent $PSScriptRoot
	$destination = Join-Path $repoRoot '.tmp\goose-installer'
	New-Item -ItemType Directory -Force $destination | Out-Null
	$installer = Join-Path $destination 'Goose-win32-x64-setup.exe'
	Invoke-WebRequest 'https://github.com/aaif-goose/goose/releases/download/v1.59.0/Goose-win32-x64-setup.exe' -OutFile $installer
	$hash = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash
	$signature = Get-AuthenticodeSignature -LiteralPath $installer
	if ($hash -ne '66d83d86953b445dfd64f83517c37e534b427319f3a00e326c7bbef90d61de4b' -or $signature.Status -ne 'Valid')
	{
		throw 'The signed Goose installer failed verification.'
	}
	Write-Output "Verified installer downloaded to $installer. Run it, then rerun this script to verify the bundled runtime."
}
