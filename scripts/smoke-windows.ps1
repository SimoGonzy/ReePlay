param()

$ErrorActionPreference = 'Stop'
$project = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$backend = Join-Path $project 'frontend/src-tauri/binaries/musicapp-backend-x86_64-pc-windows-msvc.exe'
$tools = Join-Path $project 'frontend/src-tauri/bundled-tools'
if (-not (Test-Path -LiteralPath $backend -PathType Leaf) -or -not (Test-Path -LiteralPath $tools -PathType Container)) {
    throw 'Build the Windows sidecar before running this smoke test.'
}

$tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$temporary = Join-Path $tempRoot ('reeplay-smoke-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temporary | Out-Null
$process = $null

try {
    $start = [System.Diagnostics.ProcessStartInfo]::new($backend)
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $start.EnvironmentVariables['MUSICAPP_DATA_DIR'] = Join-Path $temporary 'data'
    $start.EnvironmentVariables['MUSICAPP_TOOLS_DIR'] = $tools
    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $start
    if (-not $process.Start()) { throw 'The engine did not start.' }
    $lineTask = $process.StandardOutput.ReadLineAsync()
    if (-not $lineTask.Wait(20000) -or $lineTask.Result -notmatch '^MUSICAPP_PORT=([0-9]+)$') {
        throw 'The engine did not announce a port.'
    }
    $port = [int]$Matches[1]

    $url = "http://127.0.0.1:$port"
    $status = $null
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        try {
            $status = Invoke-RestMethod -Uri "$url/api/status" -TimeoutSec 2
            break
        }
        catch {
            if ($process.HasExited) { throw 'The engine closed during startup.' }
            Start-Sleep -Milliseconds 250
        }
    }
    if (-not $status) { throw "The engine is not responding on port $port." }
    if (-not $status.ffmpeg -or -not $status.content.EndsWith('content\library')) {
        throw 'Invalid backend, FFmpeg, or library path.'
    }
    $playlist = Invoke-RestMethod -Uri "$url/api/playlists" -Method Post -ContentType 'application/json' -Body '{"title":"Windows smoke"}'
    $archive = Invoke-RestMethod -Uri "$url/api/playlists/$($playlist.id)/export" -Method Post
    if (-not (Test-Path -LiteralPath $archive.path -PathType Leaf)) { throw 'ZIP archive was not created.' }
    Invoke-RestMethod -Uri "$url/api/playlists/$($playlist.id)?keep_tracks=true" -Method Delete | Out-Null
    if ((Invoke-RestMethod -Uri "$url/api/library").playlists | Where-Object id -eq $playlist.id) {
        throw 'Playlist was not deleted.'
    }
    Write-Output 'Windows sidecar: FFmpeg, library, ZIP, and deletion OK'
}
finally {
    if ($process) {
        if (-not $process.HasExited) {
            $process.Kill()
            $process.WaitForExit(10000) | Out-Null
        }
        $process.Dispose()
    }
    $resolved = [System.IO.Path]::GetFullPath($temporary)
    if (-not $resolved.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase) -or (Split-Path $resolved -Leaf) -notlike 'reeplay-smoke-*') {
        throw 'Invalid temporary path: cleanup stopped.'
    }
    for ($attempt = 0; $attempt -lt 8; $attempt++) {
        try {
            Remove-Item -LiteralPath $resolved -Recurse -Force
            break
        }
        catch {
            if ($attempt -eq 7) { throw }
            Start-Sleep -Milliseconds 300
        }
    }
}
