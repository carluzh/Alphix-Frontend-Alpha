'use client'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { motion } from 'framer-motion'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { ComponentProps, PropsWithChildren, useState } from 'react'
import { Menu, X } from 'lucide-react'

export default function Layout({ children }: PropsWithChildren) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)

  return (
    <div className="relative flex flex-col bg-gray-50 dark:bg-[#0d0d0c] px-0 md:w-full md:flex-1 md:items-center md:px-4">
      <div className="flex flex-col gap-y-2 md:w-full">
        <LandingPageDesktopNavigation />
        <LandingPageTopbar
          isMobileMenuOpen={isMobileMenuOpen}
          setIsMobileMenuOpen={setIsMobileMenuOpen}
        />
        <LandingPageMobileNavigation
          isOpen={isMobileMenuOpen}
          onClose={() => setIsMobileMenuOpen(false)}
        />

        <div className="relative flex flex-col px-4 pt-32 md:w-full md:px-0 md:pt-8">
          {children}
        </div>
        <LandingPageFooter />
      </div>
    </div>
  )
}

const NavLink = ({
  href,
  className,
  children,
  isActive: _isActive,
  target,
  ...props
}: ComponentProps<typeof Link> & {
  isActive?: (pathname: string) => boolean
}) => {
  const pathname = usePathname() ?? ''
  const isActive = _isActive
    ? _isActive(pathname)
    : pathname.startsWith(href.toString())
  const isExternal = href.toString().startsWith('http')

  return (
    <Link
      href={href}
      target={isExternal ? '_blank' : target}
      prefetch
      className={cn(
        'text-gray-500 dark:text-gray-400 -m-1 flex items-center gap-x-2 p-1 transition-colors hover:text-black dark:hover:text-white',
        isActive && 'text-black dark:text-white',
        className,
      )}
      {...props}
    >
      {children}
    </Link>
  )
}

interface NavigationItem {
  title: string
  href: string
  isActive?: (pathname: string) => boolean
  target?: '_blank'
}

const mobileNavigationItems: NavigationItem[] = [
  {
    title: 'Overview',
    href: '/',
    isActive: (pathname) => pathname === '/',
  },
  {
    title: 'Swap',
    href: '/swap',
  },
  {
    title: 'Liquidity',
    href: '/liquidity',
  },
  {
    title: 'Documentation',
    href: 'https://alphix.gitbook.io/docs/',
    target: '_blank',
  },
  {
    title: 'GitHub',
    href: 'https://github.com/alphixfi',
    target: '_blank',
  },
]

const LandingPageMobileNavigation = ({
  isOpen,
  onClose
}: {
  isOpen: boolean
  onClose: () => void
}) => {
  if (!isOpen) return null

  return (
    <div className="md:hidden fixed inset-0 z-40 bg-gray-50 dark:bg-[#0d0d0c] pt-20">
      <div className="flex flex-col gap-y-6 px-6 py-2">
        <div className="flex flex-col gap-y-1">
          {mobileNavigationItems.map((item) => (
            <NavLink
              key={item.title}
              className="text-xl tracking-tight"
              isActive={item.isActive}
              target={item.target}
              href={item.href}
              onClick={onClose}
            >
              {item.title}
            </NavLink>
          ))}
        </div>
      </div>
    </div>
  )
}

const LandingPageDesktopNavigation = () => {
  return (
    <div className="sticky top-0 z-50 hidden w-full flex-col items-center py-6 md:flex">
      <nav className="flex items-center gap-6 rounded-lg bg-surface border border-sidebar-border/60 px-2 py-2">
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
          <Link
            href="/swap"
            className="text-sm font-semibold text-muted-foreground transition-colors hover:text-white"
          >
            Products
          </Link>
          <Link
            href="https://alphix.gitbook.io/docs/"
            target="_blank"
            className="text-sm font-semibold text-muted-foreground transition-colors hover:text-white"
          >
            Docs
          </Link>
          <Link
            href="https://alphix.gitbook.io/docs/"
            target="_blank"
            className="text-sm font-semibold text-muted-foreground transition-colors hover:text-white"
          >
            Security
          </Link>
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

const LandingPageTopbar = ({
  isMobileMenuOpen,
  setIsMobileMenuOpen
}: {
  isMobileMenuOpen: boolean
  setIsMobileMenuOpen: (open: boolean) => void
}) => {
  return (
    <div className="z-50 flex w-full flex-row items-center justify-between px-6 py-6 md:hidden fixed top-0 left-0 right-0 bg-gray-50 dark:bg-[#0d0d0c]">
      <Link href="/">
        <Image
          src="/Logo Type (white).svg"
          alt="Alphix"
          width={100}
          height={24}
          className="h-6 w-auto"
        />
      </Link>
      <button
        className="flex items-center justify-center w-10 h-10"
        onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
      >
        {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
      </button>
    </div>
  )
}

const LandingPageFooter = () => {
  return (
    <motion.div
      initial="initial"
      className="relative flex w-full flex-col items-center"
      variants={{ initial: { opacity: 0 }, animate: { opacity: 1 } }}
      transition={{ duration: 0.5, ease: 'easeInOut' }}
      whileInView="animate"
      viewport={{ once: true }}
    >
      <footer className="w-full border-t border-sidebar-border">
        <div className="w-full max-w-6xl mx-auto py-12 px-4 sm:px-6 md:px-8">
          <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-8">
            <div className="flex items-start">
              <Image
                src="/LogoIconWhite.svg"
                alt="Alphix Logo"
                width={32}
                height={32}
                className="h-8 w-8"
              />
            </div>

            <div className="flex flex-col sm:flex-row gap-8">
              <div>
                <h3 className="text-sm font-medium mb-4 text-muted-foreground">
                  Product
                </h3>
                <div className="space-y-3">
                  <Link
                    href="/swap"
                    className="block text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Swap
                  </Link>
                  <Link
                    href="/liquidity"
                    className="block text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Liquidity
                  </Link>
                  <Link
                    href="/portfolio"
                    className="block text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Portfolio
                  </Link>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-medium mb-4 text-muted-foreground">
                  Connect
                </h3>
                <div className="space-y-3">
                  <a
                    href="https://x.com/AlphixFi"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    X (Twitter)
                  </a>
                  <a
                    href="https://github.com/alphixfi"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    GitHub
                  </a>
                  <a
                    href="https://alphix.gitbook.io/docs/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Documentation
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      </footer>
    </motion.div>
  )
}
