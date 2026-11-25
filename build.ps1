param(
    [switch]$SkipWebapp
)

$ErrorActionPreference = "Stop"

Write-Host "Building server plugin..." -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path "server/dist" | Out-Null

go build -o "server/dist/plugin-windows-amd64.exe" .
if ($LASTEXITCODE -ne 0) { throw "Server build failed" }

Write-Host "Build server plugin - OK" -ForegroundColor Green

if (-not $SkipWebapp) {
    Write-Host "Building webapp plugin..." -ForegroundColor Cyan
    Push-Location webapp
    npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "webapp build failed" }
    Pop-Location
    Write-Host "Build webapp plugin - OK" -ForegroundColor Green
}

Write-Host "Done!" -ForegroundColor Green
