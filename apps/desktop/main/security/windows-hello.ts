/**
 * Windows Hello 生物识别 API 封装（简化版）
 *
 * 仅判断系统是否已设置 PIN 登录凭证。
 * 检测到 PIN 存在即认为可用，不再枚举 TPM / 红外 / 指纹 / 组策略等细分状态。
 *
 * 安全设计：
 * - 验证失败自动降级密码解锁
 * - 无第三方闭源依赖，仅使用 Windows 原生 WinRT API + 文件系统检测
 */

import { execFile } from 'child_process'
import { logger } from '../logger'

// ==================== 类型定义 ====================

export interface WindowsHelloAvailability {
  /** 系统是否已设置 PIN / Windows Hello 可用 */
  available: boolean
  /** 前端展示提示文案 */
  tipText: string
}

export interface WindowsHelloVerificationResult {
  success: boolean
  verified: boolean
  notAvailable?: boolean
  cancelled?: boolean
  error?: string
}

// ==================== 常量 ====================

const PS_TIMEOUT = 30000
let cachedAvailability: WindowsHelloAvailability | null = null
let availabilityCheckTime = 0
const AVAILABILITY_CACHE_TTL = 60000

// ==================== 底层执行 ====================

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

// ==================== 可用性检测 ====================

/**
 * 检测系统是否已设置 PIN 登录凭证
 *
 * 逻辑：
 * 1. 非 Windows → available: false
 * 2. 检查 NGC 目录下是否存在用户 PIN 凭证目录 → available: true/false
 *
 * 缓存 1 分钟，避免频繁读取文件系统
 */
