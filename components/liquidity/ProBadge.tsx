import { cn } from "@/lib/utils";

interface ProBadgeProps {
  size?: 'sm' | 'md';
  className?: string;
}

export function ProBadge({ size = 'md', className }: ProBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded px-1.5 py-0.5 font-normal leading-none text-sidebar-primary bg-[#f45502]/15",
        size === 'sm' ? 'text-[10px]' : 'text-xs',
        className
      )}
    >
      Pro
    </span>
  );
}
