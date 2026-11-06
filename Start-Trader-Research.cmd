@echo off
setlocal
cd /d "%~dp0"
echo Starting Trader Research Workspace on this PC only...
where py >nul 2>nul
if %errorlevel%==0 (
    py -3 local\workspace_server.py
    goto finished
)
where python >nul 2>nul
if %errorlevel%==0 (
    python local\workspace_server.py
    goto finished
)
echo.
echo Python 3.10+ was not found.
echo You can still open prototype\trader-workspace.html in Edge for offline research.
echo To enable local Ollama analysis, install Python 3 and rerun this launcher.
:finished
if errorlevel 1 pause
endlocal
