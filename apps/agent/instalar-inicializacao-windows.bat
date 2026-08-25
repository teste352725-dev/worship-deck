@echo off
setlocal
set "TARGET=%~dp0start-agent.bat"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ws=New-Object -ComObject WScript.Shell; $s=$ws.CreateShortcut([Environment]::GetFolderPath('Startup')+'\Worship Agent.lnk'); $s.TargetPath='%TARGET%'; $s.WorkingDirectory='%~dp0'; $s.WindowStyle=7; $s.Save()"
if errorlevel 1 (
  echo Nao foi possivel criar o atalho de inicializacao.
  pause
  exit /b 1
)
echo.
echo Worship Agent configurado para iniciar com o Windows.
echo.
pause
