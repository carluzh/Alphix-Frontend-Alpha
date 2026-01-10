# SDK Audit Issues - Transaction Building

**Generated:** 2026-01-10
**Confirmed Edits:** 6

---

## Issue Tracker

| ID | Severity | Status | Agent | Issue |
|----|----------|--------|-------|-------|
| S1 | CRITICAL | **VERIFIED OK** | Swap | No WRAP_ETH for native ETH multi-hop input |
| S2 | CRITICAL | **VERIFIED OK** | Swap | No UNWRAP_WETH for native ETH output |
| S3 | CRITICAL | **LOW_PRIORITY** | Swap | SETTLE_ALL amount may not match swap input |
| S4 | CRITICAL | **LOW_PRIORITY** | Swap | Price limit silently ignored for multi-hop ExactOut |
| S5 | CRITICAL | **FIXED** | Swap | zeroForOne direction validation missing |
| S6 | CRITICAL | **FIXED** | Swap | Token type check uses symbol, not address |
| S7 | HIGH | **FIXED** | Swap | TAKE_ALL uses conflicting 95% slippage |
| S8 | HIGH | PENDING | Swap | Multi-hop path continuity not validated |
| S9 | HIGH | PENDING | Swap | Permit2 nonce not validated pre-submission |
| S10 | HIGH | PENDING | Swap | Quote cache TTL (15s) causes stale quote issues |
| L1 | CRITICAL | **VERIFIED OK** | Liquidity | V4Position.fromAmounts() receives strings not JSBI |
| L2 | CRITICAL | **VERIFIED OK** | Liquidity | V4Planner/Universal Router command mismatch |
| L3 | CRITICAL | **LOW_PRIORITY** | Liquidity | Native ETH value tracking across two txs broken |
| L4 | CRITICAL | **VERIFIED OK** | Liquidity | V4Position constructor incorrect args |
| L5 | CRITICAL | **VERIFIED OK** | Liquidity | Amount parsing uses strings not JSBI |
| C1 | CRITICAL | **FIXED** | Constants | EMPTY_BYTES is '0x00' instead of '0x' |
| C2 | CRITICAL | **VERIFIED OK** | Constants | MaxAllowanceTransferAmount type mismatch |
| C3 | HIGH | PENDING | Constants | PERMIT2_ADDRESS single-chain assumption |
| C4 | HIGH | PENDING | Constants | Router address hardcoding |
| C5 | MEDIUM | PENDING | Constants | Fee tier 0x800000 not documented |
| C6 | MEDIUM | PENDING | Constants | TICK_SPACING values not exported |
| C7 | MEDIUM | PENDING | Constants | Block time constants incomplete |
| C8 | LOW | PENDING | Constants | Inconsistent PERMIT_TYPES definition |
| C9 | LOW | PENDING | Constants | Missing CommandType exports |
| C10 | LOW | PENDING | Constants | Native currency hardcoding |
| Q1 | CRITICAL | **FIXED** | Quote | Price impact formula uses abs() incorrectly |
| Q2 | HIGH | **VERIFIED OK** | Quote | Slippage UI/Contract mismatch |
| Q3 | HIGH | PENDING | Quote | Pool state staleness |
| Q4 | MEDIUM | PENDING | Quote | JSBI/BigInt type mixing loses precision |
| Q5 | MEDIUM | PENDING | Quote | Zap price impact decimal handling |
| Q6 | MEDIUM | PENDING | Quote | SqrtPriceX96 string conversion precision |
| Q7 | MEDIUM | PENDING | Quote | Rounding direction not controlled |
| T1 | CRITICAL | **NEEDS_TESTING** | TxBuilder | Native currency lost (.wrapped used) in addTakePair |
| T2 | CRITICAL | **NEEDS_TESTING** | TxBuilder | Sorted tokens use .wrapped for native sweep |
| T3 | HIGH | PENDING | TxBuilder | tokenId JSBI conversion (should use toHex) |
| T4 | HIGH | **FIXED** | TxBuilder | Slippage hardcoded to zero in buildIncreaseTx |
| T5 | MEDIUM | PENDING | TxBuilder | Pool currency ordering unverified |
| T6 | MEDIUM | PENDING | TxBuilder | hookData always empty |

