# Creates an application-specific context profile while preserving the installed base model.
param(
	[ValidateSet('qwen3.5:9b', 'qwen3.5:4b')]
	[string]$Model = 'qwen3.5:9b'
)

$ErrorActionPreference = 'Stop'
# The fixed loopback endpoint is never supplied by a model or renderer document.
$endpoint = 'http://127.0.0.1:11434'
$inventory = Invoke-RestMethod -Uri "$endpoint/api/tags" -TimeoutSec 10
$installed = @($inventory.models | Where-Object { $_.name -eq $Model })
if ($installed.Count -ne 1)
{
	throw "Install $Model in Ollama first. This script does not download model weights."
}
# Separate names retain the original model's configuration and existing consumers.
$profile = if ($Model -eq 'qwen3.5:9b') { 'chora-qwen3.5:9b-16k' } else { 'chora-qwen3.5:4b-16k' }
$request = @{ model = $profile; from = $Model; parameters = @{ num_ctx = 16384; num_predict = 4096 }; stream = $false }
$body = $request | ConvertTo-Json -Depth 4
$created = Invoke-RestMethod -Method Post -Uri "$endpoint/api/create" -ContentType 'application/json' -Body $body -TimeoutSec 120
if ($created.status -ne 'success')
{
	throw 'Ollama did not confirm creation of the local Chora profile.'
}
# Verify the persisted parameters, because the compatibility API ignores request-level num_ctx.
$showBody = @{ model = $profile } | ConvertTo-Json
$configured = Invoke-RestMethod -Method Post -Uri "$endpoint/api/show" -ContentType 'application/json' -Body $showBody -TimeoutSec 10
if ($configured.parameters -notmatch '(?m)^num_ctx\s+16384\s*$' -or $configured.parameters -notmatch '(?m)^num_predict\s+4096\s*$')
{
	throw 'The Chora profile did not retain its required context and response limits.'
}
Write-Output "Configured $profile from existing $Model weights. The original model is unchanged."
