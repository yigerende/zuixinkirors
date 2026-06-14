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
if ([string]::IsNullOrWhiteSpace($changes)) {
    Write-Host "No changes to commit."
    exit 0
}

git commit -m $message
git push origin $branch

Write-Host ""
Write-Host "Commit and push completed."
