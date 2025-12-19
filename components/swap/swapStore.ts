import { useSyncExternalStore } from "react"

type Listener = () => void

export type SwapIndependentField = "from" | "to"

type SwapStoreState = {
  independentField: SwapIndependentField
  fromAmount: string
  toAmount: string
}

let state: SwapStoreState = {
  independentField: "from",
  fromAmount: "",
  toAmount: "",
}

const listeners = new Set<Listener>()

function emit() {
  for (const l of listeners) l()
}

function setState(patch: Partial<SwapStoreState> | ((prev: SwapStoreState) => Partial<SwapStoreState>)) {
  const nextPatch = typeof patch === "function" ? patch(state) : patch
  state = { ...state, ...nextPatch }
  emit()
}

function subscribe(listener: Listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useSwapStore<T>(selector: (s: SwapStoreState) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => selector(state),
    () => selector(state)
  )
}

export const swapStore = {
  getState: () => state,
  setState,
  actions: {
    setIndependentField: (f: SwapIndependentField) => setState({ independentField: f }),
    setFromAmount: (v: string) => setState({ fromAmount: v }),
    setToAmount: (v: string) => setState({ toAmount: v }),
    setAmounts: (fromAmount: string, toAmount: string) => setState({ fromAmount, toAmount }),
    reset: () => setState({ independentField: "from", fromAmount: "", toAmount: "" }),
  },
} as const



