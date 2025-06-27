'use client';

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronRight, Menu, X } from "lucide-react";
import { RequestAccessButton } from "@/components/RequestAccessButton";
import DisplayCards from "@/components/ui/display-cards";
import { toast } from "sonner";
import { PulsatingDot } from "@/components/pulsating-dot";
import { MockSwapComponent } from "@/components/swap/MockSwapComponent";
import { useRouter } from 'next/navigation';

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";



export default function Home() {
  const router = useRouter();
  const textContainerRef = useRef<HTMLDivElement>(null);
  const [rightMargin, setRightMargin] = useState(0);
  const [showNavbar, setShowNavbar] = useState(true);
  const [currentWord, setCurrentWord] = useState('');
  const [wordIndex, setWordIndex] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isAnimationComplete, setIsAnimationComplete] = useState(false);
  const [showFinalDot, setShowFinalDot] = useState(false);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const [isHovering, setIsHovering] = useState(false);
  const [animationFinished, setAnimationFinished] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isPoolsImageHovered, setIsPoolsImageHovered] = useState(false);

  const words = ['dynamic', 'composable', 'efficient', 'unified', 'here'];

  const imageStyle = {
    transform: `perspective(1000px) rotateY(-12deg) rotateX(4deg) ${isPoolsImageHovered ? 'translateY(-8px)' : ''}`,
    transition: 'transform 0.3s ease-in-out',
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!animationFinished) return;
    
    const rect = e.currentTarget.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const mouseX = e.clientX - centerX;
    const mouseY = e.clientY - centerY;
    
    setMousePosition({ x: mouseX * 0.02, y: mouseY * -0.01 });
  };

  const handleMouseEnter = () => {
    if (!animationFinished) return;
    setIsHovering(true);
  };

  const handleMouseLeave = () => {
    setIsHovering(false);
    setMousePosition({ x: 0, y: 0 });
  };

  const handleAnimationEnd = () => {
    setAnimationFinished(true);
  };

  const handleNavigateToSwap = () => {
    window.location.href = '/swap';
  };

  const handleCopyEmail = async () => {
    try {
      await navigator.clipboard.writeText('contact@alphix.fi');
      toast.success("Email Address Copied!");
    } catch (error) {
      // Fallback for older browsers
      const textArea = document.createElement("textarea");
      textArea.value = 'contact@alphix.fi';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      try {
        document.execCommand('copy');
        toast.success("Email Address Copied!");
      } catch (fallbackError) {
        toast.error("Failed to copy email address");
      }
      document.body.removeChild(textArea);
    }
  };

  useEffect(() => {
    const typeSpeed = isDeleting ? 50 : 100;
    const word = words[wordIndex];
    
    const timer = setTimeout(() => {
      if (!isDeleting && currentWord === word) {
        // If it's the last word ("here"), don't delete it and add a dot
        if (wordIndex === words.length - 1) {
          if (!showFinalDot) {
            setTimeout(() => {
              setShowFinalDot(true);
              setIsAnimationComplete(true);
            }, 500);
          }
          return;
        }
        // Word is complete, wait then start deleting
        setTimeout(() => setIsDeleting(true), 1500);
      } else if (isDeleting && currentWord === '') {
        // Finished deleting, move to next word
        setIsDeleting(false);
        setWordIndex((prev) => (prev + 1) % words.length);
      } else if (isDeleting) {
        // Continue deleting
        setCurrentWord(word.substring(0, currentWord.length - 1));
      } else {
        // Continue typing
        setCurrentWord(word.substring(0, currentWord.length + 1));
      }
    }, typeSpeed);

    return () => clearTimeout(timer);
  }, [currentWord, wordIndex, isDeleting, words, showFinalDot]);

  useEffect(() => {
    const calculateMargin = () => {
      if (textContainerRef.current) {
        const rect = textContainerRef.current.getBoundingClientRect();
        setRightMargin(rect.x);
      }
    };

    const handleScroll = () => {
      const scrollY = window.scrollY;
      const windowHeight = window.innerHeight;
      const scrollPercent = scrollY / windowHeight;
      
      // Hide navbar when scrolled 25% down the first page
      setShowNavbar(scrollPercent < 0.25);
    };

    const observer = new ResizeObserver(calculateMargin);
    if (document.body) {
      observer.observe(document.body);
    }
    
    calculateMargin();
    window.addEventListener('resize', calculateMargin);
    window.addEventListener('scroll', handleScroll);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', calculateMargin);
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  return (
    <div className="bg-black" style={{background: '#0a0908'}}>
      {/* CSS Keyframes for interactive animations */}
      <style jsx>{`
        @keyframes swapSlideIn {
          0% {
            opacity: 0;
            transform: translateY(calc(-50% + 40px)) perspective(1000px) rotateY(-5deg);
          }
          100% {
            opacity: 1;
            transform: translateY(calc(-50% - 20px)) perspective(1000px) rotateY(-5deg);
          }
        }
        
        @keyframes swapSlideInLarge {
          0% {
            opacity: 0;
            transform: translateY(calc(-50% + 50px)) perspective(1000px) rotateY(-5deg);
          }
          100% {
            opacity: 1;
            transform: translateY(calc(-50% - 20px)) perspective(1000px) rotateY(-5deg);
          }
        }
      `}</style>

      {/* Navbar */}
      <Navbar 
        showNavbar={showNavbar} 
        isMobileMenuOpen={isMobileMenuOpen}
        setIsMobileMenuOpen={setIsMobileMenuOpen}
      />
      
      {/* Main Hero Section */}
      <section className="relative h-[95vh] max-h-[1120px] w-full overflow-hidden">
        {/* WebGL Canvas */}
        <WebGLCanvas rightMargin={rightMargin} />
        
        {/* Text Overlay - moved up to show second section peek */}
        <div className="absolute inset-0 z-20 text-white">
          <div ref={textContainerRef} className="w-full max-w-5xl 2xl:max-w-screen-xl mx-auto h-full relative px-4 sm:px-6 md:px-8">
            
            {/* Main content positioned in center-upper area */}
            <div className="absolute top-[45%] transform -translate-y-1/2">
              {/* Badges */}
              <motion.div 
                className="flex flex-wrap gap-2 mb-4"
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 1.8, ease: "easeOut" }}
              >
                <Badge variant="default" className="flex items-center bg-[#1e1d1b] text-white pl-1.5 pr-3 py-1 transition-all duration-300 hover:bg-[#2a2928]" style={{ fontFamily: 'Inter, sans-serif', fontWeight: 450 }}>
                  <PulsatingDot color="#22c55e" size={2.5} pulseBaseRadius={4} className="mr-1" />
                  Private Alpha
                </Badge>
              </motion.div>
              
              {/* Main heading */}
              <div className="text-5xl mb-6" style={{ fontFamily: 'Inter, sans-serif', fontWeight: 550 }}>
                {/* First line: "We Build Better Markets." */}
                <div className="mb-3">
                  {"We Build Better Markets.".split(" ").map((word, index, array) => (
                    <span key={index}>
                      <motion.span
                        className="inline-block"
                        initial={{ 
                          opacity: 0, 
                          y: 20, 
                          filter: "blur(8px)" 
                        }}
                        animate={{ 
                          opacity: 1, 
                          y: 0, 
                          filter: "blur(0px)" 
                        }}
                        transition={{ 
                          duration: 0.8, 
                          delay: index * 0.15,
                          ease: "easeOut" 
                        }}
                      >
                        {word}
                      </motion.span>
                      {index < array.length - 1 && " "}
                    </span>
                  ))}
                </div>
                
                {/* Second line: "For Everyone." */}
                <div style={{ marginTop: '0.75rem' }}>
                  {"For Everyone.".split(" ").map((word, index, array) => (
                    <span key={index}>
                      <motion.span
                        className="inline-block"
                        initial={{ 
                          opacity: 0, 
                          y: 20, 
                          filter: "blur(8px)" 
                        }}
                        animate={{ 
                          opacity: 1, 
                          y: 0, 
                          filter: "blur(0px)" 
                        }}
                        transition={{ 
                          duration: 0.8, 
                          delay: 1.2 + index * 0.15, // Increased delay for bigger gap between lines
                          ease: "easeOut" 
                        }}
                      >
                        {word}
                      </motion.span>
                      {index < array.length - 1 && " "}
                    </span>
                  ))}
                </div>
              </div>
              
              {/* Subtitle */}
              <motion.p 
                className="text-xl mb-8" 
                style={{ fontFamily: 'Inter, sans-serif', marginTop: '-4px', color: 'rgba(255, 255, 255, 0.65)' }}
                initial={{ opacity: 0, y: 20, filter: "blur(4px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                transition={{ duration: 0.6, delay: 1.8, ease: "easeOut" }}
              >
                Innovative Features at your Fingertips.<br />Dynamic Fees. Rehypothecation. Liquidity Automation.
              </motion.p>
              
              {/* Action buttons */}
              <motion.div 
                className="flex items-center gap-6"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 2.1, ease: "easeOut" }}
              >
                <Button 
                  variant="alphix"
                  className="text-base flex items-center px-4 py-4 h-11 rounded-md cursor-pointer" 
                  style={{ fontFamily: 'Inter, sans-serif' }}
                  onClick={handleNavigateToSwap}
                >
                  <div className="flex items-center justify-center">
                    Open App
                  </div>
                </Button>
                <RequestAccessButton 
                  style={{ 
                    fontFamily: 'Inter, sans-serif'
                  }}
                />
              </motion.div>
            </div>
            
            {/* Swap Component - Large screens (2xl+) */}
            <div 
              className="absolute right-[-20px] top-1/2 z-10 hidden 2xl:block" 
              style={{ 
                opacity: animationFinished ? 1 : 0,
                animation: animationFinished ? 'none' : 'swapSlideInLarge 1.2s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards',
                transform: animationFinished 
                  ? `translateY(calc(-50% - ${isHovering ? 30 : 20}px)) perspective(1000px) rotateY(${-5 + mousePosition.x}deg) rotateX(${mousePosition.y}deg)`
                  : undefined,
                transition: animationFinished ? 'transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)' : 'none'
              }}
              onMouseMove={handleMouseMove}
              onMouseEnter={handleMouseEnter}
              onMouseLeave={handleMouseLeave}
              onAnimationEnd={handleAnimationEnd}
            >
              <div 
                className="cursor-pointer"
                style={{ 
                  filter: 'drop-shadow(0 4px 20px rgba(0, 0, 0, 0.25))'
                }}
                onClick={handleNavigateToSwap}
              >
                <MockSwapComponent zoom={1.2} />
              </div>
            </div>
            
            {/* Swap Component - Medium screens (custom breakpoint to 2xl) */}
            <div 
              className="absolute right-[0px] top-1/2 z-10 hidden min-[1010px]:block 2xl:hidden" 
              style={{ 
                opacity: animationFinished ? 1 : 0,
                animation: animationFinished ? 'none' : 'swapSlideIn 1.2s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards',
                transform: animationFinished 
                  ? `translateY(calc(-50% - ${isHovering ? 30 : 20}px)) perspective(1000px) rotateY(${-5 + mousePosition.x}deg) rotateX(${mousePosition.y}deg)`
                  : undefined,
                transition: animationFinished ? 'transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)' : 'none'
              }}
              onMouseMove={handleMouseMove}
              onMouseEnter={handleMouseEnter}
              onMouseLeave={handleMouseLeave}
              onAnimationEnd={handleAnimationEnd}
            >
              <div 
                className="cursor-pointer"
                style={{ 
                  filter: 'drop-shadow(0 4px 20px rgba(0, 0, 0, 0.25))'
                }}
                onClick={handleNavigateToSwap}
              >
                <MockSwapComponent zoom={0.9} />
              </div>
            </div>
            
          </div>
        </div>
      </section>

      {/* Second Section - Overlapping with normal scroll */}
      <section className="relative min-h-screen text-white z-30" style={{background: '#0a0908'}}>
        <div className="w-full max-w-5xl 2xl:max-w-screen-xl mx-auto pt-32 pb-20 px-4 sm:px-6 md:px-8">
          {/* Header section */}
          <div className="mb-10">
            {/* Badge */}
            <div className="flex flex-wrap gap-2 mb-6">
              <Badge variant="default" className="flex items-center bg-[#1e1d1b] text-white px-3 py-1 transition-all duration-300 hover:bg-[#2a2928]" style={{ fontFamily: 'Inter, sans-serif', fontWeight: 450 }}>
                Our Vision
              </Badge>
            </div>
            
            <div className="relative">
              <div className="grid grid-cols-1 md:grid-cols-3">
                <div className="md:col-span-2">
                  <h2 className="text-5xl min-[1010px]:text-4xl 2xl:text-5xl" style={{ fontFamily: 'Inter, sans-serif', fontWeight: 450 }}>
                    To Unify AMM<br /><span style={{ display: 'block', marginTop: '0.75rem' }}>Innovation.</span>
                  </h2>
                </div>
              </div>
              
              <div className="relative mt-6 md:absolute md:top-0 md:left-[calc(33.333%-0.125rem)] md:mt-0">
                <p className="text-base pl-0 max-w-lg" style={{ fontFamily: 'Inter, sans-serif', color: 'rgba(255, 255, 255, 0.65)', lineHeight: '1.5' }}>
                  Hooks create modular AMM innovation. We serve as the aggregation layer on top of existing infrastructure to build and consolidate exciting features into a single pool.
                </p>
              </div>
            </div>
          </div>

                    {/* Three feature sections with dividers */}
          <div className="relative">
            {/* Top horizontal divider line */}
            <div className="w-full h-0.5 bg-white/5 z-30 relative"></div>
            
            <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3">
              {/* Section 1 */}
              <div className="p-12 pb-24 relative overflow-hidden lg:col-span-2 2xl:col-span-1">
                <div className="lg:grid lg:grid-cols-2 lg:items-center lg:gap-8 2xl:block">
                  <div>
                    <h3 className="relative z-20 text-xl font-medium text-white mb-2" style={{ fontFamily: 'Inter, sans-serif' }}>
                      Composable Features
                    </h3>
                    <p className="relative z-20 text-base mb-6" style={{ fontFamily: 'Inter, sans-serif', color: 'rgba(255, 255, 255, 0.65)', lineHeight: '1.5', fontWeight: 300 }}>
                      Continuously expanding to improve efficiency and user experience.
                    </p>
                  </div>
                  
                  {/* DisplayCards component */}
                  <div className="flex justify-center mt-12 relative scale-[1.1] -translate-x-6 lg:mt-0 lg:scale-100 lg:translate-x-0 lg:-translate-y-4 2xl:mt-12 2xl:scale-110 2xl:-translate-x-10 2xl:translate-y-4">
                    <DisplayCards />
                  </div>
                </div>

                {/* Right Edge Shadow */}
                
                {/* Vertical divider line - right */}
                <div className="hidden 2xl:block absolute top-0 right-0 w-0.5 bg-white/5 z-20" style={{ height: 'calc(100% - 3rem)' }}></div>
              </div>

              {/* Mobile-only divider */}
              <div className="w-full h-0.5 bg-white/5 lg:hidden mt-10"></div>

              {/* Horizontal divider for tablet view */}
              <div className="hidden lg:block 2xl:hidden col-span-2 w-full h-0.5 bg-white/5"></div>

              {/* Section 2 */}
              <div className="p-12 relative">
                <h3 className="relative z-20 text-xl font-medium text-white mb-2" style={{ fontFamily: 'Inter, sans-serif' }}>
                  Infrastructure Agnostic
                </h3>
                <p className="relative z-20 text-base mb-6" style={{ fontFamily: 'Inter, sans-serif', color: 'rgba(255, 255, 255, 0.65)', lineHeight: '1.5', fontWeight: 300 }}>
                  Flexible foundation that adapts to different pool types and environments.
                </p>
                
                {/* Image */}
                <div className="flex justify-center items-center w-full lg:aspect-square scale-90">
                  <img src="/InfraAgnostic.png" alt="Infrastructure Agnostic" className="w-full" />
                </div>
                
                {/* Vertical divider line - right */}
                <div className="hidden lg:block absolute top-0 right-0 w-0.5 bg-white/5" style={{ height: 'calc(100% - 3rem)' }}></div>
              </div>

              {/* Mobile-only divider */}
              <div className="w-full h-0.5 bg-white/5 lg:hidden"></div>

              {/* Section 3 */}
              <div className="p-12">
                <h3 className="relative z-20 text-xl font-medium text-white mb-2" style={{ fontFamily: 'Inter, sans-serif' }}>
                  Crafted to Perfection
                </h3>
                <p className="relative z-20 text-base mb-6" style={{ fontFamily: 'Inter, sans-serif', color: 'rgba(255, 255, 255, 0.65)', lineHeight: '1.5', fontWeight: 300 }}>
                  Abstracting complexity through a simple, elegant interface.
                </p>
                
                {/* Image */}
                <div className="flex justify-center items-center w-full aspect-square relative overflow-hidden -mt-12 z-0 lg:scale-80 2xl:scale-100">
                  <img src="/TemporaryCraft.png" alt="Crafted to Perfection" className="w-[100%] max-w-none z-0" />
                  <div className="absolute inset-0 pointer-events-none z-0" style={{
                    background: 'radial-gradient(circle, transparent 40%, #0a0908 85%, #0a0908 100%)'
                  }} />
                </div>
              </div>
            </div>
            
            {/* Bottom horizontal divider line */}
            <div className="w-full h-0.5 bg-white/5 -mt-12"></div>
          </div>

          <div className="mt-32">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 items-start">
              {/* Left side with title and description */}
              <div className="space-y-6">
                <div className="flex flex-wrap gap-2">
                  <Badge variant="default" className="flex items-center bg-[#1e1d1b] text-white px-3 py-1 transition-all duration-300 hover:bg-[#2a2928]" style={{ fontFamily: 'Inter, sans-serif', fontWeight: 450 }}>
                    Product
                  </Badge>
                </div>
                <h2 className="text-5xl min-[1010px]:text-4xl 2xl:text-5xl" style={{ fontFamily: 'Inter, sans-serif', fontWeight: 450 }}>
                  Unified Pools
                </h2>
                <p className="text-base" style={{ fontFamily: 'Inter, sans-serif', color: 'rgba(255, 255, 255, 0.65)', lineHeight: '1.5' }}>
                  Our Dynamic Fee Algorithm is the first feature offered through Unified Pools. It was built to counteract the liquidity fragmentation inherent in today's static fee-tier AMMs, creating a more efficient market for traders and liquidity providers.
                </p>
              </div>
              
              {/* Right side with angled image */}
              <div 
                className="relative w-full flex items-start justify-center mt-8 md:mt-0 cursor-pointer"
                onMouseEnter={() => setIsPoolsImageHovered(true)}
                onMouseLeave={() => setIsPoolsImageHovered(false)}
                onClick={() => router.push('/swap')}
              >
                <div className="relative w-full max-w-full" style={imageStyle}>
                  <div className="relative">
                    <img 
                      src="/Unified-Hook.png" 
                      alt="Unified Pools Architecture" 
                      className="w-full rounded-lg shadow-2xl"
                    />
                    <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-[#0a0908] to-transparent"></div>
                  </div>
                </div>
              </div>
            </div>

            {/* Features in a horizontal row */}
            <div className="mt-24 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-x-8 gap-y-10">
              {/* Feature 1: Adaptive Pricing */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-3">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-area-chart text-white flex-shrink-0">
                    <path d="M3 3v18h18"/>
                    <path d="M7 12v5h12V8l-5 5-4-4Z"/>
                  </svg>
                  <h4 className="text-base font-medium text-white">Adaptive Pricing</h4>
                </div>
                <p className="text-sm" style={{ color: 'rgba(255, 255, 255, 0.65)' }}>Dynamic fees respond to Volume and TVL in real-time for optimal performance.</p>
              </div>
              
              {/* Feature 2: Capital Efficiency */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-3">
                   <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-chevrons-up text-white flex-shrink-0">
                    <path d="m17 11-5-5-5 5"/>
                    <path d="m17 18-5-5-5 5"/>
                  </svg>
                  <h4 className="text-base font-medium text-white">Capital Efficiency</h4>
                </div>
                <p className="text-sm" style={{ color: 'rgba(255, 255, 255, 0.65)' }}>Optimized fee structure maximizes liquidity usage and provider returns.</p>
              </div>
              
              {/* Feature 3: Trustless */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-3">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-loader text-white flex-shrink-0">
                    <line x1="12" x2="12" y1="2" y2="6"/>
                    <line x1="12" x2="12" y1="18" y2="22"/>
                    <line x1="4.93" x2="7.76" y1="4.93" y2="7.76"/>
                    <line x1="16.24" x2="19.07" y1="16.24" y2="19.07"/>
                    <line x1="2" x2="6" y1="12" y2="12"/>
                    <line x1="18" x2="22" y1="12" y2="12"/>
                    <line x1="4.93" x2="7.76" y1="19.07" y2="16.24"/>
                    <line x1="16.24" x2="19.07" y1="7.76" y2="4.93"/>
                  </svg>
                  <h4 className="text-base font-medium text-white">Trustless</h4>
                </div>
                <p className="text-sm" style={{ color: 'rgba(255, 255, 255, 0.65)' }}>All data is sourced on-chain directly without relying on external oracles.</p>
              </div>
              
              {/* Feature 4: Enhanced Security */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-3">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-blocks text-white flex-shrink-0">
                    <rect width="7" height="7" x="14" y="3" rx="1"/>
                    <path d="M10 21V8a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5a1 1 0 0 0-1-1H3"/>
                  </svg>
                  <h4 className="text-base font-medium text-white">Enhanced Security</h4>
                </div>
                <p className="text-sm" style={{ color: 'rgba(255, 255, 255, 0.65)' }}>Built on battle-tested infrastructure with minimal attack vectors.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative text-white z-30" style={{background: '#0a0908'}}>
        {/* Horizontal divider */}
        <div className="w-full h-px bg-white/10"></div>
        
        <div className="w-full max-w-5xl 2xl:max-w-screen-xl mx-auto py-12 px-4 sm:px-6 md:px-8">
          <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-8">
            {/* Logo */}
            <div className="flex items-start">
              <div className="h-8 w-8">
                <img 
                  src="/LogoIconWhite.svg" 
                  alt="Alphix Logo Icon" 
                  className="h-full w-full"
                />
              </div>
            </div>
            
            {/* Resources and Connect - closer together on the right */}
            <div className="flex flex-col sm:flex-row gap-8">
              {/* Resources */}
              <div>
                <h3 className="text-sm font-medium mb-4" style={{ fontFamily: 'Consolas, monospace', fontWeight: 500, color: '#a5a5a5' }}>
                  Resources
                </h3>
                <div className="space-y-3">
                  <a 
                    href="https://github.com/alphixfi/alphixv0-core/tree/main/branding-materials/logos" 
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-sm text-[#c2c2c1] hover:text-white transition-colors cursor-pointer"
                    style={{ fontFamily: 'Inter, sans-serif' }}
                  >
                    Brand Kit
                  </a>
                </div>
              </div>
              
              {/* Connect */}
              <div>
                <h3 className="text-sm font-medium mb-4" style={{ fontFamily: 'Consolas, monospace', fontWeight: 500, color: '#a5a5a5' }}>
                  Connect
                </h3>
                <div className="space-y-3">
                  <button 
                    onClick={handleCopyEmail}
                    className="block text-sm text-[#c2c2c1] hover:text-white transition-colors cursor-pointer text-left"
                    style={{ fontFamily: 'Inter, sans-serif' }}
                  >
                    Mail
                  </button>
                  <a 
                    href="https://x.com/AlphixFi" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="block text-sm text-[#c2c2c1] hover:text-white transition-colors cursor-pointer"
                    style={{ fontFamily: 'Inter, sans-serif' }}
                  >
                    X (Twitter)
                  </a>
                  <a 
                    href="https://github.com/alphixfi" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="block text-sm text-[#c2c2c1] hover:text-white transition-colors cursor-pointer"
                    style={{ fontFamily: 'Inter, sans-serif' }}
                  >
                    GitHub
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Navbar({ 
  showNavbar, 
  isMobileMenuOpen, 
  setIsMobileMenuOpen 
}: { 
  showNavbar: boolean;
  isMobileMenuOpen: boolean;
  setIsMobileMenuOpen: (open: boolean) => void;
}) {
  const handleComingSoon = () => {
    toast.info("Coming Soon", {
      position: "bottom-right",
    });
  };

  return (
    <>
      <nav 
        className={`fixed top-0 left-0 right-0 z-50 bg-[#0a0907] transition-transform duration-300 ease-in-out ${
          showNavbar ? 'transform translate-y-0' : 'transform -translate-y-full'
        }`}
      >
        <div className="w-full max-w-5xl 2xl:max-w-screen-xl mx-auto py-4 flex justify-between items-center px-4 sm:px-6 md:px-8">
          {/* Logo - increased size for mobile */}
          <div className="flex items-center gap-2">
            <div className="h-7 sm:h-8 md:h-6">
              <img 
                src="/Logo Type (white).svg" 
                alt="Alphix Logotype" 
                className="h-full w-auto"
              />
            </div>
          </div>
          
          {/* Desktop Navigation Links */}
          <div className="hidden md:flex items-center gap-4">
            <Button 
              variant="ghost"
              className="text-sm px-4 py-2 h-auto bg-transparent hover:bg-[#1e1d1b] text-[#a5a5a5] hover:text-white rounded-md cursor-pointer"
              style={{ fontFamily: 'Consolas, monospace', fontWeight: 500 }}
              onClick={handleComingSoon}
            >
              Documentation
            </Button>
            <Button 
              variant="ghost"
              className="text-sm px-4 py-2 h-auto bg-transparent hover:bg-[#1e1d1b] text-[#a5a5a5] hover:text-white rounded-md cursor-pointer"
              style={{ fontFamily: 'Consolas, monospace', fontWeight: 500 }}
              onClick={handleComingSoon}
            >
              Analytics
            </Button>
            <Button 
              variant="ghost"
              className="text-sm px-4 py-2 h-auto bg-transparent hover:bg-[#1e1d1b] text-[#a5a5a5] hover:text-white rounded-md cursor-pointer"
              style={{ fontFamily: 'Consolas, monospace', fontWeight: 500 }}
              onClick={handleComingSoon}
            >
              Security
            </Button>
            <a 
              href="https://x.com/AlphixFi" 
              target="_blank" 
              rel="noopener noreferrer" 
              className="ml-2 flex items-center justify-center w-8 h-8 rounded-full hover:bg-[#1e1d1b] transition-colors cursor-pointer group"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M16.9947 2H20.1115L13.5007 9.5L21.2209 20H15.2302L10.5 13.7L5.07938 20H1.96154L9.00025 12L1.60059 2H7.74871L11.9502 7.7L16.9947 2ZM16.0947 18.2L18.0947 18.2L6.89474 3.8L4.79474 3.8L16.0947 18.2Z" fill="#a5a5a5" className="group-hover:fill-white transition-colors"/>
              </svg>
            </a>
          </div>

          {/* Mobile Hamburger Menu Button */}
          <button
            className="md:hidden flex items-center justify-center w-10 h-10 rounded-md hover:bg-[#1e1d1b] transition-colors"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            aria-label="Toggle mobile menu"
          >
            {isMobileMenuOpen ? (
              <X size={24} className="text-[#a5a5a5]" />
            ) : (
              <Menu size={24} className="text-[#a5a5a5]" />
            )}
          </button>
        </div>
        {/* 1px line below navbar */}
        <div className="w-full h-px bg-white/10"></div>
      </nav>

      {/* Mobile Menu Overlay */}
      {isMobileMenuOpen && (
        <div 
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        >
          <div 
            className="fixed top-[73px] left-0 right-0 bg-[#0a0907] border-t border-white/10"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-6 space-y-4">
              <Button 
                variant="ghost"
                className="w-full text-left justify-start text-base px-4 py-3 h-auto bg-transparent hover:bg-[#1e1d1b] text-[#a5a5a5] hover:text-white rounded-md cursor-pointer"
                style={{ fontFamily: 'Consolas, monospace', fontWeight: 500 }}
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  handleComingSoon();
                }}
              >
                Documentation
              </Button>
              <Button 
                variant="ghost"
                className="w-full text-left justify-start text-base px-4 py-3 h-auto bg-transparent hover:bg-[#1e1d1b] text-[#a5a5a5] hover:text-white rounded-md cursor-pointer"
                style={{ fontFamily: 'Consolas, monospace', fontWeight: 500 }}
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  handleComingSoon();
                }}
              >
                Analytics
              </Button>
              <Button 
                variant="ghost"
                className="w-full text-left justify-start text-base px-4 py-3 h-auto bg-transparent hover:bg-[#1e1d1b] text-[#a5a5a5] hover:text-white rounded-md cursor-pointer"
                style={{ fontFamily: 'Consolas, monospace', fontWeight: 500 }}
                onClick={() => {
                  setIsMobileMenuOpen(false);
                  handleComingSoon();
                }}
              >
                Security
              </Button>
              <div className="pt-4 border-t border-white/10">
                <a 
                  href="https://x.com/AlphixFi" 
                  target="_blank" 
                  rel="noopener noreferrer" 
                  className="flex items-center justify-center w-10 h-10 rounded-md hover:bg-[#1e1d1b] transition-colors cursor-pointer group"
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M16.9947 2H20.1115L13.5007 9.5L21.2209 20H15.2302L10.5 13.7L5.07938 20H1.96154L9.00025 12L1.60059 2H7.74871L11.9502 7.7L16.9947 2ZM16.0947 18.2L18.0947 18.2L6.89474 3.8L4.79474 3.8L16.0947 18.2Z" fill="#a5a5a5" className="group-hover:fill-white transition-colors"/>
                  </svg>
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function WebGLCanvas({ rightMargin }: { rightMargin: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const marginRef = useRef(rightMargin);

  useEffect(() => {
    marginRef.current = rightMargin;
  }, [rightMargin]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) {
      console.error('WebGL not supported');
      return;
    }

    // Vertex shader source (from their code)
    const vertexShaderSource = `
      attribute vec2 a_position;
      attribute vec2 a_texCoord;
      varying vec2 v_texCoord;
      
      void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
        v_texCoord = a_texCoord;
      }
    `;

    // Fragment shader source (adapted from their code)
    const fragmentShaderSource = `
      #ifdef GL_FRAGMENT_PRECISION_HIGH
        precision highp float;
      #else
        precision mediump float;
      #endif

      uniform vec2 u_resolution;
      uniform float u_time;
      uniform bool u_pixelation;
      uniform float u_right_margin;

      varying vec2 v_texCoord;

      #define PI 3.14159265359

      // --- Noise Functions ---
      
      // As seen in https://blog.frost.kiwi/GLSL-noise-and-radial-gradient/
      // From Jorge Jimenez's presentation http://www.iryoku.com/next-generation-post-processing-in-call-of-duty-advanced-warfare
      float interleavedGradientNoise(in vec2 uv) {
        return fract(52.9829189 * fract(dot(uv, vec2(0.06711056, 0.00583715))));
      }

      // 3D Simplex noise by Stefan Gustavson, from https://github.com/stegu/webgl-noise
      vec3 mod289(vec3 x) {
        return x - floor(x * (1.0 / 289.0)) * 289.0;
      }

      vec4 mod289(vec4 x) {
        return x - floor(x * (1.0 / 289.0)) * 289.0;
      }

      vec4 permute(vec4 x) {
        return mod289(((x*34.0)+1.0)*x);
      }

      vec4 taylorInvSqrt(vec4 r) {
        return 1.79284291400159 - 0.85373472095314 * r;
      }

      float snoise(vec3 v) {
        const vec2  C = vec2(1.0/6.0, 1.0/3.0) ;
        const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);

        vec3 i  = floor(v + dot(v, C.yyy) );
        vec3 x0 =   v - i + dot(i, C.xxx) ;

        vec3 g = step(x0.yzx, x0.xyz);
        vec3 l = 1.0 - g;
        vec3 i1 = min( g.xyz, l.zxy );
        vec3 i2 = max( g.xyz, l.zxy );

        vec3 x1 = x0 - i1 + C.xxx;
        vec3 x2 = x0 - i2 + C.yyy;
        vec3 x3 = x0 - D.yyy;

        i = mod289(i);
        vec4 p = permute( permute( permute(
                   i.z + vec4(0.0, i1.z, i2.z, 1.0 ))
                 + i.y + vec4(0.0, i1.y, i2.y, 1.0 ))
                 + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));

        float n_ = 0.142857142857; // 1.0/7.0
        vec3  ns = n_ * D.wyz - D.xzx;

        vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

        vec4 x_ = floor(j * ns.z);
        vec4 y_ = floor(j - 7.0 * x_ );

        vec4 x = x_ *ns.x + ns.yyyy;
        vec4 y = y_ *ns.x + ns.yyyy;
        vec4 h = 1.0 - abs(x) - abs(y);

        vec4 b0 = vec4( x.xy, y.xy );
        vec4 b1 = vec4( x.zw, y.zw );

        vec4 s0 = floor(b0)*2.0 + 1.0;
        vec4 s1 = floor(b1)*2.0 + 1.0;
        vec4 sh = -step(h, vec4(0.0));

        vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;
        vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww ;

        vec3 p0 = vec3(a0.xy,h.x);
        vec3 p1 = vec3(a0.zw,h.y);
        vec3 p2 = vec3(a1.xy,h.z);
        vec3 p3 = vec3(a1.zw,h.w);

        vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
        p0 *= norm.x;
        p1 *= norm.y;
        p2 *= norm.z;
        p3 *= norm.w;

        vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
        m = m * m;
        return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1),
                                      dot(p2,x2), dot(p3,x3) ) );
      }
      
      
      // --- Base Animation & Color ---

      float getBeamIntensity(vec2 uv, vec2 sourcePos, float scanAngle, float beamWidth, float sourceRadius) {
        vec2 fromSource = uv - sourcePos;
        float dist = length(fromSource);
        
        float angle = atan(fromSource.y, fromSource.x);
        float angleDeg = degrees(angle);
        angleDeg = angleDeg < 0.0 ? angleDeg + 360.0 : angleDeg;
        
        float angleDiff = abs(angleDeg - scanAngle);
        angleDiff = min(angleDiff, 360.0 - angleDiff);
        
        float adjustedBeamWidth = beamWidth * (1.0 + sourceRadius / max(dist, 0.001));
        float beamShape = smoothstep(adjustedBeamWidth, 0.0, angleDiff);
        
        float distanceFalloff = 1.0 - smoothstep(1.5, 0.05, dist);
        
        return beamShape * distanceFalloff;
      }

      float getBottomGlow(vec2 uv) {
        float xOffset = sin(u_time * 0.5) * 0.2;
        uv.x += xOffset;
        
        float distFromBottom = (uv.y + 1.0) * 0.5;
        
        float flameTime = u_time * 0.7;
        float noise = (snoise(vec3(uv.x * 1.2, distFromBottom * 2.0, flameTime)) + 1.0) * 0.5;
        
        float modHeight = 0.2 + noise * 0.08;
        float glowIntensity = smoothstep(modHeight, 0.0, distFromBottom);
        
        float intensityVar = 0.25 + 0.08 * sin(u_time + uv.x * 2.5);
        
        return glowIntensity * intensityVar;
      }

      vec4 computeFinalColor(float intensity) {
          vec3 color_yellow = vec3(0.965, 0.53, 0.06);
          vec3 color_orange = vec3(0.890, 0.188, 0.055);
          vec3 color_dark_cherry = vec3(0.549, 0.0, 0.118);
          
          vec3 temp_color = mix(color_dark_cherry, color_orange, smoothstep(0.0, 0.6, intensity));
          vec3 finalBeamColor = mix(temp_color, color_yellow, smoothstep(0.5, 1.1, intensity));
         
          return vec4(finalBeamColor * intensity * 1.2, intensity);
      }

      void main() {
        vec2 final_uv;

        if (u_pixelation) {
            vec2 blocks = vec2(20.0, 20.0);
            vec2 block_frag_coord = floor(gl_FragCoord.xy / blocks) * blocks;
            vec2 block_center_coord = block_frag_coord + (blocks * 0.5);
            vec2 pixelated_full_uv_norm = block_center_coord / u_resolution;
            final_uv = pixelated_full_uv_norm * 2.0 - 1.0;
        } else {
            vec2 full_uv_norm = gl_FragCoord.xy / u_resolution;
            final_uv = full_uv_norm * 2.0 - 1.0;
        }

        final_uv.x *= u_resolution.x / u_resolution.y;
        
        // --- Base animation intensity ---
        float aspectRatio = u_resolution.x / u_resolution.y;
        
        float margin_offset = (u_right_margin / u_resolution.x) * 2.0 * aspectRatio;
        float manual_offset = 0.15; // Small nudge to the right
        vec2 baseSource = vec2(aspectRatio - margin_offset + manual_offset, 0.2);
        
        float sourceRadius = 0.1;
        float scanSpeed = 0.6;
        float scanLeftBound = 220.0;
        float scanRightBound = 250.0;
        float scanRange = (scanRightBound - scanLeftBound) * 0.5;
        float scanCenterAngle = (scanLeftBound + scanRightBound) * 0.5;
        float scanAngle = scanCenterAngle + sin(u_time * scanSpeed) * scanRange;
        float beamWidth = 28.0;
        float intensity = getBeamIntensity(final_uv, baseSource, scanAngle, beamWidth, sourceRadius);
        intensity *= 0.98 + 0.07 * sin(u_time * 1.0);
        
        vec4 finalColor = computeFinalColor(intensity);
        
        // --- Additive Effects ---
        float grain = snoise(vec3(gl_FragCoord.xy, u_time * 75.0)) * 0.0;
        finalColor.rgb += grain;

        float bottomGlow = getBottomGlow(final_uv);
        vec3 glowColor1 = vec3(0.8, 0.2, 0.05);
        vec3 glowColor2 = vec3(0.6, 0.15, 0.0); 
        float colorMix = 0.5 + 0.5 * sin(u_time * 0.3);
        vec3 variedGlowColor = mix(glowColor1, glowColor2, colorMix);
        finalColor.rgb = mix(finalColor.rgb, variedGlowColor, bottomGlow * 0.5);
        finalColor.a = max(finalColor.a, bottomGlow * 0.9);
        
        gl_FragColor = finalColor;
      }
    `;

    // Create and compile shaders
    function createShader(gl: WebGLRenderingContext, type: number, source: string) {
      const shader = gl.createShader(type);
      if (!shader) return null;
      
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error('Error compiling shader:', gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
      }
      
      return shader;
    }

    // Create program
    function createProgram(gl: WebGLRenderingContext, vertexShader: WebGLShader, fragmentShader: WebGLShader) {
      const program = gl.createProgram();
      if (!program) return null;
      
      gl.attachShader(program, vertexShader);
      gl.attachShader(program, fragmentShader);
      gl.linkProgram(program);
      
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.error('Error linking program:', gl.getProgramInfoLog(program));
        gl.deleteProgram(program);
        return null;
      }
      
      return program;
    }

    // Initialize shaders
    const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
    const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
    
    if (!vertexShader || !fragmentShader) return;
    
    const program = createProgram(gl, vertexShader, fragmentShader);
    if (!program) return;

    // Get attribute and uniform locations
    const positionAttributeLocation = gl.getAttribLocation(program, 'a_position');
    const texCoordAttributeLocation = gl.getAttribLocation(program, 'a_texCoord');
    const resolutionUniformLocation = gl.getUniformLocation(program, 'u_resolution');
    const timeUniformLocation = gl.getUniformLocation(program, 'u_time');
    const pixelationUniformLocation = gl.getUniformLocation(program, 'u_pixelation');
    const rightMarginUniformLocation = gl.getUniformLocation(program, 'u_right_margin');

    // Create a buffer for the rectangle
    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    const positions = [-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1];
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);

    // Create a buffer for texture coordinates
    const texCoordBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
    const texCoords = [0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1];
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(texCoords), gl.STATIC_DRAW);
    
    let startTime = Date.now();
    let lastScrollY = window.scrollY;
    
    function resizeCanvas() {
        if (!canvas || !gl || !canvas.parentElement) return false;
        const { width, height } = canvas.parentElement.getBoundingClientRect();
        
        if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
            gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
            return true; // resized
        }
        return false; // not resized
    }

    const observer = new ResizeObserver(resizeCanvas);
    if(canvas?.parentElement) {
      observer.observe(canvas.parentElement, { box: 'content-box' });
    }
    
    resizeCanvas();
    
    function render(time: number) {
      time *= 0.001;
      if (!gl || !canvas) return;
      
      gl.clearColor(0.0, 0.0, 0.0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.useProgram(program);

      // Set uniforms
      gl.uniform2f(resolutionUniformLocation, canvas.width, canvas.height);
      gl.uniform1f(timeUniformLocation, time);
      gl.uniform1i(pixelationUniformLocation, 1); // Re-enable pixelation
      gl.uniform1f(rightMarginUniformLocation, marginRef.current);

      // Set up attributes
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      gl.enableVertexAttribArray(positionAttributeLocation);
      gl.vertexAttribPointer(positionAttributeLocation, 2, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
      gl.enableVertexAttribArray(texCoordAttributeLocation);
      gl.vertexAttribPointer(texCoordAttributeLocation, 2, gl.FLOAT, false, 0, 0);

      // Draw
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      requestAnimationFrame(render);
    }

    startTime = Date.now();
    lastScrollY = window.scrollY;
    requestAnimationFrame(render);

    return () => {
      window.removeEventListener('resize', resizeCanvas);
    };
  }, []);

  return (
      <canvas
        ref={canvasRef}
      className="absolute inset-0 z-10"
      />
  );
}

