import { useCallback, useEffect, useRef, useState } from 'react'
import { directRpcFetch, ethCall, getBalance } from '../rpc-client'
import { getFunctionSelector } from '../utils/crypto'
import { MULTICALL_ADDRESS, NATIVE_TOKEN_ADDRESS } from '../constants'
import { useActiveWeb3 } from './useWeb3Provider'

const ERC20_BALANCE_OF_SELECTOR = getFunctionSelector('balanceOf(address)') // "70a08231"

function encodeBytes(data: string) {
  const length = data.length / 2 // Hex string length divided by 2 for bytes
  const lengthEncoded = length.toString(16).padStart(64, '0')
  const paddedData = data.padEnd(Math.ceil(data.length / 64) * 64, '0')
  return lengthEncoded + paddedData
}

// Decode the results from the Multicall response
function decodeMulticallOutput(result: string | undefined): bigint[] {
  if (!result) return []
  const res = result.startsWith('0x') ? result.slice(2) : result
  let offset = 0

  // Decode blockNumber (first 32 bytes, uint256)
  //const blockNumber = BigInt("0x" + res.slice(offset, offset + 64));
  offset += 64

  // Decode blockHash (next 32 bytes, bytes32)
  //const blockHash = "0x" + res.slice(offset, offset + 64);
  offset += 64

  // Decode returnData array offset (not used directly)
  //const returnDataOffset = parseInt(res.slice(offset, offset + 64), 16);
  offset += 64

  // Decode returnData array length (next 32 bytes, uint256)
  const returnDataLength = parseInt(res.slice(offset, offset + 64), 16)
  offset += 64

  const dynamicData = res.slice(offset)

  const offsetsOfEachData = []
  for (let i = 0; i < returnDataLength; i++) {
    const returnDataOffset = parseInt(res.slice(offset, offset + 64), 16)
    offsetsOfEachData.push(returnDataOffset)
    offset += 64
  }

  const returnData: { success: boolean; returnData: string }[] = []

  for (let i = 0; i < returnDataLength; i++) {
    const currentData = dynamicData.slice(offsetsOfEachData[i] * 2)

    let currentOffset = 0
    // Decode success (bool, first 32 bytes of each tuple)
    const success = currentData.slice(currentOffset, 64).endsWith('1')
    currentOffset += 64

    // Decode returnData offset (relative to the start of the tuple array)
    //const innerReturnDataOffset = currentData.slice(currentOffset , currentOffset + 64);
    currentOffset += 64

    // Decode returnData length from the specified offset
    const currentDataLength = parseInt(currentData.slice(currentOffset, currentOffset + 64), 16)
    currentOffset += 64

    const returnDataHex = '0x' + (currentData.slice(currentOffset, currentOffset + currentDataLength * 2) || '0')

    returnData.push({ success, returnData: returnDataHex })
  }

  return returnData.map(item => {
    if (item.success) return BigInt(item.returnData)
    return BigInt(0)
  })
}

// Helper to manually encode ABI data
function encodeMulticallInput(requireSuccess: boolean, calls: { target: string; callData: string }[]): string {
  const functionSelector = getFunctionSelector('tryBlockAndAggregate(bool,(address,bytes)[])')

  // Encode `requireSuccess` as a 32-byte boolean
  const requireSuccessEncoded = requireSuccess ? '01'.padStart(64, '0') : '00'.padStart(64, '0')

  // `callsOffset` is fixed at 64 bytes (0x40 in hex)
  const offset = '40'.padStart(64, '0')

  const callsLength = calls.length.toString(16).padStart(64, '0')

  const encodedCalls = calls.map(call => {
    const encodedTarget = call.target.toLowerCase().replace('0x', '').padStart(64, '0')

    const encodedCallData = encodeBytes(call.callData.replace(/^0x/, ''))

    return encodedTarget + offset + encodedCallData
  })

  const staticPart = `${functionSelector}${requireSuccessEncoded}${offset}${callsLength}`

  const dynamicDataLocaitons: number[] = []
  dynamicDataLocaitons.push(calls.length * 32)
  encodedCalls.forEach((call, index) => {
    if (index === encodedCalls.length - 1) return
    dynamicDataLocaitons.push(call.length / 2 + dynamicDataLocaitons[index])
  })

  const encodedDynamicDataLocaitons = dynamicDataLocaitons.map(location => location.toString(16).padStart(64, '0'))

  const dynamicData = encodedDynamicDataLocaitons.join('') + encodedCalls.join('')

  return `0x${staticPart}${dynamicData}`
}

