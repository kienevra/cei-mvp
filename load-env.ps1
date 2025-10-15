Write-Host "Loading environment variables from .env..." -ForegroundColor Cyan
Get-Content "$PSScriptRoot\.env" | ForEach-Object {
    if ($_ -match '^\s*([^#=]+)=(.*)$') {
        $name = $matches[1].Trim()
        $value = $matches[2].Trim().Trim('"')
        Set-Item -Path "Env:${name}" -Value $value
        Write-Host "ENV set: $name" -ForegroundColor Green
    }
}
Write-Host "Environment loaded successfully." -ForegroundColor Yellow

#To run migrations when envs are live run the following in your powershell
#.\load-env.ps1
