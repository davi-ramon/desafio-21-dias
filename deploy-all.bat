@echo off
chcp 65001 >nul
title Deploy Completo — Desafio 21 Dias

set ROOT=%~dp0
set SITE_DIR=%ROOT%site\wpktavares-site
set DEPLOY_ID=AKfycbx9ypaZFGLIFkCVbV2LmvSv-dZIUZvMGvhJDnG2unhCwlaVTnBMU1anbbLa15h0aKxi
set GH_BRANCH=main

echo.
echo ╔══════════════════════════════════════════════════╗
echo ║       DEPLOY COMPLETO — DESAFIO 21 DIAS         ║
echo ╚══════════════════════════════════════════════════╝
echo.

:: ── ETAPA 1: Google Apps Script ──────────────────────
echo [1/3] Google Apps Script (clasp)...
cd /d "%ROOT%"
clasp push --force
if %ERRORLEVEL% NEQ 0 ( echo   ERRO no clasp push! & pause & exit /b 1 )
clasp deploy --deploymentId %DEPLOY_ID%
if %ERRORLEVEL% NEQ 0 ( echo   ERRO no clasp deploy! & pause & exit /b 1 )
echo   OK — GAS publicado!
echo.

:: ── ETAPA 2: Firebase Hosting ────────────────────────
echo [2/3] Firebase Hosting...
cd /d "%SITE_DIR%"
firebase deploy --only hosting --account ads.deyvid@gmail.com
if %ERRORLEVEL% NEQ 0 ( echo   ERRO no Firebase deploy! & pause & exit /b 1 )
echo   OK — Firebase publicado!
echo.

:: ── ETAPA 3: GitHub ──────────────────────────────────
echo [3/3] GitHub...
cd /d "%ROOT%"
set /p MSG="Mensagem do commit (ex: feat: nova feature): "
if "%MSG%"=="" set MSG=chore: update
git add -A
git commit -m "%MSG%"
git push origin %GH_BRANCH%
if %ERRORLEVEL% NEQ 0 ( echo   ERRO no git push! & pause & exit /b 1 )
echo   OK — GitHub atualizado!
echo.

echo ╔══════════════════════════════════════════════════╗
echo ║         DEPLOY COMPLETO COM SUCESSO! 🚀          ║
echo ║                                                  ║
echo ║  GAS:      script.google.com                     ║
echo ║  Firebase: wpktavares.com.br                     ║
echo ║  GitHub:   github.com/davi-ramon/desafio-21-dias ║
echo ╚══════════════════════════════════════════════════╝
echo.
pause
