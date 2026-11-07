@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>&1
if not errorlevel 1 (
  set "PY=py -3"
) else (
  set "PY=python"
)

echo.
echo === Topstep Offline Preflight ===
echo NO TOPSTEP CREDENTIALS OR API CONNECTION REQUIRED
echo.
%PY% -c "import sys; assert sys.version_info >= (3,10); from zoneinfo import ZoneInfo; ZoneInfo('America/Chicago')" >nul 2>&1
if errorlevel 1 (
  echo [BLOCKED] Python 3.10+ and America/Chicago timezone support required.
  echo Try Start-Topstep-Demo.cmd to provision timezone data.
  goto failed
)

echo [1/3] Running local Python unit and localhost HTTP tests...
%PY% -m unittest discover -s local/tests -p "test_*.py" -v
if errorlevel 1 goto failed

echo [2/3] Checking JavaScript tests...
where npm >nul 2>&1
if errorlevel 1 (
  echo [NOT RUN] Node.js/npm not installed. Python tests passed, JavaScript tests unverified.
  goto partial
)
call npm test
if errorlevel 1 goto failed
echo [3/3] Verifying production bundle compiles...
call npm run build
if errorlevel 1 goto failed
echo.
echo [PASS] Offline Python, JavaScript tests, and Vite production build passed.
echo [NOT VERIFIED] Windows browser visuals, actual TopstepX API, genuine streaming, live risk rules.
pause
exit /b 0

:partial
echo.
echo [PARTIAL] Offline Python passed; JavaScript requires npm.
pause
exit /b 2

:failed
echo.
echo [FAIL] One or more checks failed. Do not promote the draft release.
pause
exit /b 1
