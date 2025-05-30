# V4 Quoter Integration

This API integrates with Uniswap V4's Quoter contract to get price quotes for swaps.

## Testing the API

### 1. HTML Test Page

The easiest way to test is by using the HTML test page:

1. Start your Next.js development server:
   ```
   npm run dev
   ```

2. Navigate to http://localhost:3000/api/swap/test-quote.html

3. Fill in the form and click "Get Quote"

### 2. Node.js Test Script

For command-line testing:

1. Run the test script with Node.js 18+ (which has fetch built-in):
   ```
   node pages/api/swap/test-quote.js
   ```

### 3. Directly in the UI

The main swap interface in the app will use the Quoter API when you enter an amount.

## Debug Mode

The API supports a debug mode that returns mock responses without making contract calls. This is useful for:

- Testing UI components without a working contract
- Development when the contract isn't deployed yet
- Testing without a network connection

To use debug mode, add `debug: true` to the request body.

## Updating the Contract Address

The V4 Quoter contract address is hardcoded in `get-quote.ts`. Update this address when deploying to different networks or when the contract is redeployed.

Current addresses:
- Base Sepolia: `0x4752ba5DBc23F44D41918EB030a4C75930df434c`

## API Endpoint

**POST** `/api/swap/get-quote`

**Request Body:**
```json
{
  "fromTokenSymbol": "YUSDC",
  "toTokenSymbol": "BTCRL",
  "amountDecimalsStr": "1",
  "chainId": 84532,
  "debug": false
}
```

**Response:**
```json
{
  "success": true,
  "fromAmount": "1",
  "fromToken": "YUSDC",
  "toAmount": "0.000012987012987012987",
  "toToken": "BTCRL",
  "gasEstimate": "150000"
}
```

## Error Handling

If the API encounters an error, it will return:

```json
{
  "success": false,
  "error": "Error message details"
}
``` 