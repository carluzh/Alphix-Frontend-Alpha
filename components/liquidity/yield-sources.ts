/**
 * Yield source branding configuration
 * Shared across all components that display lending source logos
 */

export const YIELD_SOURCES = {
  aave: {
    name: "Aave",
    logo: "/aave/Logomark-light.png",
    textLogo: "/aave/Logo-light.png",
  },
  spark: {
    name: "Spark",
    logo: "/spark/Spark-Logomark-RGB.svg",
    textLogo: "/spark/Spark-Logo-Horizontal-Dark_Background-RGB.svg",
  },
} as const;

export type YieldSourceKey = keyof typeof YIELD_SOURCES;
