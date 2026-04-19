import { cn } from '@/lib/utils'

type BadgeVariant = 'live' | 'dev'

interface SectionHeadingProps {
  title: string
  badge?: {
    text: string
    variant: BadgeVariant
  }
  connectBottom?: boolean
  className?: string
}

export function SectionHeading({ title, badge, connectBottom, className }: SectionHeadingProps) {
  return (
    <div
      className={cn(
        'animate-on-scroll flex items-center justify-between gap-3 bg-muted/50 surface-depth px-4 md:px-5 py-2.5',
        connectBottom
          ? 'rounded-t-lg border border-sidebar-border/60 border-b-0'
          : 'rounded-lg',
        className,
      )}
    >
      <h2 className="text-base md:text-lg leading-tight tracking-tight text-foreground">
        {title}
      </h2>
      {badge && (
        <span
          className={cn(
            'inline-flex items-center self-stretch rounded-md px-3 text-sm font-medium',
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
