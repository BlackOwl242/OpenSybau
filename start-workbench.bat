@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js was not found. Install Node.js, then run this file again.
  pause
  exit /b 1
)

if not exist "node_modules\vite\bin\vite.js" (
  where npm >nul 2>&1
  if errorlevel 1 (
    echo npm was not found. Install Node.js with npm, then run this file again.
    pause
    exit /b 1
  )
  echo Installing the small Preact and Vite frontend dependencies for the first run...
  call npm ci --no-audit --no-fund
  if errorlevel 1 (
    echo Dependency installation failed. Check your network connection and try again.
    pause
    exit /b 1
  )
)

powershell -NoProfile -Command "$ok=$false; try { $s=Invoke-RestMethod -Uri 'http://127.0.0.1:4173/api/state' -TimeoutSec 2; $p=@($s.PSObject.Properties.Name); $ok=(($p -contains 'settings') -and ($p -contains 'workspaces') -and ($p -contains 'tasks') -and ($p -contains 'frontendVersion')) } catch {}; if ($ok) { exit 0 }; exit 1"
if not errorlevel 1 (
  echo OpenSybau is already running. Opening the existing server.
  start "" "http://127.0.0.1:4173/"
  exit /b 0
)

echo Starting OpenSybau. Keep the OpenSybau Server window open while you use it.
start "OpenSybau Server" cmd /k "npm run dev"

powershell -NoProfile -Command "$deadline=(Get-Date).AddSeconds(25); do { try { $s=Invoke-RestMethod -Uri 'http://127.0.0.1:4173/api/state' -TimeoutSec 1; $p=@($s.PSObject.Properties.Name); if (($p -contains 'settings') -and ($p -contains 'workspaces') -and ($p -contains 'tasks') -and ($p -contains 'frontendVersion')) { Start-Process 'http://127.0.0.1:4173/'; exit 0 } } catch {}; Start-Sleep -Milliseconds 500 } while ((Get-Date) -lt $deadline); exit 1"
if errorlevel 1 (
  echo OpenSybau did not become ready. Check the OpenSybau Server window for an error.
  pause
  exit /b 1
)

echo OpenSybau is ready at http://127.0.0.1:4173/
exit /b 0
