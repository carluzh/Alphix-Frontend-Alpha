/**
 * Timescale Renderer
 *
 * Renders the X-axis with date labels based on price data.
 * Copied from Uniswap's TimescaleRenderer.ts pattern.
 */

import * as d3 from 'd3';
import { CHART_DIMENSIONS, CHART_COLORS } from '../constants';
import type { ChartState, PriceDataPoint, Renderer } from '../types';
import { HistoryDuration } from '@/lib/chart/types';

export interface TimescaleRendererConfig {
  g: d3.Selection<SVGGElement, unknown, null, undefined>;
  getState: () => ChartState;
  getPriceData: () => PriceDataPoint[];
  duration?: HistoryDuration;
}

/**
 * Get time format based on duration
 */
function getTimeFormat(duration: HistoryDuration) {
  switch (duration) {
    case HistoryDuration.DAY:
    case HistoryDuration.HOUR:
      // DDD HH:MM (e.g., "Mon 1:00")
      return d3.timeFormat('%a %H:%M');
    case HistoryDuration.WEEK:
      // MMM DD (e.g., "Jan 01")
      return d3.timeFormat('%b %d');
    case HistoryDuration.YEAR:
      // MMM YYYY (e.g., "Jan 2024")
      return d3.timeFormat('%b %Y');
    default:
      // MMM DD (e.g., "Jan 01") - default for MONTH
      return d3.timeFormat('%b %d');
  }
}

export function createTimescaleRenderer({
  g,
  getState,
  getPriceData,
  duration = HistoryDuration.MONTH,
}: TimescaleRendererConfig): Renderer {
  const timescaleGroup = g.append('g').attr('class', 'timescale-group');

  const draw = (): void => {
    // Clear previous elements
    timescaleGroup.selectAll('*').remove();

    const state = getState();
    const priceData = getPriceData();
    const { dimensions } = state;

    if (priceData.length === 0) {
      return;
    }

    const priceDataMapped = priceData.map(d => ({
      date: new Date(d.time * 1000),
      value: d.value,
    }));

    // Create time scale for the x-axis
    const dateExtent = d3.extent(priceDataMapped, d => d.date);

    const xScale = d3
      .scaleTime()
      .domain(dateExtent[0] ? dateExtent : [new Date(), new Date()])
      // Start from left edge with small padding
      .range([CHART_DIMENSIONS.TIMESCALE_HEIGHT, dimensions.width]);

    const timeFormat = getTimeFormat(duration);
    const ticks = xScale.ticks(4);

    timescaleGroup
      .selectAll('.time-label')
      .data(ticks)
      .enter()
      .append('text')
      .attr('class', 'time-label')
      .attr('x', d => xScale(d))
      .attr('y', CHART_DIMENSIONS.CHART_HEIGHT + CHART_DIMENSIONS.TIMESCALE_HEIGHT / 2 + 4)
      .attr('text-anchor', 'middle')
      .style('fill', CHART_COLORS.currentPriceLine) // Using neutral color
      .style('font-size', '11px')
      .style('font-family', 'inherit')
      .text(d => timeFormat(d));
  };

  return { draw };
}
