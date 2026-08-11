import { computed, useAttrs, type ComputedRef } from 'vue'

const SAFE_PRIMITIVE_ATTRIBUTES = new Set(['class', 'style', 'id', 'title', 'tabindex'])

export function filterPrimitiveAttrs(
  attrs: Record<string, unknown>,
  excludedAttributes: readonly string[] = []
): Record<string, unknown> {
  const excluded = new Set(excludedAttributes)
  return Object.fromEntries(
    Object.entries(attrs).filter(
      ([name]) =>
        !excluded.has(name) &&
        (SAFE_PRIMITIVE_ATTRIBUTES.has(name) || name.startsWith('aria-') || name.startsWith('data-'))
    )
  )
}

export function usePrimitiveAttrs(excludedAttributes: readonly string[] = []): ComputedRef<Record<string, unknown>> {
  const attrs = useAttrs()
  return computed(() => filterPrimitiveAttrs(attrs, excludedAttributes))
}

interface ButtonAccessibleNameInput {
  label?: string
  accessibleLabel?: string
  hasDefaultSlot: boolean
}

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function assertButtonAccessibleName({
  label,
  accessibleLabel,
  hasDefaultSlot,
}: ButtonAccessibleNameInput): void {
  if (hasText(label) || hasText(accessibleLabel) || hasDefaultSlot) return
  throw new Error('UiButton requires visible text or an accessible label. Use UiIconButton for icon-only actions.')
}

export interface UiProgressState {
  value: number | null
  percentage: number | null
}

export function getUiProgressState(value: number | null, max: number): UiProgressState {
  if (!Number.isFinite(max) || max <= 0) {
    throw new RangeError('UiProgress max must be a finite number greater than zero.')
  }
  if (value === null) return { value: null, percentage: null }
  if (!Number.isFinite(value)) {
    throw new RangeError('UiProgress value must be null or a finite number.')
  }

  const normalizedValue = Math.min(Math.max(value, 0), max)
  return {
    value: normalizedValue,
    percentage: (normalizedValue / max) * 100,
  }
}

export function assertProgressLabel(label: string): void {
  if (hasText(label)) return
  throw new Error('UiProgress requires a non-empty accessible label.')
}
