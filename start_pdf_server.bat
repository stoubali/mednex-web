@echo off
REM MedNex PDF Server Startup Script for Windows
REM This script starts the Python PDF generation server

echo ========================================
echo  MedNex PDF Server Startup
echo ========================================
echo.

REM Check if Python is installed
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python is not installed or not in PATH
    echo Please install Python from https://www.python.org/
    echo Make sure to check "Add Python to PATH" during installation
    pause
    exit /b 1
)

echo [OK] Python found
echo.

REM Check if requirements are installed
echo Checking dependencies...
pip list | find "Flask" >nul
if errorlevel 1 (
    echo Installing required packages...
    pip install -r requirements.txt
    if errorlevel 1 (
        echo ERROR: Failed to install dependencies
        pause
        exit /b 1
    )
) else (
    echo [OK] Dependencies already installed
)

echo.
echo ========================================
echo  Starting PDF Server...
echo ========================================
echo.
echo The server will start on: http://localhost:5000
echo.
echo Health check: http://localhost:5000/health
echo.
echo Press Ctrl+C to stop the server
echo.

REM Start the Python server
python pdf_server.py

pause
