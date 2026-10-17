Set-StrictMode -Version 2.0

function Resolve-Project5CanonicalPath {
    param([Parameter(Mandatory = $true)][string]$Path)
    return [IO.Path]::GetFullPath($Path).TrimEnd('\')
}

function Enter-Project5LifecycleLock {
    param([Parameter(Mandatory = $true)][string]$Path)
    $parent = Split-Path -Parent $Path
    if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
    try {
        return [IO.File]::Open($Path, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    } catch [IO.IOException] {
        throw "lifecycle_lock_held:$Path"
    }
}

function Test-Project5SensitiveState {
    param([Parameter(Mandatory = $true)][AllowNull()]$Value)
    if ($null -eq $Value) { return $false }
    $forbidden = '(?i)(token|secret|authorization|api.?key)'
    if ($Value -is [Collections.IDictionary]) {
        foreach ($key in $Value.Keys) {
            if ([string]$key -match $forbidden) { return $true }
            if (Test-Project5SensitiveState -Value $Value[$key]) { return $true }
        }
        return $false
    }
    if ($Value -is [Collections.IEnumerable] -and $Value -isnot [string]) {
        foreach ($item in $Value) {
            if (Test-Project5SensitiveState -Value $item) { return $true }
        }
        return $false
    }
    if ($null -ne $Value -and $Value -is [psobject] -and $Value -isnot [string]) {
        foreach ($property in $Value.PSObject.Properties) {
            if ($property.MemberType -notmatch 'Property') { continue }
            if ($property.Name -match $forbidden) { return $true }
            if (Test-Project5SensitiveState -Value $property.Value) { return $true }
        }
    }
    return $false
}

function Read-Project5RuntimeState {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    try {
        $raw = [IO.File]::ReadAllText($Path, [Text.Encoding]::UTF8)
        if (-not $raw.Trim()) { throw 'empty' }
        return $raw | ConvertFrom-Json
    } catch {
        throw "runtime_state_invalid:$($_.Exception.Message)"
    }
}

function Write-Project5RuntimeState {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)]$State
    )
    if (Test-Project5SensitiveState -Value $State) { throw 'runtime_state_contains_sensitive_key' }
    $parent = Split-Path -Parent $Path
    if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
    $temporary = "$Path.$([Guid]::NewGuid().ToString('N')).tmp"
    try {
        $json = $State | ConvertTo-Json -Depth 12
        [IO.File]::WriteAllText($temporary, $json, [Text.UTF8Encoding]::new($false))
        Move-Item -LiteralPath $temporary -Destination $Path -Force
    } finally {
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
    }
}

function Test-Project5Port {
    param(
        [Parameter(Mandatory = $true)][int]$Port,
        [int]$TimeoutMilliseconds = 250
    )
    $client = [Net.Sockets.TcpClient]::new()
    try {
        $task = $client.ConnectAsync('127.0.0.1', $Port)
        return $task.Wait($TimeoutMilliseconds) -and $client.Connected
    } catch {
        return $false
    } finally {
        $client.Dispose()
    }
}

function Get-Project5ProcessSnapshot {
    param([Parameter(Mandatory = $true)][int]$ProcessId)
    if ($ProcessId -le 0) { return $null }
    try {
        $process = Get-Process -Id $ProcessId -ErrorAction Stop
        $cim = Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction Stop
        $executable = if ($cim.ExecutablePath) { [string]$cim.ExecutablePath } else { [string]$process.Path }
        return [pscustomobject]@{
            pid = $ProcessId
            creationTimeUtc = $process.StartTime.ToUniversalTime().ToString('o')
            executablePath = $executable
            commandLine = [string]$cim.CommandLine
        }
    } catch {
        return $null
    }
}

function ConvertTo-Project5UtcDateTime {
    param([Parameter(Mandatory = $true)]$Value)
    if ($Value -is [DateTimeOffset]) { return ([DateTimeOffset]$Value).UtcDateTime }
    if ($Value -is [DateTime]) { return ([DateTime]$Value).ToUniversalTime() }
    return [DateTimeOffset]::Parse(
        [string]$Value,
        [Globalization.CultureInfo]::InvariantCulture,
        [Globalization.DateTimeStyles]::RoundtripKind
    ).UtcDateTime
}

