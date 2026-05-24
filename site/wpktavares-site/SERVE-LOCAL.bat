@echo off
chcp 65001 >nul
title Servidor Local — WPK Tavares

:: Garante que roda SEMPRE a partir da pasta correta
cd /d "%~dp0"

echo.
echo ================================================
echo   SERVIDOR LOCAL — WPK Tavares
echo   Pasta: %CD%
echo ================================================
echo.
echo  Acesse no navegador:
echo  http://localhost:5000/app/
echo.
echo  (Ctrl+C para parar)
echo ================================================
echo.

firebase emulators:start --only hosting
