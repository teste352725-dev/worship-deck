@echo off
cd /d "%~dp0"
title Worship Deck 1.0.1
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
