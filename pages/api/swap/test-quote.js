// Simple script to test the V4 Quoter API endpoint
// Using built-in fetch API (available in Node.js 18+)

// Configuration
const API_URL = 'http://localhost:3000/api/swap/get-quote';
const CHAIN_ID = 84532; // Base Sepolia

// Test data for the swap
const testCases = [
  {
    name: 'YUSD to BTCRL - 1 YUSD',
    fromTokenSymbol: 'YUSDC',
    toTokenSymbol: 'BTCRL',
    amountDecimalsStr: '1', // 1 YUSD
  },
  {
    name: 'BTCRL to YUSD - 0.0001 BTCRL',
    fromTokenSymbol: 'BTCRL',
    toTokenSymbol: 'YUSDC',
    amountDecimalsStr: '0.0001', // 0.0001 BTCRL
  },
];

// Run the tests
async function runTests() {
  for (const testCase of testCases) {
    console.log(`\nTesting: ${testCase.name}`);
    
    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          fromTokenSymbol: testCase.fromTokenSymbol,
          toTokenSymbol: testCase.toTokenSymbol,
          amountDecimalsStr: testCase.amountDecimalsStr,
          chainId: CHAIN_ID,
          debug: true // Use debug mode to avoid real contract calls
        })
      });
      
      const data = await response.json();
      
      if (response.ok && data.success) {
        console.log('✅ Quote successful:');
        console.log(`   Input: ${data.fromAmount} ${data.fromToken}`);
        console.log(`   Output: ${data.toAmount} ${data.toToken}`);
        console.log(`   Gas estimate: ${data.gasEstimate}`);
      } else {
        console.log('❌ Quote failed:');
        console.log(`   Error: ${data.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.log('❌ Request failed:');
      console.log(`   Error: ${error.message}`);
    }
  }
}

// Run the tests
runTests()
  .then(() => console.log('\nAll tests completed.'))
  .catch(error => console.error('Error running tests:', error)); 