# Points Page API Integration

This document outlines the data structures, mock endpoints, and work required to integrate the Points page with a real API.

## Current Architecture

The Points page uses `usePointsPageData` hook (`hooks/usePointsPageData.ts`) which follows Uniswap patterns:
- Separate state per data category
- Granular loading states
- Parallel fetching with `Promise.allSettled`
- Sentry error logging

---

## Data Structures

### 1. User Points Data

```typescript
interface UserPointsData {
  totalPoints: number;        // e.g., 1022.7923
  dailyRate: number;          // e.g., 45.32 (points earned per day)
  leaderboardPosition: number | null;  // e.g., 127 (null if not ranked)
  volumePoints: number;       // Points from swap volume
  liquidityPoints: number;    // Points from LP positions
  referralPoints: number;     // Points from referrals
  recentPointsEarned: number; // Points earned in current/recent week
}
```

**API Endpoint**: `GET /api/points/user/{address}`

### 2. Global Stats Data

```typescript
interface GlobalStatsData {
  totalParticipants: number;  // e.g., 2847
}
```

**API Endpoint**: `GET /api/points/stats`

### 3. Points History

```typescript
interface PointsHistoryEntry {
  id: string;
  type: "weekly_drop" | "referral";
  points: number;
  // For weekly drops
  season?: number;     // e.g., 0
  week?: number;       // e.g., 8
  startDate?: number;  // Unix timestamp (ms)
  endDate?: number;    // Unix timestamp (ms)
  // For referrals
  referralCount?: number;
  timestamp?: number;  // Single date for referrals
}
```

**API Endpoint**: `GET /api/points/history/{address}?limit=50&offset=0`

### 4. Leaderboard Data

```typescript
interface LeaderboardEntry {
  rank: number;
  address: string;      // 0x...
  points: number;
  isCurrentUser?: boolean;  // Can be computed client-side
}
```

**API Endpoint**: `GET /api/points/leaderboard?limit=100&offset=0`

---

## Mock Functions to Replace

Located in `hooks/usePointsPageData.ts` (lines 93-163):

| Function | Endpoint | Auth Required |
|----------|----------|---------------|
| `fetchUserPoints(address)` | `/api/points/user/{address}` | No (public by address) |
| `fetchGlobalStats()` | `/api/points/stats` | No |
| `fetchPointsHistory(address)` | `/api/points/history/{address}` | No |
| `fetchLeaderboard()` | `/api/points/leaderboard` | No |

---

## API Contract Recommendations

### Response Format

```typescript
// Success
{
  success: true,
  data: T,
  timestamp: number
}

// Error
{
  success: false,
  error: {
    code: string,      // e.g., "USER_NOT_FOUND"
    message: string
  }
}
```

### Pagination (for leaderboard/history)

```typescript
{
  success: true,
  data: {
    entries: T[],
    pagination: {
      total: number,
      limit: number,
      offset: number,
      hasMore: boolean
    }
  }
}
```

### Cache Headers

| Endpoint | Recommended Cache |
|----------|------------------|
| `/api/points/user/{address}` | `s-maxage=60, stale-while-revalidate=300` |
| `/api/points/stats` | `s-maxage=300, stale-while-revalidate=600` |
| `/api/points/history/{address}` | `s-maxage=300, stale-while-revalidate=600` |
| `/api/points/leaderboard` | `s-maxage=300, stale-while-revalidate=600` |

---

## Integration Steps

### Phase 1: Create API Routes

1. Create `/pages/api/points/user/[address].ts`
2. Create `/pages/api/points/stats.ts`
3. Create `/pages/api/points/history/[address].ts`
4. Create `/pages/api/points/leaderboard.ts`

### Phase 2: Replace Mock Functions

Update `usePointsPageData.ts`:

```typescript
async function fetchUserPoints(address: string): Promise<UserPointsData> {
  const response = await fetch(`/api/points/user/${address}`);
  if (!response.ok) throw new Error(`Failed to fetch user points: ${response.status}`);
  const json = await response.json();
  if (!json.success) throw new Error(json.error?.message || 'Unknown error');
  return json.data;
}
```

### Phase 3: Migrate to React Query (Optional but Recommended)

React Query is already installed (`@tanstack/react-query@5.72.2`).

```typescript
import { useQuery } from '@tanstack/react-query';

function useUserPoints(address: string | undefined) {
  return useQuery({
    queryKey: ['points', 'user', address],
    queryFn: () => fetchUserPoints(address!),
    enabled: !!address,
    staleTime: 60_000,      // 1 minute
    gcTime: 5 * 60_000,     // 5 minutes
  });
}
```

Benefits:
- Automatic request deduplication
- Built-in caching
- Refetch on window focus
- Optimistic updates for mutations
- DevTools for debugging

---

## Referral System Integration

### Additional Endpoints Needed

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/points/referral/code` | GET | Get user's referral code |
| `/api/points/referral/apply` | POST | Apply a referral code |
| `/api/points/referral/users` | GET | Get referred users list |

### Referral Code Data

```typescript
interface ReferralCode {
  code: string;           // e.g., "ALPHA123" or generated hash
  isCustom: boolean;      // Custom codes requested via Discord
  createdAt: number;
}

interface ReferredUser {
  address: string;
  joinedAt: number;
  totalPointsEarned: number;
  yourEarnings: number;    // 10% of their points
}
```

---

## Season/Week System

### Current Constants

```typescript
const SEASON_0_START = new Date(2024, 9, 3, 2, 0, 0, 0).getTime(); // Oct 3, 2024
const SEASON_DURATION_DAYS = 90;
const POINTS_PER_WEEK = 100_000;
```

### Endpoint for Season Info

```typescript
// GET /api/points/season
interface SeasonInfo {
  currentSeason: number;
  currentWeek: number;
  seasonStartDate: number;
  seasonEndDate: number;
  pointsPerWeek: number;
  totalPointsDistributed: number;
}
```

---

## Error Handling

Errors are logged to Sentry with operation tags:

| Tag | Description |
|-----|-------------|
| `points_fetch_global_stats` | Global stats fetch failed |
| `points_fetch_leaderboard` | Leaderboard fetch failed |
| `points_fetch_user_points` | User points fetch failed |
| `points_fetch_history` | History fetch failed |

---

## Testing Checklist

- [ ] User points load correctly when wallet connected
- [ ] Leaderboard loads when wallet disconnected
- [ ] Points history pagination works
- [ ] Leaderboard pagination works
- [ ] Referral code copy works
- [ ] Referral code application works
- [ ] Error states display correctly
- [ ] Loading skeletons show during fetch
- [ ] Sentry captures errors correctly

---

## Files to Modify

| File | Changes |
|------|---------|
| `hooks/usePointsPageData.ts` | Replace mock fetch functions with real API calls |
| `components/PointsTabsSection.tsx` | Wire up referral code application |
| (New) `pages/api/points/*` | Create API routes |

---

## Notes

- Points are distributed weekly on Thursdays
- Season 0 is a 90-day pilot (13 weeks)
- 10% referral bonus goes to the referrer, not the referee
- Leaderboard updates after each weekly distribution
