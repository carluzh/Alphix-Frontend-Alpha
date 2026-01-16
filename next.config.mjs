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

// Get version from version-log.ts (single source of truth) and git commit hash at build time
const versionLogContent = readFileSync('./lib/version-log.ts', 'utf8');
const versionMatch = versionLogContent.match(/version:\s*["']([^"']+)["']/);
const appVersion = versionMatch ? versionMatch[1] : '0.0.0';

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
  webpack: (config) => {
    config.resolve = config.resolve || {};
    config.resolve.alias = config.resolve.alias || {};
    // SDK deduplication - identical to Uniswap vite.config.mts dedupe
    const sdkDedupe = ['@uniswap/sdk-core', '@uniswap/v4-sdk', '@uniswap/universal-router-sdk', 'jsbi'];
    sdkDedupe.forEach(pkg => { config.resolve.alias[pkg] = require.resolve(pkg); });
    config.resolve.alias['@react-native-async-storage/async-storage'] = false;
    config.ignoreWarnings = [{ module: /@whatwg-node\/fetch/ }];
    return config;
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    // Enable Next.js image optimization (WebP conversion, responsive sizes)
    unoptimized: false,
    formats: ['image/avif', 'image/webp'],
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

// Wrap with bundle analyzer, then Sentry
export default withSentryConfig(withBundleAnalyzer(nextConfig), {
  silent: true,
  hideSourceMaps: true,

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
