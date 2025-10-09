# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Alphix is a decentralized Automated Market Maker (AMM) built on top of Uniswap V4 infrastructure. This is the frontend application that enables users to swap tokens, provide liquidity, and interact with Alphix pools on Fantom testnet. The project leverages Uniswap's Universal Router SDK and V4 SDK while implementing custom pool configurations and liquidity management features.

**IMPORTANT**: The `interface/` folder contains publicly accessible Uniswap repositories and should be excluded from modifications unless explicitly required. All Alphix-specific development occurs outside this folder.

## Tech Stack

- **Framework**: Next.js 15.2.4 with React 19
- **Language**: TypeScript 5.8.3 (target: ES2020)
- **Styling**: Tailwind CSS 3.4.1 with shadcn/ui components (Radix UI primitives)
  - **Style System**: Centralized CSS variables (14 core brand colors in `globals.css`)
  - **Component Library**: 56 shadcn/ui components with custom theming
  - **📖 See**: `.claude/commands/style.md` for comprehensive styling guidelines
- **Web3**: Wagmi v2, Viem v2, Ethers.js 5.7.2, Reown AppKit 1.7.2
- **State Management**: TanStack React Query 5.72.2
- **Uniswap SDKs**: @uniswap/sdk-core, @uniswap/universal-router-sdk, @uniswap/v4-sdk
- **Data Layer**: GraphQL (graphql-request 7.1.2), Supabase 2.50.0
- **Testing**: Vitest 3.2.4, Playwright 1.55.0, React Testing Library
- **3D Graphics**: Three.js 0.175.0, React Three Fiber 9.1.2
- **Build Tools**: PostCSS, Autoprefixer
- **Package Manager**: npm
- **Node Version**: v22.12.0 (REQUIRED)

## Developer Environment Setup

**IMPORTANT**: This project requires specific versions and environment variables to function properly.

### Prerequisites

1. **Node.js v22.12.0** - Use nvm or volta for version management:
   ```bash
   nvm install 22.12.0
   nvm use 22.12.0
   ```

2. **Environment Variables** - Create `.env.local` in the root directory with:
   - WalletConnect Project ID
   - Supabase URL and keys (anon key, JWT secret, service role key)
   - Subgraph URLs (Satsuma endpoints)
   - ReCAPTCHA keys
   - Maintenance mode flag

3. **Initial Setup**:
   ```bash
   npm install
   # Verify environment is configured
   npm run dev
   ```

## Essential Development Commands

### Daily Development

```bash
# Start development server (default port 3000)
npm run dev

# Build for production
npm run build

# Start production server
npm start

# Deploy (example - adapt to your platform)
# Vercel: relies on project settings; build is `next build`
# If self-hosting: build then run `npm start` behind a process manager
```

### Type Checking & Code Quality

```bash
# YOU MUST run type checking after making code changes
# Note: TypeScript build errors are currently ignored in next.config.mjs
# Run this manually to catch type issues:
npx tsc --noEmit

# No linting script configured in package.json
# TypeScript is the primary quality gate
```

**IMPORTANT**: Always run type checking before committing code changes, even though build errors are suppressed in the Next.js config.

### Testing

```bash
# No test script currently configured in package.json
# Tests were previously removed from the codebase (references in git status)
```

## Architecture & Code Organization

### Directory Structure

