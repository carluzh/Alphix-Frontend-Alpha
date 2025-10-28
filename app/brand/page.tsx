'use client';

import { useState, useRef, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Menu, X, Download, Copy, Check, Clock4 } from "lucide-react";
import { toast } from "sonner";
import { useRouter, usePathname } from 'next/navigation';
import { NavPopover, NavPopoverSection } from "@/components/NavPopover";
import Link from 'next/link';
import { getLatestVersion, getLatestVersionSummary, getTimeAgo } from "@/lib/version-log";

export default function BrandsPage() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [copiedItems, setCopiedItems] = useState<Set<string>>(new Set());

  const copyToClipboard = async (text: string, itemId: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedItems(prev => new Set(prev).add(itemId));
      toast.success("Copied to clipboard!");
      setTimeout(() => {
        setCopiedItems(prev => {
          const newSet = new Set(prev);
          newSet.delete(itemId);
          return newSet;
        });
      }, 2000);
    } catch (error) {
      toast.error("Failed to copy");
    }
  };

  const colors = [
    { name: "Primary Orange", hex: "#F87316" },
    { name: "Brand Orange", hex: "#f45502" },
    { name: "Background Dark", hex: "#0A0908" },
    { name: "Surface", hex: "#1E1D1B" },
  ];

  const fonts = [
    {
      name: "Inter",
      description: "Primary font for UI and content",
      link: "https://fonts.google.com/specimen/Inter",
      sample: "The quick brown fox jumps over the lazy dog"
    },
    {
      name: "Consolas",
      description: "Monospace font for code and badges",
      link: "https://fonts.adobe.com/fonts/consolas",
      sample: "console.log('Hello World');"
    }
  ];

  const handleCopyEmail = async () => {
    try {
      await navigator.clipboard.writeText('contact@alphix.fi');
      toast.success("Email Address Copied!");
    } catch (error) {
      // Fallback for older browsers
      const textArea = document.createElement("textarea");
      textArea.value = 'contact@alphix.fi';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      try {
        document.execCommand('copy');
        toast.success("Email Address Copied!");
      } catch (fallbackError) {
        toast.error("Failed to copy email address");
      }
      document.body.removeChild(textArea);
    }
  };

  return (
    <div className="bg-black min-h-screen" style={{background: '#0a0908'}}>
      {/* Navbar */}
      <Navbar
        showNavbar={true}
        isMobileMenuOpen={isMobileMenuOpen}
        setIsMobileMenuOpen={setIsMobileMenuOpen}
      />

      {/* Main Content */}
      <main className="relative z-30 pt-20">
        {/* Logos Section */}
        <section className="w-full max-w-5xl 2xl:max-w-screen-xl mx-auto pt-20 pb-12 px-4 sm:px-6 md:px-8">
          <div className="mb-12">
            <h2 className="text-3xl font-medium text-white mb-4" style={{ fontFamily: 'Inter, sans-serif', fontWeight: 500 }}>
              Logos
            </h2>
            <p className="text-white/65" style={{ fontFamily: 'Inter, sans-serif' }}>
              High-quality logo variants for different use cases and backgrounds.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            {/* Logo Type White */}
            <div className="bg-[#1e1d1b] rounded-lg p-8 border border-white/5 group relative">
              <div className="bg-black rounded-lg p-8 mb-4 flex items-center justify-center aspect-square relative">
                <img
                  src="/Logo Type (white).svg"
                  alt="Alphix Logo White"
                  className="h-8 w-auto"
                />
                <a
                  href="/Logo Type (white).svg"
                  download="alphix-logo-white.svg"
                  className="absolute inset-0 flex items-center justify-center bg-black/80 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer rounded-lg"
                >
                  <Download className="w-6 h-6 text-white" />
                </a>
              </div>
              <h3 className="text-white font-medium mb-2" style={{ fontFamily: 'Inter, sans-serif' }}>Logo Type (White)</h3>
              <p className="text-white/65 text-sm mb-0" style={{ fontFamily: 'Inter, sans-serif' }}>For dark backgrounds</p>
            </div>

            {/* Logo Type Black */}
            <div className="bg-[#1e1d1b] rounded-lg p-8 border border-white/5 group relative">
              <div className="bg-white rounded-lg p-8 mb-4 flex items-center justify-center aspect-square relative">
                <img
                  src="/Logo Type (black).svg"
                  alt="Alphix Logo Black"
                  className="h-8 w-auto"
                />
                <a
                  href="/Logo Type (black).svg"
                  download="alphix-logo-black.svg"
                  className="absolute inset-0 flex items-center justify-center bg-white/80 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer rounded-lg"
                >
                  <Download className="w-6 h-6 text-black" />
                </a>
              </div>
              <h3 className="text-white font-medium mb-2" style={{ fontFamily: 'Inter, sans-serif' }}>Logo Type (Black)</h3>
              <p className="text-white/65 text-sm mb-0" style={{ fontFamily: 'Inter, sans-serif' }}>For light backgrounds</p>
            </div>

            {/* Logo Icon White */}
            <div className="bg-[#1e1d1b] rounded-lg p-8 border border-white/5 group relative">
              <div className="bg-black rounded-lg p-8 mb-4 flex items-center justify-center aspect-square relative">
                <img
                  src="/LogoIconWhite.svg"
                  alt="Alphix Logo Icon White"
                  className="h-12 w-12"
                />
                <a
                  href="/LogoIconWhite.svg"
                  download="alphix-icon-white.svg"
                  className="absolute inset-0 flex items-center justify-center bg-black/80 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer rounded-lg"
                >
                  <Download className="w-6 h-6 text-white" />
                </a>
              </div>
              <h3 className="text-white font-medium mb-2" style={{ fontFamily: 'Inter, sans-serif' }}>Logo Icon (White)</h3>
              <p className="text-white/65 text-sm mb-0" style={{ fontFamily: 'Inter, sans-serif' }}>Standalone mark</p>
            </div>

            {/* Logo Icon Black */}
            <div className="bg-[#1e1d1b] rounded-lg p-8 border border-white/5 group relative">
              <div className="bg-white rounded-lg p-8 mb-4 flex items-center justify-center aspect-square relative">
                <img
                  src="/LogoIconBlack.svg"
                  alt="Alphix Logo Icon Black"
                  className="h-12 w-12"
                />
                <a
                  href="/LogoIconBlack.svg"
                  download="alphix-icon-black.svg"
                  className="absolute inset-0 flex items-center justify-center bg-white/80 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer rounded-lg"
                >
                  <Download className="w-6 h-6 text-black" />
                </a>
              </div>
              <h3 className="text-white font-medium mb-2" style={{ fontFamily: 'Inter, sans-serif' }}>Logo Icon (Black)</h3>
              <p className="text-white/65 text-sm mb-0" style={{ fontFamily: 'Inter, sans-serif' }}>Standalone mark</p>
            </div>
          </div>
        </section>

        {/* Colors Section */}
        <section className="w-full max-w-5xl 2xl:max-w-screen-xl mx-auto py-12 px-4 sm:px-6 md:px-8">
          <div className="mb-12">
            <h2 className="text-3xl font-medium text-white mb-4" style={{ fontFamily: 'Inter, sans-serif', fontWeight: 500 }}>
              Color Palette
            </h2>
            <p className="text-white/65" style={{ fontFamily: 'Inter, sans-serif' }}>
              Primary colors that define the Alphix visual identity.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {colors.map((color, index) => (
              <div key={index} className="bg-[#1e1d1b] rounded-lg p-6 border border-white/5">
                <div
                  className={`w-full h-20 rounded-lg mb-4 ${color.name === 'Surface' ? 'border border-white/20' : ''}`}
                  style={{ backgroundColor: color.hex }}
                />
                <h3 className="text-white font-medium mb-2" style={{ fontFamily: 'Inter, sans-serif' }}>
                  {color.name}
                </h3>
                <div className="flex items-center gap-2">
                  <code className="text-white/80 bg-black/30 px-2 py-1 rounded text-sm font-mono">
                    {color.hex}
                  </code>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 w-6 p-0 text-white/60 hover:text-white hover:bg-white/10"
                    onClick={() => copyToClipboard(color.hex, `color-${index}`)}
                  >
                    {copiedItems.has(`color-${index}`) ? (
                      <Check className="w-3 h-3" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Typography Section */}
        <section className="w-full max-w-5xl 2xl:max-w-screen-xl mx-auto py-12 pb-20 px-4 sm:px-6 md:px-8">
          <div className="mb-12">
            <h2 className="text-3xl font-medium text-white mb-4" style={{ fontFamily: 'Inter, sans-serif', fontWeight: 500 }}>
              Typography
            </h2>
            <p className="text-white/65" style={{ fontFamily: 'Inter, sans-serif' }}>
              Font families used across Alphix products and communications.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {fonts.map((font, index) => (
              <div
                key={index}
                className="bg-[#1e1d1b] rounded-lg p-8 border border-white/5 cursor-pointer transition-all duration-300 hover:border-white/20 group"
                onClick={() => window.open(font.link, '_blank')}
              >
                <div className="text-left ml-4">
                  <h3 className="text-4xl text-white font-medium mb-2" style={{ fontFamily: font.name }}>
                    {font.name}
                  </h3>
                  <p className="text-white/65 text-sm mb-4" style={{ fontFamily: font.name }}>
                    {font.description}
                  </p>
                  <p className="text-white/50 text-lg" style={{ fontFamily: font.name }}>
                    {font.sample}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>

      </main>

      {/* Footer */}
      <footer className="relative text-white z-30" style={{background: '#0a0908'}}>
        {/* Horizontal divider */}
        <div className="w-full h-px bg-white/10"></div>

        <div className="w-full max-w-5xl 2xl:max-w-screen-xl mx-auto py-12 px-4 sm:px-6 md:px-8">
          <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-8">
            {/* Logo */}
            <div className="flex items-start">
              <div className="h-8 w-8">
                <img
                  src="/LogoIconWhite.svg"
                  alt="Alphix Logo Icon"
                  className="h-full w-full"
                />
              </div>
            </div>

            {/* Resources and Connect - closer together on the right */}
            <div className="flex flex-col sm:flex-row gap-8">
              {/* Resources */}
              <div>
                <h3 className="text-sm font-medium mb-4" style={{ fontFamily: 'Consolas, monospace', fontWeight: 500, color: '#a5a5a5' }}>
                  Resources
                </h3>
                <div className="space-y-3">
                  <a
                    href="/brand"
                    className="block text-sm text-[#c2c2c1] hover:text-white transition-colors cursor-pointer"
                    style={{ fontFamily: 'Inter, sans-serif' }}
                  >
                    Brand Kit
                  </a>
                </div>
              </div>

              {/* Connect */}
              <div>
                <h3 className="text-sm font-medium mb-4" style={{ fontFamily: 'Consolas, monospace', fontWeight: 500, color: '#a5a5a5' }}>
                  Connect
                </h3>
                <div className="space-y-3">
                  <button
                    onClick={handleCopyEmail}
                    className="block text-sm text-[#c2c2c1] hover:text-white transition-colors cursor-pointer text-left"
                    style={{ fontFamily: 'Inter, sans-serif' }}
                  >
                    Mail
                  </button>
                  <a
                    href="https://x.com/AlphixFi"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-sm text-[#c2c2c1] hover:text-white transition-colors cursor-pointer"
                    style={{ fontFamily: 'Inter, sans-serif' }}
                  >
                    X (Twitter)
                  </a>
                  <a
                    href="https://github.com/alphixfi"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-sm text-[#c2c2c1] hover:text-white transition-colors cursor-pointer"
                    style={{ fontFamily: 'Inter, sans-serif' }}
                  >
                    GitHub
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

// Helper component for nav links
const NavLink = ({ href, children, className, isActive: _isActive, target }: {
  href: string
  children: React.ReactNode
  className?: string
  isActive?: (pathname: string) => boolean
  target?: '_blank'
}) => {
  const pathname = usePathname()
  const isActive = _isActive ? _isActive(pathname ?? '') : (pathname ?? '').startsWith(href)
  const isExternal = href.startsWith('http')

  return (
    <Link
      href={href}
      target={isExternal ? '_blank' : target}
      prefetch
      className={`-m-1 flex items-center gap-x-2 p-1 text-gray-500 transition-colors hover:text-white focus:outline-none ${
        isActive && 'text-white'
      } ${className || ''}`}
    >
      {children}
    </Link>
  )
}

function Navbar({
  showNavbar,
  isMobileMenuOpen,
  setIsMobileMenuOpen
}: {
  showNavbar: boolean;
  isMobileMenuOpen: boolean;
  setIsMobileMenuOpen: (open: boolean) => void;
}) {
  const router = useRouter()
  const pathname = usePathname()
  const latestVersion = getLatestVersion()

  // Features popover sections
  const featuresSections: NavPopoverSection[] = [
    {
      title: 'Core',
      items: [
        {
          href: '/swap',
          label: 'Unified Pool',
          subtitle: 'Consolidate liquidity across features',
        },
      ],
    },
    {
      title: 'Products',
      items: [
        {
          href: '/swap',
          label: 'Dynamic Fees',
          subtitle: 'Adaptive fee optimization',
        },
        {
          href: '/liquidity',
          label: 'Rehypothecation',
          subtitle: 'Capital efficient liquidity',
        },
      ],
    },
  ]

  // Docs popover sections - Flipped layout: grid on left, list on right
  const docsSections: NavPopoverSection[] = [
    {
      title: 'Explore',
      items: [
        {
          href: 'https://alphix.gitbook.io/docs/',
          label: 'Overview',
          subtitle: 'Introduction to Alphix',
          target: '_blank',
        },
        {
          href: 'https://alphix.gitbook.io/docs/the-basics/architecture',
          label: 'Architecture',
          subtitle: 'System design',
          target: '_blank',
        },
        {
          href: 'https://alphix.gitbook.io/docs/quick-start',
          label: 'Quick Start',
          subtitle: 'Get started quickly',
          target: '_blank',
        },
        {
          href: 'https://alphix.gitbook.io/docs/more/support',
          label: 'Support',
          subtitle: 'Get help',
          target: '_blank',
        },
      ],
    },
    {
      title: 'Resources',
      items: [
        {
          href: 'https://github.com/alphixfi',
          label: 'GitHub',
          target: '_blank',
        },
        {
          href: '/brand',
          label: 'Brand Kit',
        },
      ],
    },
  ]

  // Security popover sections
  const securitySections: NavPopoverSection[] = [
    {
      items: [
        {
          href: '#',
          label: 'Audits',
          subtitle: 'Security audit reports',
        },
        {
          href: '#',
          label: 'Bug Bounty',
          subtitle: 'Report vulnerabilities',
        },
      ],
    },
  ]

  return (
    <>
      {/* Desktop Navigation */}
      <nav className={`hidden md:flex fixed top-0 left-0 right-0 z-50 bg-[#0a0908] transition-transform duration-300 ease-in-out ${
        showNavbar ? 'transform translate-y-0' : 'transform -translate-y-full'
      }`}>
        <div className="w-full flex flex-col items-center gap-12 py-8">
          <div className="relative flex w-full max-w-5xl 2xl:max-w-screen-xl flex-row items-center justify-between px-4 sm:px-6 md:px-8">
            {/* Logo on left - Full logo */}
            <img
              src="/Logo Type (white).svg"
              alt="Alphix"
              className="h-6 cursor-pointer"
              onClick={() => router.push('/')}
            />

            {/* Centered nav items */}
            <ul className="absolute left-1/2 mx-auto flex -translate-x-1/2 flex-row gap-x-8 text-sm text-white/60">
              <li>
                <NavPopover
                  trigger="Features"
                  sections={featuresSections}
                  isActive={(pathname ?? '').startsWith('/swap') || (pathname ?? '').startsWith('/liquidity') || (pathname ?? '').startsWith('/portfolio')}
                  featuresLayout={true}
                  footerContent={
                    <Link
                      href="/login"
                      className="group mt-2 px-3 py-2 rounded-md transition-colors hover:bg-[#1e1d1b] flex flex-col gap-y-1"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-white">
                          Beta <span className="text-white">v{latestVersion.version}</span>
                        </span>
                        <div className="flex items-center gap-1 text-white/60 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Clock4 size={11} className="flex-shrink-0" />
                          <span className="text-[10px]">{getTimeAgo(latestVersion.releaseDate)}</span>
                        </div>
                      </div>
                      <span className="text-xs text-white/60">
                        {getLatestVersionSummary()}
                      </span>
                    </Link>
                  }
                />
              </li>
              <li>
                <NavPopover
                  trigger="Docs"
                  sections={docsSections}
                  layout="flex"
                  socialLinks={[
                    { href: 'https://x.com/AlphixFi', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M16.9947 2H20.1115L13.5007 9.5L21.2209 20H15.2302L10.5 13.7L5.07938 20H1.96154L9.00025 12L1.60059 2H7.74871L11.9502 7.7L16.9947 2ZM16.0947 18.2L18.0947 18.2L6.89474 3.8L4.79474 3.8L16.0947 18.2Z" fill="currentColor"/></svg>, label: 'X (Twitter)' },
                    { href: 'https://discord.gg/alphix', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5499-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419-.019 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1568 2.4189Z" fill="currentColor"/></svg>, label: 'Discord' },
                  ]}
                />
              </li>
              <li>
                <button
                  onClick={() => toast("Coming Soon")}
                  className="-m-1 flex cursor-pointer items-center gap-x-2 px-3 py-2 transition-colors hover:text-white focus:outline-none"
                >
                  Security
                </button>
              </li>
            </ul>

            {/* Log In button on right */}
            <button
              onClick={() => router.push('/login')}
              className="text-white text-sm px-3 py-1.5 rounded-lg hover:bg-[#1e1d1b] transition-colors"
            >
              Log In
            </button>
          </div>
        </div>
      </nav>

      {/* Mobile Navigation - Simple version */}
      <nav className={`md:hidden fixed top-0 left-0 right-0 z-50 bg-[#0a0908] transition-transform duration-300 ease-in-out ${
        showNavbar ? 'transform translate-y-0' : 'transform -translate-y-full'
      }`}>
        <div className="flex w-full flex-row items-center justify-between px-6 py-6">
          <img
            src="/Logo Type (white).svg"
            alt="Alphix"
            className="h-8"
            onClick={() => router.push('/')}
          />
          <button
            className="flex items-center justify-center w-10 h-10"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          >
            {isMobileMenuOpen ? <X size={24} className="text-white" /> : <Menu size={24} className="text-white" />}
          </button>
        </div>
      </nav>

      {/* Mobile Menu */}
      {isMobileMenuOpen && (
        <div className="md:hidden fixed inset-0 z-40 bg-[#0a0908] pt-20">
          <div className="flex flex-col gap-y-6 px-6 py-2">
            <div className="flex flex-col gap-y-1">
              <NavLink href="/" isActive={(pathname) => pathname === '/'} className="text-xl tracking-tight">
                Overview
              </NavLink>
              <NavLink href="/swap" className="text-xl tracking-tight">
                Swap
              </NavLink>
              <NavLink href="/liquidity" className="text-xl tracking-tight">
                Liquidity
              </NavLink>
              <NavLink href="https://alphix.gitbook.io/docs/" target="_blank" className="text-xl tracking-tight">
                Documentation
              </NavLink>
            </div>
            <NavLink
              href="/login"
              className="text-xl tracking-tight"
            >
              Login
            </NavLink>
          </div>
        </div>
      )}
    </>
  );
}

function WebGLCanvas({ rightMargin }: { rightMargin: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const marginRef = useRef(rightMargin);
  const rafIdRef = useRef<number | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  useEffect(() => {
    marginRef.current = rightMargin;
  }, [rightMargin]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Ensure opaque canvas to avoid white flash on route transitions
    const gl =
      (canvas.getContext('webgl2', {
        alpha: false,
        antialias: true,
        powerPreference: 'high-performance',
        desynchronized: true,
        preserveDrawingBuffer: false,
      }) as WebGL2RenderingContext | null) ||
      (canvas.getContext('webgl', {
        alpha: false,
        antialias: true,
        powerPreference: 'high-performance',
        desynchronized: true,
        preserveDrawingBuffer: false,
      }) as WebGLRenderingContext | null);
    if (!gl) {
      console.error('WebGL not supported');
      return;
    }

    // Match page background to avoid any white flash
    canvas.style.backgroundColor = '#0a0908';

    // Vertex shader source
    const vertexShaderSource = `
      attribute vec2 a_position;
      attribute vec2 a_texCoord;
      varying vec2 v_texCoord;

      void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
        v_texCoord = a_texCoord;
      }
    `;

    // Fragment shader source
    const fragmentShaderSource = `
      #ifdef GL_FRAGMENT_PRECISION_HIGH
        precision highp float;
      #else
        precision mediump float;
      #endif

      uniform vec2 u_resolution;
      uniform float u_time;
      uniform bool u_pixelation;
      uniform float u_right_margin;

      varying vec2 v_texCoord;

      #define PI 3.14159265359

      // Noise functions
      float interleavedGradientNoise(in vec2 uv) {
        return fract(52.9829189 * fract(dot(uv, vec2(0.06711056, 0.00583715))));
      }

      vec3 mod289(vec3 x) {
        return x - floor(x * (1.0 / 289.0)) * 289.0;
      }

      vec4 mod289(vec4 x) {
        return x - floor(x * (1.0 / 289.0)) * 289.0;
      }

      vec4 permute(vec4 x) {
        return mod289(((x*34.0)+1.0)*x);
      }

      vec4 taylorInvSqrt(vec4 r) {
        return 1.79284291400159 - 0.85373472095314 * r;
      }

      float snoise(vec3 v) {
        const vec2  C = vec2(1.0/6.0, 1.0/3.0) ;
        const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);

        vec3 i  = floor(v + dot(v, C.yyy) );
        vec3 x0 =   v - i + dot(i, C.xxx) ;

        vec3 g = step(x0.yzx, x0.xyz);
        vec3 l = 1.0 - g;
        vec3 i1 = min( g.xyz, l.zxy );
        vec3 i2 = max( g.xyz, l.zxy );

        vec3 x1 = x0 - i1 + C.xxx;
        vec3 x2 = x0 - i2 + C.yyy;
        vec3 x3 = x0 - D.yyy;

        i = mod289(i);
        vec4 p = permute( permute( permute(
                   i.z + vec4(0.0, i1.z, i2.z, 1.0 ))
                 + i.y + vec4(0.0, i1.y, i2.y, 1.0 ))
                 + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));

        float n_ = 0.142857142857;
        vec3  ns = n_ * D.wyz - D.xzx;

        vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

        vec4 x_ = floor(j * ns.z);
        vec4 y_ = floor(j - 7.0 * x_ );

        vec4 x = x_ *ns.x + ns.yyyy;
        vec4 y = y_ *ns.x + ns.yyyy;
        vec4 h = 1.0 - abs(x) - abs(y);

        vec4 b0 = vec4( x.xy, y.xy );
        vec4 b1 = vec4( x.zw, y.zw );

        vec4 s0 = floor(b0)*2.0 + 1.0;
        vec4 s1 = floor(b1)*2.0 + 1.0;
        vec4 sh = -step(h, vec4(0.0));

        vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;
        vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww ;

        vec3 p0 = vec3(a0.xy,h.x);
        vec3 p1 = vec3(a0.zw,h.y);
        vec3 p2 = vec3(a1.xy,h.z);
        vec3 p3 = vec3(a1.zw,h.w);

        vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
        p0 *= norm.x;
        p1 *= norm.y;
        p2 *= norm.z;
        p3 *= norm.w;

        vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
        m = m * m;
        return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1),
                                      dot(p2,x2), dot(p3,x3) ) );
      }

      float getBeamIntensity(vec2 uv, vec2 sourcePos, float scanAngle, float beamWidth, float sourceRadius) {
        vec2 fromSource = uv - sourcePos;
        float dist = length(fromSource);

        float angle = atan(fromSource.y, fromSource.x);
        float angleDeg = degrees(angle);
        angleDeg = angleDeg < 0.0 ? angleDeg + 360.0 : angleDeg;

        float angleDiff = abs(angleDeg - scanAngle);
        angleDiff = min(angleDiff, 360.0 - angleDiff);

        float adjustedBeamWidth = beamWidth * (1.0 + sourceRadius / max(dist, 0.001));
        float beamShape = smoothstep(adjustedBeamWidth, 0.0, angleDiff);

        float distanceFalloff = 1.0 - smoothstep(1.5, 0.05, dist);

        return beamShape * distanceFalloff;
      }

      vec4 computeFinalColor(float intensity) {
          vec3 color_yellow = vec3(0.965, 0.53, 0.06);
          vec3 color_orange = vec3(0.890, 0.188, 0.055);
          vec3 color_dark_cherry = vec3(0.549, 0.0, 0.118);

          vec3 temp_color = mix(color_dark_cherry, color_orange, smoothstep(0.0, 0.6, intensity));
          vec3 finalBeamColor = mix(temp_color, color_yellow, smoothstep(0.5, 1.1, intensity));

          return vec4(finalBeamColor * intensity * 1.2, intensity);
      }

      void main() {
        vec2 final_uv;

        if (u_pixelation) {
            vec2 blocks = vec2(20.0, 20.0);
            vec2 block_frag_coord = floor(gl_FragCoord.xy / blocks) * blocks;
            vec2 block_center_coord = block_frag_coord + (blocks * 0.5);
            vec2 pixelated_full_uv_norm = block_center_coord / u_resolution;
            final_uv = pixelated_full_uv_norm * 2.0 - 1.0;
        } else {
            vec2 full_uv_norm = gl_FragCoord.xy / u_resolution;
            final_uv = full_uv_norm * 2.0 - 1.0;
        }

        final_uv.x *= u_resolution.x / u_resolution.y;

        float aspectRatio = u_resolution.x / u_resolution.y;

        vec2 baseSource = vec2(0.0, 0.0);

        float sourceRadius = 0.1;
        float scanSpeed = 0.6;
        float scanLeftBound = 220.0;
        float scanRightBound = 250.0;
        float scanRange = (scanRightBound - scanLeftBound) * 0.5;
        float scanCenterAngle = (scanLeftBound + scanRightBound) * 0.5;
        float scanAngle = scanCenterAngle + sin(u_time * scanSpeed) * scanRange;
        float beamWidth = 28.0;
        float intensity = getBeamIntensity(final_uv, baseSource, scanAngle, beamWidth, sourceRadius);
        intensity *= 0.98 + 0.07 * sin(u_time * 1.0);

        vec4 finalColor = computeFinalColor(intensity);

        gl_FragColor = finalColor;
      }
    `;

    // Create and compile shaders
    function createShader(gl: WebGLRenderingContext, type: number, source: string) {
      const shader = gl.createShader(type);
      if (!shader) return null;

      gl.shaderSource(shader, source);
      gl.compileShader(shader);

      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('Error compiling shader:', gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
      }

      return shader;
    }

    // Create program
    function createProgram(gl: WebGLRenderingContext, vertexShader: WebGLShader, fragmentShader: WebGLShader) {
      const program = gl.createProgram();
      if (!program) return null;

      gl.attachShader(program, vertexShader);
      gl.attachShader(program, fragmentShader);
      gl.linkProgram(program);

      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.error('Error linking program:', gl.getProgramInfoLog(program));
        gl.deleteProgram(program);
        return null;
      }

      return program;
    }

    // Initialize shaders
    const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
    const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);

    if (!vertexShader || !fragmentShader) return;

    const program = createProgram(gl, vertexShader, fragmentShader);
    if (!program) return;

    // Get attribute and uniform locations
    const positionAttributeLocation = gl.getAttribLocation(program, 'a_position');
    const texCoordAttributeLocation = gl.getAttribLocation(program, 'a_texCoord');
    const resolutionUniformLocation = gl.getUniformLocation(program, 'u_resolution');
    const timeUniformLocation = gl.getUniformLocation(program, 'u_time');
    const pixelationUniformLocation = gl.getUniformLocation(program, 'u_pixelation');
    const rightMarginUniformLocation = gl.getUniformLocation(program, 'u_right_margin');

    // Create a buffer for the rectangle
    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    const positions = [-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1];
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);

    // Create a buffer for texture coordinates
    const texCoordBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
    const texCoords = [0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1];
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(texCoords), gl.STATIC_DRAW);

    function resizeCanvas() {
        if (!canvas || !gl || !canvas.parentElement) return false;
        const { width, height } = canvas.parentElement.getBoundingClientRect();

        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
            gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
            return true;
        }
        return false;
    }

    const observer = new ResizeObserver(resizeCanvas);
    resizeObserverRef.current = observer;
    if (canvas?.parentElement) {
      observer.observe(canvas.parentElement, { box: 'content-box' });
    }

    resizeCanvas();

    function render(time: number) {
      time *= 0.001;
      if (!gl || !canvas) return;

      gl.clearColor(0.0, 0.0, 0.0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.useProgram(program);

      // Set uniforms
      gl.uniform2f(resolutionUniformLocation, canvas.width, canvas.height);
      gl.uniform1f(timeUniformLocation, time);
      gl.uniform1i(pixelationUniformLocation, 1);
      gl.uniform1f(rightMarginUniformLocation, marginRef.current);

      // Set up attributes
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      gl.enableVertexAttribArray(positionAttributeLocation);
      gl.vertexAttribPointer(positionAttributeLocation, 2, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
      gl.enableVertexAttribArray(texCoordAttributeLocation);
      gl.vertexAttribPointer(texCoordAttributeLocation, 2, gl.FLOAT, false, 0, 0);

      // Draw
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      rafIdRef.current = requestAnimationFrame(render);
    }

    rafIdRef.current = requestAnimationFrame(render);

    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
      if (resizeObserverRef.current) {
        try { resizeObserverRef.current.disconnect(); } catch {}
        resizeObserverRef.current = null;
      }
      canvas.style.backgroundColor = '#0a0908';
    };
  }, []);

  return (
      <canvas
        ref={canvasRef}
      className="absolute inset-0 z-10"
      />
  );
}