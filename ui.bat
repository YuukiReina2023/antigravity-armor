@echo off
setlocal
pushd "%~dp0"
call "%~dp0aarmor-ui.cmd" %*
set "EXIT_CODE=%ERRORLEVEL%"
popd
exit /b %EXIT_CODE%
