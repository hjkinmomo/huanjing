param(
    [int]$WebPort = 8796,
    [int]$AgentPort = 8797,
    [string]$KnowledgeRoot = "",
    [string]$PythonPath = "",
    [string]$RuntimeDataDir = "",
    [switch]$CopyTokenToClipboard,
    [switch]$PassThru
)

$ErrorActionPreference = "Stop"
$ProjectRoot = [IO.Path]::GetFullPath((Split-Path -Parent $MyInvocation.MyCommand.Path)).TrimEnd('\')
. (Join-Path $ProjectRoot "tools\project5-lifecycle.ps1")

if (-not $RuntimeDataDir) { $RuntimeDataDir = Join-Path $ProjectRoot "data" }
$RuntimeDataDir = [IO.Path]::GetFullPath($RuntimeDataDir).TrimEnd('\')
$StatePath = Join-Path $RuntimeDataDir "desktop-runtime.json"
$LockPath = Join-Path $RuntimeDataDir "desktop-runtime.lock"
New-Item -ItemType Directory -Force -Path $RuntimeDataDir | Out-Null

if ($WebPort -eq $AgentPort -or $WebPort -lt 1024 -or $AgentPort -lt 1024 -or $WebPort -gt 65535 -or $AgentPort -gt 65535) {
    throw "invalid_desktop_ports"
}
if (-not $KnowledgeRoot) {
    $KnowledgeRoot = Join-Path $ProjectRoot "knowledge"
    New-Item -ItemType Directory -Force -Path $KnowledgeRoot | Out-Null
}
if (-not (Test-Path -LiteralPath $KnowledgeRoot -PathType Container)) { throw "knowledge_root_missing:$KnowledgeRoot" }
$KnowledgeRoot = [IO.Path]::GetFullPath($KnowledgeRoot).TrimEnd('\')

if (-not $PythonPath) {
    $projectPython = Join-Path $ProjectRoot "runtime\python\python.exe"
    $PythonPath = if (Test-Path -LiteralPath $projectPython) { $projectPython } else { "python" }
}
if (Test-Path -LiteralPath $PythonPath -PathType Leaf) {
    $PythonPath = (Resolve-Path -LiteralPath $PythonPath).Path
} else {
    $pythonCommand = Get-Command $PythonPath -ErrorAction Stop
    $PythonPath = [IO.Path]::GetFullPath($pythonCommand.Source)
}

$lock = Enter-Project5LifecycleLock -Path $LockPath
$agent = $null
$web = $null
$token = ""
try {
    $existing = Read-Project5RuntimeState -Path $StatePath
    if ($null -ne $existing -and $null -ne $existing.processes) {
        $existingAgent = Test-Project5ProcessIdentity -Record $existing.processes.agent
        $existingWeb = Test-Project5ProcessIdentity -Record $existing.processes.web
        if ($existingAgent.owned -or $existingWeb.owned) { throw "desktop_already_running" }
        # A recycled PID is not ours to stop, but it must not permanently block fresh free ports.
    }
    if (Test-Project5Port -Port $WebPort) { throw "web_port_in_use:$WebPort" }
    if (Test-Project5Port -Port $AgentPort) { throw "agent_port_in_use:$AgentPort" }

    $bytes = New-Object byte[] 24
    $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
    $token = [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")

    $previousToken = $env:HERMES_BRIDGE_TOKEN
    $env:HERMES_BRIDGE_TOKEN = $token
    try {
        $agent = Start-Process -FilePath $PythonPath -ArgumentList @(
            "bridge.py", "--port", $AgentPort,
            "--allow-root", $ProjectRoot, "--knowledge-root", $KnowledgeRoot,
            "--data-dir", $RuntimeDataDir,
            "--suppress-token-output"
        ) -WorkingDirectory $ProjectRoot -WindowStyle Hidden `
            -RedirectStandardOutput (Join-Path $RuntimeDataDir "bridge.stdout.log") `
            -RedirectStandardError (Join-Path $RuntimeDataDir "bridge.stderr.log") -PassThru
    } finally {
        $env:HERMES_BRIDGE_TOKEN = $previousToken
    }

    $WebRoot = Join-Path $ProjectRoot "web"
    $previousGatewayToken = $env:HERMES_GATEWAY_TOKEN
    $env:HERMES_GATEWAY_TOKEN = $token
    try {
        $web = Start-Process -FilePath $PythonPath -ArgumentList @(
            "desktop_gateway.py", "--port", $WebPort,
            "--bridge-port", $AgentPort, "--web-root", $WebRoot
        ) -WorkingDirectory $ProjectRoot -WindowStyle Hidden `
            -RedirectStandardOutput (Join-Path $RuntimeDataDir "web.stdout.log") `
            -RedirectStandardError (Join-Path $RuntimeDataDir "web.stderr.log") -PassThru
    } finally {
        $env:HERMES_GATEWAY_TOKEN = $previousGatewayToken
    }

    $deadline = [DateTimeOffset]::UtcNow.AddSeconds(10)
    $health = $null
    do {
        Start-Sleep -Milliseconds 200
        if ($agent.HasExited) { throw "agent_exited_during_startup:$($agent.ExitCode)" }
        if ($web.HasExited) { throw "web_exited_during_startup:$($web.ExitCode)" }
        if ((Test-Project5Port -Port $WebPort) -and (Test-Project5Port -Port $AgentPort)) {
            try {
                # The authenticated loopback probe must never travel through a system proxy.
                # WebRequest.Proxy is request-local and works in Windows PowerShell 5.1 too.
                $probe = [Net.HttpWebRequest]::Create("http://127.0.0.1:$AgentPort/v1/agent/status")
                $probe.Proxy = $null
                $probe.Timeout = 2000
                $probe.ReadWriteTimeout = 2000
                $probe.Headers['Authorization'] = "Bearer $token"
                $probeResponse = $probe.GetResponse()
                try {
                    $probeReader = [IO.StreamReader]::new($probeResponse.GetResponseStream())
                    try { $health = $probeReader.ReadToEnd() | ConvertFrom-Json }
                    finally { $probeReader.Dispose() }
                } finally { $probeResponse.Dispose() }
            } catch {
                $health = $null
            }
        }
    } until (($null -ne $health -and $health.ok) -or [DateTimeOffset]::UtcNow -ge $deadline)
    if ($null -eq $health -or -not $health.ok) { throw "agent_health_timeout" }

    $agentSignature = "bridge.py --port $AgentPort --allow-root $ProjectRoot"
    $webSignature = "desktop_gateway.py --port $WebPort --bridge-port $AgentPort --web-root $WebRoot"
    $now = [DateTimeOffset]::UtcNow.ToString("o")
    $state = @{
        schemaVersion = 1
        lifecycleState = "running"
        projectRoot = $ProjectRoot
        knowledgeRoot = $KnowledgeRoot
        pythonPath = $PythonPath
        webPort = $WebPort
        agentPort = $AgentPort
        webUrl = "http://127.0.0.1:$WebPort/experience.html"
        bridgeUrl = "http://127.0.0.1:$AgentPort"
        startedAt = $now
        updatedAt = $now
        failureReason = $null
        processes = @{
            agent = @{
                pid = $agent.Id
                creationTimeUtc = $agent.StartTime.ToUniversalTime().ToString("o")
                executablePath = $PythonPath
                commandSignature = $agentSignature
            }
            web = @{
                pid = $web.Id
                creationTimeUtc = $web.StartTime.ToUniversalTime().ToString("o")
                executablePath = $PythonPath
                commandSignature = $webSignature
            }
        }
    }
    Write-Project5RuntimeState -Path $StatePath -State $state

    $result = [pscustomobject]@{
        Url = $state.webUrl
        BridgeUrl = $state.bridgeUrl
        SessionToken = $token
        AgentPid = $agent.Id
        WebPid = $web.Id
        PythonPath = $PythonPath
        KnowledgeRoot = $KnowledgeRoot
        Database = (Join-Path $RuntimeDataDir "hermes_agent.db")
        StatePath = $StatePath
    }
    if ($CopyTokenToClipboard) { Set-Clipboard -Value $token }
    if ($PassThru) { return $result }
    $result | Select-Object -Property Url, BridgeUrl, AgentPid, WebPid, PythonPath, KnowledgeRoot, Database, StatePath | Format-List
    if ($CopyTokenToClipboard) { Write-Output "Session token copied to clipboard for explicit manual Bridge fallback; clear the clipboard after use." }
} catch {
    $failureRecord = $_
    $agentFailurePid = if ($null -ne $agent) { $agent.Id } else { 0 }
    $webFailurePid = if ($null -ne $web) { $web.Id } else { 0 }
    $agentFailureTime = ""
    $webFailureTime = ""
    try { if ($null -ne $agent -and $null -ne $agent.StartTime) { $agentFailureTime = $agent.StartTime.ToUniversalTime().ToString("o") } } catch { }
    try { if ($null -ne $web -and $null -ne $web.StartTime) { $webFailureTime = $web.StartTime.ToUniversalTime().ToString("o") } } catch { }
    foreach ($child in @($agent, $web)) {
        if ($null -ne $child) {
            try { if (-not $child.HasExited) { Stop-Process -Id $child.Id -Force -ErrorAction Stop } } catch { }
        }
    }
    if ($null -eq $agent -and $null -eq $web) { throw $failureRecord }
    $reason = [string]$failureRecord.Exception.Message
    if ($reason.Length -gt 300) { $reason = $reason.Substring(0, 300) }
    $failed = @{
        schemaVersion = 1
        lifecycleState = "startup_failed"
        projectRoot = $ProjectRoot
        knowledgeRoot = $KnowledgeRoot
        pythonPath = $PythonPath
        webPort = $WebPort
        agentPort = $AgentPort
        webUrl = "http://127.0.0.1:$WebPort/"
        bridgeUrl = "http://127.0.0.1:$AgentPort"
        startedAt = $null
        updatedAt = [DateTimeOffset]::UtcNow.ToString("o")
        failureReason = $reason
        processes = @{
            agent = @{ pid = $agentFailurePid; creationTimeUtc = $agentFailureTime; executablePath = $PythonPath; commandSignature = "bridge.py --port $AgentPort --allow-root $ProjectRoot" }
            web = @{ pid = $webFailurePid; creationTimeUtc = $webFailureTime; executablePath = $PythonPath; commandSignature = "desktop_gateway.py --port $WebPort --bridge-port $AgentPort --web-root $(Join-Path $ProjectRoot 'web')" }
        }
    }
    Write-Project5RuntimeState -Path $StatePath -State $failed
    throw $failureRecord
} finally {
    if ($null -ne $lock) { $lock.Dispose() }
}
