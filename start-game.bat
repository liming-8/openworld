@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Aether Wilds - local server

set PORT=8080

echo.
echo   ============================================
echo    万象原野 Aether Wilds  -  starting...
echo   ============================================
echo.

where node >nul 2>nul
if %errorlevel%==0 goto USENODE

where python >nul 2>nul
if %errorlevel%==0 goto USEPY

where py >nul 2>nul
if %errorlevel%==0 goto USEPY2

echo   [!] Node.js or Python not found.
echo.
echo   Option A: install Node.js from https://nodejs.org
echo   Option B: install Python from https://www.python.org
echo.
echo   After installing, run this file again.
echo.
pause
exit /b 1

:USENODE
start "" http://127.0.0.1:%PORT%/
node serve.mjs %PORT%
goto END

:USEPY
start "" http://127.0.0.1:%PORT%/
python -m http.server %PORT% --bind 127.0.0.1
goto END

:USEPY2
start "" http://127.0.0.1:%PORT%/
py -m http.server %PORT% --bind 127.0.0.1
goto END

:END
echo.
echo   Server stopped.
pause
