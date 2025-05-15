"use client";

import { AppLayout } from "@/components/app-layout";
import { useState } from "react";
import { ArrowRightLeftIcon, PlusIcon, MinusIcon, ArrowLeftIcon, MoreHorizontal, ArrowUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { TabsList, TabsTrigger, Tabs, TabsContent } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import Image from "next/image";
import * as React from "react";
import { 
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";

// Sample chart data
const chartData = Array.from({ length: 60 }, (_, i) => {
  const date = new Date();
  date.setDate(date.getDate() - i);
  return {
    date: date.toISOString().split('T')[0],
    volume: Math.floor(Math.random() * 200000) + 100000,
    tvl: Math.floor(Math.random() * 100000) + 1000000,
  };
}).reverse();

const chartConfig = {
  views: {
    label: "Daily Values",
  },
  volume: {
    label: "Volume",
    color: "hsl(var(--chart-1))",
  },
  tvl: {
    label: "TVL",
    color: "hsl(var(--chart-2))",
  },
} satisfies ChartConfig;

// Define the pool data type
type Pool = {
  id: string;
  tokens: {
    symbol: string;
    icon: string;
  }[];
  pair: string;
  volume24h: string;
  volume7d: string;
  fees24h: string;
  fees7d: string;
  liquidity: string;
  apr: string;
  highlighted: boolean;
}

// Pool data
const pools: Pool[] = [
  {
    id: "yusd-btcrl",
    tokens: [
      { symbol: "YUSD", icon: "/placeholder.svg?height=32&width=32" },
      { symbol: "BTCRL", icon: "/placeholder.svg?height=32&width=32" }
    ],
    pair: "YUSD / BTCRL",
    volume24h: "$432,187",
    volume7d: "$1.23M",
    fees24h: "$1,296",
    fees7d: "$3,690",
    liquidity: "$1.42M",
    apr: "8.4%",
    highlighted: true
  }
];

export default function LiquidityPage() {
  const [selectedPool, setSelectedPool] = useState<string | null>(null);
  const [activeChart, setActiveChart] = React.useState<keyof typeof chartConfig>("volume");
  const [sorting, setSorting] = React.useState<SortingState>([]);

  // Calculate totals for stats
  const totals = React.useMemo(() => ({
    volume: chartData.reduce((acc, curr) => acc + curr.volume, 0),
    tvl: chartData.reduce((acc, curr) => acc + curr.tvl, 0),
  }), []);
  
  // Handle back button
  const handleBack = () => {
    setSelectedPool(null);
  };

  // Define the columns for the table
  const columns: ColumnDef<Pool>[] = [
    {
      accessorKey: "pair",
      header: "Pool",
      cell: ({ row }) => {
        const pool = row.original;
        return (
          <div className="flex items-center gap-2">
            <div className="relative w-14 h-7">
              <div className="absolute top-0 left-0 w-7 h-7 rounded-full overflow-hidden bg-background border border-border/50">
                <Image 
                  src={pool.tokens[0].icon} 
                  alt={pool.tokens[0].symbol} 
                  width={28} 
                  height={28} 
                  className="w-full h-full object-cover" 
                />
              </div>
              <div className="absolute top-0 left-4 w-7 h-7 rounded-full overflow-hidden bg-background border border-border/50">
                <Image 
                  src={pool.tokens[1].icon} 
                  alt={pool.tokens[1].symbol} 
                  width={28} 
                  height={28} 
                  className="w-full h-full object-cover" 
                />
              </div>
            </div>
            <span className="font-medium">{pool.pair}</span>
          </div>
        );
      },
    },
    {
      accessorKey: "volume24h",
      header: ({ column }) => {
        return (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            className="p-0 hover:bg-transparent w-full flex justify-end"
          >
            <div className="flex items-center">
              Volume (24h)
              <ArrowUpDown className="ml-1 h-4 w-4" />
            </div>
          </Button>
        );
      },
      cell: ({ row }) => <div className="text-right">{row.original.volume24h}</div>,
    },
    {
      accessorKey: "volume7d",
      header: () => <div className="text-right w-full">Volume (7D)</div>,
      cell: ({ row }) => <div className="text-right">{row.original.volume7d}</div>,
    },
    {
      accessorKey: "fees24h",
      header: () => <div className="text-right w-full">Fees (24h)</div>,
      cell: ({ row }) => <div className="text-right">{row.original.fees24h}</div>,
    },
    {
      accessorKey: "fees7d",
      header: () => <div className="text-right w-full">Fees (7D)</div>,
      cell: ({ row }) => <div className="text-right">{row.original.fees7d}</div>,
    },
    {
      accessorKey: "liquidity",
      header: () => <div className="text-right w-full">Liquidity</div>,
      cell: ({ row }) => <div className="text-right">{row.original.liquidity}</div>,
    },
    {
      accessorKey: "apr",
      header: () => <div className="text-right w-full">APR</div>,
      cell: ({ row }) => (
        <div className="text-right">
          <Badge variant="outline" className="bg-emerald-500/20 text-emerald-400 border-emerald-700/30">
            {row.original.apr}
          </Badge>
        </div>
      ),
    },
    {
      id: "actions",
      header: () => <div className="text-right w-full">Actions</div>,
      cell: ({ row }) => {
        const pool = row.original;
        return (
          <div className="text-right">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="h-8 w-8 p-0">
                  <span className="sr-only">Open menu</span>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => setSelectedPool(pool.id)}>
                  View pool details
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem>Add liquidity</DropdownMenuItem>
                <DropdownMenuItem>View analytics</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      },
    },
  ];

  // Initialize the table
  const table = useReactTable({
    data: pools,
    columns,
    getCoreRowModel: getCoreRowModel(),
    onSortingChange: setSorting,
    getSortedRowModel: getSortedRowModel(),
    state: {
      sorting,
    },
  });

  return (
    <AppLayout>
      <div className="flex flex-1 flex-col">
        {!selectedPool ? (
          <div className="flex flex-1 flex-col p-6 px-10">
            {/* Top stats and chart section - commented out for alpha */}
            {/* 
            <div className="grid gap-6 mb-8 md:grid-cols-3">
              <Card className="md:col-span-1">
                <CardContent className="pt-6">
                  <div className="grid grid-cols-1 gap-5">
                    <div className="flex flex-col">
                      <div className="text-sm text-muted-foreground mb-1">Total Value Locked</div>
                      <div className="text-2xl font-bold">$1.42M</div>
                    </div>
                    <div className="flex flex-col">
                      <div className="text-sm text-muted-foreground mb-1">24h Volume</div>
                      <div className="text-2xl font-bold">$432,187</div>
                    </div>
                    <div className="flex flex-col">
                      <div className="text-sm text-muted-foreground mb-1">24h Fees</div>
                      <div className="text-2xl font-bold">$1,296</div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="md:col-span-2">
                <CardContent className="pt-6">
                  <div className="flex justify-end items-center mb-4 px-2">
                    <div className="flex space-x-4">
                      <button
                        className={`text-sm ${activeChart === "volume" ? "text-primary border-b border-primary" : "text-muted-foreground"}`}
                        onClick={() => setActiveChart("volume")}
                      >
                        Volume
                      </button>
                      <button
                        className={`text-sm ${activeChart === "tvl" ? "text-primary border-b border-primary" : "text-muted-foreground"}`}
                        onClick={() => setActiveChart("tvl")}
                      >
                        TVL
                      </button>
                    </div>
                  </div>
                  <ChartContainer
                    config={chartConfig}
                    className="aspect-auto h-[260px] w-full"
                  >
                    <BarChart
                      accessibilityLayer
                      data={chartData}
                      margin={{
                        left: 12,
                        right: 12,
                      }}
                    >
                      <CartesianGrid vertical={false} />
                      <XAxis
                        dataKey="date"
                        tickLine={false}
                        axisLine={false}
                        tickMargin={8}
                        minTickGap={32}
                        tickFormatter={(value) => {
                          const date = new Date(value);
                          return date.toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                          });
                        }}
                      />
                      <ChartTooltip
                        content={
                          <ChartTooltipContent
                            className="w-[150px]"
                            nameKey="views"
                            labelFormatter={(value) => {
                              return new Date(value).toLocaleDateString("en-US", {
                                month: "short",
                                day: "numeric",
                                year: "numeric",
                              });
                            }}
                          />
                        }
                      />
                      <Bar dataKey={activeChart} fill={`var(--color-${activeChart})`} />
                    </BarChart>
                  </ChartContainer>
                </CardContent>
              </Card>
            </div>
            */}

            {/* Pools table section */}
            <div className="mb-6 mt-6">
              <div className="mb-4">
                <h2 className="text-xl font-semibold">Liquidity Pools</h2>
                <p className="text-sm text-muted-foreground">
                  Available pools on Base Sepolia
                </p>
              </div>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    {table.getHeaderGroups().map((headerGroup) => (
                      <TableRow key={headerGroup.id}>
                        {headerGroup.headers.map((header) => (
                          <TableHead 
                            key={header.id} 
                            className={`${header.column.id === 'actions' ? 'w-[80px]': ''} ${header.column.id !== 'pair' && header.column.id !== 'actions' ? 'text-right' : ''}`}>
                            {header.isPlaceholder
                              ? null
                              : flexRender(
                                  header.column.columnDef.header,
                                  header.getContext()
                                )}
                          </TableHead>
                        ))}
                      </TableRow>
                    ))}
                  </TableHeader>
                  <TableBody>
                    {table.getRowModel().rows?.length ? (
                      table.getRowModel().rows.map((row) => (
                        <TableRow
                          key={row.id}
                          className={`cursor-pointer transition-colors ${
                            row.original.highlighted ? 'bg-accent/10 hover:bg-accent/15' : 'hover:bg-muted/10'
                          }`}
                        >
                          {row.getVisibleCells().map((cell) => (
                            <TableCell key={cell.id} onClick={() => {
                              // Only navigate to pool details if not clicking on actions cell
                              if (!cell.column.id.includes('actions')) {
                                setSelectedPool(row.original.id);
                              }
                            }}>
                              {flexRender(
                                cell.column.columnDef.cell,
                                cell.getContext()
                              )}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell
                          colSpan={columns.length}
                          className="h-24 text-center"
                        >
                          No pools available.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-1 justify-center py-10">
            <div className="w-full max-w-md px-4">
              <div className="mb-6">
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="mb-4" 
                  onClick={handleBack}
                >
                  <ArrowLeftIcon className="h-4 w-4 mr-2" />
                  Back to Pools
                </Button>
              </div>
              
              <Card className="bg-card/60 border-border">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg font-medium">YUSD / BTCRL</CardTitle>
                    <Badge variant="outline" className="bg-emerald-500/20 text-emerald-400 border-emerald-700/30">
                      {pools[0].apr}
                    </Badge>
                  </div>
                  <CardDescription>Base Sepolia • Active Pool</CardDescription>
                </CardHeader>
                
                <CardContent>
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <div className="bg-muted/30 p-3 rounded-md">
                      <div className="text-muted-foreground text-xs mb-1">TVL</div>
                      <div className="text-sm font-medium">{pools[0].liquidity}</div>
                    </div>
                    <div className="bg-muted/30 p-3 rounded-md">
                      <div className="text-muted-foreground text-xs mb-1">24h Volume</div>
                      <div className="text-sm font-medium">{pools[0].volume24h}</div>
                    </div>
                    <div className="bg-muted/30 p-3 rounded-md">
                      <div className="text-muted-foreground text-xs mb-1">Fees (24h)</div>
                      <div className="text-sm font-medium">{pools[0].fees24h}</div>
                    </div>
                    <div className="bg-muted/30 p-3 rounded-md">
                      <div className="text-muted-foreground text-xs mb-1">My Liquidity</div>
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
        )}
      </div>
    </AppLayout>
  );
} 