```
Alphix-Frontend-Alpha/
├── app/                    # Next.js App Router pages
│   ├── page.tsx           # Home/Pools listing page
│   ├── swap/              # Token swap interface
│   ├── liquidity/         # Add/remove liquidity pages
│   │   └── [poolId]/      # Dynamic pool-specific liquidity management
│   └── portfolio/         # User position tracking
├── components/            # Reusable UI components
│   ├── ui/               # shadcn/ui components (Button, Dialog, etc.)
│   ├── liquidity/        # Liquidity-specific components
│   └── app-*.tsx         # App-level layout components
├── lib/                   # Core utilities and services
│   ├── wagmiConfig.ts    # Wallet connection configuration
│   ├── viemClient.ts     # Viem client setup
│   ├── rpcClient.ts      # RPC provider management
│   ├── subgraphClient.ts # GraphQL subgraph queries
│   ├── pools-config.ts   # Pool configurations
│   ├── routing-engine.ts # Swap routing logic
│   ├── swap.ts           # Swap execution utilities
│   ├── liquidity-utils.ts # Liquidity calculations
│   ├── apy-calculator.ts # APY/fee calculations
│   ├── price-service.ts  # Price fetching and formatting
│   ├── supabase.ts       # Supabase client
│   └── abis/             # Smart contract ABIs
├── hooks/                 # Custom React hooks
│   ├── useEthersSigner.ts # Wagmi to Ethers.js bridge
│   ├── use-toast.ts      # Toast notifications
│   └── use-mobile.tsx    # Mobile breakpoint detection
├── config/                # App configuration
├── types/                 # TypeScript type definitions
├── public/                # Static assets
├── interface/             # Uniswap repositories (DO NOT MODIFY)
└── middleware.ts          # Next.js middleware (auth, redirects, etc.)
```

### Key Architectural Patterns

1. **Next.js App Router**: Uses React Server Components and client components with `"use client"` directive
2. **Path Aliases**: `@/*` maps to root, `@liquidity/*` maps to `components/liquidity/*` (see tsconfig.json)
3. **Web3 Integration**: Wagmi hooks for wallet connection, Viem for contract interactions, Ethers for legacy compatibility
4. **Data Fetching**: React Query for caching, GraphQL subgraphs for on-chain data, Supabase for off-chain data
5. **Component Library**: shadcn/ui with Radix UI primitives, styled with Tailwind CSS
6. **Type Safety**: `strictNullChecks: true` but `strict: false` - be mindful of null/undefined handling

### Important Configuration Details

**TypeScript Configuration:**
- Module resolution: `bundler`
- Target: ES2020
- JSX: `preserve` (handled by Next.js)
- Strict null checks enabled, but general strict mode disabled

**Next.js Configuration:**
- TypeScript build errors are **ignored** (`ignoreBuildErrors: true`)
- Images are **unoptimized** (`unoptimized: true`)
- Experimental: Webpack build workers, parallel server builds

**Environment Variables:**
- **REQUIRED**: See `.env.local` for WalletConnect, Supabase, and Subgraph URLs
- Never commit `.env.local` to version control
- Sensitive keys: Supabase JWT secret, service role key, ReCAPTCHA keys

## Code Style & Conventions

**📖 For styling guidelines, see**: `.claude/commands/style.md`

### Import Style

```typescript
// ✅ GOOD: Use ES modules with destructuring
import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { formatUnits } from 'viem'

// ❌ AVOID: CommonJS
const React = require('react')
```

### Component Styling

```tsx
// ✅ GOOD: Use utility classes from globals.css
<div className="bg-container border-sidebar-border rounded-lg">

// ✅ GOOD: Use semantic Tailwind classes
<Button className="bg-button-primary border-sidebar-primary text-sidebar-primary">

// ❌ AVOID: Hardcoded hex colors
<div className="bg-[#131313] border-[#323232]">

// ⚠️ EXCEPTION: Pattern overlays (acceptable as inline styles)
<button 
  className="bg-button"
  style={{ backgroundImage: 'url(/pattern.svg)' }}
/>
```

### Component Patterns

```typescript
// ✅ GOOD: Functional components with TypeScript
export function PoolCard({ pool }: { pool: Pool }) {
  const [isOpen, setIsOpen] = useState(false)
  // ...
}

// ✅ GOOD: Use "use client" for interactive components
"use client"
import { useState } from 'react'

// ❌ AVOID: Class components
class PoolCard extends React.Component { }
```

### Styling

```typescript
// ✅ GOOD: Tailwind CSS with cn() utility
import { cn } from '@/lib/utils'

<div className={cn("flex items-center", isActive && "bg-primary")}>

// ✅ GOOD: Use shadcn/ui components
import { Button } from '@/components/ui/button'
<Button variant="outline" size="lg">Swap</Button>

// ❌ AVOID: Inline styles unless absolutely necessary
<div style={{ display: 'flex' }}>
```

### Web3 Patterns

