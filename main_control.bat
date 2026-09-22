@echo off
setlocal
cd /d "%~dp0"
if not "%~1"=="" (
  node scripts\control.mjs %*
  exit /b
)
:menu
echo.
echo ==========================================
echo          SCHEMA STUDIO - MAIN CONTROL
echo ==========================================
echo   4. Deploy / redeploy API + frontend
echo   7. Status
echo   9. Open aplikasi
echo  10. Install dependencies
echo  11. Run checks
echo  15. Stop aplikasi
echo   0. Exit
echo.
set "SCHEMA_CHOICE="
set /p "SCHEMA_CHOICE=Pilih: "
if "%SCHEMA_CHOICE%"=="0" exit /b 0
if "%SCHEMA_CHOICE%"=="4" node scripts\control.mjs deploy
if "%SCHEMA_CHOICE%"=="7" node scripts\control.mjs status
if "%SCHEMA_CHOICE%"=="9" start "" http://127.0.0.1:3080
if "%SCHEMA_CHOICE%"=="10" node scripts\control.mjs install
if "%SCHEMA_CHOICE%"=="11" node scripts\control.mjs check
if "%SCHEMA_CHOICE%"=="15" node scripts\control.mjs stop
pause
goto menu
