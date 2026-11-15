@echo off
REM ===== Muhammad C++ Studio - run the whole studio on Windows (Docker Desktop) =====
chcp 65001 >nul
cd /d "%~dp0"
set "PORT=4000"
set "COMPOSE=docker compose -f infrastructure\docker\docker-compose.yml --env-file .env"

docker info >nul 2>&1
if errorlevel 1 goto nodocker

if /i "%~1"=="stop" goto stop

REM A private random worker token, created once and kept only on this computer.
if exist .env goto haveenv
powershell -NoProfile -Command "$b=New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); $t=-join($b|ForEach-Object{'{0:x2}' -f $_}); Set-Content -Encoding ascii -Path .env -Value ('MCS_WORKER_TOKEN='+$t),('MCS_PORT=%PORT%')"
:haveenv

echo.
echo  Preparing Muhammad C++ Studio...
echo  First time: 5-15 minutes (downloading compilers and Wine). Next times: seconds.
echo.
%COMPOSE% up -d --build
if errorlevel 1 goto failed

echo  Waiting for the site to start...
powershell -NoProfile -Command "for($i=0;$i -lt 120;$i++){ try { $null=Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:%PORT%/api/health'; exit 0 } catch { Start-Sleep -Seconds 2 } }; exit 1"
start "" "http://localhost:%PORT%/run/"
echo.
echo  Studio is running:  http://localhost:%PORT%/run/
echo  To stop it: double-click Stop-Studio.bat
echo.
pause
exit /b 0

:stop
%COMPOSE% down
echo  Studio stopped.
pause
exit /b 0

:nodocker
echo.
echo  Docker Desktop is not installed or not running.
echo   1) Install it:  https://www.docker.com/products/docker-desktop/
echo   2) Open Docker Desktop and wait until it says "Engine running".
echo   3) Double-click Start-Studio.bat again.
echo.
start "" "https://www.docker.com/products/docker-desktop/"
pause
exit /b 1

:failed
echo.
echo  Something went wrong while starting. Make sure Docker Desktop is running and try again.
echo  Details: %COMPOSE% logs
pause
exit /b 1
