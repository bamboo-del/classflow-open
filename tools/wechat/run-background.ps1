param([Parameter(Mandatory = $true)][string]$CredentialsFile)

$ErrorActionPreference = 'Stop'
$configPath = Join-Path $PSScriptRoot 'wechat.local.json'
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$logDir = Join-Path $projectRoot 'data\wechat'
[IO.Directory]::CreateDirectory($logDir) | Out-Null
$logPath = Join-Path $logDir 'sync.log'
$python = Join-Path $config.assistantRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $CredentialsFile -PathType Leaf)) { throw '找不到本机 ClassFlow 登录文件' }

Add-Content -LiteralPath $logPath -Encoding utf8 -Value ('启动 ' + (Get-Date).ToString('s'))
& $python -X utf8 -u (Join-Path $PSScriptRoot 'bridge.py') --config $configPath --credentials-file $CredentialsFile |
    Out-File -LiteralPath $logPath -Encoding utf8 -Append
exit $LASTEXITCODE
