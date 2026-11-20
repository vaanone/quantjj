#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Vaan CSV HTTP server installer — run ONCE on the Vaan Windows VPS
  (elevated PowerShell session, via RDP).

.DESCRIPTION
  Stands up a lightweight authenticated HTTP file server that fronts the
  \\VAAN\VaanOne share, so the Vercel-hosted trading-chart app can read the
  CSV files over HTTP (CSV_BASE_URL) instead of Google Drive.

  What it does:
    1. Resolves \\VAAN\VaanOne to its LOCAL path (so the SYSTEM service can
       read the files without SMB loopback). Falls back to the UNC path.
    2. Generates a random basic-auth password (saved to C:\VaanCsvHttp\auth.txt,
       reused on re-runs).
    3. Writes the server script + config to C:\VaanCsvHttp\.
    4. Reserves the URL and opens the Windows Firewall for the port.
    5. Registers a Scheduled Task (runs as SYSTEM at startup) and starts it.
    6. Probes localhost and prints the exact env vars to set in Vercel.

  After this: open inbound TCP 8000 in the AWS Security Group, then set
  CSV_BASE_URL + CSV_BASIC_AUTH in Vercel. See the printed summary.
#>

$ErrorActionPreference = 'Stop'
$Port       = 8000
$ShareUnc   = '\\VAAN\VaanOne'
$InstallDir = 'C:\VaanCsvHttp'
$TaskName   = 'VaanCsvHttp'
$AuthUser   = 'vaan'

Write-Host "=== Vaan CSV HTTP server installer ===" -ForegroundColor Cyan

# --- 1. Resolve the share's local path -----------------------------------
$Share = $ShareUnc
# 'VaanOne' = the share name (host 'VAAN' is [0] after TrimStart)
$shareName = $ShareUnc.TrimStart('\').Split('\')[1]
try {
    $smb = Get-SmbShare -Name $shareName -ErrorAction Stop
    if ($smb -and $smb.Path) {
        $Share = $smb.Path
        Write-Host "Resolved $ShareUnc -> local path $Share"
    }
} catch {
    Write-Host "Could not resolve local path via Get-SmbShare; using UNC $Share"
}

if (-not (Test-Path -LiteralPath $Share)) {
    Write-Host "ERROR: path '$Share' does not exist on this machine." -ForegroundColor Red
    Write-Host "Edit `$ShareUnc at the top of this script to point at the CSV folder, then re-run."
    exit 1
}
$csvCount = @(Get-ChildItem -LiteralPath $Share -Filter *.csv -File).Count
Write-Host "Found $csvCount CSV file(s) in $Share"

# --- 2. Install dir + persistent auth password ---------------------------
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
$AuthPath = Join-Path $InstallDir 'auth.txt'
if (Test-Path $AuthPath) {
    $AuthPass = (Get-Content $AuthPath -Raw).Trim()
    Write-Host "Reusing existing auth password from $AuthPath"
} else {
    $rng = ((48..57) + (65..90) + (97..122) | Get-Random -Count 24)
    $AuthPass = -join ($rng | ForEach-Object { [char]$_ })
    Set-Content -Path $AuthPath -Value $AuthPass -Encoding ASCII
}

# --- 3. Write config + server script -------------------------------------
$cfg = @{ Port = $Port; Share = $Share; AuthUser = $AuthUser }
$cfg | ConvertTo-Json | Set-Content -Path (Join-Path $InstallDir 'config.json') -Encoding UTF8

$serverPath = Join-Path $InstallDir 'server.ps1'
$serverCode = @'
# Vaan CSV HTTP server — written by VaanCsvHttp-setup.ps1.
# Authenticated file server for the Vaan CSV share. Serves:
#   GET /index.json  -> [{name, modifiedTime, size}, ...] manifest
#   GET /<file.csv>  -> file bytes + Last-Modified header
#   GET /            -> HTML directory listing (fallback)
# All requests require HTTP Basic auth. Run via the VaanCsvHttp scheduled
# task (as SYSTEM). Logs to C:\VaanCsvHttp\server.log.
$ErrorActionPreference = 'Continue'
$ConfigPath = 'C:\VaanCsvHttp\config.json'
$AuthPath   = 'C:\VaanCsvHttp\auth.txt'
$LogPath    = 'C:\VaanCsvHttp\server.log'

function Write-Log($msg) {
    try { Add-Content -Path $LogPath -Value ("[{0}] {1}" -f (Get-Date -Format 'o'), $msg) } catch {}
}

try { $cfg = Get-Content $ConfigPath -Raw | ConvertFrom-Json }
catch { Write-Log "Cannot read config: $_"; exit 1 }

$Port     = [int]$cfg.Port
$Share    = [string]$cfg.Share
$AuthUser = [string]$cfg.AuthUser
try { $AuthPass = (Get-Content $AuthPath -Raw).Trim() }
catch { Write-Log "No auth file: $_"; exit 1 }
$Expected = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($AuthUser + ':' + $AuthPass))