```typescript
// ✅ GOOD: Use Wagmi hooks
import { useAccount, useWriteContract } from 'wagmi'
const { address, isConnected } = useAccount()

// ✅ GOOD: Use Viem for utilities
import { parseUnits, formatUnits } from 'viem'
const amount = parseUnits('1.5', 18)

// ⚠️ ACCEPTABLE: Use Ethers.js for legacy SDKs (Uniswap Universal Router)
import { useEthersSigner } from '@/hooks/useEthersSigner'
const signer = useEthersSigner()
```

### Formatting & Imports

- Use ES modules (`import`/`export`), never CommonJS (`require`)
- Destructure imports when reasonable
- Keep imports sorted by groups (node/builtins, external, internal) if editing nearby code
- Follow existing Tailwind class patterns; prefer `cn()` util for conditional classes

## Workflow & Git Conventions

### Branch Naming

Based on repository branches, use these patterns:
- `feat/feature-name` - New features (e.g., `feat/betav1.1`)
- `temp-vX.X.X` - Temporary version branches (e.g., `temp-v1.2.1`)
- `cursor/*` or `background_agent` - AI-assisted development branches

**Main branch**: `master`

### Commit Messages

Based on recent commits, follow this style:
- Use descriptive, imperative mood: `feat APY Calculator`, `Pool Range Type Names`
- For cleanup: `init, feat clean`
- For merges: `Merge branch 'temp-v1.2'`, `Merge v1.2.1`
- For fixes: `Recaptcha Hotfix`
- Separate concerns: `Realignment Pool Detail Page, Standard Pool Naming`

**Format**: `[type] Description` or simple `Description`
- Types: `feat`, `fix`, `init`, `Merge`
- Keep it concise and clear

### Before Committing

**YOU MUST complete all of the following before committing:**

1. **Type checking**: Run `npx tsc --noEmit` and fix all errors
2. **Manual testing**: Test critical paths (swap, liquidity add/remove, wallet connection)
3. **Security review**: Verify no sensitive data from `.env.local` is exposed
4. **File review**: Examine all modified files in git diff
5. **Fantom testnet verification**: Confirm changes work on testnet before merging to production

### Pull Requests

- Target branch: `master`
- Ensure all CI checks pass (if configured)
- Test on Fantom testnet before merging to production
- Small, focused PRs are preferred; request review early if risky
- Rebase small local fixups before opening PR; prefer merge commits for release branches

### Repository Etiquette

- Prefer rebase for local cleanup; allow merge commits when integrating release/version branches
- Keep branch names descriptive and scoped (`feat/`, `fix/`, `chore/`)
- Provide clear PR descriptions: what/why, screenshots for UI
- Code review: be specific, reference files/lines; authors address all comments or justify

## Common Development Tasks

### Adding a New Pool

1. Update `lib/pools-config.ts` with pool configuration
2. Add pool metadata (tokens, fee tier, tick spacing)
3. Update GraphQL queries if needed in `lib/subgraphClient.ts`
4. Test liquidity add/remove flows

### Implementing New Swap Routes

1. Update `lib/routing-engine.ts` with routing logic
2. Modify `lib/swap.ts` for execution
3. Update `lib/swap-constants.ts` if new constants needed
4. Use Universal Router SDK from `@uniswap/universal-router-sdk`

### Adding UI Components

1. Use shadcn/ui when possible: `npx shadcn@latest add [component]`
2. Place custom components in `components/`
3. Use Tailwind classes with `cn()` utility
4. Follow existing patterns in similar components

### Working with Subgraphs

```typescript
// Query patterns in lib/subgraphClient.ts
import { gql, request } from 'graphql-request'

const query = gql`
  query GetPools {
    pools {
      id
      token0 { symbol }
      token1 { symbol }
    }
  }
`
const data = await request(SUBGRAPH_URL, query)
```

**Subgraph endpoints**:
- Primary: `SUBGRAPH_URL` (Satsuma Marinita)
- Secondary: `SUBGRAPH_URL_DAI` (Satsuma Marinelia)

### Debugging Web3 Transactions

1. Check wallet connection: Verify AppKit is properly initialized
2. Check network: Ensure user is on Fantom testnet
3. Check RPC: Monitor `lib/rpcClient.ts` for rate limiting
4. Check contract ABIs: Located in `lib/abis/`
5. Use browser console and wallet transaction history

