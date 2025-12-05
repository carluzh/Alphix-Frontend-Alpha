"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { ComponentProps, useCallback, useTransition } from "react"

type TransitionLinkProps = ComponentProps<typeof Link>

export function TransitionLink({ href, onClick, children, ...props }: TransitionLinkProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>) => {
      if (onClick) onClick(e)
      if (e.defaultPrevented) return

      const url = typeof href === "string" ? href : href.pathname || "/"

      // Skip for external links, new tabs, or modifier keys
      if (
        url.startsWith("http") ||
        e.metaKey ||
        e.ctrlKey ||
        e.shiftKey ||
        props.target === "_blank"
      ) {
        return
      }

      e.preventDefault()

      // Use View Transitions API if available
      if (document.startViewTransition) {
        document.startViewTransition(() => {
          startTransition(() => {
            router.push(url)
          })
        })
      } else {
        startTransition(() => {
          router.push(url)
        })
      }
    },
    [href, onClick, props.target, router]
  )

  return (
    <Link href={href} onClick={handleClick} {...props}>
      {children}
    </Link>
  )
}
