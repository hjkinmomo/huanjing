param(
    [string]$ProjectRoot = "",
    [string]$RuntimeDataDir = "",
    [switch]$PassThru
)

$ErrorActionPreference = "Stop"
if (-not $ProjectRoot) { $ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path }
$ProjectRoot = [IO.Path]::GetFullPath($ProjectRoot).TrimEnd('\')
. (Join-Path $ProjectRoot "tools\project5-lifecycle.ps1")

if (-not $RuntimeDataDir) { $RuntimeDataDir = Join-Path $ProjectRoot "data" }
$RuntimeDataDir = [IO.Path]::GetFullPath($RuntimeDataDir).TrimEnd('\')
$StatePath = Join-Path $RuntimeDataDir "desktop-runtime.json"
$LockPath = Join-Path $RuntimeDataDir "desktop-runtime.lock"
$lock = Enter-Project5LifecycleLock -Path $LockPath
try {
    $state = Read-Project5RuntimeState -Path $StatePath
    if ($null -eq $state) { throw "desktop_state_missing" }
    $agentIdentity = Test-Project5ProcessIdentity -Record $state.processes.agent
    $webIdentity = Test-Project5ProcessIdentity -Record $state.processes.web

    foreach ($identity in @($agentIdentity, $webIdentity)) {
        if ($identity.live -and -not $identity.owned) {
            throw "desktop_process_identity_mismatch:$($identity.pid):$($identity.reason)"
        }
    }

    foreach ($identity in @($agentIdentity, $webIdentity)) {
        if ($identity.owned) {
            Stop-Process -Id $identity.pid -ErrorAction Stop
            try { Wait-Process -Id $identity.pid -Timeout 5 -ErrorAction Stop } catch {
                $remaining = Get-Process -Id $identity.pid -ErrorAction SilentlyContinue
                if ($remaining) { throw "desktop_process_stop_timeout:$($identity.pid)" }
            }
        }
    }

    $state.lifecycleState = "stopped"
    $state.updatedAt = [DateTimeOffset]::UtcNow.ToString("o")
    $state.failureReason = $null
    Write-Project5RuntimeState -Path $StatePath -State $state
    $result = [pscustomobject]@{
        ok = $true
        lifecycleState = "stopped"
        agentPid = [int]$state.processes.agent.pid
        webPid = [int]$state.processes.web.pid
        statePath = $StatePath
    }
    if ($PassThru) { return $result }
    $result
} finally {
    if ($null -ne $lock) { $lock.Dispose() }
}
