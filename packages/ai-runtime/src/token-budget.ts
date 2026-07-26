export function truncateToolResult(result: string, maxCharacters: number): { content: string; truncated: boolean } {
  if (result.length <= maxCharacters) return { content: result, truncated: false }
  return { content: `${result.slice(0, maxCharacters)}\n[truncated]`, truncated: true }
}
