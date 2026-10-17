param(
    [string]$ProjectRoot = '',
    [string]$StatePath = '',
    [switch]$Json,
    [switch]$PassThru
)

$ErrorActionPreference = 'Stop'
if (-not $ProjectRoot) { $ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path }
$ProjectRoot = [IO.Path]::GetFullPath($ProjectRoot).TrimEnd('\')
. (Join-Path $ProjectRoot 'tools\project5-lifecycle.ps1')

$status = Get-Project5DesktopStatus -ProjectRoot $ProjectRoot -StatePath $StatePath
if ($PassThru) { return $status }
if ($Json) {
    $status | ConvertTo-Json -Depth 8
} else {
    $status
}
if (-not $status.ok) { exit 1 }