function Send-Response {
    param($Response, $ContentType, $Body, $StatusCode, $LastModified)
    if ($StatusCode) { try { $Response.StatusCode = $StatusCode } catch {} }
    try { $Response.ContentType = $ContentType } catch {}
    if ($LastModified) { try { $Response.Headers['Last-Modified'] = $LastModified } catch {} }
    $Response.ContentLength64 = $Body.Length
    $Response.OutputStream.Write($Body, 0, $Body.Length)
    $Response.OutputStream.Close()
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add('http://+:' + $Port + '/')
try { $listener.Start() }
catch { Write-Log "Listener start failed: $_"; exit 1 }
Write-Log "Vaan CSV server listening on port $Port, serving $Share"

while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $req = $ctx.Request
    $res = $ctx.Response
    try {
        if ($req.Headers['Authorization'] -ne ('Basic ' + $Expected)) {
            try { $res.Headers['WWW-Authenticate'] = 'Basic realm="Vaan CSV"' } catch {}
            $b = [Text.Encoding]::UTF8.GetBytes('Unauthorized')
            Send-Response -Response $res -ContentType 'text/plain' -Body $b -StatusCode 401
            continue
        }

        $raw = [Uri]::UnescapeDataString($req.Url.AbsolutePath).TrimStart('/')
        if ($raw -match '\.\.' -or $raw -match '\\' -or $raw -match '^[A-Za-z]:') {
            $b = [Text.Encoding]::UTF8.GetBytes('Bad request')
            Send-Response -Response $res -ContentType 'text/plain' -Body $b -StatusCode 400
            continue
        }

        if ($raw -eq 'index.json') {
            $files = @(Get-ChildItem -LiteralPath $Share -Filter *.csv -File | Sort-Object Name)
            $items = $files | ForEach-Object {
                [PSCustomObject]@{ name = $_.Name; modifiedTime = $_.LastWriteTimeUtc.ToString('o'); size = $_.Length }
            }
            $json = $items | ConvertTo-Json -Compress -Depth 3
            if (-not $json.StartsWith('[')) { $json = '[' + $json + ']' }
            $b = [Text.Encoding]::UTF8.GetBytes($json)
            Send-Response -Response $res -ContentType 'application/json; charset=utf-8' -Body $b
            continue
        }

        if ($raw -ne '') {
            $target = Join-Path $Share $raw
            if (Test-Path -LiteralPath $target -PathType Leaf) {
                $bytes = [IO.File]::ReadAllBytes($target)
                $lm = (Get-Item -LiteralPath $target).LastWriteTimeUtc.ToString('R')
                Send-Response -Response $res -ContentType 'text/csv; charset=utf-8' -Body $bytes -LastModified $lm
                continue
            }
        }

        if ($raw -eq '') {
            $files = @(Get-ChildItem -LiteralPath $Share -Filter *.csv -File | Sort-Object Name)
            $sb = New-Object Text.StringBuilder
            [void]$sb.Append('<html><head><meta charset="utf-8"><title>Vaan CSV</title></head><body><h1>Vaan CSV files</h1><ul>')
            foreach ($f in $files) {
                $href = [Uri]::EscapeDataString($f.Name)
                [void]$sb.Append('<li><a href="' + $href + '">' + $f.Name + '</a> (' + $f.Length + ' bytes)</li>')
            }
            [void]$sb.Append('</ul></body></html>')
            $b = [Text.Encoding]::UTF8.GetBytes($sb.ToString())
            Send-Response -Response $res -ContentType 'text/html; charset=utf-8' -Body $b
            continue
        }

        $b = [Text.Encoding]::UTF8.GetBytes('Not found')
        Send-Response -Response $res -ContentType 'text/plain' -Body $b -StatusCode 404
    }
    catch {
        Write-Log "Request error: $_"
        try { $res.StatusCode = 500 } catch {}
        try { $res.OutputStream.Close() } catch {}
    }
}
'@
Set-Content -Path $serverPath -Value $serverCode -Encoding ASCII

