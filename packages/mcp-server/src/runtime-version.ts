export function resolveMcpPackageVersion(bundledVersion?: string): string {
  const normalizedVersion = typeof bundledVersion === 'string' ? bundledVersion.trim() : ''
  return normalizedVersion || '0.0.0-dev'
}

export function getMcpPackageVersion(): string {
  return resolveMcpPackageVersion(typeof __MCP_PACKAGE_VERSION__ !== 'undefined' ? __MCP_PACKAGE_VERSION__ : undefined)
}
