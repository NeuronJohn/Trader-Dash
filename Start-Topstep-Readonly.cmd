@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>&1
if %errorlevel%==0 (
  py -3 local\topstep_server.py
) else (
  python local\topstep_server.py
)
if errorlevel 1 (
  echo.
  echo Could not start Topstep read-only workstation. Install Python 3.10+.
  pause
)
