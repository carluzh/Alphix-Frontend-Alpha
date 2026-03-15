import { Currency, CurrencyAmount } from '@uniswap/sdk-core'
import {
  FormatterRule,
  TYPE_TO_FORMATTER_RULES,
} from './localeBasedFormats'
import { NumberType, PercentNumberDecimals, PercentNumberType } from './types'

// Simple type for nullable values
type Maybe<T> = T | null | undefined

const PLACEHOLDER_TEXT = '-'

function getFormatterRule(input: number, type: NumberType): FormatterRule {
  const { rules, defaultFormat } = TYPE_TO_FORMATTER_RULES[type]
  for (const rule of rules) {
    if (
      (rule.exact !== undefined && input === rule.exact) ||
      (rule.upperBound !== undefined && input < rule.upperBound)
    ) {
      return rule
    }
  }

  console.warn('Invalid input or misconfigured formatter rules for type', { type, input })

  // Use default formatting if no applicable rules found (should never happen)
  return { formatter: defaultFormat }
}

export function formatNumber({
  input,
  locale,
  currencyCode = 'USD',
  type = NumberType.TokenNonTx,
  placeholder = PLACEHOLDER_TEXT,
}: {
  input: number | null | undefined
  locale: string
  currencyCode?: string
  type?: NumberType
  placeholder?: string
}): string {
  if (input === null || input === undefined) {
    return placeholder
  }

  const { formatter, overrideValue, postFormatModifier } = getFormatterRule(input, type)
  if (typeof formatter === 'string') {
    return formatter
  }

  const createdFormat = formatter.createFormat(locale, currencyCode)
  const formatted = createdFormat.format(overrideValue !== undefined ? overrideValue : input)
  return postFormatModifier ? postFormatModifier(formatted) : formatted
}

export function formatCurrencyAmount({
  amount,
  locale,
  type = NumberType.TokenNonTx,
  placeholder,
}: {
  amount?: CurrencyAmount<Currency> | null | undefined
  locale: string
  type?: NumberType
  placeholder?: string
}): string {
  return formatNumber({
    input: amount ? parseFloat(amount.toFixed()) : undefined,
    locale,
    type,
    placeholder,
  })
}

export function formatNumberOrString({
  price,
  locale,
  currencyCode,
  type,
  placeholder = PLACEHOLDER_TEXT,
}: {
  price: Maybe<number | string>
  locale: string
  currencyCode?: string
  type: NumberType
  placeholder?: string
}): string {
  if (price === null || price === undefined) {
    return placeholder
  }
  if (typeof price === 'string') {
    return formatNumber({ input: parseFloat(price), locale, currencyCode, type, placeholder })
  }
  return formatNumber({ input: price, locale, currencyCode, type, placeholder })
}

function getPercentNumberType(maxDecimals: PercentNumberDecimals): PercentNumberType {
  switch (maxDecimals) {
    case 1:
      return NumberType.PercentageOneDecimal
    case 3:
      return NumberType.PercentageThreeDecimals
    case 4:
      return NumberType.PercentageFourDecimals
    default:
      return NumberType.Percentage
  }
}

export function formatPercent({
  rawPercentage,
  locale,
  maxDecimals = 2,
}: {
  rawPercentage: Maybe<number | string>
  locale: string
  maxDecimals?: PercentNumberDecimals
}): string {
  if (rawPercentage === null || rawPercentage === undefined) {
    return PLACEHOLDER_TEXT
  }

  const type = getPercentNumberType(maxDecimals)
  const percentage =
    typeof rawPercentage === 'string' ? parseFloat(rawPercentage) : parseFloat(rawPercentage.toString())

  // Handle NaN cases - return fallback if percentage is invalid
  if (isNaN(percentage)) {
    return PLACEHOLDER_TEXT
  }

  return formatNumber({ input: percentage / 100, type, locale })
}

