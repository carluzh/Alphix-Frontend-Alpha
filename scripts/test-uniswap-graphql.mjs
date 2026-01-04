/**
 * Test script for Uniswap GraphQL API
 * Run with: node scripts/test-uniswap-graphql.mjs
 */

const TEST_ADDRESS = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

// GraphQL endpoint
const GRAPHQL_URL = "https://graphql.interface.gateway.uniswap.org/v1/graphql";

// Simple token query (should work without auth)
const TOKEN_QUERY = `
  query TokenInfo($chain: Chain!, $address: String) {
    token(chain: $chain, address: $address) {
      symbol
      name
      address
      chain
      market(currency: USD) {
        price {
          value
        }
        pricePercentChange24h {
          value
        }
      }
    }
  }
`;

// Portfolio historical balance query
const PORTFOLIO_HISTORY_QUERY = `
  query PortfolioBalanceHistory($ownerAddress: String!, $duration: HistoryDuration!) {
    portfolios(ownerAddresses: [$ownerAddress]) {
      id
      ownerAddress
      valueHistory(duration: $duration) {
        timestamp
        value
      }
    }
  }
`;

async function testTokenQuery() {
  console.log("Testing Token Query (public)...\n");

  const body = {
    query: TOKEN_QUERY,
    variables: {
      chain: "ETHEREUM",
      address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", // WETH
    },
  };

  try {
    const response = await fetch(GRAPHQL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-request-source": "uniswap-web",
        "Origin": "https://app.uniswap.org",
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    console.log("Token Query Result:");
    console.log(JSON.stringify(data, null, 2));

    if (data.data?.token) {
      console.log(`\n✅ Token: ${data.data.token.symbol}`);
      console.log(`   Price: $${data.data.token.market?.price?.value || "N/A"}`);
    }
  } catch (error) {
    console.error("❌ Error:", error.message);
  }
}

async function testPortfolioHistory() {
  console.log("\n\nTesting Portfolio History Query...\n");

  const body = {
    query: PORTFOLIO_HISTORY_QUERY,
    variables: {
      ownerAddress: TEST_ADDRESS,
      duration: "DAY",
    },
  };

  try {
    const response = await fetch(GRAPHQL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-request-source": "uniswap-web",
        "Origin": "https://app.uniswap.org",
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    console.log("Portfolio History Result:");
    console.log(JSON.stringify(data, null, 2));

    if (data.data?.portfolios?.[0]?.valueHistory) {
      const history = data.data.portfolios[0].valueHistory;
      console.log(`\n✅ History points: ${history.length}`);
      if (history.length > 0) {
        console.log(`   First: ${new Date(history[0].timestamp * 1000).toISOString()} = $${history[0].value}`);
        console.log(`   Last: ${new Date(history[history.length - 1].timestamp * 1000).toISOString()} = $${history[history.length - 1].value}`);
      }
    }
  } catch (error) {
    console.error("❌ Error:", error.message);
  }
}

async function main() {
  console.log("Testing Uniswap GraphQL API...\n");
  console.log(`Endpoint: ${GRAPHQL_URL}`);
  console.log(`Test Address: ${TEST_ADDRESS}\n`);
  console.log("---\n");

  await testTokenQuery();
  await testPortfolioHistory();
}

main();
