import { GraphQLClient, gql } from 'graphql-request';

// Replace with the actual GraphQL endpoint of your deployed subgraph
const SUBGRAPH_ENDPOINT = 'YOUR_SUBGRAPH_GRAPHQL_ENDPOINT_HERE';

// The GraphQL query to fetch swaps for a given pool within a time range
// We ask for amountUSD and feesUSD to calculate both volume and fees
const GET_SWAPS_IN_TIME_RANGE_QUERY = gql`
  query GetPoolSwapsInTimeRange($poolId: Bytes!, $cutoffTimestamp: BigInt!) {
    swaps(
      where: {
        pool: $poolId,
        timestamp_gte: $cutoffTimestamp
      }
      # Ordering by timestamp can be helpful for debugging but not strictly necessary for sum
      # orderBy: timestamp
      # orderDirection: asc
      # You might want to limit the number of results if expecting a huge number of swaps
      # first: 10000 # Adjust as needed
    ) {
      id
      timestamp
      amountUSD # Include amountUSD for volume calculation
      feesUSD   # Include feesUSD for fees calculation (if you need rolling fees too)
    }
  }
`;

/**
 * Fetches swaps for a given pool over a specified number of past days and calculates
 * the total volume and fees within that period.
 * @param poolId The PoolId (bytes32 string) of the pool.
 * @param days The number of past days to include in the calculation (e.g., 1 for 24h, 7 for 7d).
 * @returns An object containing the total volume and fees in USD for the specified period as strings.
 */
async function getRollingVolumeAndFees(poolId: string, days: number): Promise<{ volumeUSD: string, feesUSD: string }> {
  const client = new GraphQLClient(SUBGRAPH_ENDPOINT);

  // Calculate the timestamp for the specified number of days ago
  const nowInSeconds = Math.floor(Date.now() / 1000);
  const cutoffTimestampInSeconds = nowInSeconds - (days * 24 * 60 * 60);

  const variables = {
    poolId: poolId,
    cutoffTimestamp: BigInt(cutoffTimestampInSeconds).toString(), // Ensure timestamp is string for BigInt
  };

  try {
    const data: any = await client.request(GET_SWAPS_IN_TIME_RANGE_QUERY, variables);

    if (!data || !data.swaps || data.swaps.length === 0) {
      console.warn(`No swap data found for pool ${poolId} in the past ${days} days.`);
      return { volumeUSD: "0.0", feesUSD: "0.0" };
    }

    let totalVolumeUSD = 0.0;
    let totalFeesUSD = 0.0;

    // Sum the amountUSD and feesUSD of all fetched swaps
    for (const swap of data.swaps) {
      // These are stored as BigDecimal strings in the subgraph
      totalVolumeUSD += parseFloat(swap.amountUSD);
      totalFeesUSD += parseFloat(swap.feesUSD); // Sum fees
    }

    // Return the total volume and fees formatted as strings
    return {
        volumeUSD: totalVolumeUSD.toFixed(18), // Adjust decimal places as needed for display
        feesUSD: totalFeesUSD.toFixed(18) // Adjust decimal places as needed for display
    };

  } catch (error) {
    console.error(`Error fetching ${days}d volume/fees for pool ${poolId}:`, error);
    throw error; // Re-throw or handle error as appropriate
  }
}

// Example usage: Replace with the actual PoolId you want to query
const targetPoolId = "0xbcc20db9b797e211e508500469e553111c6fa8d80f7896e6db60167bcf18ce13";

// Function to get 24h volume and fees
async function get24hVolumeAndFees(poolId: string): Promise<{ volumeUSD: string, feesUSD: string }> {
    return getRollingVolumeAndFees(poolId, 1); // 1 day for 24 hours
}

// Function to get 7d volume and fees
async function get7dVolumeAndFees(poolId: string): Promise<{ volumeUSD: string, feesUSD: string }> {
    return getRollingVolumeAndFees(poolId, 7); // 7 days for 7d volume
}

// --- Execute the functions ---

get24hVolumeAndFees(targetPoolId)
  .then(results => {
    console.log(`Rolling 24h Volume for pool ${targetPoolId}: ${results.volumeUSD} USD`);
    console.log(`Rolling 24h Fees for pool ${targetPoolId}: ${results.feesUSD} USD`);
  })
  .catch(err => {
    console.error("Failed to get 24h volume/fees:", err);
  });

get7dVolumeAndFees(targetPoolId)
  .then(results => {
    console.log(`Rolling 7d Volume for pool ${targetPoolId}: ${results.volumeUSD} USD`);
    console.log(`Rolling 7d Fees for pool ${targetPoolId}: ${results.feesUSD} USD`);
  })
  .catch(err => {
    console.error("Failed to get 7d volume/fees:", err);
  });
