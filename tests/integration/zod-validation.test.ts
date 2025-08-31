import { describe, it, expect } from 'vitest';
import { validateApiResponse } from '@/lib/validation';
import {
  PoolStateSchema,
  LiquidityDepthSchema,
  DynamicFeeSchema,
  TokenPricesSchema,
  MaintenanceStatusSchema
} from '@/lib/validation';

describe('Zod Validation Integration', () => {
  describe('Pool State Validation', () => {
    it('should validate correct pool state response', () => {
      const validResponse = {
        poolId: '0x123...',
        sqrtPriceX96: '123456789012345678901234567890',
        tick: 12345,
        liquidity: '1000000000000000000',
        protocolFee: 0,
        lpFee: 3000,
        currentPrice: '1.23',
        currentPoolTick: 12345,
      };

      const result = validateApiResponse(PoolStateSchema, validResponse, 'pool-state-test');
      expect(result).toEqual(validResponse);
    });

    it('should reject invalid pool state response', () => {
      const invalidResponse = {
        poolId: '0x123...',
        sqrtPriceX96: 123456789012345678901234567890, // Should be string
        tick: '12345', // Should be number
        liquidity: '1000000000000000000',
        protocolFee: 0,
        lpFee: 3000,
        currentPrice: '1.23',
        currentPoolTick: 12345,
      };

      expect(() => {
        validateApiResponse(PoolStateSchema, invalidResponse, 'pool-state-test');
      }).toThrow();
    });

    it('should reject missing required fields', () => {
      const incompleteResponse = {
        poolId: '0x123...',
        // Missing other required fields
      };

      expect(() => {
        validateApiResponse(PoolStateSchema, incompleteResponse, 'pool-state-test');
      }).toThrow();
    });
  });

  describe('Liquidity Depth Validation', () => {
    it('should validate correct liquidity depth response', () => {
      const validResponse = {
        items: [
          {
            pool: '0x123...',
            tickLower: 12000,
            tickUpper: 13000,
            liquidity: '500000000000000000',
          },
          {
            pool: '0x456...',
            tickLower: 12500,
            tickUpper: 13500,
            liquidity: '300000000000000000',
          },
        ],
      };

      const result = validateApiResponse(LiquidityDepthSchema, validResponse, 'liquidity-depth-test');
      expect(result).toEqual(validResponse);
    });

    it('should reject invalid liquidity depth response', () => {
      const invalidResponse = {
        items: [
          {
            pool: '0x123...',
            tickLower: '12000', // Should be number
            tickUpper: 13000,
            liquidity: '500000000000000000',
          },
        ],
      };

      expect(() => {
        validateApiResponse(LiquidityDepthSchema, invalidResponse, 'liquidity-depth-test');
      }).toThrow();
    });
  });

  describe('Dynamic Fee Validation', () => {
    it('should validate correct dynamic fee response', () => {
      const validResponse = {
        dynamicFee: '3000',
        dynamicFeeBps: 3000,
        poolId: '0x123...',
        poolName: 'ETH/USDC',
        unit: 'bps',
        isEstimate: false,
        note: 'Actual LP fee (bps) derived from onchain millionths.',
      };

      const result = validateApiResponse(DynamicFeeSchema, validResponse, 'dynamic-fee-test');
      expect(result).toEqual(validResponse);
    });

    it('should reject invalid dynamic fee response', () => {
      const invalidResponse = {
        dynamicFee: 3000, // Should be string
        dynamicFeeBps: '3000', // Should be number
        poolId: '0x123...',
        poolName: 'ETH/USDC',
        unit: 'bps',
        isEstimate: false,
        note: 'Actual LP fee (bps) derived from onchain millionths.',
      };

      expect(() => {
        validateApiResponse(DynamicFeeSchema, invalidResponse, 'dynamic-fee-test');
      }).toThrow();
    });
  });

  describe('Token Prices Validation', () => {
    it('should validate correct token prices response', () => {
      const validResponse = {
        ETH: 3500,
        BTC: 65000,
        USDC: 1,
        USDT: 1,
      };

      const result = validateApiResponse(TokenPricesSchema, validResponse, 'token-prices-test');
      expect(result).toEqual(validResponse);
    });

    it('should reject invalid token prices response', () => {
      const invalidResponse = {
        ETH: '3500', // Should be number
        BTC: 65000,
        USDC: 1,
        USDT: 1,
      };

      expect(() => {
        validateApiResponse(TokenPricesSchema, invalidResponse, 'token-prices-test');
      }).toThrow();
    });

    it('should handle empty prices object', () => {
      const emptyResponse = {};

      const result = validateApiResponse(TokenPricesSchema, emptyResponse, 'token-prices-test');
      expect(result).toEqual(emptyResponse);
    });
  });

  describe('Maintenance Status Validation', () => {
    it('should validate correct maintenance status response', () => {
      const validResponse = {
        maintenance: false,
      };

      const result = validateApiResponse(MaintenanceStatusSchema, validResponse, 'maintenance-test');
      expect(result).toEqual(validResponse);
    });

    it('should validate maintenance mode response', () => {
      const maintenanceResponse = {
        maintenance: true,
      };

      const result = validateApiResponse(MaintenanceStatusSchema, maintenanceResponse, 'maintenance-test');
      expect(result).toEqual(maintenanceResponse);
    });

    it('should reject invalid maintenance status response', () => {
      const invalidResponse = {
        maintenance: 'false', // Should be boolean
      };

      expect(() => {
        validateApiResponse(MaintenanceStatusSchema, invalidResponse, 'maintenance-test');
      }).toThrow();
    });
  });

  describe('Error Handling', () => {
    it('should provide helpful error messages', () => {
      const invalidResponse = {
        poolId: '0x123...',
        // Missing required fields
      };

      expect(() => {
        validateApiResponse(PoolStateSchema, invalidResponse, 'test-endpoint');
      }).toThrow(/Invalid test-endpoint response format/);
    });

    it('should handle null/undefined input', () => {
      expect(() => {
        validateApiResponse(PoolStateSchema, null, 'test-endpoint');
      }).toThrow();

      expect(() => {
        validateApiResponse(PoolStateSchema, undefined, 'test-endpoint');
      }).toThrow();
    });
  });
});


