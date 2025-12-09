'use client'

import { cn } from '@/lib/utils'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import Link from 'next/link'
import { ReactNode, useState } from 'react'

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

interface NavPopoverProps {
  trigger: ReactNode
  sections: NavPopoverSection[]
  isActive?: boolean
  layout?: 'grid' | 'flex'
}

export const NavPopover = ({
  trigger,
  sections,
  isActive,
  layout = 'grid',
}: NavPopoverProps) => {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger
        className={cn(
          'text-gray-500 dark:text-gray-400 -m-1 flex cursor-pointer items-center gap-x-2 p-1 transition-colors hover:text-black dark:hover:text-white focus:outline-none',
          (isOpen || isActive) && 'text-black dark:text-white',
        )}
        onMouseEnter={() => setIsOpen(true)}
        onMouseLeave={() => setIsOpen(false)}
      >
        {trigger}
      </PopoverTrigger>
      <PopoverContent
        className={cn(
          'w-fit divide-x p-0',
          layout === 'flex'
            ? 'flex flex-row'
            : `grid ${sections.length === 1 ? 'grid-cols-1' : `grid-cols-${sections.length}`}`,
        )}
        sideOffset={0}
        onMouseEnter={() => setIsOpen(true)}
        onMouseLeave={() => setIsOpen(false)}
      >
        {sections.map((section, idx) => (
          <div
            key={idx}
            className={cn(
              'flex flex-col p-2',
              section.items.some((item) => item.subtitle) ? 'col-span-2' : '',
            )}
          >
            {section.title && (
              <h3 className="px-4 py-2 text-sm text-gray-500 dark:text-gray-400">
                {section.title}
              </h3>
            )}
            <div
              className={cn(
                section.items.some((item) => item.subtitle)
                  ? 'grid grid-cols-2'
                  : '',
              )}
            >
              {section.items.map(({ href, label, subtitle, target }) => (
                <Link
                  key={href + label}
                  href={href}
                  prefetch
                  target={target}
                  className="flex flex-col rounded-md px-4 py-2 text-sm transition-colors hover:bg-accent"
                >
                  <span className="font-medium">{label}</span>
                  {subtitle && (
                    <span className="text-gray-500 dark:text-gray-400">
                      {subtitle}
                    </span>
                  )}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </PopoverContent>
    </Popover>
  )
}
