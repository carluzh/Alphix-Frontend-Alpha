'use client';

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronRight, Check, X, Loader2 } from "lucide-react";

interface RequestAccessButtonProps {
  className?: string;
  style?: React.CSSProperties;
}

type ButtonState = 'button' | 'input' | 'loading' | 'success' | 'error';

export function RequestAccessButton({ className, style }: RequestAccessButtonProps) {
  const [state, setState] = React.useState<ButtonState>('button');
  const [email, setEmail] = React.useState('');

  const inputRef = React.useRef<HTMLInputElement>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);

  // Handle click outside to revert to button state
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        if (state === 'input' || state === 'error') {
          setState('button');
          setEmail('');
        }
      }
    };

    if (state === 'input' || state === 'error') {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [state]);

  // Focus input when switching to input state
  React.useEffect(() => {
    if (state === 'input' && inputRef.current) {
      inputRef.current.focus();
    }
  }, [state]);

  const handleButtonClick = () => {
    if (state === 'button' || state === 'error') {
      setState('input');
    }
  };

  const validateEmail = (email: string) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const handleSubmit = async () => {
    if (!email.trim()) {
      setState('error');
      return;
    }

    if (!validateEmail(email)) {
      setState('error');
      return;
    }

    setState('loading');

    try {
      // Simulate API call - replace with your actual API endpoint
      const response = await fetch('/api/request-access', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email }),
      });

      if (response.ok) {
        setState('success');
      } else {
        setState('error');
      }
    } catch (error) {
      setState('error');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSubmit();
    } else if (e.key === 'Escape') {
      setState('button');
      setEmail('');
    }
  };

  return (
    <div ref={containerRef} className="relative">
      {state === 'button' && (
        <Button 
          variant="ghost" 
          className={`flex items-center px-4 py-4 h-12 bg-transparent hover:bg-[#1e1d1b] rounded-md group cursor-pointer ${className}`}
          style={style}
          onClick={handleButtonClick}
        >
          <div className="flex items-center justify-center">
            <span className="text-base" style={{
              background: 'linear-gradient(90deg, #FFFFFF 0%, #888888 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text'
            }}>
              Request Access
            </span>
            <ChevronRight className="ml-1 h-4 w-4 text-[#888888]" style={{ transform: 'translateY(2px)' }} />
          </div>
        </Button>
      )}

      {(state === 'input' || state === 'error') && (
        <div className="flex items-center gap-2">
          <div className="relative">
            <Input
              ref={inputRef}
              type="email"
              placeholder="Enter your email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={handleKeyDown}
              className={`bg-transparent border-[#333] text-white placeholder:text-[#888888] focus:border-[#333] focus:ring-0 focus:ring-offset-0 focus:outline-none focus-visible:ring-0 focus-visible:border-[#333] h-12 pr-10 ${
                state === 'error' ? 'border-red-500 focus-visible:border-red-500' : ''
              }`}
            />
            <button
              onClick={handleSubmit}
              className="absolute right-2 top-1/2 transform -translate-y-1/2 p-1 hover:bg-[#1e1d1b] rounded transition-colors"
            >
              <ChevronRight className={`h-4 w-4 transition-colors ${
                state === 'error' ? 'text-red-500' : 'text-[#888888] hover:text-white'
              }`} />
            </button>
          </div>
        </div>
      )}

      {state === 'loading' && (
        <div className="flex items-center gap-2 px-4 py-4 h-12">
          <Loader2 className="h-4 w-4 animate-spin text-[#888888]" />
          <span className="text-[#888888]">Submitting...</span>
        </div>
      )}

      {state === 'success' && (
        <div 
          className={`flex items-center px-4 py-4 h-12 bg-transparent hover:bg-[#1e1d1b] rounded-md cursor-default ${className}`}
          style={style}
        >
          <div className="flex items-center justify-center">
            <span className="text-base" style={{
              background: 'linear-gradient(90deg, #FFFFFF 0%, #888888 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text'
            }}>
              Access Requested
            </span>
          </div>
        </div>
      )}
    </div>
  );
} 