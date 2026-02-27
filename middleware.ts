import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

const ALLOWED_ORIGINS = [
  'https://alphix.io',
  'https://www.alphix.io',
  'https://app.alphix.io',
  'https://testnet.alphix.io',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

// CSP configuration - wildcards used for RPC providers to support NEXT_PUBLIC_RPC_URL flexibility
const BASE_CSP: Record<string, string[]> = {
  'default-src': ["'self'"],
  'script-src': IS_PRODUCTION
    ? ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'", "https://va.vercel-scripts.com", "https://vercel.live"]
    : ["'self'", "'unsafe-inline'", "'unsafe-eval'", "'wasm-unsafe-eval'", "https://va.vercel-scripts.com", "https://vercel.live"],
  'style-src': ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://fonts.gstatic.com"],
  'font-src': ["'self'", "https://fonts.googleapis.com", "https://fonts.gstatic.com"],
  'img-src': ["*", "blob:", "data:"],
  'media-src': ["'self'"],
  'frame-src': ["'self'", "https://verify.walletconnect.com", "https://verify.walletconnect.org"],
  'form-action': ["'none'"],
  'connect-src': [
    "'self'", "blob:", "data:",
    // RPC providers (wildcards for flexibility with NEXT_PUBLIC_RPC_URL)
    "https://*.alchemy.com",
    "https://*.infura.io",
    "https://*.drpc.org",
    "https://*.drpc.live",
    "https://*.publicnode.com",
    "https://*.quiknode.pro",
    "https://mainnet.base.org",
    "https://sepolia.base.org",
    "https://1rpc.io",
    "https://rpc.ankr.com",
    "https://cloudflare-eth.com",
    // WalletConnect
    "https://*.walletconnect.com",
    "https://*.walletconnect.org",
    "wss://relay.walletconnect.com",
    "wss://relay.walletconnect.org",
    "https://api.web3modal.org",
    "https://api.web3modal.com",
    // Coinbase
    "https://*.coinbase.com",
    "wss://www.walletlink.org",
    // Alphix
    "https://api.alphix.fi",
    "wss://api.alphix.fi",
    "https://api.goldsky.com",
    "https://gateway.thegraph.com",
    // Data providers
    "https://api.coingecko.com",
    "https://pro-api.coingecko.com",
    "https://raw.githubusercontent.com",
    "https://ipfs.io",
    "https://gateway.ipfs.io",
    "https://cloudflare-ipfs.com",
    // Upstash (client-side points/cache - wildcard required for dynamic subdomains)
    "https://*.upstash.io",
    // Monitoring
    "https://o4510478966980608.ingest.de.sentry.io",
    "https://sentry.io",
    // Vercel
    "https://vercel.com",
    "https://vercel.live",
    "https://va.vercel-scripts.com",
    // Dev only
    ...(IS_PRODUCTION ? [] : [
      "http://127.0.0.1:8545",
      "http://localhost:8545",
      "http://localhost:3001",
      "ws://localhost:3000",
      "ws://localhost:3001",
      "ws://34.60.82.34:3001",
    ]),
  ],
  'worker-src': ["'self'", "blob:"],
  'frame-ancestors': ["'none'"],
  'base-uri': ["'self'"],
  'object-src': ["'none'"],
  'upgrade-insecure-requests': [],
};

const CSP_HEADER = Object.entries(BASE_CSP)
  .map(([key, values]) => values.length === 0 ? key : `${key} ${values.join(' ')}`)
  .join('; ');

function addSecurityHeaders(response: NextResponse): void {
  response.headers.set('Content-Security-Policy', CSP_HEADER);
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-XSS-Protection', '1; mode=block');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  if (IS_PRODUCTION) {
    response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }
}

export function middleware(request: NextRequest) {
  if (!IS_PRODUCTION && request.nextUrl.searchParams.get('e2e') === 'true') {
    return NextResponse.next();
  }

  if (request.method === 'OPTIONS') {
    const res = new NextResponse(null, { status: 204 });
    const origin = request.headers.get('origin');
    if (origin && (ALLOWED_ORIGINS.includes(origin) || !IS_PRODUCTION)) {
      res.headers.set('Access-Control-Allow-Origin', origin);
    }
    res.headers.set('Vary', 'Origin');
    res.headers.set('Access-Control-Allow-Credentials', 'true');
    res.headers.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.headers.set('Access-Control-Allow-Headers', request.headers.get('access-control-request-headers') || 'Content-Type, Authorization');
    addSecurityHeaders(res);
    return res;
  }

  const createSecureResponse = (type: 'next' | 'rewrite' | 'redirect', url?: URL) => {
    const response = type === 'next' ? NextResponse.next()
      : type === 'rewrite' && url ? NextResponse.rewrite(url)
      : type === 'redirect' && url ? NextResponse.redirect(url)
      : NextResponse.next();
    addSecurityHeaders(response);
    return response;
  };

  const hostname = request.headers.get('host') || '';
  const url = request.nextUrl.clone();

  if (hostname.startsWith('brands.')) {
    url.pathname = '/brand';
    return createSecureResponse('rewrite', url);
  }

  const { pathname } = request.nextUrl;
  const maintenanceEnabled = process.env.MAINTENANCE === 'true';

  if (pathname === '/' || pathname === '/brand') {
    return createSecureResponse('next');
  }

  if (maintenanceEnabled) {
    if (pathname.startsWith('/maintenance') ||
        pathname.startsWith('/api/maintenance-status') || pathname.startsWith('/_next') ||
        pathname.includes('.')) {
      return createSecureResponse('next');
    }
    return createSecureResponse('redirect', new URL('/maintenance', request.url));
  }

  return createSecureResponse('next');
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|favicon.png).*)'],
};
