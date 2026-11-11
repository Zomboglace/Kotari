@echo off
rem Démarre kotari-server sous Windows. Modifie DOSSIER ci-dessous.
rem Première fois : node kotari-server.mjs init "%DOSSIER%"
chcp 65001 >nul
set DOSSIER=%USERPROFILE%\Documents\Kotari\table-partagee
cd /d "%~dp0"
if not exist "%DOSSIER%\server.json" (
  node kotari-server.mjs init "%DOSSIER%"
)
node kotari-server.mjs start "%DOSSIER%"
pause
