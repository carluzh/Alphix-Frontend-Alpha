import { metadata } from './metadata'; // Import from your .ts file
export { metadata }; // Export it here

export default function LiquidityLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>; // This layout just passes children through
} 