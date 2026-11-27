param([switch]$SkipBuild)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$version = (Get-Content -LiteralPath (Join-Path $projectRoot 'frontend/package.json') -Raw | ConvertFrom-Json).version
$baseName = "ReePlay_${version}_amd64"

if (-not $SkipBuild) {
    docker build --progress=plain -t musicapp-linux-builder -f packaging/linux/Dockerfile .
    if ($LASTEXITCODE -ne 0) { throw 'The Linux Docker build failed.' }
}

$container = docker create musicapp-linux-builder /bin/true
if ($LASTEXITCODE -ne 0) { throw 'Could not create the artifact container.' }
try {
    New-Item -ItemType Directory -Force -Path (Join-Path $projectRoot 'dist-linux') | Out-Null
    docker cp "${container}:/bundle/deb/$baseName.deb" (Join-Path $projectRoot "dist-linux/$baseName.deb")
    if ($LASTEXITCODE -ne 0) { throw 'Could not copy the .deb package.' }
    docker cp "${container}:/bundle/appimage/$baseName.AppImage" (Join-Path $projectRoot "dist-linux/$baseName.AppImage")
    if ($LASTEXITCODE -ne 0) { throw 'Could not copy the AppImage.' }
    Copy-Item -LiteralPath (Join-Path $projectRoot 'packaging/linux/install-appimage.sh') -Destination (Join-Path $projectRoot 'dist-linux/install-appimage.sh') -Force
    Copy-Item -LiteralPath (Join-Path $projectRoot 'frontend/src-tauri/icons/128x128.png') -Destination (Join-Path $projectRoot 'dist-linux/ReePlay.png') -Force
}
finally {
    docker rm $container | Out-Null
}
Get-ChildItem -LiteralPath (Join-Path $projectRoot 'dist-linux') -File | Select-Object Name,Length
