"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { ChevronLeftIcon } from "lucide-react";

export default function LoginPage() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();
  const isMobile = useIsMobile();

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        router.push('/swap');
      } else {
        const data = await res.json();
        setError(data.message || 'Login failed. Please try again.');
      }
    } catch (err) {
      console.error("Login page error:", err);
      setError('An unexpected error occurred. Please try again.');
    }

    setIsLoading(false);
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-background p-6">
      <div className="w-full max-w-4xl">
        {/* Back button */}
        <div className="mb-2 flex items-center justify-between">
          <Button 
            variant="ghost" 
            onClick={() => router.push('/')}
            className="pl-2"
          >
            <ChevronLeftIcon className="mr-2 h-4 w-4" /> Back to Main
          </Button>

          <a 
            href="https://x.com/AlphixFi" 
            target="_blank" 
            rel="noopener noreferrer" 
            className="flex items-center justify-center w-8 h-8 rounded-full hover:bg-[#1e1d1b] transition-colors cursor-pointer group"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M16.9947 2H20.1115L13.5007 9.5L21.2209 20H15.2302L10.5 13.7L5.07938 20H1.96154L9.00025 12L1.60059 2H7.74871L11.9502 7.7L16.9947 2ZM16.0947 18.2L18.0947 18.2L6.89474 3.8L4.79474 3.8L16.0947 18.2Z" fill="#a5a5a5" className="group-hover:fill-white transition-colors"/>
            </svg>
          </a>
        </div>

        <div className={`flex gap-4 w-full ${isMobile ? 'flex-col' : 'flex-row'}`}>
          {/* Left component - Title and Description */}
          <Card className="flex-1">
            <CardHeader>
              <CardTitle className="text-2xl">Access Private Alpha</CardTitle>
              <CardDescription className="space-y-2">
                <p>Welcome to the Alphix private alpha. This is an early version where features and interfaces may change frequently.</p>
                <p>Test tokens can be claimed through the faucet once you're inside. We appreciate any feedback you have—please reach out to us at <a href="mailto:contact@alphix.fi" className="text-primary hover:underline">contact@alphix.fi</a>.</p>
              </CardDescription>
            </CardHeader>
          </Card>

          {/* Right component - Password Input and Unlock */}
          <Card className={isMobile ? 'w-full' : 'w-96'}>
            <form onSubmit={handleSubmit}>
              <CardContent className="space-y-4 pt-6">
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    placeholder="Enter your password"
                  />
                </div>
                {error && (
                  <p className="text-sm text-destructive">{error}</p>
                )}
              </CardContent>
              <CardFooter>
                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? 'Unlocking...' : 'Unlock'}
                </Button>
              </CardFooter>
            </form>
          </Card>
        </div>
      </div>
    </div>
  );
} 