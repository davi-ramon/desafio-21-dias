@echo off
chcp 65001 >nul
title Deploy WPK Tavares

:: Garante que roda SEMPRE a partir da pasta correta
cd /d "%~dp0"

echo.
echo ================================================
echo   DEPLOY - WPK Tavares
echo   Pasta: %CD%
echo ================================================
echo.

firebase deploy --only hosting

echo.
if %ERRORLEVEL% EQU 0 (
  echo   SUCESSO! Acesse: https://wpktavares.com.br
) else (
  echo   ERRO no deploy. Veja mensagem acima.
)
echo ================================================
echo.
pause