---

## Detailed Issue Descriptions

### SWAP ARCHITECT FINDINGS

#### S1: No WRAP_ETH for native ETH multi-hop input
**File:** `pages/api/swap/build-tx.ts`
**Severity:** CRITICAL
**Status:** NEEDS PROOF - User states native ETH pools don't need wrapping
**Description:** Multi-hop swaps starting with native ETH may fail without WRAP_ETH command
**SDK Reference:** universal-router-sdk wraps ETH before V4_SWAP

#### S2: No UNWRAP_WETH for native ETH output
**File:** `pages/api/swap/build-tx.ts`
**Severity:** CRITICAL
**Status:** NEEDS PROOF - User states native ETH pools don't need wrapping
**Description:** User receives WETH instead of ETH when swap outputs native token
**SDK Reference:** universal-router-sdk adds UNWRAP_WETH for native output

#### S3: SETTLE_ALL amount may not match swap input
**File:** `pages/api/swap/build-tx.ts`
**Severity:** CRITICAL
**Status:** PENDING
**Description:** SETTLE_ALL command amount may not match actual swap input amount
**SDK Reference:** Must match exactIn amount or use max for exactOut

#### S4: Price limit silently ignored for multi-hop ExactOut
**File:** `pages/api/swap/build-tx.ts`
**Severity:** CRITICAL
**Status:** **LOW_PRIORITY**
**Description:** No slippage protection for multi-hop exact output swaps
**SDK Reference:** V4_SWAP command only accepts one sqrtPriceLimitX96 for entire path
**Verification:** V4 protocol limitation - multi-hop cannot have per-hop price limits; Uniswap uses amountIn max for protection

#### S5: zeroForOne direction validation missing
**File:** `pages/api/swap/build-tx.ts`
**Severity:** CRITICAL
**Status:** **FIXED**
**Description:** zeroForOne was calculated using address comparison (`===`) instead of canonical ordering (`sortsBefore()`)
**SDK Reference:** `@uniswap/sdk-core Token.sortsBefore()` determines canonical pool ordering
**Fix Applied:** Changed all zeroForOne calculations to use `inputToken.sortsBefore(outputToken)` to match get-quote.ts

#### S6: Token type check uses symbol, not address
**File:** `pages/api/swap/build-tx.ts`
**Severity:** CRITICAL
**Status:** **FIXED**
**Description:** Permit skipped for ERC20 tokens when checking by symbol - security risk if ERC20 named "ETH"
**SDK Reference:** Uniswap uses `isNativeIn()` with NATIVE_TOKEN_ADDRESS check in trade builders
**Fix Applied:** Changed `fromTokenSymbol === 'ETH'` to address-based check using `NATIVE_TOKEN_ADDRESS` (0x0000...0000)

#### S7: TAKE_ALL uses conflicting 95% slippage
**File:** `pages/api/swap/build-tx.ts`
**Severity:** HIGH
**Status:** PENDING
**Description:** Hardcoded 95% slippage in TAKE_ALL conflicts with user settings
**SDK Reference:** Should use user-configured slippage

#### S8: Multi-hop path continuity not validated
**File:** `pages/api/swap/build-tx.ts`
**Severity:** HIGH
**Status:** PENDING
**Description:** Path tokens not validated for continuity between hops
**SDK Reference:** Output of hop N must equal input of hop N+1

#### S9: Permit2 nonce not validated pre-submission
**File:** `pages/api/swap/build-tx.ts`
**Severity:** HIGH
**Status:** PENDING
**Description:** Permit nonce not checked against on-chain state before use
**SDK Reference:** Stale nonce causes transaction revert

#### S10: Quote cache TTL (15s) causes stale quote issues
**File:** `pages/api/swap/get-quote.ts`
**Severity:** HIGH
**Status:** PENDING
**Description:** 15-second cache TTL can return outdated quotes
**SDK Reference:** Price changes during cache window not reflected

---

### LIQUIDITY ENGINEER FINDINGS

#### L1: V4Position.fromAmounts() receives strings not JSBI
**File:** `pages/api/liquidity/prepare-zap-mint-tx.ts`
**Severity:** CRITICAL
**Status:** NEEDS PROOF
**Description:** Position amounts passed as strings instead of JSBI BigInts
**SDK Reference:** V4Position.fromAmounts expects JSBI for precise math

