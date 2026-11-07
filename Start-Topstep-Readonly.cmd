@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>&1
if not errorlevel 1 (
  set "PY=py -3"
) else (
  set "PY=python"
)

%PY% -c "import sys; assert sys.version_info >= (3,10); from zoneinfo import ZoneInfo; ZoneInfo('America/Chicago')" >nul 2>&1
if errorlevel 1 (
  echo Checking Python 3.10+ and Windows timezone support...
  %PY% -c "import sys; assert sys.version_info >= (3,10)" >nul 2>&1
  if errorlevel 1 goto fail
  echo Installing missing IANA timezone database for Chicago sessions...
  %PY% -m pip install --user tzdata
  if errorlevel 1 goto fail
  %PY% -c "from zoneinfo import ZoneInfo; ZoneInfo('America/Chicago')" >nul 2>&1
  if errorlevel 1 goto fail
)

if "%TRADER_DEMO%"=="1" (
  echo Starting completely offline synthetic rehearsal mode...
) else (
  %PY% -c "import websocket; assert hasattr(websocket, 'create_connection')" >nul 2>&1
  if errorlevel 1 (
    echo Installing local Topstep SignalR WebSocket client...
    %PY% -m pip install --user -r requirements-topstep.txt
    if errorlevel 1 goto fail
  )
)

%PY% local\topstep_server.py
if errorlevel 1 goto fail
exit /b 0

:fail
echo.
echo Topstep read-only workstation could not start. Python 3.10+ and internet access for first-time timezone setup may be required.
pause
exit /b 1
