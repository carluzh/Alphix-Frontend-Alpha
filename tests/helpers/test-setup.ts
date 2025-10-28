/**
 * Shared test setup utilities
 * Provides common initialization and cleanup for E2E tests
 */

import { Page, BrowserContext } from '@playwright/test'
import { bootstrap } from '@tenkeylabs/dappwright'
import { Wallet } from 'ethers'
import { connectMetaMaskWallet } from './metamask'
import { ALL_TOKENS } from '../fixtures/tokens'

export interface TestAccount {
  address: string
  privateKey: string
}

export interface TestContext {
  wallet: any
  page: Page
  context: BrowserContext
  testAccount: TestAccount
  cleanup: () => Promise<void>
}

/**
 * Generate a random Ethereum account for testing
 */
async function generateRandomAccount(): Promise<TestAccount> {
  const wallet = Wallet.createRandom()
  return {
    address: wallet.address,
    privateKey: wallet.privateKey,
  }
}

/**
 * Setup MetaMask wallet with test account
 */
async function setupMetaMaskWallet(wallet: any, testAccount: TestAccount): Promise<void> {
  await wallet.importPK(testAccount.privateKey)

  // Add localhost network (Anvil fork of Base Sepolia)
  // IMPORTANT: Chain ID must match the Anvil fork chain ID AND wagmiConfig.ts E2E mode (1337)
  const LOCAL_RPC = process.env.LOCAL_RPC || 'http://127.0.0.1:8545'
  try {
    await wallet.addNetwork({
      networkName: 'Localhost 8545',
      rpc: LOCAL_RPC,
      chainId: 1337, // Must match Anvil fork chain ID and wagmiConfig E2E chain ID
      symbol: 'ETH',
    })
  } catch (error) {
    // Network might already exist, ignore error
    console.log('  Network already exists or error adding:', error)
  }

  // Switch to the localhost network
  await wallet.switchNetwork('Localhost 8545')
}

/**
 * Set ETH balance for an address using Anvil RPC
 */
async function setEthBalance(address: string, balanceHex: string): Promise<void> {
  const LOCAL_RPC = process.env.LOCAL_RPC || 'http://127.0.0.1:8545'
  await fetch(LOCAL_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'anvil_setBalance',
      params: [address, balanceHex],
      id: 1,
    }),
  })
}

/**
 * Set token balance for an address using Anvil's setStorageAt
 * ERC20 tokens store balances in a mapping, typically at slot 0
 * Storage location = keccak256(abi.encode(address, slot))
 */
async function setTokenBalance(tokenAddress: string, holderAddress: string, balance: bigint): Promise<void> {
  const LOCAL_RPC = process.env.LOCAL_RPC || 'http://127.0.0.1:8545'
  const { keccak256, concat, pad, toHex } = await import('viem/utils')

  // Try common storage slots (0, 1, 2, 3, 9) used by different ERC20 implementations
  const commonSlots = [0, 1, 2, 3, 9]

  for (const slot of commonSlots) {
    // Calculate storage location: keccak256(concat(pad(address, 32), pad(slot, 32)))
    const paddedAddress = pad(holderAddress as `0x${string}`, { size: 32 })
    const paddedSlot = pad(toHex(slot), { size: 32 })
    const storageKey = keccak256(concat([paddedAddress, paddedSlot]))

    // Encode balance as 32-byte hex
    const balanceHex = toHex(balance, { size: 32 })

    // Set the storage slot
    await fetch(LOCAL_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'anvil_setStorageAt',
        params: [tokenAddress, storageKey, balanceHex],
        id: 1,
      }),
    })
  }

  // Mine a block to finalize the state change
  await fetch(LOCAL_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'anvil_mine',
      params: ['0x1'],
      id: 1,
    }),
  })
}

/**
 * Initialize a complete test environment with MetaMask wallet and seeded balances
 */
export async function initializeTestEnvironment(): Promise<TestContext> {
  // Generate test account
  const testAccount = await generateRandomAccount()
  console.log(`\n[SETUP] Test account: ${testAccount.address}`)

  // Launch MetaMask browser with unique session
  const uniqueSeed = `test-${Date.now()}-${Math.random().toString(36).substring(7)}`
  const [wallet, page, context] = await bootstrap(uniqueSeed, {
    wallet: 'metamask',
    version: '12.23.0',
    headless: false,
  })

  // Suppress verbose browser logs (only show errors)
  page.on('pageerror', error => {
    console.log('[Browser error]:', error.message)
  })

  // Setup MetaMask wallet
  await setupMetaMaskWallet(wallet, testAccount)

  // Seed account balances
  console.log('[SETUP] Seeding balances: 100 ETH, 1000 of each token')
  await setEthBalance(testAccount.address, '0x56BC75E2D63100000') // 100 ETH

  for (const token of ALL_TOKENS) {
    const balance = BigInt(1000) * BigInt(10 ** token.decimals)
    await setTokenBalance(token.address, testAccount.address, balance)
  }
  console.log('[SETUP] ✓ Test environment ready\n')

  // Cleanup function to properly close browser and release resources
  const cleanup = async () => {
    console.log('\n[CLEANUP] Closing browser and releasing resources...')
    try {
      const pages = context.pages()
      for (const p of pages) {
        try {
          if (!p.isClosed()) {
            await p.close()
          }
        } catch (e) {
          // Ignore close errors
        }
      }

      await context.close()
      await new Promise(resolve => setTimeout(resolve, 3000))
      console.log('[CLEANUP] ✓ Complete\n')
    } catch (error) {
      console.log(`[CLEANUP] Error: ${error}`)
    }
  }

  return { wallet, page, context, testAccount, cleanup }
}

/**
 * Navigate to swap page and connect wallet
 */
export async function navigateAndConnectWallet(
  page: Page,
  context: BrowserContext
): Promise<void> {
  console.log('[NAVIGATE] Opening swap page and connecting wallet...')
  await page.goto('/swap?e2e=true', { waitUntil: 'domcontentloaded' })
  await connectMetaMaskWallet(page, context)

  const swapAmountInput = page.locator('input[type="number"], input[placeholder*="0"]').first()
  await swapAmountInput.waitFor({ state: 'visible', timeout: 10000 })
  console.log('[NAVIGATE] ✓ Ready\n')
}

/**
 * Helper to click action buttons in review view (Approve, Sign, Confirm Swap)
 */
export async function clickActionButton(page: Page): Promise<string> {
  const buttonTexts = ['Approve', 'Sign', 'Confirm Swap']
  for (const text of buttonTexts) {
    const candidate = page.getByRole('button', { name: text, exact: true })
    try {
      await candidate.waitFor({ state: 'visible', timeout: 3000 })
      await candidate.click()
      return text
    } catch {
      continue
    }
  }
  throw new Error('Could not find action button')
}
