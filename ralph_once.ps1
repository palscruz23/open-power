Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$rootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$bashCandidates = @(
  'C:\Program Files\Git\bin\bash.exe',
  'C:\Program Files\Git\usr\bin\bash.exe'
)

$bashPath = $bashCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $bashPath) {
  throw 'Git Bash was not found. Install Git for Windows or update ralph_once.ps1 with the correct bash.exe path.'
}

Push-Location $rootDir
try {
  & $bashPath './ralph_once.sh'
  exit $LASTEXITCODE
}
finally {
  Pop-Location
}
