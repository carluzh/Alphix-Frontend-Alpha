"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { ChevronLeftIcon } from "lucide-react";

export function LoginForm({
  className,
  hasError,
  isLoading,
  onSubmit,
  onPasswordChange,
  ...props
}: Omit<React.ComponentProps<"div">, "onSubmit"> & { 
  hasError?: boolean; 
  isLoading?: boolean; 
  onSubmit?: (event: React.FormEvent<HTMLFormElement>) => void;
  onPasswordChange?: (value: string) => void;
}) {
  const [password, setPassword] = useState('');
  
  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setPassword(value);
    onPasswordChange?.(value);
  };

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <div className="rounded-lg border border-sidebar-border bg-sidebar p-6">
        <form onSubmit={onSubmit} noValidate>
          <div className="grid gap-6">
            <div className="grid gap-3">
              <Label htmlFor="email">Email <span className="text-muted-foreground text-xs">(Optional)</span></Label>
              <Input
                id="email"
                type="email"
                placeholder="contact@alphix.fi"
                className="bg-muted/30 border-none"
              />
            </div>
            <div className="grid gap-3">
              <div className="flex items-center">
                <Label htmlFor="password">Password</Label>
              </div>
              <Input 
                id="password" 
                type="password" 
                required 
                value={password}
                onChange={handlePasswordChange}
                className={cn(
                  "bg-muted/30",
                  hasError ? "border-red-500 border" : "border-none"
                )}
              />
            </div>

            <Button 
              type="submit" 
              className={
                !password.trim() 
                  ? "w-full relative border border-sidebar-border bg-[var(--sidebar-connect-button-bg)] px-3 text-sm font-medium transition-all duration-200 overflow-hidden hover:brightness-110 hover:border-white/30 text-white/75 hover:bg-[var(--sidebar-connect-button-bg)]"
                  : isLoading
                    ? "w-full text-sidebar-primary border border-sidebar-primary bg-[#3d271b]/50 hover:bg-[#3d271b]/60 opacity-75 cursor-not-allowed"
                    : "w-full text-sidebar-primary border border-sidebar-primary bg-[#3d271b] hover:bg-[#3d271b]/90"
              }
              disabled={isLoading}
              style={!password.trim() ? { backgroundImage: 'url(/pattern_wide.svg)', backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
            >
              Login
            </Button>
          </div>
        </form>
      </div>
      <div className="text-muted-foreground text-center text-xs text-balance">
        Please <a href="/" className="text-white hover:text-gray-200">Sign Up</a> here or reach out on{" "}
        <a 
          href="https://x.com/AlphixFi" 
          target="_blank" 
          rel="noopener noreferrer" 
          className="inline-flex items-center align-middle gap-1 text-white hover:text-gray-200"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="inline align-middle">
            <path d="M16.9947 2H20.1115L13.5007 9.5L21.2209 20H15.2302L10.5 13.7L5.07938 20H1.96154L9.00025 12L1.60059 2H7.74871L11.9502 7.7L16.9947 2ZM16.0947 18.2L18.0947 18.2L6.89474 3.8L4.79474 3.8L16.0947 18.2Z" fill="currentColor"/>
          </svg>
        </a><br/> to receive your Password.
      </div>
    </div>
  )
}

export default function LoginPage() {
  const [hasError, setHasError] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  const isMobile = useIsMobile();

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setHasError(false);

    const password = (event.currentTarget.elements.namedItem('password') as HTMLInputElement).value;
    
    // Custom validation
    if (!password.trim()) {
      setHasError(true);
      setIsLoading(false);
      return;
    }

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        router.push('/swap');
      } else {
        setHasError(true);
      }
    } catch (err) {
      console.error("Login page error:", err);
      setHasError(true);
    }

    setIsLoading(false);
  };

  const handlePasswordChange = (value: string) => {
    // Clear error when user starts typing
    if (hasError) {
      setHasError(false);
    }
  };

  return (
    <div className="min-h-screen bg-background p-6 relative">
      {/* Back button */}
      <div className="absolute top-6 left-6">
        <Button 
          variant="ghost" 
          onClick={() => router.push('/')}
          className="pl-2"
        >
          <ChevronLeftIcon className="mr-2 h-4 w-4" /> Back to Main
        </Button>
      </div>

      <div className="flex items-center justify-center min-h-screen">
        <div className="w-full max-w-sm">
          {/* Logo */}
          <div className="flex justify-center items-center gap-3 mb-6">
            <img
              src="/Logo Type (white).svg"
              alt="Alphix"
              className="h-6 cursor-pointer"
              onClick={() => router.push('/')}
            />
            <Badge
              variant="outline"
              className="bg-[#3d271b] text-sidebar-primary border-sidebar-primary rounded-md font-normal hover:bg-[#4a2f1f] transition-colors cursor-default"
              style={{ fontFamily: 'Consolas, monospace' }}
            >
              Beta
            </Badge>
          </div>

          {/* Login Form */}
          <LoginForm onSubmit={handleSubmit} hasError={hasError} isLoading={isLoading} onPasswordChange={handlePasswordChange} />
        </div>
      </div>
    </div>
  );
} 