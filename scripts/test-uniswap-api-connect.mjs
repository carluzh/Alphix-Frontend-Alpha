/**
 * Test script for Uniswap Portfolio Chart API using ConnectRPC
 * Run with: node scripts/test-uniswap-api-connect.mjs
 */

import { createPromiseClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { DataApiService } from "@uniswap/client-data-api/dist/data/v1/api_connect.js";
import { Platform, ChartPeriod } from "@uniswap/client-data-api/dist/data/v1/api_pb.js";

const TEST_ADDRESS = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

async function main() {
  console.log("Testing Uniswap Portfolio Chart API with ConnectRPC...\n");
  console.log(`Test Address: ${TEST_ADDRESS}`);
  console.log(`Platform.EVM value: ${Platform.EVM}`);
  console.log(`ChartPeriod.DAY value: ${ChartPeriod.DAY}`);
  console.log("");

  // Create transport with interceptor for headers
  const transport = createConnectTransport({
    baseUrl: "https://interface.gateway.uniswap.org/v2",
    interceptors: [
      (next) => async (request) => {
        request.header.set("x-request-source", "uniswap-web");
        return next(request);
      },
    ],
  });

  // Create the client
  const client = createPromiseClient(DataApiService, transport);

  const request = {
    walletAccount: {
      platformAddresses: [
        {
          platform: Platform.EVM,
          address: TEST_ADDRESS,
        },
      ],
    },
    chainIds: [], // All chains
    chartPeriod: ChartPeriod.DAY,
  };

  console.log("Request:");
  console.log(JSON.stringify(request, (key, value) => {
    if (typeof value === 'bigint') return value.toString();
    return value;
  }, 2));
  console.log("\n---\n");

  try {
    const response = await client.getPortfolioChart(request);

    console.log("✅ Response received!");
    console.log(`Points: ${response.points?.length || 0}`);

    if (response.points && response.points.length > 0) {
      console.log("\nFirst 3 points:");
      response.points.slice(0, 3).forEach((point, i) => {
        const date = new Date(Number(point.timestamp) * 1000);
        console.log(`  [${i}] ${date.toISOString()} = $${point.value.toFixed(2)}`);
      });
      console.log("\nLast 3 points:");
      response.points.slice(-3).forEach((point, i) => {
        const date = new Date(Number(point.timestamp) * 1000);
        console.log(`  [${response.points.length - 3 + i}] ${date.toISOString()} = $${point.value.toFixed(2)}`);
      });
    }
  } catch (error) {
    console.error("❌ Error:", error.message);
    if (error.cause) {
      console.error("Cause:", error.cause);
    }
    console.error("\nFull error:");
    console.error(error);
  }
}

main();
