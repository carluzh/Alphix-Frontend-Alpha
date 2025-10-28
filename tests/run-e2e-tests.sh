#!/bin/bash
# E2E Test Runner for Unix/Git Bash
# Usage: ./run-e2e-tests.sh [suite] [mode]
# Examples:
#   ./run-e2e-tests.sh              - Runs all test suites
#   ./run-e2e-tests.sh swap         - Runs all swap tests
#   ./run-e2e-tests.sh swap quick   - Runs swap Session 1 only
#   ./run-e2e-tests.sh liquidity    - Runs all liquidity tests (when added)
#   ./run-e2e-tests.sh portfolio    - Runs all portfolio tests (when added)

# Load environment variables from .env.local
if [ -f .env.local ]; then
  export $(grep -v '^#' .env.local | xargs)
fi

SUITE=${1:-all}
MODE=${2:-full}

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

# Determine test file and grep pattern
TEST_FILE=""
GREP_PATTERN=""
SUITE_NAME=""

if [ "$SUITE" = "all" ]; then
  SUITE_NAME="All Suites"
  TEST_FILE="*.spec.ts"
  GREP_PATTERN="^\[|^  |^✓|^===|^Session|^Error|failed|passed|Balance|Warning|Quote|aUSDC|aUSDT|aETH|aBTC|ETH|decreased|increased|PART|STARTING|COMPLETE|SESSION|Multihop|Change"
elif [ "$SUITE" = "swap" ]; then
  TEST_FILE="swap.spec.ts"
  GREP_PATTERN="^\[|^  |^✓|^===|^Session|^Error|failed|passed|Balance|Warning|Quote|aUSDC|aUSDT|aETH|aBTC|ETH|decreased|increased|PART|STARTING|COMPLETE|SESSION|Multihop|Change"

  if [ "$MODE" = "quick" ]; then
    SUITE_NAME="Swap (Session 1 Only)"
    GREP_PATTERN="^\[|^  |^✓|^===|^Session|^Error|failed|passed|PART|STARTING|COMPLETE"
  else
    SUITE_NAME="Swap (All Sessions)"
  fi
elif [ "$SUITE" = "liquidity" ]; then
  TEST_FILE="liquidity.spec.ts"
  GREP_PATTERN="^\[|^  |^✓|^===|^Session|^Error|failed|passed|Balance|Warning|Quote|Position|Deposit|Approval|Permit|PART|STARTING|COMPLETE"

  if [ "$MODE" = "quick" ]; then
    SUITE_NAME="Liquidity (Session 1 Only)"
    GREP_PATTERN="^\[|^  |^✓|^===|^Session|^Error|failed|passed|PART|STARTING|COMPLETE"
  else
    SUITE_NAME="Liquidity (All Sessions)"
  fi
elif [ "$SUITE" = "portfolio" ]; then
  SUITE_NAME="Portfolio"
  TEST_FILE="portfolio.spec.ts"
  GREP_PATTERN="^\[|^  |^✓|^===|^Session|^Error|failed|passed"
else
  echo "Unknown test suite: $SUITE"
  echo "Available suites: all, swap, liquidity, portfolio"
  kill $ANVIL_PID 2>/dev/null
  exit 1
fi

echo ""
echo "========================================"
echo "Running E2E tests ($SUITE_NAME)"
echo "========================================"
echo ""
echo "Building Next.js app..."
NODE_OPTIONS="--no-deprecation" npm run e2e:build > build.log 2>&1

if [ $? -ne 0 ]; then
  echo "✗ Build failed. Check build.log for details"
  kill $ANVIL_PID 2>/dev/null
  exit 1
fi

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

# Build playwright command
PLAYWRIGHT_CMD="npx --quiet playwright test $TEST_FILE -c playwright.config.ts --reporter=line"

# Add grep filter for swap quick mode
if [ "$SUITE" = "swap" ] && [ "$MODE" = "quick" ]; then
  PLAYWRIGHT_CMD="$PLAYWRIGHT_CMD --grep \"Session 1\""
fi

# Execute tests and filter output
eval "$PLAYWRIGHT_CMD" 2>&1 | grep -E "$GREP_PATTERN"
TEST_EXIT_CODE=${PIPESTATUS[0]}

echo ""
echo "=========================================="

# Cleanup
echo "Cleaning up..."
kill $SERVER_PID 2>/dev/null
kill $ANVIL_PID 2>/dev/null
pkill -f "next start" 2>/dev/null
echo "✓ Done"

exit $TEST_EXIT_CODE
