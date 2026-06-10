@echo off
cd /d "%~dp0"
node build-standalone.js
if %ERRORLEVEL% NEQ 0 (
  echo Node.js가 필요합니다. https://nodejs.org 에서 설치 후 다시 실행하세요.
  pause
  exit /b 1
)
copy /Y standalone.html standalone-bundled.html >nul
echo.
echo 완료! 학생에게 보낼 파일:
echo   standalone-bundled.html
echo.
pause
