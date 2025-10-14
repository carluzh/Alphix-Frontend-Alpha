@echo off
REM E2E Test Runner for Windows
REM Usage: run-e2e-tests.bat [quick|full]
REM - quick: Runs only critical path tests (fastest feedback)
REM - full:  Runs all tests including edge cases (default)

set MODE=%1
if "%MODE%"=="" set MODE=full

echo Starting Anvil fork in background...
start /B anvil --fork-url %BASE_SEPOLIA_RPC% --chain-id 1337 --block-time 1 >anvil.log 2>&1

echo Waiting for Anvil to start...
timeout /t 5 /nobreak >nul

REM Check if Anvil is responding
curl -s -X POST -H "Content-Type: application/json" --data "{\"jsonrpc\":\"2.0\",\"method\":\"eth_chainId\",\"params\":[],\"id\":1}" http://127.0.0.1:8545 >nul 2>&1
if %errorlevel% equ 0 (
  echo   [32m✓ Anvil started successfully on http://127.0.0.1:8545[0m
) else (
  echo   [31m✗ Anvil failed to start or not responding[0m
  echo   Check BASE_SEPOLIA_RPC environment variable is set
  echo   Anvil logs saved to anvil.log
  pause
  exit /b 1
)

if "%MODE%"=="quick" (
  echo.
  echo ========================================
  echo Running E2E tests ^(Quick Suite^)
  echo ========================================
  echo.
  call npm run e2e:quick
) else (
  echo.
  echo ========================================
  echo Running E2E tests ^(Full Suite^)
  echo ========================================
  echo.
  call npm run e2e:full
)

echo.
echo Tests complete. Press any key to stop Anvil and exit...
pause >nul

echo Cleaning up...
taskkill /IM anvil.exe /F >nul 2>&1
echo   [32m✓ Done[0m

