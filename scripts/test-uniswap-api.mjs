/**
 * Test script for Uniswap Portfolio Chart API
 * Run with: node scripts/test-uniswap-api.mjs
 */

import { getAddress } from "viem";

// Test wallet addresses
const VITALIK_ADDRESS = getAddress("0xd8da6bf26964af9d7eed9e03e53415d37aa96045");
// Try another well-known address - Uniswap Treasury
const UNISWAP_TREASURY = getAddress("0x1a9C8182C09F50C8318d769245beA52c32BE35BC");
// A random active address on Ethereum
const TEST_ADDRESS = VITALIK_ADDRESS;

console.log(`Using checksummed address: ${TEST_ADDRESS}\n`);

// Uniswap Data API endpoint
const API_BASE_URL = "https://interface.gateway.uniswap.org/v2";
const ENDPOINT = `${API_BASE_URL}/data.v1.DataApiService/GetPortfolioChart`;

// ChartPeriod enum values
const ChartPeriod = {
  HOUR: 0,
  DAY: 1,
  WEEK: 2,
  MONTH: 3,
  YEAR: 4,
};

// Platform enum values
const Platform = {
  UNSPECIFIED: 0,
  EVM: 1,
  SVM: 2, // Solana
};

// Required headers for Uniswap API (ConnectRPC protocol)
const HEADERS = {
  "Content-Type": "application/json",
  "Connect-Protocol-Version": "1",
  "x-request-source": "uniswap-web",
  "Origin": "https://app.uniswap.org",
  "Referer": "https://app.uniswap.org/",
};

async function testPortfolioChartAPI() {
  console.log("Testing Uniswap Portfolio Chart API...\n");
  console.log(`Endpoint: ${ENDPOINT}`);
  console.log(`Test Address: ${TEST_ADDRESS}`);
  console.log(`Period: DAY (${ChartPeriod.DAY})\n`);

  const requestBody = {
    walletAccount: {
      platformAddresses: [
        {
          platform: Platform.EVM,
          address: TEST_ADDRESS,
        },
      ],
    },
    // Empty array = all chains, or specify chain IDs like [1, 8453] for Mainnet + Base
    chainIds: [],
    chartPeriod: ChartPeriod.DAY,
  };

  console.log("Request headers:");
  console.log(JSON.stringify(HEADERS, null, 2));
  console.log("\nRequest body:");
  console.log(JSON.stringify(requestBody, null, 2));
  console.log("\n---\n");

  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify(requestBody),
    });

    console.log(`Response status: ${response.status} ${response.statusText}`);
    console.log(`Response headers:`);
    for (const [key, value] of response.headers.entries()) {
      if (key.toLowerCase().includes("content") || key.toLowerCase().includes("x-")) {
        console.log(`  ${key}: ${value}`);
      }
    }
    console.log("\n---\n");

    const data = await response.json();

    console.log("Response data:");
    if (data.points && data.points.length > 0) {
      console.log(`Total points: ${data.points.length}`);
      console.log(`\nFirst 3 points:`);
      data.points.slice(0, 3).forEach((point, i) => {
        const date = new Date(Number(point.timestamp) * 1000);
        console.log(`  [${i}] timestamp: ${point.timestamp} (${date.toISOString()}), value: $${point.value.toFixed(2)}`);
      });
      console.log(`\nLast 3 points:`);
      data.points.slice(-3).forEach((point, i) => {
        const date = new Date(Number(point.timestamp) * 1000);
        console.log(`  [${data.points.length - 3 + i}] timestamp: ${point.timestamp} (${date.toISOString()}), value: $${point.value.toFixed(2)}`);
      });
    } else {
      console.log(JSON.stringify(data, null, 2));
    }

    console.log("\n✅ API test successful!");
    return data;
  } catch (error) {
    console.error("\n❌ API test failed:");
    console.error(error.message);
    throw error;
  }
}

// Also test with different periods
async function testAllPeriods() {
  console.log("\n=== Testing all chart periods ===\n");

  for (const [periodName, periodValue] of Object.entries(ChartPeriod)) {
    console.log(`\n--- Testing ${periodName} (${periodValue}) ---`);

    const requestBody = {
      walletAccount: {
        platformAddresses: [
          { platform: Platform.EVM, address: TEST_ADDRESS },
        ],
      },
      chainIds: [],
      chartPeriod: periodValue,
    };

    try {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify(requestBody),
      });

      const data = await response.json();

      if (data.points && data.points.length > 0) {
        const firstDate = new Date(Number(data.points[0].timestamp) * 1000);
        const lastDate = new Date(Number(data.points[data.points.length - 1].timestamp) * 1000);
        console.log(`  Points: ${data.points.length}`);
        console.log(`  Range: ${firstDate.toISOString()} → ${lastDate.toISOString()}`);
        console.log(`  Value range: $${data.points[0].value.toFixed(2)} → $${data.points[data.points.length - 1].value.toFixed(2)}`);
      } else {
        console.log(`  No data or empty response`);
      }
    } catch (error) {
      console.log(`  Error: ${error.message}`);
    }
  }
}

// Run the tests
testPortfolioChartAPI()
  .then(() => testAllPeriods())
  .catch(() => process.exit(1));
