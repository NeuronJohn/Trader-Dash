@echo off
setlocal
cd /d "%~dp0"
set "TRADER_DEMO=1"
set "TOPSTEPX_USERNAME="
set "TOPSTEPX_API_KEY="
call Start-Topstep-Readonly.cmd
