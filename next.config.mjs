/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  experimental: {
    webpackBuildWorker: true,
    parallelServerBuildTraces: true,
    parallelServerCompiles: true,
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

export default nextConfig