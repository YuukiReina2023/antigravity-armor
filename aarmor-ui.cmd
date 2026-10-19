@echo off
setlocal
set "REPO_ROOT=%~dp0"
set "DOTNET_EXE="

for /f "tokens=1" %%P in ('tasklist /FI "IMAGENAME eq AntigravityArmor.UI.exe" /NH 2^>nul') do (
  if /I "%%P"=="AntigravityArmor.UI.exe" (
    echo [INFO] Antigravity Armor UI is already running.
    echo Close the existing window before rebuilding or restarting it.
    exit /b 0
  )
)

if exist "%USERPROFILE%\.dotnet\dotnet.exe" set "DOTNET_EXE=%USERPROFILE%\.dotnet\dotnet.exe"
if not defined DOTNET_EXE (
  for /f "delims=" %%D in ('where dotnet 2^>nul') do (
    if not defined DOTNET_EXE set "DOTNET_EXE=%%D"
  )
)

if not defined DOTNET_EXE (
  echo [ERROR] .NET SDK was not found.
  echo Install the .NET 10 SDK, then run this script again.
  echo Download: https://dotnet.microsoft.com/download/dotnet/10.0
  pause
  exit /b 1
)

for /f "tokens=1" %%V in ('"%DOTNET_EXE%" --list-sdks 2^>nul') do (
  for /f "tokens=1 delims=." %%M in ("%%V") do (
    if "%%M"=="10" goto sdk_found
  )
)

echo [ERROR] .NET 10 SDK was not found.
echo Found dotnet at: "%DOTNET_EXE%"
echo Install the .NET 10 SDK, then run this script again.
echo Download: https://dotnet.microsoft.com/download/dotnet/10.0
pause
exit /b 1

:sdk_found
for %%D in ("%DOTNET_EXE%") do set "DOTNET_ROOT=%%~dpD"
set "PATH=%DOTNET_ROOT%;%PATH%"
cd /d "%REPO_ROOT%"

echo Starting Antigravity Armor UI...
"%DOTNET_EXE%" run --project "%REPO_ROOT%ui\AntigravityArmor.UI\AntigravityArmor.UI.csproj" --framework net10.0 %*
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo.
  echo [ERROR] UI exited with code %EXIT_CODE%.
  pause
)
exit /b %EXIT_CODE%
