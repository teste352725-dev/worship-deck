@echo off
setlocal
set "TARGET=%~dp0iniciar-automatico.bat"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ws=New-Object -ComObject WScript.Shell; $s=$ws.CreateShortcut([Environment]::GetFolderPath('Startup')+'\Worship Deck.lnk'); $s.TargetPath='%TARGET%'; $s.WorkingDirectory='%~dp0'; $s.Save()"
if errorlevel 1 (
  echo Nao foi possivel criar o atalho de inicializacao.
  pause
  exit /b 1
)
echo.
echo Worship Deck configurado para iniciar com o Windows.
echo.
pause
