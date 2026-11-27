$ErrorActionPreference = 'Stop'

$frontend = Split-Path -Parent $PSScriptRoot
$cache = Join-Path $frontend '.vendor-cache'
$tools = Join-Path $frontend 'src-tauri\bundled-tools'
$licenses = Join-Path $tools 'licenses'
New-Item -ItemType Directory -Force -Path $cache, $tools, $licenses | Out-Null

function Get-VerifiedArchive($name, $url, $expectedSha256) {
    $archive = Join-Path $cache $name
    if (-not (Test-Path -LiteralPath $archive)) {
        Write-Host "Downloading $name"
        Invoke-WebRequest -Uri $url -OutFile $archive
    }
    $stream = [System.IO.File]::OpenRead($archive)
    try { $actual = [System.BitConverter]::ToString([System.Security.Cryptography.SHA256]::Create().ComputeHash($stream)).Replace('-', '') }
    finally { $stream.Dispose() }
    if ($actual -ne $expectedSha256) {
        throw "SHA-256 mismatch for $name. Remove the cached archive and try again."
    }
    return $archive
}

function Copy-ZipEntry($entry, $destination) {
    if ($null -eq $entry) { throw "Missing archive entry for $destination" }
    $inputStream = $entry.Open()
    try {
        $outputStream = [System.IO.File]::Create($destination)
        try { $inputStream.CopyTo($outputStream) }
        finally { $outputStream.Dispose() }
    }
    finally { $inputStream.Dispose() }
}

$nodeUrl = 'https://nodejs.org/dist/v24.16.0/node-v24.16.0-win-x64.zip'
$nodeArchive = Get-VerifiedArchive 'node-v24.16.0-win-x64.zip' $nodeUrl 'EDACA9BD58EC8E92037DAC4E877D52F6B8F430B81C18B57E264B4E2FB111CD56'
$ffmpegUrl = 'https://github.com/FFmpeg-Builds/FFmpeg-Builds/releases/download/autobuild-2026-11-18-12-39/ffmpeg-n9.0.2-57-gd838f9f9ae-win64-lgpl-shared-9.0.zip'
$ffmpegArchive = Get-VerifiedArchive 'ffmpeg-n9.0.2-win64-lgpl-shared.zip' $ffmpegUrl 'A1725F7FDE34E20B05CB776CFE7E83A14221A247EA67C2F513E1E0492C13796B'

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($nodeArchive)
try {
    Copy-ZipEntry ($zip.Entries | Where-Object FullName -EQ 'node-v24.16.0-win-x64/node.exe' | Select-Object -First 1) (Join-Path $tools 'node.exe')
    Copy-ZipEntry ($zip.Entries | Where-Object FullName -EQ 'node-v24.16.0-win-x64/LICENSE' | Select-Object -First 1) (Join-Path $licenses 'node-LICENSE.txt')
}
finally { $zip.Dispose() }

$zip = [System.IO.Compression.ZipFile]::OpenRead($ffmpegArchive)
try {
    $entries = @($zip.Entries | Where-Object { $_.FullName -match '/bin/(ffmpeg\.exe|ffprobe\.exe|[^/]+\.dll)$' })
    if (($entries | Where-Object { $_.Name -eq 'ffmpeg.exe' }).Count -ne 1 -or
        ($entries | Where-Object { $_.Name -eq 'ffprobe.exe' }).Count -ne 1 -or
        ($entries | Where-Object { $_.Name -like '*.dll' }).Count -lt 1) {
        throw 'The FFmpeg archive does not contain the expected executables and DLLs.'
    }
    foreach ($entry in $entries) { Copy-ZipEntry $entry (Join-Path $tools $entry.Name) }
    Copy-ZipEntry ($zip.Entries | Where-Object { $_.FullName -match '/LICENSE\.txt$' } | Select-Object -First 1) (Join-Path $licenses 'ffmpeg-LICENSE.txt')
}
finally { $zip.Dispose() }

$manifest = [ordered]@{
    node = [ordered]@{ version = '24.16.0'; source = $nodeUrl }
    ffmpeg = [ordered]@{ version = '9.0.2-57-gd838f9f9ae'; source = $ffmpegUrl; license = 'LGPL-3.0' }
}
$manifest | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath (Join-Path $tools 'manifest.json') -Encoding UTF8
Write-Host "Bundled download tools ready in $tools"
