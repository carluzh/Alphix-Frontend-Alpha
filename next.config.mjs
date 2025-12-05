import { withSentryConfig } from "@sentry/nextjs";

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
    viewTransitions: true,
  },
}

export default withSentryConfig(nextConfig, {
  // Minimal Sentry build options
  silent: true, // Suppress Sentry build logs
  hideSourceMaps: true, // Don't expose source maps publicly

  // Disable automatic instrumentation (we only want error capture)
  disableLogger: true,
});
