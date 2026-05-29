import { withSentryConfig } from "@sentry/nextjs";
import bundleAnalyzer from '@next/bundle-analyzer';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { createRequire } from 'module';

// Create require for ESM compatibility (needed for require.resolve in webpack config)
const require = createRequire(import.meta.url);

// Bundle analyzer - run with ANALYZE=true npm run build
const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
});

// Get version from package.json and git commit hash at build time
const pkg = JSON.parse(readFileSync('./package.json', 'utf8'));
const appVersion = pkg.version || '0.0.0';

let gitCommitHash = 'dev';
try {
  gitCommitHash = execSync('git rev-parse --short HEAD').toString().trim();
} catch {
  // If git is not available, use 'dev'
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: appVersion,
    NEXT_PUBLIC_GIT_COMMIT: gitCommitHash,
  },
  webpack: (config, { isServer }) => {
    config.resolve = config.resolve || {};
    config.resolve.alias = config.resolve.alias || {};
    // SDK deduplication - identical to Uniswap vite.config.mts dedupe
    const sdkDedupe = ['@uniswap/sdk-core', '@uniswap/v4-sdk', '@uniswap/universal-router-sdk', 'jsbi'];
    sdkDedupe.forEach(pkg => { config.resolve.alias[pkg] = require.resolve(pkg); });
    config.resolve.alias['@react-native-async-storage/async-storage'] = false;
    config.ignoreWarnings = [{ module: /@whatwg-node\/fetch/ }];

    // SVGR: handle `*.svg` imports as React components for the vendored Kyber widget.
    // Supports the `?url` query suffix the widget uses for URL-as-string imports.
    config.module.rules.push(
      {
        test: /\.svg$/i,
        type: 'asset/resource',
        resourceQuery: /url/, // *.svg?url → URL string
      },
      {
        test: /\.svg$/i,
        issuer: /\.[jt]sx?$/,
        resourceQuery: { not: [/url/] }, // default → React component
        use: ['@svgr/webpack'],
      },
    );

    // Fix WalletConnect ESM/CommonJS interop issues in serverless functions
    // These packages use CommonJS but get imported as ESM, causing named export errors
    if (isServer) {
      const walletConnectExternals = [
        '@walletconnect/logger',
        '@walletconnect/core',
        '@walletconnect/sign-client',
        '@walletconnect/ethereum-provider',
        '@walletconnect/universal-provider',
        'pino',
        'pino-pretty',
      ];
      config.externals = config.externals || [];
      if (Array.isArray(config.externals)) {
        config.externals.push(...walletConnectExternals);
      }
    }

    return config;
  },
  typescript: {
    // Build errors are now enforced - fix type issues instead of ignoring them
    ignoreBuildErrors: false,
  },
  images: {
    // Enable Next.js image optimization (WebP conversion, responsive sizes)
    unoptimized: false,
    formats: ['image/avif', 'image/webp'],
    // Allow external images from CoinGecko for token logos
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'assets.coingecko.com',
        pathname: '/coins/images/**',
      },
      {
        protocol: 'https',
        hostname: 'coin-images.coingecko.com',
        pathname: '/coins/images/**',
      },
    ],
  },
  experimental: {
    webpackBuildWorker: true,
    parallelServerBuildTraces: true,
    parallelServerCompiles: true,
    // Optimize chunking for smaller bundles
    optimizePackageImports: ['@uniswap/sdk-core', '@uniswap/v4-sdk', 'viem', 'wagmi', '@tanstack/react-query'],
  },
  // Exclude WalletConnect packages from Turbopack bundling due to incompatible test files
  serverExternalPackages: [
    'pino',
    'thread-stream',
    '@walletconnect/core',
    '@walletconnect/sign-client',
    '@walletconnect/ethereum-provider',
    '@walletconnect/universal-provider',
    '@walletconnect/logger',
  ],
}

// Wrap with bundle analyzer, then Sentry.
// Source-map upload is env-gated: the bundler plugin auto-reads SENTRY_ORG,
// SENTRY_PROJECT, and SENTRY_AUTH_TOKEN from the environment and self-activates
// upload once all three are set (e.g. in CI / Vercel). No explicit org/project/
// authToken options needed here.
export default withSentryConfig(withBundleAnalyzer(nextConfig), {
  silent: true,
  // Route Sentry events through our own domain so adblockers / Brave shields /
  // privacy DNS don't silently drop them. Crypto-savvy users frequently block
  // *.ingest.sentry.io directly.
  tunnelRoute: '/monitoring',

  // Webpack-level Sentry options (new API)
  webpack: {
    // Edge runtime doesn't allow eval()/new Function() - platform limitation, not a bug
    // Sentry's middleware instrumentation relies on dynamic code generation internally
    autoInstrumentMiddleware: false,
    treeshake: {
      removeDebugLogging: true,
    },
  },
});
