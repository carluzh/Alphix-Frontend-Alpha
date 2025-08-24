"use client"

import { Button } from "@/components/ui/button"
import { useEffect } from "react"
import { useRouter } from "next/navigation"

export default function MaintenancePage() {
  const router = useRouter()

  useEffect(() => {
    let cancelled = false
    const check = async () => {
      try {
        const res = await fetch('/api/maintenance-status', { cache: 'no-store' })
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled && data && data.maintenance === false) {
          router.replace('/swap')
        }
      } catch {}
    }
    check()
    const id = setInterval(check, 5000)
    return () => { cancelled = true; clearInterval(id) }
  }, [router])

  return (
    <div className="relative min-h-screen flex items-center justify-center p-6">
      {/* Background logo */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center z-0" aria-hidden="true">
        <img
          src="/LogoIconWhite.svg"
          alt="Alphix Logo Background"
          style={{
            width: '75vw',
            maxWidth: '1200px',
            height: 'auto',
            opacity: 0.05,
            WebkitMaskImage: 'linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0) 65%, rgba(0,0,0,1) 100%)',
            maskImage: 'linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0) 65%, rgba(0,0,0,1) 100%)',
            WebkitMaskSize: '100% 100%',
            maskSize: '100% 100%'
          }}
        />
      </div>
      <div className="relative z-10 rounded-lg bg-muted/30 border border-sidebar-border/60 p-6 max-w-md w-full text-center">
        <h1 className="text-lg font-semibold mb-2">Under Maintenance</h1>
        <p className="text-xs text-muted-foreground">
          We're performing a brief maintenance to improve your experience. To get notified when Alphix is back online, join below.
        </p>
        <div className="mt-4 flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="relative border border-sidebar-border bg-[var(--sidebar-connect-button-bg)] px-3 text-xs font-medium transition-all duration-200 overflow-hidden hover:brightness-110 hover:border-white/30 text-white/75"
            asChild
            style={{ backgroundImage: 'url(/pattern.svg)', backgroundSize: 'cover', backgroundPosition: 'center' }}
          >
            <a href="https://discord.gg/NTXRarFbTr" target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-2">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="inline">
                <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5499-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419-.019 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1568 2.4189Z" fill="currentColor"/>
              </svg>
              <span className="text-xs">Discord</span>
            </a>
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="relative border border-sidebar-border bg-[var(--sidebar-connect-button-bg)] px-3 text-xs font-medium transition-all duration-200 overflow-hidden hover:brightness-110 hover:border-white/30 text-white/75"
            asChild
            style={{ backgroundImage: 'url(/pattern.svg)', backgroundSize: 'cover', backgroundPosition: 'center' }}
          >
            <a href="https://x.com/AlphixFi" target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-2">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M16.9947 2H20.1115L13.5007 9.5L21.2209 20H15.2302L10.5 13.7L5.07938 20H1.96154L9.00025 12L1.60059 2H7.74871L11.9502 7.7L16.9947 2ZM16.0947 18.2L18.0947 18.2L6.89474 3.8L4.79474 3.8L16.0947 18.2Z" fill="currentColor"/>
              </svg>
              <span className="text-xs">Twitter</span>
            </a>
          </Button>
        </div>
      </div>
    </div>
  )
}