# --- 4. URL reservation + Windows Firewall -------------------------------
try { netsh http add urlacl url="http://+:$Port/" user="NT AUTHORITY\SYSTEM" 2>$null | Out-Null } catch {}
if (-not (Get-NetFirewallRule -DisplayName $TaskName -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName $TaskName -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -Profile Any | Out-Null
    Write-Host "Opened Windows Firewall for TCP $Port"
}

# --- 5. Scheduled task (SYSTEM, on startup) ------------------------------
schtasks /Delete /TN $TaskName /F 2>$null | Out-Null
# No spaces in the path, so no quoting needed — avoids schtasks /TR truncation.
$cmd = 'powershell.exe -ExecutionPolicy Bypass -NoProfile -WindowStyle Hidden -File ' + $serverPath
schtasks /Create /TN $TaskName /TR $cmd /SC ONSTART /RU SYSTEM /RL HIGHEST /F | Out-Null
schtasks /Run /TN $TaskName | Out-Null
Write-Host "Scheduled task '$TaskName' created and started (runs as SYSTEM at startup)"

# --- 6. Verify + print summary -------------------------------------------
Start-Sleep -Seconds 3
$basic = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($AuthUser + ':' + $AuthPass))
$probe = $null
try {
    $probe = Invoke-WebRequest -Uri "http://localhost:$Port/index.json" `
        -Headers @{ Authorization = "Basic $basic" } -UseBasicParsing -TimeoutSec 5
} catch { Write-Host "Local probe failed: $_" -ForegroundColor Yellow }

Write-Host ""
Write-Host "=== Installation complete ===" -ForegroundColor Green
if ($probe -and $probe.StatusCode -eq 200) {
    Write-Host "Local probe OK — server is responding on port $Port." -ForegroundColor Green
    Write-Host "Manifest: $($probe.Content.Substring(0, [Math]::Min(200, $probe.Content.Length)))"
} else {
    Write-Host "WARNING: local probe did not return 200." -ForegroundColor Yellow
    Write-Host "Check: Get-Content C:\VaanCsvHttp\server.log ; schtasks /Query /TN $TaskName /V"
}

Write-Host ""
Write-Host ">>> Set these in Vercel (Project -> Settings -> Environment Variables):" -ForegroundColor Cyan
Write-Host "    CSV_BASE_URL   = http://3.26.176.158:$Port"
Write-Host "    CSV_BASIC_AUTH = $AuthUser`:$AuthPass"
Write-Host ""
Write-Host "(Auth password also saved to $AuthPath)"
Write-Host ""
Write-Host ">>> IMPORTANT — open inbound TCP $Port in the AWS Security Group:" -ForegroundColor Yellow
Write-Host "    EC2:      Instances -> select instance -> Security tab -> Security Group"
Write-Host "              -> Edit inbound rules -> Add: Custom TCP, Port $Port, Source 0.0.0.0/0"
Write-Host "    Lightsail: Networking tab -> Firewall -> add rule TCP $Port"
Write-Host ""
Write-Host "Once the SG rule is added and Vercel has the env vars, tell the agent to verify."
