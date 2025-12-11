import { withSentryConfig } from "@sentry/nextjs";
import { execSync } from 'child_process';
import { readFileSync } from 'fs';

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
    viewTransitions: true,
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

export default withSentryConfig(nextConfig, {
  // Minimal Sentry build options
  silent: true, // Suppress Sentry build logs
  hideSourceMaps: true, // Don't expose source maps publicly

  // Disable automatic instrumentation (we only want error capture)
  disableLogger: true,
});
