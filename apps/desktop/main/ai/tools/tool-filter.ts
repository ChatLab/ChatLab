import { normalizeBuiltinToolNames } from '@openchatlab/core'

export function isAnalysisToolAllowed(toolName: string, allowedTools?: readonly string[] | null): boolean {
  return !!allowedTools && normalizeBuiltinToolNames(allowedTools).includes(toolName)
}