#### L2: V4Planner/Universal Router command mismatch
**File:** `pages/api/liquidity/prepare-zap-mint-tx.ts`
**Severity:** CRITICAL
**Status:** NEEDS PROOF
**Description:** Command encoding may not match Universal Router expectations
**SDK Reference:** V4Planner commands must match router decoder

#### L3: Native ETH value tracking across two txs broken
**File:** `pages/api/liquidity/prepare-zap-mint-tx.ts`
**Severity:** CRITICAL
**Status:** NEEDS PROOF
**Description:** Native ETH value split between swap and mint transactions
**SDK Reference:** msg.value must be tracked across both transactions

#### L4: V4Position constructor incorrect args
**File:** `pages/api/liquidity/prepare-mint-after-swap-tx.ts`
**Severity:** CRITICAL
**Status:** **VERIFIED OK**
**Description:** Position constructor called with wrong argument types/order
**SDK Reference:** V4Position(pool, tickLower, tickUpper, liquidity) - constructor signature verified
**Verification:** Alphix code uses correct signature: `new V4Position({ pool, tickLower, tickUpper, liquidity })`

#### L5: Amount parsing uses strings not JSBI
**File:** `pages/api/liquidity/prepare-mint-after-swap-tx.ts`
**Severity:** CRITICAL
**Status:** **VERIFIED OK**
**Description:** Amount calculations use string arithmetic
**SDK Reference:** `BigintIsh = JSBI | string | number` - SDK accepts all three types
**Verification:** Uniswap SDK explicitly defines BigintIsh to accept strings; no conversion required

---

### CONSTANTS AUDITOR FINDINGS

#### C1: EMPTY_BYTES is '0x00' instead of '0x'
**File:** `lib/swap-constants.ts` (line 126)
**Severity:** CRITICAL
**Status:** **FIXED**
**Description:** `EMPTY_BYTES = '0x00'` but V4 SDK uses `'0x'`
**SDK Reference:** `sdks/sdks/v4-sdk/src/internalConstants.ts:11` exports `EMPTY_BYTES = '0x'`
**Fix Applied:** Changed `'0x00'` to `'0x'` with Uniswap SDK reference comment

#### C2: MaxAllowanceTransferAmount type mismatch
**File:** `lib/swap-constants.ts` (line 61)
**Severity:** CRITICAL
**Status:** **VERIFIED OK**
**Description:** Uses `2n ** 160n - 1n` (BigInt) instead of BigNumber
**SDK Reference:** permit2-sdk exports MaxAllowanceTransferAmount as ethers BigNumber
**Verification:** Types never mixed in Alphix - BigInt used consistently for viem; BigNumber only where ethers required

#### C3: PERMIT2_ADDRESS single-chain assumption
**File:** `lib/swap-constants.ts` (line 22-23)
**Severity:** HIGH
**Status:** PENDING - Multi-chain not priority
**Description:** Hardcoded Permit2 address won't work on all chains
**SDK Reference:** permit2-sdk has chain-specific addresses

#### C4: Router address hardcoding
**File:** `config/pools.json` (line 10)
**Severity:** HIGH
**Status:** PENDING - Acceptable for now
**Description:** Universal Router address hardcoded
**SDK Reference:** Router can be upgraded

#### C5: Fee tier 0x800000 not documented
**File:** `config/pools.json`
**Severity:** MEDIUM
**Status:** PENDING
**Description:** Dynamic fee flag (8388608) lacks inline documentation
**SDK Reference:** Document that 0x800000 = dynamic fee

#### C6: TICK_SPACING values not exported
**File:** `lib/swap-constants.ts`
**Severity:** MEDIUM
**Status:** PENDING
**Description:** Tick spacing not centralized as constants
**SDK Reference:** V4 SDK exports TICK_SPACINGS map

#### C7: Block time constants incomplete
**File:** `lib/swap-constants.ts` (lines 57-58)
**Severity:** MEDIUM
**Status:** PENDING
**Description:** L1/L2 block times hardcoded, not chain-specific
**SDK Reference:** Different chains have different block times

