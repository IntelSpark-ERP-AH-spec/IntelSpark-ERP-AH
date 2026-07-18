@echo off
setlocal
title IntelSheets - MontableuriIA
color 0A

set "PROJECT_ROOT=%~dp0"
cd /d "%PROJECT_ROOT%"

echo ======================================================
echo   IntelSheets - Application de gestion
echo ======================================================
echo.

echo Arret des anciens services IntelSheets...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ports = 3001,3443,5173; Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $ports -contains $_.LocalPort } | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }" >nul 2>&1
timeout /t 1 /nobreak >nul

if not exist "%PROJECT_ROOT%.env" (
    echo [ERREUR] Fichier .env manquant dans %PROJECT_ROOT%
    pause
    exit /b 1
)

echo [1/2] Demarrage du backend et de l API...
start "IntelSheets Backend" /D "%PROJECT_ROOT%" cmd /k "node --watch server.js"

timeout /t 3 /nobreak >nul

echo [2/2] Demarrage de l interface utilisateur...
start "IntelSheets Frontend" /D "%PROJECT_ROOT%frontend" cmd /k "npm.cmd run dev"

echo.
echo Interface : http://localhost:5173
echo API       : http://localhost:3001
echo.
echo Les deux fenetres ouvertes doivent rester actives pendant l utilisation.
pause
