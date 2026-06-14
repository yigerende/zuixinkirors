$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

function Require-Command {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Missing required command: $Name"
    }
}

function New-LocalConfig {
    if (Test-Path -LiteralPath ".\config.json") {
        return
    }

    $apiKey = "csk_local_" + ([Guid]::NewGuid().ToString("N"))
    $adminApiKey = "sk-admin-local-" + ([Guid]::NewGuid().ToString("N").Substring(0, 16))
    $config = [ordered]@{
        host = "127.0.0.1"
        port = 8990
        apiKey = $apiKey
        adminApiKey = $adminApiKey
        region = "us-east-1"
        tlsBackend = "rustls"
        defaultEndpoint = "ide"
    }

    $config | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath ".\config.json" -Encoding UTF8
    Write-Host "Created config.json"
    Write-Host "API Key: $apiKey"
    Write-Host "Admin API Key: $adminApiKey"
}

function New-LocalCredentials {
    if (-not (Test-Path -LiteralPath ".\credentials.json")) {
        "[]" | Set-Content -LiteralPath ".\credentials.json" -Encoding UTF8
        Write-Host "Created credentials.json"
    }
}

function Build-AdminUi {
    if (Test-Path -LiteralPath ".\admin-ui\dist\index.html") {
        return
    }

    Require-Command "npm"
    Push-Location ".\admin-ui"
    try {
        if (Test-Path -LiteralPath ".\package-lock.json") {
            npm ci
        } else {
            npm install
        }
        npm run build
    } finally {
        Pop-Location
    }
}

Require-Command "cargo"
New-LocalConfig
New-LocalCredentials
Build-AdminUi

Write-Host ""
Write-Host "Starting kiro-rs..."
Write-Host "Admin UI: http://127.0.0.1:8990/admin"
Write-Host ""

cargo run -- --config config.json --credentials credentials.json
