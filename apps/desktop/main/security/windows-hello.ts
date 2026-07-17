/**
 * Windows Hello API 封装
 *
 * 安全审计修复 (P1):
 * - 可用性检测改用官方 WinRT UserConsentVerifier.CheckAvailabilityAsync()
 * - 验证调用改用 IAsyncOperation.Status 轮询 + GetResults() 替代 GetAwaiter().GetResult()
 */

import { execFile } from 'child_process'
import { logger } from '../logger'

export interface WindowsHelloAvailability {
  available: boolean
  tipText: string
}

export interface WindowsHelloVerificationResult {
  success: boolean
  verified: boolean
  notAvailable?: boolean
  cancelled?: boolean
  error?: string
}

const PS_TIMEOUT = 30000
let cachedAvailability: WindowsHelloAvailability | null = null
let availabilityCheckTime = 0
const AVAILABILITY_CACHE_TTL = 60000

function runPowerShell(script: string, timeout = PS_TIMEOUT): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { timeout, windowsHide: true, encoding: 'utf-8' },
      (error, stdout, stderr) => {
        if (error && !stdout) { reject(new Error(stderr || error.message)); return }
        resolve(stdout.trim())
      }
    )
  })
}

// ==================== 可用性检测（官方 API） ====================

export async function checkWindowsHelloAvailability(): Promise<WindowsHelloAvailability> {
  if (process.platform !== 'win32') {
    return { available: false, tipText: '仅 Windows 平台支持 Windows Hello' }
  }

  const now = Date.now()
  if (cachedAvailability && now - availabilityCheckTime < AVAILABILITY_CACHE_TTL) {
    return cachedAvailability
  }

  const psScript = `
[Windows.Security.Credentials.UI.UserConsentVerifier, Windows.Security.Credentials, ContentType=WindowsRuntime] | Out-Null
try {
  $asyncOp = [Windows.Security.Credentials.UI.UserConsentVerifier]::CheckAvailabilityAsync()
  # 轮询 IAsyncOperation 状态：0=Started 1=Completed 2=Canceled 3=Error
  while ($asyncOp.Status -eq 0) { Start-Sleep -Milliseconds 100 }
  Write-Output "AVAIL:$($asyncOp.GetResults().ToString())"
} catch {
  Write-Output "ERROR:$($_.Exception.Message)"
}
`

  try {
    const output = await runPowerShell(psScript)
    if (output.startsWith('ERROR:')) {
      logger.warn(`Hello availability check failed: ${sanitizeLog(output.substring(6))}`)
      cachedAvailability = { available: false, tipText: '请先在Windows系统设置PIN码以使用Windows Hello' }
    } else if (output.includes('AVAIL:Available')) {
      cachedAvailability = { available: true, tipText: 'Windows Hello 可用' }
    } else {
      const reason = output.includes('NotConfiguredForUser') ? '用户未配置 PIN/生物识别'
        : output.includes('DisabledByPolicy') ? '组策略已禁用 Windows Hello'
        : output.includes('DeviceNotPresent') ? '设备不支持 Windows Hello'
        : '请先在Windows系统设置PIN码以使用Windows Hello'
      cachedAvailability = { available: false, tipText: reason }
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    logger.error(`Hello availability check exception: ${sanitizeLog(msg)}`)
    cachedAvailability = { available: false, tipText: '请先在Windows系统设置PIN码以使用Windows Hello' }
  }

  availabilityCheckTime = Date.now()
  return cachedAvailability
}

export async function isWindowsHelloAvailable(): Promise<boolean> {
  return (await checkWindowsHelloAvailability()).available
}

// ==================== 身份验证（轮询进程 + IAsyncOperation） ====================

export async function verifyWithWindowsHello(
  message: string = '请验证您的身份以解锁 ChatLab'
): Promise<WindowsHelloVerificationResult> {
  const availability = await checkWindowsHelloAvailability()
  if (!availability.available) {
    return { success: false, verified: false, notAvailable: true, error: availability.tipText }
  }

  const escapedMessage = message.replace(/'/g, "''").replace(/"/g, '`"')
  const psScript = `
[Windows.Security.Credentials.UI.UserConsentVerifier, Windows.Security.Credentials, ContentType=WindowsRuntime] | Out-Null

$preExisting = Get-Process -Name "CredentialUIBroker" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id

$asyncOp = [Windows.Security.Credentials.UI.UserConsentVerifier]::RequestVerificationAsync('${escapedMessage}')

$timeout = [DateTime]::Now.AddSeconds(5)
$uiPid = $null
while ([DateTime]::Now -lt $timeout) {
  $current = Get-Process -Name "CredentialUIBroker" -ErrorAction SilentlyContinue | Where-Object { $preExisting -notcontains $_.Id } | Select-Object -First 1
  if ($current) { $uiPid = $current.Id; break }
  Start-Sleep -Milliseconds 200
}

if ($uiPid) {
  $waitTimeout = [DateTime]::Now.AddSeconds(120)
  while ([DateTime]::Now -lt $waitTimeout) {
    $alive = Get-Process -Id $uiPid -ErrorAction SilentlyContinue
    if (-not $alive) { break }
    Start-Sleep -Milliseconds 500
  }
  Start-Sleep -Seconds 2
} else {
  Start-Sleep -Seconds 3
}

# 轮询 IAsyncOperation 直到完成
while ($asyncOp.Status -eq 0) { Start-Sleep -Milliseconds 100 }

try {
  $result = $asyncOp.GetResults()
  $raw = $result.ToString()
  Write-Output "RAW:$raw"
  Write-Output "VERIFY:$raw"
} catch {
  Write-Output "ERROR:$($_.Exception.Message)"
}
`

  try {
    const output = await runPowerShell(psScript, 180000)
    const trimmed = output.trim()
    logger.info(`Hello raw output: ${sanitizeLog(trimmed.substring(0, 120))}`)

    const rawMatch = trimmed.match(/^RAW:(.+)$/m)
    const rawValue = rawMatch ? rawMatch[1].trim() : '(not found)'
    logger.info(`Hello system result: ${rawValue}`)

    if (trimmed.includes('ERROR:')) {
      const errLine = trimmed.split('\n').find((l: string) => l.startsWith('ERROR:')) || ''
      logger.error(`Hello PS error: ${sanitizeLog(errLine.substring(6).trim())}`)
      return { success: false, verified: false, error: 'Windows Hello 验证失败，请使用密码解锁' }
    }

    const verifyMatch = trimmed.match(/^VERIFY:(.+)$/m)
    if (!verifyMatch) {
      logger.warn('Hello: no VERIFY line in output')
      return { success: false, verified: false, error: '验证异常' }
    }

    const resultStr = verifyMatch[1].trim()
    logger.info(`Hello parsed: ${resultStr}`)

    if (resultStr === 'Verified') { clearAvailabilityCache(); return { success: true, verified: true } }
    if (resultStr === 'Canceled') { return { success: false, verified: false, cancelled: true } }
    if (resultStr === 'DeviceNotPresent' || resultStr === 'NotConfiguredForUser' || resultStr === 'DisabledByPolicy') {
      clearAvailabilityCache(); return { success: false, verified: false, notAvailable: true, error: 'Windows Hello 不可用' }
    }
    if (resultStr === 'RetriesExhausted') { return { success: false, verified: false, error: '验证次数过多' } }

    logger.warn(`Hello unexpected: ${resultStr}`)
    return { success: false, verified: false, error: '验证失败' }

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    logger.error(`Hello exec exception: ${sanitizeLog(msg)}`)
    return { success: false, verified: false, error: '验证服务异常' }
  }
}

function clearAvailabilityCache(): void { cachedAvailability = null; availabilityCheckTime = 0 }

function sanitizeLog(message: string): string {
  return message.replace(/C:\\Users\\[^\\]+/gi, 'C:\\Users\\***').replace(/\\Users\\[^\\]+/gi, '\\Users\\***').substring(0, 200)
}
