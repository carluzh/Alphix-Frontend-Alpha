'use client'

import { useEffect, useRef, useState, RefObject } from 'react'

interface UseInViewOptions {
  threshold?: number
  rootMargin?: string
  once?: boolean
}

/**
 * Lightweight hook to detect when an element enters the viewport.
 * Replaces framer-motion's whileInView with pure CSS animations.
 *
 * Usage:
 * const { ref, inView } = useInView({ once: true })
 * <div ref={ref} className={`animate-on-scroll ${inView ? 'in-view' : ''}`}>
 */
export function useInView<T extends HTMLElement = HTMLDivElement>(
  options: UseInViewOptions = {}
): { ref: RefObject<T | null>; inView: boolean } {
  const { threshold = 0.1, rootMargin = '0px', once = true } = options
  const ref = useRef<T>(null)
  const [inView, setInView] = useState(false)

  useEffect(() => {
    const element = ref.current
    if (!element) return

    // Check for reduced motion preference
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (prefersReducedMotion) {
      setInView(true)
      return
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true)
          if (once) {
            observer.disconnect()
          }
        } else if (!once) {
          setInView(false)
        }
      },
      { threshold, rootMargin }
    )

    observer.observe(element)
    return () => observer.disconnect()
  }, [threshold, rootMargin, once])

  return { ref, inView }
}

/**
 * Simpler variant that just adds 'in-view' class directly.
 * Returns a ref callback that sets up the observer automatically.
 */
export function useInViewClass(options: UseInViewOptions = {}) {
  const { threshold = 0.1, rootMargin = '0px', once = true } = options

  useEffect(() => {
    // Check for reduced motion preference
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const elements = document.querySelectorAll('.animate-on-scroll:not(.in-view), .hero-animate:not(.in-view), .animate-fade-only:not(.in-view)')

    if (prefersReducedMotion) {
      elements.forEach(el => el.classList.add('in-view'))
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('in-view')
            if (once) {
              observer.unobserve(entry.target)
            }
          } else if (!once) {
            entry.target.classList.remove('in-view')
          }
        })
      },
      { threshold, rootMargin }
    )

    elements.forEach(el => observer.observe(el))
    return () => observer.disconnect()
  }, [threshold, rootMargin, once])
}
