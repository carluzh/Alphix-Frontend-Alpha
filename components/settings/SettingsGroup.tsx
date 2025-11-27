import { cn } from '@/lib/utils'

interface SettingsGroupProps {
  striped?: boolean
  children: React.ReactNode
}

export const SettingsGroup: React.FC<SettingsGroupProps> = ({
  children,
  striped = false,
}) => (
  <div
    className={cn(
      'w-full flex-col divide-y overflow-hidden rounded-lg',
      striped
        ? 'divide-dashed divide-sidebar-border/60 border border-dashed border-sidebar-border/60 bg-muted/10'
        : 'divide-sidebar-border border border-sidebar-border bg-container'
    )}
  >
    {children}
  </div>
)

export interface SettingsGroupItemProps {
  title: string
  description?: string
  vertical?: boolean
  onClick?: () => void
  clickable?: boolean
}

export const SettingsGroupItem: React.FC<
  React.PropsWithChildren<SettingsGroupItemProps>
> = ({ children, title, description, vertical, onClick, clickable }) => (
  <div
    onClick={clickable ? onClick : undefined}
    className={cn(
      'flex gap-x-12 gap-y-4 p-4',
      vertical
        ? 'flex-col'
        : 'flex-col md:flex-row md:items-start md:justify-between',
      clickable && 'cursor-pointer hover:bg-muted/20 transition-colors'
    )}
  >
    <div className="flex w-full flex-col md:max-w-[50%]">
      <h3 className="text-sm font-medium">{title}</h3>
      {description && (
        <p className="text-xs text-muted-foreground/60">{description}</p>
      )}
    </div>
    {children && (
      <div
        className={cn(
          'flex w-full flex-row items-center gap-y-2 md:w-full',
          vertical ? '' : 'md:justify-end',
        )}
      >
        {children}
      </div>
    )}
  </div>
)
