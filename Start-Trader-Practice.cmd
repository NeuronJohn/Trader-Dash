@echo off
setlocal
cd /d "%~dp0"
echo Trader Research - optional practice market reader
echo Practice-token-only, manual closed-candle fetch, no orders.
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 local\practice_launcher.py
  goto finished
)
where python >nul 2>nul
if %errorlevel%==0 (
  python local\practice_launcher.py
  goto finished
)
echo Python 3.10+ was not detected.
:finished
if errorlevel 1 pause
endlocal
