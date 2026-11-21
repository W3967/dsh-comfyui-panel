@echo off
title Stop ComfyUI
echo Stopping ComfyUI (only processes running ComfyUI\main.py)...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$p = Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*ComfyUI*main.py*' }; if (-not $p) { Write-Host 'No ComfyUI process found.'; exit 0 }; $p | ForEach-Object { Write-Host ('  killing PID ' + $_.ProcessId); Stop-Process -Id $_.ProcessId -Force }; Write-Host 'Stopped.'"
echo.
ping -n 3 127.0.0.1 >nul
