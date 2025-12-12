'use client'

import { Button } from '@/components/ui/button'
import { useInView } from '@/hooks/useInView'
import Link from 'next/link'
import Image from 'next/image'
import { PropsWithChildren, useState, useEffect } from 'react'
import { toast } from 'sonner'

const GithubIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
  </svg>
)

const XIcon = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
)

const DiscordIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
  </svg>
)

const GrainOverlay = () => (
  <div
    className="pointer-events-none absolute inset-0 z-[100]"
    style={{
      background: 'url(/landing/noise-color.png)',
      opacity: 0.012,
    }}
  />
)

export default function Layout({ children }: PropsWithChildren) {
  return (
    <div className="relative flex flex-col bg-gray-50 dark:bg-[#0d0d0c] px-0 md:w-full md:flex-1 md:items-center md:px-4">
      <GrainOverlay />
      <LandingPageNavigation />
      <div className="flex flex-col gap-y-2 md:w-full overflow-x-clip">
        <div className="relative flex flex-col px-4 pt-12 md:pt-16 md:w-full md:px-0">
          {children}
        </div>
        <LandingPageFooter />
      </div>
    </div>
  )
}

const LandingPageNavigation = () => {
  return (
    <div className="sticky top-0 z-50 flex w-full flex-col items-center py-4 md:py-6 px-4 md:px-0" style={{ willChange: 'transform' }}>
      <nav className="flex items-center gap-3 md:gap-6 rounded-lg bg-surface border border-sidebar-border/60 px-2 py-2">
        <Link href="/" className="flex items-center justify-center ml-1">
          <Image
            src="/LogoIconWhite.svg"
            alt="Alphix"
            width={28}
            height={28}
            className="h-6 w-7"
          />
        </Link>
        <div className="flex items-center gap-6">
          <button
            onClick={() => {
              document.getElementById('dynamic-fees-section')?.scrollIntoView({ behavior: 'smooth' })
            }}
            className="text-sm font-semibold text-muted-foreground transition-colors hover:text-white"
          >
            Products
          </button>
          <Link
            href="https://alphix.gitbook.io/docs/"
            target="_blank"
            className="text-sm font-semibold text-muted-foreground transition-colors hover:text-white"
          >
            Docs
          </Link>
          <button
            onClick={() => toast.info('Coming Soon')}
            className="text-sm font-semibold text-muted-foreground transition-colors hover:text-white"
          >
            Security
          </button>
        </div>
        <Link href="/swap">
          <Button
            className="h-8 rounded-md bg-[#2a2a2a] px-5 text-sm font-semibold text-white/75 transition-all hover:bg-button-primary hover:text-sidebar-primary"
          >
            Launch
          </Button>
        </Link>
      </nav>
    </div>
  )
}

const MEDIUM_BREAKPOINT = 2000
const NARROW_BREAKPOINT = 1700

const LandingPageFooter = () => {
  const [breakpoint, setBreakpoint] = useState<'full' | 'medium' | 'narrow'>('full')
  const [isMobile, setIsMobile] = useState(false)
  const { ref, inView } = useInView<HTMLDivElement>({ once: true, threshold: 0.1 })

  useEffect(() => {
    const checkWidth = () => {
      const width = window.innerWidth
      setIsMobile(width < 768)
      if (width < NARROW_BREAKPOINT) setBreakpoint('narrow')
      else if (width < MEDIUM_BREAKPOINT) setBreakpoint('medium')
      else setBreakpoint('full')
    }
    checkWidth()
    window.addEventListener('resize', checkWidth)
    return () => window.removeEventListener('resize', checkWidth)
  }, [])

  // Match PaperShaderFrame horizontal extension at each breakpoint
  const FOOTER_MAX_WIDTH = breakpoint === 'narrow' ? 'calc(72rem + 10rem)' : breakpoint === 'medium' ? 'calc(72rem + 24rem)' : 'calc(72rem + 32rem)'

  return (
    <div
      ref={ref}
      className={`animate-on-scroll relative flex flex-col items-center mt-12 md:mt-16 ${inView ? 'in-view' : ''}`}
    >
      <div
        className="relative w-full h-[280px] md:h-[320px] overflow-hidden px-0 md:px-4"
        style={{ maxWidth: isMobile ? 'none' : FOOTER_MAX_WIDTH }}
      >
        <footer className="w-full md:rounded-t-lg border border-b-0 border-x-0 md:border-x border-sidebar-border/60 bg-white dark:bg-[#131313] h-[400px] md:h-[480px]">
          <div className="flex flex-col justify-between h-[280px] md:h-[320px] py-8 md:py-10 px-4 md:px-12">
            <div className="flex flex-row justify-between items-start">
              <Image
                src="/LogoIconWhite.svg"
                alt="Alphix Logo"
                width={32}
                height={32}
                className="h-8 w-8"
              />
              <div className="flex flex-row gap-8 md:gap-16">
                <div>
                  <h3 className="text-sm font-semibold mb-4 text-foreground">
                    Protocol
                  </h3>
                  <div className="space-y-3">
                    <a
                      href="https://alphix.gitbook.io/docs/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Documentation
                    </a>
                    <a
                      href="https://alphix.gitbook.io/docs/the-basics/why-alphix"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Why Alphix
                    </a>
                    <a
                      href="https://alphix.gitbook.io/docs/more/roadmap"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Roadmap
                    </a>
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-semibold mb-4 text-foreground">
                    Resources
                  </h3>
                  <div className="space-y-3">
                    <a
                      href="https://alphix.gitbook.io/docs/the-basics/architecture"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Architecture
                    </a>
                    <a
                      href="https://alphix.gitbook.io/docs/tech/smart-contracts"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Smart Contracts
                    </a>
                    <span
                      className="block text-sm text-muted-foreground/50 cursor-not-allowed"
                    >
                      Brand Kit
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-row justify-between items-center">
              <div className="flex items-center gap-4">
                <a
                  href="https://x.com/AlphixFi"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <XIcon size={18} />
                </a>
                <a
                  href="https://discord.com/invite/NTXRarFbTr"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <DiscordIcon size={20} />
                </a>
                <a
                  href="https://github.com/alphixfi"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <GithubIcon size={20} />
                </a>
              </div>
              <p className="text-[10px] md:text-sm text-muted-foreground">
                © 2025 Alphix v{process.env.NEXT_PUBLIC_APP_VERSION}<span className="opacity-50">+{process.env.NEXT_PUBLIC_GIT_COMMIT}</span>
              </p>
            </div>
          </div>
        </footer>
      </div>
    </div>
  )
}
