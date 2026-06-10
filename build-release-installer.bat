@echo off
setlocal

cd /d "%~dp0"
set "LAST_EXIT=0"

echo Building CodeForge release installer bundles...
call npm run tauri build
if errorlevel 1 (
  echo.
  echo Release installer build failed with exit code 1.
  set "LAST_EXIT=1"
  goto :__done
)

echo.
echo Release installer build finished.
echo Bundles:
echo   %~dp0src-tauri\target\release\bundle\nsis\CodeForge_0.1.0_x64-setup.exe
echo   %~dp0src-tauri\target\release\bundle\msi\CodeForge_0.1.0_x64_en-US.msi
goto :__done

:__done
echo.
if "%LAST_EXIT%" NEQ "0" (
  echo Build finished with failures. Press any key to close.
) else (
  echo Build finished successfully. Press any key to close.
)
pause
exit /b %LAST_EXIT%
