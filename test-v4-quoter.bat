@echo off
echo Testing V4 Quoter...

REM Testing the get-quote API
curl -X POST http://localhost:3000/api/swap/get-quote ^
-H "Content-Type: application/json" ^
-d "{\"fromTokenSymbol\":\"YUSDC\",\"toTokenSymbol\":\"BTCRL\",\"amountDecimalsStr\":\"1\",\"chainId\":84532}"

echo.
echo Test complete. Press any key to exit.
pause 