import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Pool Details',
  description: "View pool details and manage your liquidity positions",
};

export default function PoolDetailLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
} 