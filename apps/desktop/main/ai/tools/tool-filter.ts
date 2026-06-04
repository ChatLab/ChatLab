export function isAnalysisToolAllowed(toolName: string, allowedTools?: readonly string[] | null): boolean {
  return !!allowedTools?.includes(toolName)
}
