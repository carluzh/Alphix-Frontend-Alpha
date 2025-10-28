@echo off
REM E2E Test Runner for Windows
REM Usage: run-e2e-tests.bat [suite] [mode]
REM Examples:
REM   run-e2e-tests.bat              - Runs all test suites
REM   run-e2e-tests.bat swap         - Runs all swap tests
REM   run-e2e-tests.bat swap quick   - Runs swap Session 1 only
REM   run-e2e-tests.bat liquidity    - Runs all liquidity tests (when added)
REM   run-e2e-tests.bat portfolio    - Runs all portfolio tests (when added)

set SUITE=%1
set MODE=%2
if "%SUITE%"=="" set SUITE=all
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

REM Determine npm script to run
set NPM_SCRIPT=e2e:full

if "%SUITE%"=="all" (
  set SUITE_NAME=All Suites
  set NPM_SCRIPT=e2e:full
) else if "%SUITE%"=="swap" (
  if "%MODE%"=="quick" (
    set SUITE_NAME=Swap ^(Session 1 Only^)
    set NPM_SCRIPT=e2e:quick
  ) else (
    set SUITE_NAME=Swap ^(All Sessions^)
    set NPM_SCRIPT=e2e:full
  )
) else if "%SUITE%"=="liquidity" (
  if "%MODE%"=="quick" (
    set SUITE_NAME=Liquidity ^(Session 1 Only^)
    set NPM_SCRIPT=e2e:liquidity:quick
  ) else (
    set SUITE_NAME=Liquidity ^(All Sessions^)
    set NPM_SCRIPT=e2e:liquidity
  )
) else if "%SUITE%"=="portfolio" (
  set SUITE_NAME=Portfolio
  REM Future: set NPM_SCRIPT=e2e:portfolio
  echo Test suite not yet implemented: portfolio
  goto cleanup
) else (
  echo Unknown test suite: %SUITE%
  echo Available suites: all, swap, liquidity, portfolio
  goto cleanup
)

echo.
echo ========================================
echo Running E2E tests ^(%SUITE_NAME%^)
echo ========================================
echo.
call npm run %NPM_SCRIPT%

echo.
echo Tests complete. Press any key to stop Anvil and exit...
pause >nul

:cleanup
echo Cleaning up...
taskkill /IM anvil.exe /F >nul 2>&1
echo   [32m✓ Done[0m

