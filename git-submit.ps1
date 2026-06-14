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

Require-Command "git"

$ProjectProxy = "http://127.0.0.1:18081"

function Invoke-Push {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Branch
    )

    Write-Host "Trying direct push..."
    git push origin $Branch
    if ($LASTEXITCODE -eq 0) {
        return
    }

    Write-Host ""
    Write-Host "Direct push failed. Trying project-only proxy: $ProjectProxy"
    git -c "http.proxy=$ProjectProxy" -c "https.proxy=$ProjectProxy" push origin $Branch
    if ($LASTEXITCODE -ne 0) {
        throw "Push failed with direct connection and project-only proxy."
    }
}

$message = ($args -join " ").Trim()
if ([string]::IsNullOrWhiteSpace($message)) {
    $message = "update: local changes $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
}

$branch = git branch --show-current
if ([string]::IsNullOrWhiteSpace($branch)) {
    throw "Not on a normal branch, cannot push automatically."
}

$remote = git remote get-url origin
Write-Host "Repository: $Root"
Write-Host "Remote:     $remote"
Write-Host "Branch:     $branch"
Write-Host "Message:    $message"
Write-Host ""

git add -A

$changes = git status --porcelain
if (-not [string]::IsNullOrWhiteSpace($changes)) {
    git commit -m $message
} else {
    Write-Host "No file changes to commit."
}

Write-Host ""
Write-Host "Pushing to origin/$branch..."
Invoke-Push -Branch $branch

$ahead = git rev-list --count "origin/$branch..HEAD" 2>$null
if (-not [string]::IsNullOrWhiteSpace($ahead) -and [int]$ahead -gt 0) {
    throw "Push did not complete. Local branch is still ahead of origin/$branch by $ahead commit(s)."
}

Write-Host ""
Write-Host "Commit and push completed."
