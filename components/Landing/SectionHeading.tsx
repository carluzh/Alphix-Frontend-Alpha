import { cn } from '@/lib/utils'

type BadgeVariant = 'live' | 'dev'

interface SectionHeadingProps {
  title: string
  badge?: {
    text: string
    variant: BadgeVariant
  }
  className?: string
}

export function SectionHeading({ title, badge, className }: SectionHeadingProps) {
  return (
    <div
      className={cn(
        'animate-on-scroll flex items-center rounded-lg bg-muted/50 surface-depth px-4 md:px-5 py-2.5',
        className,
      )}
    >
      <h2 className="text-base md:text-lg leading-tight tracking-tight text-foreground">
        {title}
      </h2>
      {badge && (
        <span
          className={cn(
            'ml-auto inline-flex items-center self-stretch rounded-md px-3 text-sm font-medium',
            badge.variant === 'live'
              ? 'bg-green-950/70 text-green-500'
              : 'bg-muted/50 text-muted-foreground',
          )}
        >
          {badge.text}
        </span>
      )}
    </div>
  )
}
