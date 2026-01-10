/**
 * Redux Store for Transactions
 *
 * Minimal Redux setup for transaction tracking.
 * Follows Uniswap's pattern but simplified for Alphix.
 *
 * @see interface/apps/web/src/state/index.ts
 */

import { configureStore, combineReducers } from '@reduxjs/toolkit'
import { persistStore, persistReducer, createMigrate, FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER } from 'redux-persist'
import type { MigrationManifest, PersistedState } from 'redux-persist'
import storage from 'redux-persist/lib/storage'
import { transactionReducer, TransactionsState } from './slice'

/**
 * Persist version - increment when making breaking changes to state shape.
 * Add a corresponding migration function in the migrations object below.
 */
export const PERSIST_VERSION = 1

/**
 * Migration functions for state schema changes.
 * Each function transforms state from the previous version to the target version.
 *
 * @example Adding a migration for version 2:
 * ```
 * 2: (state: PersistedState) => {
 *   // Transform state from version 1 to version 2
 *   return {
 *     ...state,
 *     newField: 'defaultValue',
 *   }
 * }
 * ```
 */
export const migrations: MigrationManifest = {
  // Version 1: Initial state structure
  1: (state: PersistedState): PersistedState => {
    // Clear all transactions on initial migration to ensure clean state
    if (!state) return state
    return {
      ...state,
      transactions: {},
    } as PersistedState
  },
}

const persistConfig = {
  key: 'alphix-transactions',
  version: PERSIST_VERSION,
  storage,
  whitelist: ['transactions'],
  throttle: 1000, // ms - matches Uniswap's persist throttle
  migrate: createMigrate(migrations, { debug: false }),
}

const rootReducer = combineReducers({
  transactions: transactionReducer,
})

const persistedReducer = persistReducer(persistConfig, rootReducer)

export const store = configureStore({
  reducer: persistedReducer,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: [FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER],
      },
    }),
})

export const persistor = persistStore(store)

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch

export default store
