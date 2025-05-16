"use client";

import { ArrowLeftIcon, PlusIcon, MinusIcon, ArrowRightLeftIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import type { Pool } from "@/types";

interface MobilePoolDetailsProps {
  pool: Pool | undefined;
  onBack: () => void;
}

export function MobilePoolDetails({ pool, onBack }: MobilePoolDetailsProps) {
  if (!pool) {
    // Or a more sophisticated loading/error state
    return (
      <div className="flex flex-1 justify-center items-center py-10">
        <p>Pool data not found.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 justify-center py-10">
      <div className="w-full max-w-md px-4">
        <div className=""> 
          <Button 
            variant="ghost" 
            size="sm" 
            className="mb-4" 
            onClick={onBack}
          >
            <ArrowLeftIcon className="h-4 w-4 mr-2" />
            Back to Pools
          </Button>
        </div>
        
        <Card className="bg-card/60 border-border">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg font-medium">{pool.pair || 'Pool Details'}</CardTitle>
              <Badge variant="outline" className="bg-[#e85102]/20 text-[#e85102] border-[#e85102]/30">
                {pool.apr}
              </Badge>
            </div>
            {/* TODO: Make this description dynamic or remove if not applicable for all pools */}
            <CardDescription>Base Sepolia • Active Pool</CardDescription>
          </CardHeader>
          
          <CardContent>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="bg-muted/30 p-3 rounded-md">
                <div className="text-muted-foreground text-xs mb-1">Liquidity</div>
                <div className="text-sm font-medium">{pool.liquidity}</div>
              </div>
              <div className="bg-muted/30 p-3 rounded-md">
                <div className="text-muted-foreground text-xs mb-1">24h Volume</div>
                <div className="text-sm font-medium">{pool.volume24h}</div>
              </div>
              <div className="bg-muted/30 p-3 rounded-md">
                <div className="text-muted-foreground text-xs mb-1">Fees (24h)</div>
                <div className="text-sm font-medium">{pool.fees24h}</div>
              </div>
              <div className="bg-muted/30 p-3 rounded-md">
                <div className="text-muted-foreground text-xs mb-1">My Liquidity</div>
                {/* TODO: Replace with actual user liquidity data */}
                <div className="text-sm font-medium">$0.00</div>
              </div>
            </div>
            
            <Tabs defaultValue="add" className="w-full">
              <TabsList className="grid w-full grid-cols-2 mb-4">
                <TabsTrigger value="add" className="text-xs flex items-center gap-1">
                  <PlusIcon className="h-3 w-3" />
                  Add Liquidity
                </TabsTrigger>
                <TabsTrigger value="remove" className="text-xs flex items-center gap-1">
                  <MinusIcon className="h-3 w-3" />
                  Remove Liquidity
                </TabsTrigger>
              </TabsList>
              
              <TabsContent value="add" className="py-3">
                <div className="bg-muted/30 p-6 rounded-md text-center">
                  <ArrowRightLeftIcon className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
                  <h3 className="text-sm font-medium mb-2">Add Liquidity</h3>
                  <p className="text-xs text-muted-foreground mb-4">
                    Add liquidity to earn trading fees
                  </p>
                  <Button size="sm" className="btn-primary text-xs" disabled>Coming Soon</Button>
                </div>
              </TabsContent>
              
              <TabsContent value="remove" className="py-3">
                <div className="bg-muted/30 p-6 rounded-md text-center">
                  <ArrowRightLeftIcon className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
                  <h3 className="text-sm font-medium mb-2">Remove Liquidity</h3>
                  <p className="text-xs text-muted-foreground mb-4">
                    Remove your position from the pool
                  </p>
                  <Button size="sm" className="btn-primary text-xs" disabled>Coming Soon</Button>
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
} 