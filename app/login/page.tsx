"use client";

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion, useAnimation } from 'framer-motion';
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
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"

export function LoginForm({
  className,
  hasError,
  isLoading,
  onSubmit,
  onPasswordChange,
  onEmailChange,
  emailError,
  ...props
}: Omit<React.ComponentProps<"div">, "onSubmit"> & {
  hasError?: boolean;
  isLoading?: boolean;
  onSubmit?: (event: React.FormEvent<HTMLFormElement>) => void;
  onPasswordChange?: (value: string) => void;
  onEmailChange?: (value: string) => void;
  emailError?: boolean;
}) {
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [passwordWiggleCount, setPasswordWiggleCount] = useState(0);
  const passwordWiggleControls = useAnimation() as any;

  // Trigger wiggle on new error
  useEffect(() => {
    if (hasError) {
      setPasswordWiggleCount((prev) => prev + 1);
    }
  }, [hasError]);

  // Password wiggle animation effect
  useEffect(() => {
    if (passwordWiggleCount > 0) {
      passwordWiggleControls
        .start({ x: [0, -3, 3, -2, 2, 0], transition: { duration: 0.22, ease: 'easeOut' } })
        .catch(() => {});
    }
  }, [passwordWiggleCount, passwordWiggleControls]);
  
  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setPassword(value);
    onPasswordChange?.(value);
  };

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setEmail(value);
    onEmailChange?.(value);
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
                className={cn(
                  "bg-muted/30",
                  emailError ? "border-red-500 border" : "border-none"
                )}
                value={email}
                onChange={handleEmailChange}
              />
            </div>
            <div className="grid gap-3">
              <div className="flex items-center">
                <Label htmlFor="password">Password</Label>
              </div>
              <motion.div animate={passwordWiggleControls}>
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
                  autoComplete="off"
                  data-lpignore="true"
                />
              </motion.div>
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
              {isLoading ? (
                <span className="animate-pulse relative overflow-hidden"
                  style={{ backgroundImage: 'url(/pattern_wide.svg)', backgroundSize: 'cover', backgroundPosition: 'center' }}
                >
                  Login
                </span>
              ) : (
                "Login"
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function LoginPage() {
  const [hasError, setHasError] = useState(false);
  const [emailError, setEmailError] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  const isMobile = useIsMobile();
  const debounceTimeout = useRef<NodeJS.Timeout | null>(null);

  // (moved into LoginForm)

  const validateEmail = (email: string) => {
    if (!email) return true; // Optional field
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    // Clear any pending validation timer before submitting
    if (debounceTimeout.current) {
      clearTimeout(debounceTimeout.current);
    }

    setIsLoading(true);
    setHasError(false);
    setEmailError(false);

    const password = (event.currentTarget.elements.namedItem('password') as HTMLInputElement).value;
    const email = (event.currentTarget.elements.namedItem('email') as HTMLInputElement).value;
    
    const isEmailValid = validateEmail(email);
    const isPasswordValid = password.trim() !== '';

    if (!isPasswordValid || !isEmailValid) {
      if (!isPasswordValid) setHasError(true);
      if (!isEmailValid) setEmailError(true);
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
        // If login is successful and email is provided, save the email
        if (email.trim()) {
          fetch('/api/save-beta-user', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email }),
          }).catch(err => console.error("Failed to save email:", err)); // Fire-and-forget
        }
        try { sessionStorage.setItem('came_from_login', '1'); } catch {}
        router.push('/swap');
      } else {
        // Consolidated generic failure UX
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

  const handleEmailChange = (value: string) => {
    if (debounceTimeout.current) {
      clearTimeout(debounceTimeout.current);
    }
    debounceTimeout.current = setTimeout(() => {
      // Only show error if the field is not empty and the email is invalid
      if (value.trim() && !validateEmail(value)) {
        setEmailError(true);
      } else {
        setEmailError(false);
      }
    }, 500); // 500ms delay
  };

  return (
    <div className="min-h-screen bg-background relative flex flex-col p-6">
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

      <div className="flex-grow-[3]" />

      <div className="relative w-full max-w-sm mx-auto">
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
        <LoginForm
          onSubmit={handleSubmit}
          hasError={hasError}
          isLoading={isLoading}
          onPasswordChange={handlePasswordChange}
          onEmailChange={handleEmailChange}
          emailError={emailError}
        />
      
        {/* Accordion Menu */}
        <div className="absolute top-full w-full mt-6">
          <Accordion type="single" collapsible className="w-full">
            <AccordionItem value="access" className="border-sidebar-border">
              <AccordionTrigger className="text-white hover:no-underline text-xs font-normal py-3">
                Getting your Beta Code
              </AccordionTrigger>
              <AccordionContent className="text-muted-foreground text-xs text-balance pt-2 flex flex-col gap-4">
                <p>Getting access to the Alphix Private Beta is simple:</p>
                <ol className="flex flex-col gap-2">
                  <li className="flex items-start">
                    <span className="w-6 text-left text-white" style={{ fontFamily: 'Consolas, monospace' }}>1.</span>
                    <span>Sign up by submitting your email on our <a href="/" className="text-white hover:text-gray-200">Main Page</a></span>
                  </li>
                  <li className="flex items-start">
                    <span className="w-6 text-left text-white" style={{ fontFamily: 'Consolas, monospace' }}>2.</span>
                    <span className="flex items-center gap-1">
                      Follow us on 
                      <a 
                        href="https://x.com/AlphixFi" 
                        target="_blank" 
                        rel="noopener noreferrer" 
                        className="inline-flex items-center align-middle gap-1 text-white hover:text-gray-200"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="inline align-middle">
                          <path d="M16.9947 2H20.1115L13.5007 9.5L21.2209 20H15.2302L10.5 13.7L5.07938 20H1.96154L9.00025 12L1.60059 2H7.74871L11.9502 7.7L16.9947 2ZM16.0947 18.2L18.0947 18.2L6.89474 3.8L4.79474 3.8L16.0947 18.2Z" fill="currentColor"/>
                        </svg>
                      </a> 
                      for updates and announcements
                    </span>
                  </li>
                </ol>
                <p>Beta codes are being distributed on a rolling basis. Once you receive your code, you'll be able to access the platform.</p>
              </AccordionContent>
            </AccordionItem>
            
            <AccordionItem value="purpose" className="border-sidebar-border">
              <AccordionTrigger className="text-white hover:no-underline text-xs font-normal py-3">
                About the Beta
              </AccordionTrigger>
              <AccordionContent className="text-muted-foreground text-xs pt-2">
                <p>
                  We're testing and improving our AMM platform before mainnet launch - the user experience, smart contracts, and our dynamic fee algorithm.
                </p>
                <p className="mt-2">
                  Share your feedback with us on{" "}
                  <a 
                    href="https://discord.gg/NTXRarFbTr" 
                    target="_blank" 
                    rel="noopener noreferrer" 
                    className="inline-block items-center align-middle gap-1 text-white hover:text-gray-200"
                    style={{ verticalAlign: 'text-top' }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="inline" style={{ position: 'relative', top: '-1px' }}>
                      <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5499-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419-.019 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1568 2.4189Z" fill="currentColor"/>
                    </svg>{" "}
                    Discord
                  </a> - we appreciate all input ;)
                </p>
              </AccordionContent>
            </AccordionItem>
            
            <AccordionItem value="wallet" className="border-sidebar-border">
              <AccordionTrigger className="text-white hover:no-underline text-xs font-normal py-3">
                Setting up your Wallet
              </AccordionTrigger>
              <AccordionContent className="text-muted-foreground text-xs pt-2 flex flex-col gap-4">
                <ol className="flex flex-col gap-2">
                  <li className="flex items-start">
                    <span className="w-6 text-left text-white" style={{ fontFamily: 'Consolas, monospace' }}>1.</span>
                    <span><strong className="text-white">Your Wallet</strong> - Use an EVM-compatible wallet like <a href="https://rabby.io/" target="_blank" rel="noopener noreferrer" className="text-white hover:text-gray-200">Rabby</a></span>
                  </li>
                  <li className="flex items-start">
                    <span className="w-6 text-left text-white" style={{ fontFamily: 'Consolas, monospace' }}>2.</span>
                    <span><strong className="text-white">Add Network</strong> - Connect to <a href="https://docs.base.org/base-chain/quickstart/connecting-to-base#base-testnet-sepolia" target="_blank" rel="noopener noreferrer" className="text-white hover:text-gray-200">Base Sepolia</a></span>
                  </li>
                  <li className="flex items-start">
                    <span className="w-6 text-left text-white" style={{ fontFamily: 'Consolas, monospace' }}>3.</span>
                    <span><strong className="text-white">Get ETH</strong> - Claim free test tokens from a <a href="https://www.alchemy.com/faucets/base-sepolia" target="_blank" rel="noopener noreferrer" className="text-white hover:text-gray-200">Faucet</a></span>
                  </li>
                </ol>
                <p>You're all set. Explore Alphix and help us build the future of AMMs.</p>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      </div>
      
      <div className="flex-grow-[4]" />
    </div>
  );
} 