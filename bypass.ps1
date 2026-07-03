# ShrinkMe.click Bypass PowerShell Script
# Usage: .\bypass.ps1 -Url "https://shrinkme.click/pRgC7uL"

param(
    [Parameter(Mandatory=$true)]
    [string]$Url
)

Write-Host "`n[ShrinkMe Bypass]" -ForegroundColor Cyan
Write-Host "[Target] $Url"

# Extract code from URL
$code = ($Url.TrimEnd('/').Split('/')[-1])
Write-Host "[Code] $code"

# Use Python for the bypass
$pythonScript = "C:\Users\Belal\Documents\SHORTLINK\bypass.py"

if (Test-Path $pythonScript) {
    Write-Host "`n[Running bypass script...]"
    $result = python $pythonScript $Url 2>&1
    
    # Extract URL from output
    if ($result -match "DESTINATION URL:\s+(https?://[^\s]+)") {
        $finalUrl = $Matches[1]
        Write-Host "`n[SUCCESS!]" -ForegroundColor Green
        Write-Host "[Destination] $finalUrl" -ForegroundColor Yellow
    } else {
        Write-Host $result
    }
} else {
    Write-Host "[Error] bypass.py not found" -ForegroundColor Red
}
