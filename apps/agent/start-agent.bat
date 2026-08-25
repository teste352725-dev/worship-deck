@echo off
cd /d "%~dp0"
title Worship Agent V3
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js nao foi encontrado neste computador.
  echo Instale Node.js 18 ou superior e tente novamente.
  echo.
  pause
  exit /b 1
)
node agent.js
pause