export async function checkWindowsHelloAvailability(): Promise<WindowsHelloAvailability> {
  if (process.platform !== 'win32') {
    return { available: false, tipText: '仅 Windows 平台支持 Windows Hello' }
  }

  const now = Date.now()
  if (cachedAvailability && now - availabilityCheckTime < AVAILABILITY_CACHE_TTL) {
    return cachedAvailability
  }

  // 检查 NGC 目录：若存在子目录则说明至少有一个用户配置了 PIN
  const psScript = `
$ngcPath = "$env:windir\\ServiceProfiles\\LocalService\\AppData\\Local\\Microsoft\\NGC"
if (Test-Path $ngcPath) {
  $folders = Get-ChildItem $ngcPath -Directory -ErrorAction SilentlyContinue
  if ($folders.Count -gt 0) { Write-Output "PIN:True" }
  else { Write-Output "PIN:False" }
} else {
  Write-Output "PIN:False"
}
`.trim()

  try {
    const output = await runPowerShell(psScript)
    if (output.includes('PIN:True')) {
      cachedAvailability = { available: true, tipText: 'Windows Hello 可用' }
    } else {
      cachedAvailability = { available: false, tipText: '请先在Windows系统设置PIN码以使用Windows Hello' }
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    logger.error(`Windows Hello PIN check failed: ${sanitizeLog(msg)}`)
    cachedAvailability = { available: false, tipText: '请先在Windows系统设置PIN码以使用Windows Hello' }
  }

  availabilityCheckTime = Date.now()
  return cachedAvailability
}

export async function isWindowsHelloAvailable(): Promise<boolean> {
  const result = await checkWindowsHelloAvailability()
  return result.available
}

// ==================== 身份验证 ====================

/**
 * 调用 Windows 原生 UserConsentVerifier.RequestVerificationAsync 弹出验证对话框。
 *
 * 关键修复：系统 PIN 弹窗由 CredentialUIBroker.exe 承载。
 * PowerShell 的 GetAwaiter().GetResult() 可能在弹窗关闭前就返回，
 * 导致业务层收到"验证失败"。因此加入进程轮询：
 *   1. 发起异步验证请求
 *   2. 轮询 CredentialUIBroker.exe 是否出现
 *   3. 出现后持续等待直到进程退出
 *   4. 延时确保系统写入完成，再读取验证结果
 */
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

# 记录验证前已存在的 CredentialUIBroker 进程
$preExisting = Get-Process -Name "CredentialUIBroker" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id

# 发起异步验证
$asyncOp = [Windows.Security.Credentials.UI.UserConsentVerifier]::RequestVerificationAsync('${escapedMessage}')

# 轮询等待 CredentialUIBroker.exe 出现（最多等 5 秒）
$timeout = [DateTime]::Now.AddSeconds(5)
$uiPid = $null
while ([DateTime]::Now -lt $timeout) {
  $current = Get-Process -Name "CredentialUIBroker" -ErrorAction SilentlyContinue | Where-Object { $preExisting -notcontains $_.Id } | Select-Object -First 1
  if ($current) { $uiPid = $current.Id; break }
  Start-Sleep -Milliseconds 200
}

# 如果弹窗进程出现了，等待它退出（最多等 120 秒）
if ($uiPid) {
  $waitTimeout = [DateTime]::Now.AddSeconds(120)
  while ([DateTime]::Now -lt $waitTimeout) {
    $alive = Get-Process -Id $uiPid -ErrorAction SilentlyContinue
    if (-not $alive) { break }
    Start-Sleep -Milliseconds 500
  }
  # 延长等待：系统写入认证结果需要更长时间
  Start-Sleep -Seconds 2
} else {
  # 弹窗可能由其他进程承载（如 consent.exe），等待固定的合理时间
  Start-Sleep -Seconds 3
}

# 读取验证结果（独立 try/catch，避免与其它逻辑混淆）
try {
  $result = $asyncOp.GetAwaiter().GetResult()
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

    // 记录原始输出用于排查
    logger.info(`Windows Hello raw PS output: ${sanitizeLog(trimmed.substring(0, 100))}`)

    // 提取 RAW 行（用于日志诊断）
    const rawMatch = trimmed.match(/^RAW:(.+)$/m)
    const rawValue = rawMatch ? rawMatch[1].trim() : '(not found)'
    logger.info(`Windows Hello system result: ${rawValue}`)

    // 独立错误判断
    if (trimmed.includes('ERROR:')) {
      const errLine = trimmed.split('\n').find((l: string) => l.startsWith('ERROR:')) || ''
      const err = errLine.substring(6).trim()
      logger.error(`Windows Hello PS error: ${sanitizeLog(err)}`)
      return { success: false, verified: false, error: 'Windows Hello 验证失败，请使用密码解锁' }
    }

    // 独立成功判断
    const verifyMatch = trimmed.match(/^VERIFY:(.+)$/m)
    if (!verifyMatch) {
      logger.warn(`Windows Hello: no VERIFY line in output`)
      return { success: false, verified: false, error: '验证异常' }
    }

    const resultStr = verifyMatch[1].trim()
    logger.info(`Windows Hello parsed result: ${resultStr}`)

    if (resultStr === 'Verified') {
      clearAvailabilityCache()
      return { success: true, verified: true }
    }
    if (resultStr === 'Canceled') {
      return { success: false, verified: false, cancelled: true }
    }
    if (resultStr === 'DeviceNotPresent' || resultStr === 'NotConfiguredForUser' || resultStr === 'DisabledByPolicy') {
      clearAvailabilityCache()
      return { success: false, verified: false, notAvailable: true, error: 'Windows Hello 不可用，请使用密码解锁' }
    }
    if (resultStr === 'RetriesExhausted') {
      return { success: false, verified: false, error: '验证次数过多，请使用密码解锁' }
    }

    logger.warn(`Windows Hello unexpected result: ${resultStr}`)
    return { success: false, verified: false, error: '验证失败，请使用密码解锁' }

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    logger.error(`Windows Hello exec exception: ${sanitizeLog(msg)}`)
    return { success: false, verified: false, error: '验证服务异常，请使用密码解锁' }
  }
}

// ==================== 辅助 ====================

function clearAvailabilityCache(): void {
  cachedAvailability = null
  availabilityCheckTime = 0
}

function sanitizeLog(message: string): string {
  return message
    .replace(/C:\\Users\\[^\\]+/gi, 'C:\\Users\\***')
    .replace(/\\Users\\[^\\]+/gi, '\\Users\\***')
    .substring(0, 200)
}
