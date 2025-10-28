import { PropsWithChildren } from 'react'
import { cn } from '@/lib/utils'

export type SectionProps = PropsWithChildren<{
  id?: string
  className?: string
  wrapperClassName?: string
}>

export const Section = ({
  id,
  className,
  wrapperClassName,
  children,
}: SectionProps) => {
  return (
    <div
      id={id}
      className={cn(
        'relative flex flex-col md:items-center',
        wrapperClassName,
      )}
    >
      <div
        className={cn(
          'flex w-full flex-col py-12 md:max-w-3xl md:px-0 md:py-16 xl:max-w-6xl 2xl:max-w-screen-xl',
          className,
        )}
      >
        {children}
      </div>
    </div>
  )
}
