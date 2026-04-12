@echo off
echo Starting Mwongozo Proxy Server...
echo.

REM Check if .env file exists
if not exist ".env" (
    echo ERROR: .env file not found!
    echo.
    echo Please create a .env file with your API keys.
    echo You can copy .env.example and fill in the values:
    echo.
    echo   copy .env.example .env
    echo.
    echo Then edit .env and add your API keys.
    pause
    exit /b 1
)

REM Check if Node.js is installed
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo ERROR: Node.js is not installed!
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

echo Starting proxy server on http://localhost:8787
echo.
echo Required: Keep this window open while using Mwongozo
echo Press Ctrl+C to stop the server
echo.

node server.js

pause
