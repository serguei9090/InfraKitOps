@echo off
REM InfraKit Studio - self-hosted web bundle.
REM The backend binary serves the app UI and its API on one port.
REM
REM   run.bat                                  http://127.0.0.1:8080 (this PC)
REM   set INFRAKIT_ADDR=0.0.0.0:8080 && run.bat --tls auto     (LAN)
REM
REM First start prints  SETUP-TOKEN <...>  - open the URL and paste it to
REM create the admin account.
setlocal
cd /d "%~dp0"

if "%INFRAKIT_ADDR%"=="" set INFRAKIT_ADDR=127.0.0.1:8080
if "%INFRAKIT_DATA_DIR%"=="" set INFRAKIT_DATA_DIR=.\data

echo InfraKit Studio  -^>  http://%INFRAKIT_ADDR%
echo Data directory:  %INFRAKIT_DATA_DIR%   (back this up)
echo.

infrakit-backend.exe --addr %INFRAKIT_ADDR% --auth on --static-dir .\web --data-dir "%INFRAKIT_DATA_DIR%" %*