#### C8: Inconsistent PERMIT_TYPES definition
**File:** `lib/swap-constants.ts`, `lib/liquidity-utils.ts`
**Severity:** LOW
**Status:** PENDING
**Description:** PERMIT_TYPES defined in multiple places
**SDK Reference:** Consolidate to single source

#### C9: Missing CommandType exports
**File:** `lib/swap-constants.ts`
**Severity:** LOW
**Status:** PENDING
**Description:** CommandType enum not re-exported from SDK
**SDK Reference:** universal-router-sdk CommandType enum

#### C10: Native currency hardcoding
**File:** `lib/swap-constants.ts` (lines 17-19)
**Severity:** LOW
**Status:** PENDING
**Description:** ETH hardcoded as native currency
**SDK Reference:** Should be configurable per network

---

### QUOTE ANALYST FINDINGS

#### Q1: Price impact formula uses abs() incorrectly
**File:** `pages/api/swap/get-quote.ts`
**Severity:** CRITICAL
**Status:** **FIXED**
**Description:** abs() removes sign information from price impact
**SDK Reference:** `interface/packages/uniswap/src/features/transactions/swap/utils/formatPriceImpact.ts:8` checks `lessThan(0)` for favorable prices
**Fix Applied:** Removed abs() call, added Uniswap sign convention comments (positive = unfavorable, negative = favorable)

#### Q2: Slippage UI/Contract mismatch
**File:** `pages/api/liquidity/prepare-mint-tx.ts`
**Severity:** HIGH
**Status:** PENDING - Part of slippage overhaul
**Description:** Displayed slippage differs from contract-enforced slippage
**SDK Reference:** UI and contract must match

#### Q3: Pool state staleness
**File:** `pages/api/swap/get-quote.ts`
**Severity:** HIGH
**Status:** PENDING
**Description:** Pool state may be stale when quote is used
**SDK Reference:** On-chain state changes between quote and execution

#### Q4: JSBI/BigInt type mixing
**File:** Multiple files
**Severity:** MEDIUM
**Status:** PENDING
**Description:** Mixing JSBI and native BigInt loses precision
**SDK Reference:** Use JSBI consistently for SDK compatibility

#### Q5: Zap price impact decimal handling
**File:** `pages/api/liquidity/prepare-zap-mint-tx.ts`
**Severity:** MEDIUM
**Status:** PENDING
**Description:** Price impact calculation ignores token decimals
**SDK Reference:** Must normalize for different decimal tokens

#### Q6: SqrtPriceX96 string conversion precision
**File:** Multiple files
**Severity:** MEDIUM
**Status:** PENDING
**Description:** Converting sqrtPriceX96 to string loses precision
**SDK Reference:** Keep as BigInt/JSBI throughout calculations

#### Q7: Rounding direction not controlled
**File:** Multiple files
**Severity:** MEDIUM
**Status:** PENDING
**Description:** Division rounding not explicitly controlled
**SDK Reference:** Round in user's favor (down for output, up for input)

---

### TRANSACTION BUILDER FINDINGS

#### T1: Native currency lost in addTakePair
**File:** `lib/liquidity/transaction/builders/buildDecreaseTx.ts` (line 465)
**Severity:** CRITICAL
**Status:** PENDING
**Description:** `.wrapped` used instead of bare Currency for native ETH
**SDK Reference:** Native currency should not be wrapped in TAKE

#### T2: Sorted tokens use .wrapped for native sweep
**File:** `lib/liquidity/transaction/builders/buildDecreaseTx.ts` (lines 467-470)
**Severity:** CRITICAL
**Status:** PENDING
**Description:** Token sorting uses .wrapped, breaking native ETH sweep
**SDK Reference:** Sort using Currency, not wrapped version

#### T3: tokenId JSBI conversion
**File:** `lib/liquidity/transaction/builders/buildDecreaseTx.ts`
**Severity:** HIGH
**Status:** PENDING
**Description:** tokenId should use toHex() or string, not JSBI conversion
**SDK Reference:** Position NFT tokenId is uint256

