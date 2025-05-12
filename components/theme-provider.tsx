"use client"

import * as React from "react"
import { ThemeProvider as NextThemesProvider } from "next-themes"
// import { type ThemeProviderProps } from "next-themes/dist/types" // Removed problematic import

// Use React.ComponentProps to get the props type for NextThemesProvider
export function ThemeProvider({ children, ...props }: React.ComponentProps<typeof NextThemesProvider>) {
  // Default to dark theme, enable system theme preference, allow theme switching
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark" 
      enableSystem
      disableTransitionOnChange
      {...props}
    >
      {children}
    </NextThemesProvider>
  )
}

// The useTheme hook should be imported from 'next-themes' directly in components that need it.
// So, we can remove the placeholder useTheme from this file.

