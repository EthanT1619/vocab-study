@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0convert-presets.ps1"
if errorlevel 1 (
  echo.
  echo Conversion failed.
  pause
  exit /b 1
)
echo.
pause
