param([int]$WebPort=8796,[int]$AgentPort=8797)
$ErrorActionPreference='Stop'
$project5DesktopRoot=$PSScriptRoot
$project5Status=& (Join-Path $project5DesktopRoot 'status-project5.ps1') -PassThru
if($project5Status.ok){$project5URL=$project5Status.webUrl}else{$project5Started=& (Join-Path $project5DesktopRoot 'start-project5.ps1') -WebPort $WebPort -AgentPort $AgentPort -PassThru;$project5URL=$project5Started.Url}
if(-not $project5URL){throw 'desktop_url_missing'}
$project5Edge=Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'
if(Test-Path -LiteralPath $project5Edge){Start-Process -FilePath $project5Edge -ArgumentList @("--app=$project5URL") -WindowStyle Hidden}else{Start-Process $project5URL}
