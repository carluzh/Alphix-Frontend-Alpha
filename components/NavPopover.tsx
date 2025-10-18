'use client'

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import Link from 'next/link'
import { ReactNode, useState, useEffect } from 'react'
import { twMerge } from 'tailwind-merge'

export interface NavPopoverSection {
  title?: string
  items: NavPopoverItem[]
}

export interface NavPopoverItem {
  href: string
  label: string
  subtitle?: string
  target?: '_blank'
}

interface SocialLink {
  href: string
  icon: ReactNode
  label: string
}

interface NavPopoverProps {
  trigger: ReactNode
  sections: NavPopoverSection[]
  isActive?: boolean
  layout?: 'grid' | 'flex'
  socialLinks?: SocialLink[]
  featuresLayout?: boolean
  footerContent?: ReactNode
}

export const NavPopover = ({
  trigger,
  sections,
  isActive,
  layout = 'grid',
  socialLinks,
  featuresLayout = false,
  footerContent,
}: NavPopoverProps) => {
  const [isOpen, setIsOpen] = useState(false)
  const [tooltipOpen, setTooltipOpen] = useState(false)

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger
        className={twMerge(
          '-m-1 flex cursor-pointer items-center gap-x-2 px-4 py-2 transition-colors hover:text-white focus:outline-none',
          (isOpen || isActive) && 'text-white',
        )}
        onMouseEnter={() => setIsOpen(true)}
        onMouseLeave={() => setIsOpen(false)}
      >
        {trigger}
      </PopoverTrigger>
      <PopoverContent
        className={twMerge(
          'w-fit p-0 bg-[#131313] border-[#323232]',
          featuresLayout ? 'p-3 flex flex-col' : 'divide-x',
          !featuresLayout && layout === 'flex'
            ? 'flex flex-row'
            : !featuresLayout ? `grid ${sections.length === 1 ? 'grid-cols-1' : `grid-cols-${sections.length}`}` : '',
        )}
        sideOffset={0}
        onMouseEnter={() => setIsOpen(true)}
        onMouseLeave={() => setIsOpen(false)}
      >
        {featuresLayout ? (
          <>
            <div className="bg-[#0a0908] rounded-md">
              <div className="divide-x grid grid-cols-2">
                {sections.map((section, idx) => (
                  <div
                    key={idx}
                    className="flex flex-col p-2"
                  >
                    {section.title && (
                      <div className="flex items-center justify-between px-4 py-2">
                        <h3 className="text-[10px] font-medium uppercase tracking-wide text-white/50">
                          {section.title}
                        </h3>
                        {section.title === 'Products' && (
                          <TooltipProvider>
                            <Tooltip open={tooltipOpen} onOpenChange={setTooltipOpen}>
                              <TooltipTrigger asChild>
                                <div
                                  className="flex items-center justify-center w-4 h-4 rounded cursor-pointer transition-colors hover:bg-[#1e1d1b] -translate-y-[2px]"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setTooltipOpen(!tooltipOpen);
                                  }}
                                  onMouseEnter={() => {}}
                                  onMouseLeave={() => {}}
                                >
                                  <span className="text-sm text-white/50 leading-none">+</span>
                                </div>
                              </TooltipTrigger>
                              <TooltipContent side="top" sideOffset={6} className="px-2 py-1 text-xs">
                                <div className="font-medium text-foreground">Modular Upgradability</div>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                      </div>
                    )}
                    <div className="flex flex-col">
                      {section.items.map(({ href, label, subtitle, target }) => (
                        <Link
                          key={href + label}
                          href={href}
                          prefetch
                          target={target}
                          className="flex flex-col gap-y-1 rounded-md px-4 py-2 text-sm transition-colors hover:bg-[#1e1d1b]"
                        >
                          <span className="text-[13px] text-white">{label}</span>
                          {subtitle && (
                            <span className="text-xs text-white/60">
                              {subtitle}
                            </span>
                          )}
                        </Link>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            {/* Beta footer below darker container */}
            {footerContent}
          </>
        ) : (
          <>
            {sections.map((section, idx) => (
              <div
                key={idx}
                className="flex flex-col p-2"
              >
                {section.title && (
                  <h3 className="px-4 py-2 text-[10px] font-medium uppercase tracking-wide text-white/50">
                    {section.title}
                  </h3>
                )}
                <div
                  className={twMerge(
                    section.items.some((item) => item.subtitle)
                      ? 'grid grid-cols-2 gap-0'
                      : 'flex flex-col',
                  )}
                >
                  {section.items.map(({ href, label, subtitle, target }) => (
                    <Link
                      key={href + label}
                      href={href}
                      prefetch
                      target={target}
                      className="flex flex-col gap-y-1 rounded-md px-4 py-2 text-sm transition-colors hover:bg-[#1e1d1b]"
                    >
                      <span className="text-[13px] text-white">{label}</span>
                      {subtitle && (
                        <span className="text-xs text-white/60">
                          {subtitle}
                        </span>
                      )}
                    </Link>
                  ))}
                </div>
                {/* Render social icons if this is the last section and socialLinks are provided */}
                {socialLinks && idx === sections.length - 1 && (
                  <div className="flex items-center gap-x-3 px-4 py-2 mt-1">
                    {socialLinks.map((social) => (
                      <Link
                        key={social.href}
                        href={social.href}
                        target="_blank"
                        className="text-white/60 hover:text-white transition-colors"
                        aria-label={social.label}
                      >
                        {social.icon}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}