const useTokenBalances = (tokenAddresses: string[]) => {
  const { chainId, connectedAccount, rpcUrl, hasIntegratorRpcUrl } = useActiveWeb3()
  const [balances, setBalances] = useState<{ [address: string]: bigint }>({})
  const [loading, setLoading] = useState(false)

  // Discard stale in-flight responses. When chainId / rpcUrl / token list
  // changes (e.g. user toggles the in-widget chain switcher), `fetchBalances`
  // is re-invoked but the previous call's multicall is still in flight. If
  // the older Base-RPC response resolves AFTER the newer Arbitrum-RPC one,
  // it overwrites the correct balances with stale data — surfacing as the
  // "Your Tokens flashes then disappears" bug on rapid chain toggles AND as
  // the "0 in selector, real balance in input" inconsistency between this
  // hook's two parallel instances (Widget panel + SelectCurrency list).
  const callIdRef = useRef(0)

  const fetchBalances = useCallback(async () => {
    const callId = ++callIdRef.current
    if (!connectedAccount.address) {
      if (callId === callIdRef.current) setBalances({})
      return
    }
    try {
      setLoading(true)
      const account = connectedAccount.address
      const multicallAddress = MULTICALL_ADDRESS[chainId]

      // When the integrator provided an rpcUrl, dial it directly (no rotation,
      // matches the documented contract). Otherwise rely on @kyber/rpc-client
      // rotation seeded with DefaultRpcUrl[chainId] by Web3Provider.
      const fetchNativeBalance = () =>
        hasIntegratorRpcUrl
          ? directRpcFetch<string>(rpcUrl, 'eth_getBalance', [account, 'latest']).then(r => BigInt(r))
          : getBalance(chainId, account)

      const fetchMulticall = (): Promise<string> | undefined => {
        if (!multicallAddress || !tokenAddresses.length) return undefined
        const paddedAccount = account.replace('0x', '').padStart(64, '0')
        const multicallData = encodeMulticallInput(
          false,
          tokenAddresses.map(token => ({
            target: token,
            callData: `0x${ERC20_BALANCE_OF_SELECTOR}${paddedAccount}`,
          })),
        )
        return hasIntegratorRpcUrl
          ? directRpcFetch<string>(rpcUrl, 'eth_call', [{ to: multicallAddress, data: multicallData }, 'latest'])
          : ethCall(chainId, multicallAddress, multicallData)
      }

      // Use allSettled so a multicall failure does not discard the native balance.
      const [nativeResult, multicallResult] = await Promise.allSettled([fetchNativeBalance(), fetchMulticall()])

      // A newer fetch has started — drop this stale result.
      if (callId !== callIdRef.current) return

      const balancesMap: Record<string, bigint> = {}

      if (multicallResult.status === 'fulfilled' && multicallResult.value) {
        const decodedBalances = decodeMulticallOutput(multicallResult.value)
        tokenAddresses.forEach((token, index) => {
          balancesMap[token] = decodedBalances[index]
        })
      } else if (multicallResult.status === 'rejected') {
        console.error('[swap-widgets] Failed to fetch ERC20 balances:', multicallResult.reason)
      }

      if (nativeResult.status === 'fulfilled') {
        balancesMap[NATIVE_TOKEN_ADDRESS] = nativeResult.value
      } else {
        console.error('[swap-widgets] Failed to fetch native balance:', nativeResult.reason)
      }

      setBalances(balancesMap)
    } catch (e) {
      console.error('[swap-widgets] Failed to fetch token balances:', e)
    } finally {
      if (callId === callIdRef.current) setLoading(false)
    }
    //eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rpcUrl, hasIntegratorRpcUrl, connectedAccount.address, chainId, JSON.stringify(tokenAddresses)])

  useEffect(() => {
    // Fetch balances ONCE per (account + chain + token-set) change. The
    // previous implementation polled every 10s, which caused the token-row
    // skeletons to briefly flicker on every poll AND pressured the RPC
    // unnecessarily. Callers that need a fresh fetch (e.g. Confirmation
    // close) call `refetch` explicitly via the returned API.
    fetchBalances()
  }, [fetchBalances])

  return {
    loading,
    balances,
    refetch: fetchBalances,
  }
}

export default useTokenBalances
