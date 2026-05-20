/**
 * JSON Schema → Zod conversion for MCP tool registration
 */

import { z } from 'zod'

/**
 * Convert simple JSON Schema properties to a Zod shape object.
 * Supports string / number / boolean / enum types.
 */
export function jsonSchemaToZod(
  properties: Record<string, { type: string; description?: string; default?: unknown; enum?: unknown[] }>,
  required?: string[]
): Record<string, z.ZodTypeAny> {
  const shape: Record<string, z.ZodTypeAny> = {}
  const requiredSet = new Set(required ?? [])

  for (const [key, prop] of Object.entries(properties)) {
    let zodType: z.ZodTypeAny

    switch (prop.type) {
      case 'number':
        zodType = z.number().describe(prop.description ?? '')
        break
      case 'boolean':
        zodType = z.boolean().describe(prop.description ?? '')
        break
      case 'string':
      default:
        if (prop.enum) {
          zodType = z.enum(prop.enum as [string, ...string[]]).describe(prop.description ?? '')
        } else {
          zodType = z.string().describe(prop.description ?? '')
        }
        break
    }

    if (!requiredSet.has(key)) {
      zodType = zodType.optional()
    }

    shape[key] = zodType
  }

  return shape
}
