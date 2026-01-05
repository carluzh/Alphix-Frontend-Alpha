"use client";

import { memo } from "react";
import Link from "next/link";
import { IconChevronRight } from "nucleo-micro-bold-essential";

interface ViewAllButtonProps {
  label: string;
  href?: string;
  onPress?: () => void;
}

/**
 * ViewAllButton - matches Uniswap's ViewAllButton exactly
 *
 * Styling:
 * - Button: variant="default" emphasis="tertiary" size="small"
 * - borderRadius="$roundedFull" (pill shape)
 * - width="max-content"
 * - Icon: ArrowRight, position="after"
 */
export const ViewAllButton = memo(function ViewAllButton({
  href,
  label,
  onPress,
}: ViewAllButtonProps) {
  const content = (
    <span className="group inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer rounded-full hover:bg-surface/50">
      {label}
      <IconChevronRight className="h-4 w-4 transition-transform duration-100 group-hover:translate-x-1" />
    </span>
  );

  if (href) {
    return (
      <div className="flex w-max">
        <Link href={href}>{content}</Link>
      </div>
    );
  }

  return (
    <div className="flex w-max">
      <button onClick={onPress}>{content}</button>
    </div>
  );
});

export default ViewAllButton;
