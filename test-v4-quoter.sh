#!/bin/bash
echo "Testing V4 Quoter..."

echo "Starting Next.js dev server in the background..."
cd frontend && npm run dev &
SERVER_PID=$!

echo "Waiting for server to start..."
sleep 10

echo "Testing API in debug mode..."
curl -X POST http://localhost:3000/api/swap/test -H "Content-Type: application/json"

echo ""
echo "Test complete. Killing server process..."
kill $SERVER_PID

echo "Done!" 