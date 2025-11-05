import { isAddress, getAddress } from 'viem';

const testAddresses = [
    '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1',
    '0x742d35cc6634c0532925a3b844bc9e7595f0beb1',
    '0x742D35CC6634C0532925A3B844BC9E7595F0BEB1',
    '0x0000000000000000000000000000000000000000',
    '0x1234567890123456789012345678901234567890',
];

console.log('Testing address validation:');
testAddresses.forEach(addr => {
    console.log(`${addr}: ${isAddress(addr) ? '✅ Valid' : '❌ Invalid'}`);
    try {
        const checksummed = getAddress(addr);
        console.log(`  -> Checksummed: ${checksummed}`);
    } catch (e) {
        console.log(`  -> Error: ${e.message}`);
    }
});

// Test what the actual API expects
console.log('\nGenerating a valid test address:');
const validAddress = getAddress('0x' + '1'.repeat(40));
console.log(`Valid test address: ${validAddress}`);