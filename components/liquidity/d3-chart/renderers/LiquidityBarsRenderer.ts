/**
 * Liquidity Bars Renderer
 *
 * Renders horizontal liquidity bars showing depth at each tick.
 * Bars extend from the right side of the chart, colored based on range.
 *
 * Based on Uniswap's LiquidityBarsRenderer.ts pattern.
 */

import * as d3 from 'd3';
import { CHART_DIMENSIONS, CHART_COLORS, CHART_CLASSES } from '../constants';
import { getColorForPrice, getOpacityForPrice } from '../utils/colorUtils';
import type { ChartEntry, ChartState, TickScale, Renderer } from '../types';

export interface LiquidityBarsRendererConfig {
  g: d3.Selection<SVGGElement, unknown, null, undefined>;
  getState: () => ChartState;
  getLiquidityData: () => ChartEntry[];
  getTickScale: () => TickScale;
}

export function createLiquidityBarsRenderer({
  g,
  getState,
  getLiquidityData,
  getTickScale,
}: LiquidityBarsRendererConfig): Renderer {
  // Create a group for liquidity bars
  const barsGroup = g.append('g').attr('class', CHART_CLASSES.LIQUIDITY_BARS_GROUP);

  const draw = (): void => {
    // Clear previous bars
    barsGroup.selectAll('*').remove();

    const state = getState();
    const liquidityData = getLiquidityData();
    const tickScale = getTickScale();

    const { minPrice, maxPrice, dimensions } = state;

    if (liquidityData.length === 0) return;

    const maxLiquidity = d3.max(liquidityData, d => d.activeLiquidity) || 0;
    if (maxLiquidity === 0) return;

    const liquidityXScale = d3
      .scaleLinear()
      .domain([0, maxLiquidity])
      .range([0, CHART_DIMENSIONS.LIQUIDITY_SECTION_WIDTH - CHART_DIMENSIONS.LIQUIDITY_SECTION_OFFSET]);

    // Uniswap x position formula:
    // dimensions.width - liquidityXScale(d.activeLiquidity) + LIQUIDITY_SECTION_WIDTH - LIQUIDITY_SECTION_OFFSET
    // This positions bars at the right side of the main chart area

    // Draw horizontal liquidity bars
    barsGroup
      .selectAll<SVGRectElement, ChartEntry>(`.${CHART_CLASSES.LIQUIDITY_BAR}`)
      .data(liquidityData, d => d.tick.toString())
      .enter()
      .append('rect')
      .attr('class', CHART_CLASSES.LIQUIDITY_BAR)
      .attr('x', d => {
        const barWidth = liquidityXScale(d.activeLiquidity);
        // Position: start of liquidity section minus bar width (bars grow left)
        return dimensions.width + CHART_DIMENSIONS.LIQUIDITY_SECTION_WIDTH - CHART_DIMENSIONS.LIQUIDITY_SECTION_OFFSET - barWidth;
      })
      .attr('y', d => tickScale(d.tick.toString()) ?? 0)
      .attr('width', d => liquidityXScale(d.activeLiquidity))
      .attr('height', tickScale.bandwidth())
      .attr('fill', d => getColorForPrice({
        value: d.price0,
        minPrice,
        maxPrice,
      }))
      .attr('opacity', d => getOpacityForPrice({
        value: d.price0,
        minPrice,
        maxPrice,
      }));
  };

  return { draw };
}
