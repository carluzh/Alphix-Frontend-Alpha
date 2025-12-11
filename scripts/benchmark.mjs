#!/usr/bin/env node
/**
 * Performance Benchmark Script
 *
 * Tests FCP, LCP, TTFB, and other Core Web Vitals against a production URL.
 *
 * Usage:
 *   node scripts/benchmark.mjs https://your-production-url.vercel.app
 *   node scripts/benchmark.mjs https://your-production-url.vercel.app --runs=5
 *   node scripts/benchmark.mjs https://your-production-url.vercel.app --mobile
 */

import lighthouse from 'lighthouse';
import puppeteer from 'puppeteer';
import { writeFileSync, existsSync, readFileSync } from 'fs';

const args = process.argv.slice(2);
const url = args.find(arg => arg.startsWith('http'));
const runsArg = args.find(arg => arg.startsWith('--runs='));
const runs = runsArg ? parseInt(runsArg.split('=')[1]) : 3;
const isMobile = args.includes('--mobile');
const saveReport = args.includes('--save');

if (!url) {
  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║                    LIGHTHOUSE BENCHMARK TOOL                      ║
╚══════════════════════════════════════════════════════════════════╝

Usage:
  node scripts/benchmark.mjs <URL> [options]

Examples:
  node scripts/benchmark.mjs https://alphix.vercel.app
  node scripts/benchmark.mjs https://alphix.vercel.app --runs=5
  node scripts/benchmark.mjs https://alphix.vercel.app --mobile
  node scripts/benchmark.mjs https://alphix.vercel.app --save

Options:
  --runs=N    Number of test runs (default: 3)
  --mobile    Test mobile viewport (default: desktop)
  --save      Save results to benchmark-results.json
`);
  process.exit(1);
}

console.log(`
╔══════════════════════════════════════════════════════════════════╗
║                    LIGHTHOUSE BENCHMARK                           ║
╚══════════════════════════════════════════════════════════════════╝

Target URL: ${url}
Device:     ${isMobile ? 'Mobile' : 'Desktop'}
Runs:       ${runs}
`);

// Metrics we care about
const METRICS = [
  { key: 'first-contentful-paint', name: 'FCP (First Contentful Paint)', unit: 's' },
  { key: 'largest-contentful-paint', name: 'LCP (Largest Contentful Paint)', unit: 's' },
  { key: 'server-response-time', name: 'TTFB (Time to First Byte)', unit: 'ms' },
  { key: 'speed-index', name: 'Speed Index', unit: 's' },
  { key: 'total-blocking-time', name: 'TBT (Total Blocking Time)', unit: 'ms' },
  { key: 'cumulative-layout-shift', name: 'CLS (Cumulative Layout Shift)', unit: '' },
  { key: 'interactive', name: 'TTI (Time to Interactive)', unit: 's' },
];

async function runLighthouse(url, port, isMobile) {
  const config = {
    extends: 'lighthouse:default',
    settings: {
      formFactor: isMobile ? 'mobile' : 'desktop',
      screenEmulation: isMobile ? {
        mobile: true,
        width: 375,
        height: 667,
        deviceScaleFactor: 2,
      } : {
        mobile: false,
        width: 1350,
        height: 940,
        deviceScaleFactor: 1,
      },
      throttling: isMobile ? {
        // Simulated slow 4G
        rttMs: 150,
        throughputKbps: 1638.4,
        cpuSlowdownMultiplier: 4,
      } : {
        // Simulated fast connection (but not unrealistic)
        rttMs: 40,
        throughputKbps: 10240,
        cpuSlowdownMultiplier: 1,
      },
      onlyCategories: ['performance'],
    },
  };

  const result = await lighthouse(url, {
    port,
    output: 'json',
    logLevel: 'error',
  }, config);

  return result.lhr;
}

function extractMetrics(lhr) {
  const metrics = {};

  for (const metric of METRICS) {
    const audit = lhr.audits[metric.key];
    if (audit) {
      metrics[metric.key] = {
        name: metric.name,
        value: audit.numericValue,
        displayValue: audit.displayValue,
        score: audit.score,
        unit: metric.unit,
      };
    }
  }

  // Also get performance score
  metrics.performanceScore = Math.round(lhr.categories.performance.score * 100);

  return metrics;
}

function formatValue(value, unit) {
  if (unit === 's') return `${(value / 1000).toFixed(2)}s`;
  if (unit === 'ms') return `${Math.round(value)}ms`;
  if (unit === '') return value.toFixed(3);
  return value;
}

function getScoreColor(score) {
  if (score >= 0.9) return '\x1b[32m'; // Green
  if (score >= 0.5) return '\x1b[33m'; // Yellow
  return '\x1b[31m'; // Red
}

function getValueColor(key, value) {
  const thresholds = {
    'first-contentful-paint': { good: 1800, poor: 3000 },
    'largest-contentful-paint': { good: 2500, poor: 4000 },
    'server-response-time': { good: 800, poor: 1800 },
    'speed-index': { good: 3400, poor: 5800 },
    'total-blocking-time': { good: 200, poor: 600 },
    'cumulative-layout-shift': { good: 0.1, poor: 0.25 },
    'interactive': { good: 3800, poor: 7300 },
  };

  const t = thresholds[key];
  if (!t) return '\x1b[0m';

  if (value <= t.good) return '\x1b[32m'; // Green
  if (value <= t.poor) return '\x1b[33m'; // Yellow
  return '\x1b[31m'; // Red
}

async function main() {
  const allResults = [];

  // Launch browser once
  console.log('Launching browser...\n');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  const port = new URL(browser.wsEndpoint()).port;

  for (let i = 0; i < runs; i++) {
    console.log(`\x1b[36mRun ${i + 1}/${runs}...\x1b[0m`);

    try {
      const lhr = await runLighthouse(url, port, isMobile);
      const metrics = extractMetrics(lhr);
      allResults.push(metrics);

      console.log(`  Performance Score: ${getScoreColor(metrics.performanceScore / 100)}${metrics.performanceScore}\x1b[0m`);
      console.log(`  FCP: ${formatValue(metrics['first-contentful-paint']?.value || 0, 's')}`);
      console.log(`  LCP: ${formatValue(metrics['largest-contentful-paint']?.value || 0, 's')}`);
      console.log('');
    } catch (err) {
      console.error(`  Error: ${err.message}`);
    }
  }

  await browser.close();

  if (allResults.length === 0) {
    console.log('\x1b[31mNo successful runs!\x1b[0m');
    process.exit(1);
  }

  // Calculate averages
  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║                         RESULTS                                   ║
╚══════════════════════════════════════════════════════════════════╝
`);

  const avgScores = allResults.reduce((sum, r) => sum + r.performanceScore, 0) / allResults.length;
  console.log(`Performance Score: ${getScoreColor(avgScores / 100)}${Math.round(avgScores)}/100\x1b[0m (avg of ${runs} runs)\n`);

  console.log('┌────────────────────────────────────┬──────────────┬──────────┐');
  console.log('│ Metric                             │ Average      │ Target   │');
  console.log('├────────────────────────────────────┼──────────────┼──────────┤');

  const targets = {
    'first-contentful-paint': '< 1.8s',
    'largest-contentful-paint': '< 2.5s',
    'server-response-time': '< 800ms',
    'speed-index': '< 3.4s',
    'total-blocking-time': '< 200ms',
    'cumulative-layout-shift': '< 0.1',
    'interactive': '< 3.8s',
  };

  const averages = {};

  for (const metric of METRICS) {
    const values = allResults.map(r => r[metric.key]?.value).filter(v => v !== undefined);
    if (values.length === 0) continue;

    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    averages[metric.key] = avg;

    const color = getValueColor(metric.key, avg);
    const formatted = formatValue(avg, metric.unit);
    const target = targets[metric.key] || '—';

    console.log(`│ ${metric.name.padEnd(34)} │ ${color}${formatted.padEnd(12)}\x1b[0m │ ${target.padEnd(8)} │`);
  }

  console.log('└────────────────────────────────────┴──────────────┴──────────┘');

  // Save results if requested
  if (saveReport) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `benchmark-results.json`;

    let history = [];
    if (existsSync(filename)) {
      try {
        history = JSON.parse(readFileSync(filename, 'utf-8'));
      } catch {}
    }

    history.push({
      timestamp: new Date().toISOString(),
      url,
      device: isMobile ? 'mobile' : 'desktop',
      runs,
      performanceScore: Math.round(avgScores),
      metrics: averages,
    });

    writeFileSync(filename, JSON.stringify(history, null, 2));
    console.log(`\n✓ Results saved to ${filename}`);
  }

  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║                      QUICK DIAGNOSIS                              ║
╚══════════════════════════════════════════════════════════════════╝
`);

  const fcp = averages['first-contentful-paint'] / 1000;
  const lcp = averages['largest-contentful-paint'] / 1000;
  const ttfb = averages['server-response-time'];
  const tbt = averages['total-blocking-time'];

  if (fcp > 3) {
    console.log('\x1b[31m✗ FCP is very slow (>3s)\x1b[0m');
    console.log('  → Large JS bundle blocking render');
    console.log('  → Consider code splitting and lazy loading');
  } else if (fcp > 1.8) {
    console.log('\x1b[33m⚠ FCP needs improvement (>1.8s)\x1b[0m');
  } else {
    console.log('\x1b[32m✓ FCP is good\x1b[0m');
  }

  if (lcp > 4) {
    console.log('\x1b[31m✗ LCP is very slow (>4s)\x1b[0m');
    console.log('  → Large images without optimization');
    console.log('  → Add priority prop to hero images');
  } else if (lcp > 2.5) {
    console.log('\x1b[33m⚠ LCP needs improvement (>2.5s)\x1b[0m');
  } else {
    console.log('\x1b[32m✓ LCP is good\x1b[0m');
  }

  if (ttfb > 1800) {
    console.log('\x1b[31m✗ TTFB is very slow (>1.8s)\x1b[0m');
    console.log('  → Server-side rendering taking too long');
    console.log('  → Consider static generation or ISR');
  } else if (ttfb > 800) {
    console.log('\x1b[33m⚠ TTFB needs improvement (>800ms)\x1b[0m');
  } else {
    console.log('\x1b[32m✓ TTFB is good\x1b[0m');
  }

  if (tbt > 600) {
    console.log('\x1b[31m✗ TBT is very high (>600ms)\x1b[0m');
    console.log('  → JavaScript blocking main thread');
    console.log('  → Heavy libraries (framer-motion, recharts, Web3)');
  } else if (tbt > 200) {
    console.log('\x1b[33m⚠ TBT needs improvement (>200ms)\x1b[0m');
  } else {
    console.log('\x1b[32m✓ TBT is good\x1b[0m');
  }

  console.log('');
}

main().catch(console.error);
