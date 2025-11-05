/**
 * Test script for the zap endpoint
 * Run with: npx tsx test-zap-endpoint.ts
 */

import fetch from 'node-fetch';

// Test configuration
const API_URL = 'http://127.0.0.1:3000/api/liquidity/prepare-zap-mint-tx';
const TEST_WALLET = '0x1234567890123456789012345678901234567890'; // Valid test address

// Test cases for different scenarios
const testCases = [
    {
        name: 'Zap with aUSDC into aUSDC/aUSDT pool (full range)',
        body: {
            userAddress: TEST_WALLET,
            token0Symbol: 'aUSDC',
            token1Symbol: 'aUSDT',
            inputAmount: '100', // 100 USDC
            inputTokenSymbol: 'aUSDC',
            userTickLower: -887272,
            userTickUpper: 887272,
            chainId: 84532,
            slippageTolerance: 50 // 0.5%
        }
    },
    {
        name: 'Zap with aUSDT into aUSDC/aUSDT pool (narrow range)',
        body: {
            userAddress: TEST_WALLET,
            token0Symbol: 'aUSDC',
            token1Symbol: 'aUSDT',
            inputAmount: '50', // 50 USDT
            inputTokenSymbol: 'aUSDT',
            userTickLower: -600, // Narrow range around current price
            userTickUpper: 600,
            chainId: 84532,
            slippageTolerance: 100 // 1%
        }
    },
    {
        name: 'Zap with aETH into aETH/aUSDC pool',
        body: {
            userAddress: TEST_WALLET,
            token0Symbol: 'aETH',
            token1Symbol: 'aUSDC',
            inputAmount: '0.1', // 0.1 ETH
            inputTokenSymbol: 'aETH',
            userTickLower: -10000,
            userTickUpper: 10000,
            chainId: 84532,
            slippageTolerance: 50
        }
    },
    {
        name: 'Zap with small amount (test precision)',
        body: {
            userAddress: TEST_WALLET,
            token0Symbol: 'aUSDC',
            token1Symbol: 'aUSDT',
            inputAmount: '0.001', // Very small amount
            inputTokenSymbol: 'aUSDC',
            userTickLower: -887272,
            userTickUpper: 887272,
            chainId: 84532,
            slippageTolerance: 50
        }
    }
];

async function testZapEndpoint(testCase: typeof testCases[0]) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Testing: ${testCase.name}`);
    console.log(`${'='.repeat(60)}`);

    console.log('\nRequest body:');
    console.log(JSON.stringify(testCase.body, null, 2));

    try {
        const startTime = Date.now();

        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(testCase.body),
        });

        const elapsedTime = Date.now() - startTime;
        const data = await response.json();

        console.log(`\nResponse (${elapsedTime}ms):`);
        console.log(`Status: ${response.status}`);

        if (response.ok && 'zapQuote' in data) {
            console.log('\n✅ Success! Zap quote received:');
            console.log(`- Swap Amount: ${data.zapQuote.swapAmount} ${testCase.body.inputTokenSymbol}`);
            console.log(`- Expected Token0: ${data.zapQuote.expectedToken0Amount}`);
            console.log(`- Expected Token1: ${data.zapQuote.expectedToken1Amount}`);
            console.log(`- Expected Liquidity: ${data.zapQuote.expectedLiquidity}`);
            console.log(`- Price Impact: ${data.zapQuote.priceImpact}%`);
            console.log(`\nTransaction Details:`);
            console.log(`- To: ${data.transaction.to}`);
            console.log(`- Value: ${data.transaction.value}`);
            console.log(`- Data Length: ${data.transaction.data.length} chars`);
            console.log(`- Deadline: ${new Date(parseInt(data.deadline) * 1000).toISOString()}`);

            // Calculate swap percentage - need to handle decimals properly
            const inputToken = testCase.body.inputTokenSymbol;
            const decimals = inputToken === 'aETH' ? 18 : inputToken === 'aBTC' ? 8 : 6;
            const inputAmountSmallestUnit = parseFloat(testCase.body.inputAmount) * Math.pow(10, decimals);
            const swapAmountSmallestUnit = parseFloat(data.zapQuote.swapAmount);
            const swapPercentage = ((swapAmountSmallestUnit / inputAmountSmallestUnit) * 100).toFixed(2);
            console.log(`\n📊 Analysis:`);
            console.log(`- Swapping ${swapPercentage}% of input token`);
            console.log(`- Final tick range: [${data.details.finalTickLower}, ${data.details.finalTickUpper}]`);
        } else {
            console.log('\n❌ Error response:');
            console.log(JSON.stringify(data, null, 2));
        }
    } catch (error) {
        console.log('\n❌ Request failed:');
        console.error(error);
    }
}

async function runTests() {
    console.log('🚀 Starting Zap Endpoint Tests');
    console.log(`Testing against: ${API_URL}`);
    console.log(`\nMake sure your Next.js dev server is running (npm run dev)`);

    for (const testCase of testCases) {
        await testZapEndpoint(testCase);

        // Add a small delay between tests to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log('✨ All tests completed!');
}

// Run the tests
runTests().catch(console.error);