/**
 * ChatLab Web UI - JWT Authentication Handler
 * Provides login/logout for Web UI with token-based auth
 * Logs all authentication events
 */

import { randomBytes } from 'crypto'
import type { FastifyRequest, FastifyReply } from 'fastify'
import * as fs from 'fs-extra'
import * as path from 'path'
import { app } from 'electron'

// ==================== Types ====================

export interface LoginRequest {
  username: string
  password: string
}

export interface LoginResponse {
  success: boolean
  token?: string
  expiresAt?: number
  error?: string
}

interface AuthState {
  lastAttempts: Map<string, { count: number; resetAt: number }>
}

// ==================== Constants ====================

const TOKEN_EXPIRY_DAYS = 7
const TOKEN_EXPIRY_MS = TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000

// Login attempt rate limiting
const MAX_LOGIN_ATTEMPTS = 5
const LOGIN_ATTEMPT_WINDOW_MS = 15 * 60 * 1000 // 15 minutes

// ==================== Module State ====================

const authState: AuthState = {
  lastAttempts: new Map(),
}

/**
 * Get config file path for storing auth state
 */
function getAuthConfigPath(): string {
  return path.join(app.getPath('userData'), 'api-auth.json')
}

/**
 * Load stored auth credentials (simple username/password)
 * In production, use bcrypt for password hashing
 */
function loadAuthConfig(): { username: string; password: string } | null {
  try {
    const configPath = getAuthConfigPath()
    if (!fs.existsSync(configPath)) {
      // Default credentials: username/password (should be changed)
      return {
        username: 'admin',
        password: 'admin123',
      }
    }

    const data = fs.readJsonSync(configPath)
    return data
  } catch (error) {
    console.error('[WebUI Auth] Failed to load auth config:', error)
    return null
  }
}

/**
 * Save auth config
 */
function saveAuthConfig(config: { username: string; password: string }): void {
  try {
    const configPath = getAuthConfigPath()
    fs.ensureDirSync(path.dirname(configPath))
    fs.writeJsonSync(configPath, config, { spaces: 2 })
    console.log('[WebUI Auth] Auth config saved')
  } catch (error) {
    console.error('[WebUI Auth] Failed to save auth config:', error)
  }
}

/**
 * Check login attempt rate limit
 */
function checkLoginAttemptLimit(username: string): { allowed: boolean; resetAt?: number } {
  const now = Date.now()
  const attempts = authState.lastAttempts.get(username)

  if (!attempts) {
    return { allowed: true }
  }

  if (now > attempts.resetAt) {
    authState.lastAttempts.delete(username)
    return { allowed: true }
  }

  if (attempts.count >= MAX_LOGIN_ATTEMPTS) {
    return {
      allowed: false,
      resetAt: attempts.resetAt,
    }
  }

  return { allowed: true }
}

/**
 * Record failed login attempt
 */
function recordFailedLoginAttempt(username: string): void {
  const attempts = authState.lastAttempts.get(username)
  const now = Date.now()

  if (!attempts || now > attempts.resetAt) {
    authState.lastAttempts.set(username, {
      count: 1,
      resetAt: now + LOGIN_ATTEMPT_WINDOW_MS,
    })
  } else {
    attempts.count++
  }

  console.warn(
    `[WebUI Auth] Failed login attempt for ${username} (${attempts?.count || 1}/${MAX_LOGIN_ATTEMPTS})`
  )
}

/**
 * Generate JWT token (simplified, no external JWT library)
 * In production, use 'jsonwebtoken' library for proper JWT support
 */
function generateToken(): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(
    JSON.stringify({
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor((Date.now() + TOKEN_EXPIRY_MS) / 1000),
      type: 'webui',
    })
  ).toString('base64url')
  const signature = randomBytes(32).toString('base64url')

  return `${header}.${payload}.${signature}`
}

/**
 * Parse and validate token
 */
function validateToken(token: string): { valid: boolean; exp?: number } {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) {
      return { valid: false }
    }

    const payloadStr = Buffer.from(parts[1], 'base64url').toString()
    const payload = JSON.parse(payloadStr)

    const now = Math.floor(Date.now() / 1000)
    if (payload.exp && payload.exp < now) {
      console.log('[WebUI Auth] Token expired')
      return { valid: false }
    }

    return { valid: true, exp: payload.exp }
  } catch (error) {
    console.error('[WebUI Auth] Token validation error:', error)
    return { valid: false }
  }
}

// ==================== Public API ====================

/**
 * Handle login request
 */
export async function handleLogin(request: LoginRequest): Promise<LoginResponse> {
  const { username, password } = request

  console.log(`[WebUI Auth] Login attempt for user: ${username}`)

  // Check rate limit
  const rateLimit = checkLoginAttemptLimit(username)
  if (!rateLimit.allowed) {
    const resetAt = rateLimit.resetAt || Date.now()
    const waitTime = Math.ceil((resetAt - Date.now()) / 1000)
    console.warn(`[WebUI Auth] Rate limit exceeded for ${username}. Wait ${waitTime}s.`)
    return {
      success: false,
      error: `Too many login attempts. Please try again in ${waitTime}s.`,
    }
  }

  // Validate credentials
  const config = loadAuthConfig()
  if (!config) {
    console.error('[WebUI Auth] Failed to load auth config')
    recordFailedLoginAttempt(username)
    return {
      success: false,
      error: 'Authentication system error',
    }
  }

  if (config.username !== username || config.password !== password) {
    console.warn(`[WebUI Auth] Invalid credentials for user: ${username}`)
    recordFailedLoginAttempt(username)
    return {
      success: false,
      error: 'Invalid username or password',
    }
  }

  // Generate token
  const token = generateToken()
  const expiresAt = Date.now() + TOKEN_EXPIRY_MS

  console.log(`[WebUI Auth] Login successful for user: ${username}. Token expires at ${new Date(expiresAt).toISOString()}`)
  console.log(`[WebUI Auth] Login credentials: username=${username}`)

  // Clear login attempts on success
  authState.lastAttempts.delete(username)

  return {
    success: true,
    token,
    expiresAt,
  }
}

/**
 * Handle logout request
 */
export async function handleLogout(): Promise<{ success: boolean }> {
  console.log('[WebUI Auth] User logged out')
  return { success: true }
}

/**
 * Verify JWT token and return auth status
 */
export function verifyAuthToken(token: string): { valid: boolean; message?: string } {
  const validation = validateToken(token)

  if (!validation.valid) {
    console.warn('[WebUI Auth] Invalid or expired token')
    return { valid: false, message: 'Invalid or expired token' }
  }

  return { valid: true }
}

/**
 * Middleware to verify JWT token from request
 */
export async function jwtAuthMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<boolean> {
  const authHeader = request.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.warn('[WebUI Auth] Missing or invalid authorization header')
    return false
  }

  const token = authHeader.slice(7)
  const validation = validateToken(token)

  if (!validation.valid) {
    console.warn('[WebUI Auth] Token validation failed')
    return false
  }

  console.log('[WebUI Auth] Token verified successfully')
  return true
}

/**
 * Get default auth config
 */
export function getDefaultAuthConfig(): { username: string; password: string } {
  return {
    username: 'admin',
    password: 'admin123',
  }
}

/**
 * Update auth credentials
 */
export function updateAuthCredentials(username: string, password: string): void {
  saveAuthConfig({ username, password })
  console.log(`[WebUI Auth] Credentials updated for user: ${username}`)
}

/**
 * Log authentication event
 */
export function logAuthEvent(event: string, details: Record<string, any>): void {
  console.log(`[WebUI Auth Event] ${event}:`, details)
}
