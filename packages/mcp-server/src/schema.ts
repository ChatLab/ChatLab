/**
 * JSON Schema → Zod conversion for MCP tool registration
 */

import { z } from 'zod'

/**
 * Convert simple JSON Schema properties to a Zod shape object.
 * Supports string / number / boolean / enum types and arrays of primitives.
 */
export function jsonSchemaToZod(
  properties: Record<
    string,
    { type: string; description?: string; default?: unknown; enum?: unknown[]; items?: { type: string } }
  >,
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
      case 'array': {
        const itemType = prop.items?.type
        if (itemType === 'string' || itemType === 'number' || itemType === 'boolean') {
          const itemSchema = itemType === 'number' ? z.number() : itemType === 'boolean' ? z.boolean() : z.string()
          zodType = z.array(itemSchema).describe(prop.description ?? '')
          break
        }
      }
      // Fall through to the existing string/enum fallback for unsupported item types.
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
