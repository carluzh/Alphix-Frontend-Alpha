/**
 * Shared Test Utilities
 *
 * COPIED FROM UNISWAP - Provides seeded faker for reproducible tests
 * Source: interface/packages/uniswap/src/test/shared.ts
 */
import { faker } from '@faker-js/faker'

export const MAX_FIXTURE_TIMESTAMP = 1609459200

const FAKER_SEED = 123

faker.seed(FAKER_SEED)

export { faker }