## Known Issues & Gotchas

**IMPORTANT**: Read these carefully to avoid common pitfalls.

1. **TypeScript Errors Are Suppressed**: `next.config.mjs` ignores build errors. **YOU MUST** always run `npx tsc --noEmit` manually.

2. **Image Optimization Disabled**: Images are unoptimized - be mindful of file sizes.

3. **Strict Mode Disabled**: TypeScript strict mode is off except for null checks. Write defensive code.

4. **Testing Infrastructure Removed**: Tests were recently removed from the codebase. If adding tests:
   - Use Vitest (already in devDependencies)
   - Use Playwright for E2E
   - Create tests in `tests/` directory

5. **Environment Variables**:
   - Never commit `.env.local`
   - Maintenance mode: Controlled by `NEXT_PUBLIC_MAINTENANCE`
   - ReCAPTCHA keys are project-specific

6. **Uniswap Interface Folder**:
   - Located at `interface/`
   - Contains public Uniswap repos (web, mobile, extension, packages)
   - **YOU MUST NOT MODIFY** unless explicitly working on Uniswap integration
   - All Alphix-specific development occurs outside this folder

7. **Ethers.js v5 Compatibility**:
   - Stuck on Ethers v5 due to Uniswap SDK compatibility
   - Use Viem for new code when possible
   - Use `useEthersSigner` hook to bridge Wagmi → Ethers

8. **Rate Limiting**:
   - RPC calls are rate-limited via `lib/rateLimiter.ts`
   - Retry logic in `lib/retry-utility.ts`
   - Monitor `lib/logger.ts` for issues

9. **Cache Management**:
   - Client-side caching in `lib/client-cache.ts`
   - Cache version tracking in `lib/cache-version.ts`
   - Invalidation logic in `lib/invalidation.ts`

## Developer Environment

- Use a Node version manager (nvm/volta). Required: Node v22.12.0
- Install dependencies with `npm ci` in CI; `npm install` locally
- Ensure `.env.local` is present before `npm run dev`

## File Locations & Priority (Claude Project Memory)

- **Project memory**: `./CLAUDE.md` (this file) — checked into Git for team-wide guidance
- **Style Guide**: `.claude/commands/style.md` — comprehensive styling guidelines (colors, components, patterns)
- **User memory**: `~/.claude/CLAUDE.md` — optional, personal preferences across projects
- **Recursive precedence**: Claude searches parent/child `CLAUDE.md` files and prioritizes the most specific/nested file

## Development Best Practices

1. **Type Safety**: Always define proper TypeScript types, even with strict mode disabled.

2. **Error Handling**: Use try-catch blocks, especially for Web3 operations. Log errors via `lib/logger.ts`.

3. **Performance**:
   - Use React Query for data fetching and caching
   - Implement proper loading states
   - Optimize re-renders with `useMemo` and `useCallback`

4. **Security**:
   - Never expose private keys or sensitive API keys
   - Validate user inputs (see `lib/validation.ts`)
   - Use ReCAPTCHA for sensitive operations

5. **Accessibility**: shadcn/ui components are accessible by default. Maintain this standard.

6. **Mobile Responsiveness**: Use `use-mobile` hook and Tailwind responsive classes.

7. **Web3 Best Practices**:
   - Always check wallet connection before transactions
   - Provide clear transaction feedback
   - Handle transaction failures gracefully
   - Show gas estimates when possible

## Additional Resources

- Next.js 15 Docs: https://nextjs.org/docs
- Wagmi Docs: https://wagmi.sh
- Viem Docs: https://viem.sh
- Uniswap V4 Docs: https://docs.uniswap.org/contracts/v4/overview
- shadcn/ui Docs: https://ui.shadcn.com
- TanStack Query Docs: https://tanstack.com/query/latest

## About This File

This CLAUDE.md file is located at the repository root and applies to all Alphix-specific code (everything except the `interface/` folder). When working with code in the `interface/` folder, refer to its own CLAUDE.md and AGENTS.md files which contain Uniswap-specific conventions.

Claude will recursively search for CLAUDE.md files and prioritize the most specific/nested ones. This root-level file should be checked into Git for team sharing.

---

**Last Updated**: October 2025 (v1.2.1)
