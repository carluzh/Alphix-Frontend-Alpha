import { PropsWithChildren } from "react";

/**
 * Points Layout
 *
 * Simple layout for the Points page.
 * Connect wallet banner is handled inside the Points component.
 */
export default function Layout({ children }: PropsWithChildren) {
  return (
    <div className="flex flex-col gap-3 sm:gap-6 p-3 sm:p-6 overflow-x-hidden w-full max-w-[1200px] mx-auto">
      {children}
    </div>
  );
}