function Test-Project5ProcessIdentity {
    param([Parameter(Mandatory = $true)]$Record)
    $pidValue = [int]$Record.pid
    $snapshot = Get-Project5ProcessSnapshot -ProcessId $pidValue
    if ($null -eq $snapshot) {
        return [pscustomobject]@{ owned = $false; live = $false; reason = 'not_live'; pid = $pidValue }
    }

    try {
        $recordedTime = ConvertTo-Project5UtcDateTime -Value $Record.creationTimeUtc
        $liveTime = ConvertTo-Project5UtcDateTime -Value $snapshot.creationTimeUtc
        if ([Math]::Abs(($recordedTime - $liveTime).TotalSeconds) -gt 1.0) {
            return [pscustomobject]@{ owned = $false; live = $true; reason = 'creation_time_mismatch'; pid = $pidValue }
        }
    } catch {
        return [pscustomobject]@{ owned = $false; live = $true; reason = 'creation_time_invalid'; pid = $pidValue }
    }

    try {
        $expectedExecutable = Resolve-Project5CanonicalPath -Path ([string]$Record.executablePath)
        $liveExecutable = Resolve-Project5CanonicalPath -Path ([string]$snapshot.executablePath)
        if (-not $expectedExecutable.Equals($liveExecutable, [StringComparison]::OrdinalIgnoreCase)) {
            return [pscustomobject]@{ owned = $false; live = $true; reason = 'executable_mismatch'; pid = $pidValue }
        }
    } catch {
        return [pscustomobject]@{ owned = $false; live = $true; reason = 'executable_invalid'; pid = $pidValue }
    }

    $signature = [string]$Record.commandSignature
    if (-not $signature -or ([string]$snapshot.commandLine).IndexOf($signature, [StringComparison]::OrdinalIgnoreCase) -lt 0) {
        return [pscustomobject]@{ owned = $false; live = $true; reason = 'command_mismatch'; pid = $pidValue }
    }
    return [pscustomobject]@{ owned = $true; live = $true; reason = 'owned'; pid = $pidValue }
}

function Get-Project5DesktopStatus {
    param(
        [Parameter(Mandatory = $true)][string]$ProjectRoot,
        [string]$StatePath = ''
    )
    $root = Resolve-Project5CanonicalPath -Path $ProjectRoot
    if (-not $StatePath) { $StatePath = Join-Path $root 'data\desktop-runtime.json' }
    $state = Read-Project5RuntimeState -Path $StatePath
    if ($null -eq $state) {
        return [pscustomobject]@{
            ok = $false; lifecycleState = 'not_started'; persistedState = 'missing'
            agent = $null; web = $null; agentPortOpen = $false; webPortOpen = $false; health = $null
        }
    }
    $agentIdentity = Test-Project5ProcessIdentity -Record $state.processes.agent
    $webIdentity = Test-Project5ProcessIdentity -Record $state.processes.web
    $agentPortOpen = Test-Project5Port -Port ([int]$state.agentPort)
    $webPortOpen = Test-Project5Port -Port ([int]$state.webPort)
    $health = $null
    if ($agentPortOpen) {
        try {
            $probe = [Net.HttpWebRequest]::Create([string]$state.bridgeUrl + '/v1/health')
            $probe.Proxy = $null
            $probe.Timeout = 2000
            $probe.ReadWriteTimeout = 2000
            $response = $probe.GetResponse()
            try {
                $reader = [IO.StreamReader]::new($response.GetResponseStream())
                try { $health = $reader.ReadToEnd() | ConvertFrom-Json }
                finally { $reader.Dispose() }
            } finally { $response.Dispose() }
        } catch {
            $health = [pscustomobject]@{ ok = $false; error = 'health_unavailable' }
        }
    }
    $healthy = $agentIdentity.owned -and $webIdentity.owned -and $agentPortOpen -and $webPortOpen -and $health.ok
    $effective = if ($healthy) { 'running' } elseif ($agentIdentity.live -or $webIdentity.live -or $agentPortOpen -or $webPortOpen) { 'degraded' } else { 'stopped' }
    return [pscustomobject]@{
        ok = [bool]$healthy
        lifecycleState = $effective
        persistedState = [string]$state.lifecycleState
        updatedAt = [string]$state.updatedAt
        webUrl = [string]$state.webUrl
        bridgeUrl = [string]$state.bridgeUrl
        agent = $agentIdentity
        web = $webIdentity
        agentPortOpen = [bool]$agentPortOpen
        webPortOpen = [bool]$webPortOpen
        health = $health
    }
}
