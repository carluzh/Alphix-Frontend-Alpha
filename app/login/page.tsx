"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

export default function LoginPage() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

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
      <div className="flex gap-4 w-full max-w-4xl">
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
        <Card className="w-96">
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
  );
} 