#### T4: Slippage hardcoded to zero in buildIncreaseTx
**File:** `lib/liquidity/transaction/builders/buildIncreaseTx.ts`
**Severity:** HIGH
**Status:** PENDING - Part of slippage overhaul
**Description:** Slippage tolerance hardcoded, ignoring user options
**SDK Reference:** Should use options.slippageBps or auto-slippage

#### T5: Pool currency ordering unverified
**File:** `lib/liquidity/transaction/builders/`
**Severity:** MEDIUM
**Status:** SKIPPED - User maintains pools.json manually
**Description:** Pool currency0/currency1 order not verified
**SDK Reference:** Currencies must be sorted by address

#### T6: hookData always empty
**File:** `lib/liquidity/transaction/builders/`
**Severity:** MEDIUM
**Status:** PENDING
**Description:** hookData is always '0x', breaks custom hook pools
**SDK Reference:** Hooks may require specific data

---

## Resolution Log

| Date | Issue ID | Action | Notes |
|------|----------|--------|-------|
| 2026-01-10 | T4 | FIXED | buildIncreaseTx.ts - uses options.slippageBps with DEFAULT_LP_SLIPPAGE fallback |
| 2026-01-10 | S7 | FIXED | build-tx.ts - removed 95% factor from TAKE_ALL (3 locations) |
| 2026-01-10 | Q2 | VERIFIED | No mismatch - slippage flows correctly UI → API → Contract |
| 2026-01-10 | C1 | FIXED | swap-constants.ts - EMPTY_BYTES changed from '0x00' to '0x' (Uniswap SDK ref: internalConstants.ts:11) |
| 2026-01-10 | Q1 | FIXED | get-quote.ts - removed abs() from price impact (Uniswap ref: formatPriceImpact.ts uses sign) |
| 2026-01-10 | L1 | VERIFIED | Code already uses JSBI.BigInt() correctly in prepare-zap-mint-tx.ts |
| 2026-01-10 | T1+T2 | NEEDS_TESTING | Code works because Token.wrapped === Token; would fail if Ether.onChain() used |
| 2026-01-10 | S1+S2 | VERIFIED OK | V4 pools handle native ETH (0x0) directly - no WRAP/UNWRAP needed |
| 2026-01-10 | S3 | LOW_PRIORITY | ExactIn uses exact amount, ExactOut uses max - semantically different but works |
| 2026-01-10 | S5 | FIXED | build-tx.ts - changed zeroForOne to use inputToken.sortsBefore(outputToken) |
| 2026-01-10 | L2 | VERIFIED OK | Command encoding matches SDK perfectly - Actions enum values identical |
| 2026-01-10 | L3 | LOW_PRIORITY | mintTxValue not actually used - frontend recalculates via prepare-mint-after-swap-tx |
| 2026-01-10 | S4 | LOW_PRIORITY | V4 protocol limitation - multi-hop has no per-hop sqrtPriceLimitX96 |
| 2026-01-10 | S6 | FIXED | build-tx.ts - changed symbol check to NATIVE_TOKEN_ADDRESS check |
| 2026-01-10 | L4 | VERIFIED OK | Constructor signature correct: new V4Position({ pool, tickLower, tickUpper, liquidity }) |
| 2026-01-10 | L5 | VERIFIED OK | BigintIsh = JSBI | string | number - SDK accepts strings |
| 2026-01-10 | C2 | VERIFIED OK | Types never mixed - BigInt for viem, BigNumber only where ethers required |

---

## Priority Queue (Next 5)

**Batch 1 (COMPLETED):** T4, S7, Q2 (slippage focus)
**Batch 2 (COMPLETED):** C1, Q1, T1+T2, L1
**Batch 3 (COMPLETED):** S1+S2, S3, S5, L2, L3
**Batch 4 (COMPLETED):** S4 (LOW_PRIORITY), S6 (FIXED), L4 (VERIFIED), L5 (VERIFIED), C2 (VERIFIED)

**Next batch (Batch 5) - HIGH priority remaining:**
1. **S8**: Multi-hop path continuity not validated
2. **S9**: Permit2 nonce not validated pre-submission
3. **S10**: Quote cache TTL (15s) causes stale quote issues
4. **Q3**: Pool state staleness
5. **T3**: tokenId JSBI conversion (should use toHex)

