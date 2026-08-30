@echo off
cd /d "%~dp0"
title Worship Deck V3 Alpha 4 RC
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js nao foi encontrado neste computador.
  echo Instale o Node.js 18 ou superior e execute este arquivo novamente.
  echo.
  pause
  exit /b 1
)
node secure-entry.js
pause
