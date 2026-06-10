@echo off
setlocal
cd /d "%~dp0"
set "LAST_EXIT=0"

echo Building CodeForge release binary without installer bundles...
call npm run tauri build -- --no-bundle
if errorlevel 1 (
  echo.
  echo Release binary build failed with exit code 1.
  set "LAST_EXIT=1"
  goto :__done
)

if "%LAST_EXIT%"=="0" (
  echo.
  echo Release binary build finished.
  echo App:
  echo   %~dp0src-tauri\target\release\codeforge-desktop.exe
)

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
