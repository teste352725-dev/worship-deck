@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 exit /b 1
start "Worship Deck Server" /min cmd /c "cd /d \"%~dp0\" && node server.js"
timeout /t 4 /nobreak >nul
start "" "http://127.0.0.1:4177"
exit
