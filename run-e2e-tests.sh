#!/bin/bash
# E2E Test Runner for Unix/Git Bash
# Usage: ./run-e2e-tests.sh [quick|full]
# - quick: Runs only critical path tests (fastest feedback)
# - full:  Runs all tests including edge cases (default)

# Load environment variables from .env.local
if [ -f .env.local ]; then
  export $(grep -v '^#' .env.local | xargs)
fi

MODE=${1:-full}

echo "Starting Anvil fork in background..."
anvil --fork-url $BASE_SEPOLIA_RPC --chain-id 1337 --block-time 1 > anvil.log 2>&1 &
ANVIL_PID=$!

echo "Waiting for Anvil to start..."
sleep 5

# Check if Anvil is responding
if curl -s -X POST -H "Content-Type: application/json" --data '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' http://127.0.0.1:8545 > /dev/null 2>&1; then
  echo "  ✓ Anvil started successfully on http://127.0.0.1:8545"
else
  echo "  ✗ Anvil failed to start or not responding"
  echo "  Check BASE_SEPOLIA_RPC environment variable is set"
  echo "  Anvil logs saved to anvil.log"
  kill $ANVIL_PID 2>/dev/null
  exit 1
fi

if [ "$MODE" = "quick" ]; then
  echo ""
  echo "========================================"
  echo "Running E2E tests (Quick Suite)"
  echo "========================================"
  echo ""
  echo "Building Next.js app..."
  NODE_OPTIONS="--no-deprecation" npm run e2e:build > build.log 2>&1
  if [ $? -eq 0 ]; then
    echo "✓ Build complete"
    echo ""
    echo "Starting server and tests..."
    echo "=========================================="
    echo ""
    NODE_OPTIONS="--no-deprecation" npm run e2e:start > server.log 2>&1 &
    SERVER_PID=$!

    # Wait for server to be ready
    echo "Waiting for Next.js server..."
    for i in {1..30}; do
      if curl -s http://localhost:3000 > /dev/null 2>&1; then
        echo "  ✓ Server ready on http://localhost:3000"
        break
      fi
      sleep 1
      if [ $i -eq 30 ]; then
        echo "  ✗ Server failed to start after 30 seconds"
        echo "  Check server.log for details"
        kill $SERVER_PID 2>/dev/null
        kill $ANVIL_PID 2>/dev/null
        exit 1
      fi
    done

    # Run just Session 1 for quick testing
    npx --quiet playwright test tests/e2e/swap-consolidated.spec.ts -c playwright.config.ts --grep "Session 1" --reporter=line 2>&1 | grep -E "^\[|^  |^✓|^===|^Session|^Error|failed|passed|PART|STARTING|COMPLETE"
    TEST_EXIT_CODE=${PIPESTATUS[0]}

    echo ""
    echo "=========================================="

    # Kill server
    kill $SERVER_PID 2>/dev/null
    exit $TEST_EXIT_CODE
  else
    echo "✗ Build failed. Check build.log for details"
    exit 1
  fi
else
  echo ""
  echo "========================================"
  echo "Running E2E tests (Full Suite)"
  echo "========================================"
  echo ""
  echo "Building Next.js app..."
  NODE_OPTIONS="--no-deprecation" npm run e2e:build > build.log 2>&1
  if [ $? -eq 0 ]; then
    echo "✓ Build complete"
    echo ""
    echo "Starting server and tests..."
    echo "=========================================="
    echo ""
    NODE_OPTIONS="--no-deprecation" npm run e2e:start > server.log 2>&1 &
    SERVER_PID=$!

    # Wait for server to be ready
    echo "Waiting for Next.js server..."
    for i in {1..30}; do
      if curl -s http://localhost:3000 > /dev/null 2>&1; then
        echo "  ✓ Server ready on http://localhost:3000"
        break
      fi
      sleep 1
      if [ $i -eq 30 ]; then
        echo "  ✗ Server failed to start after 30 seconds"
        echo "  Check server.log for details"
        kill $SERVER_PID 2>/dev/null
        kill $ANVIL_PID 2>/dev/null
        exit 1
      fi
    done
    echo ""

    # Run all sessions - show only test output
    npx --quiet playwright test tests/e2e/swap-consolidated.spec.ts -c playwright.config.ts --reporter=line 2>&1 | grep -E "^\[|^  |^✓|^===|^Session|^Error|failed|passed|Balance|Warning|Quote|aUSDC|aUSDT|aETH|aBTC|ETH|decreased|increased|PART|STARTING|COMPLETE|SESSION"
    TEST_EXIT_CODE=${PIPESTATUS[0]}

    echo ""
    echo "=========================================="

    # Kill server
    kill $SERVER_PID 2>/dev/null
    exit $TEST_EXIT_CODE
  else
    echo "✗ Build failed. Check build.log for details"
    exit 1
  fi
fi

echo ""
echo "Cleaning up..."
kill $ANVIL_PID 2>/dev/null
pkill -f "next start" 2>/dev/null
echo "✓ Done"
