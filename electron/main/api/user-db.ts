/**
 * ChatLab Web UI - User Management & Authentication Database
 * Handles user credentials with password hashing and persistence
 * Complete logging for all user operations
 */

import * as fs from 'fs-extra'
import * as path from 'path'
import { randomBytes, createHash, pbkdf2Sync } from 'crypto'
import { app } from 'electron'

// ==================== Types ====================

export interface User {
  id: string
  username: string
  passwordHash: string
  salt: string
  createdAt: number
  updatedAt: number
  lastLoginAt?: number
  isActive: boolean
}

export interface UserDatabase {
  version: number
  users: User[]
  createdAt: number
  updatedAt: number
}

export interface PasswordHashResult {
  hash: string
  salt: string
}

// ==================== Constants ====================

const DB_FILE = 'webui-users.json'
const HASH_ALGORITHM = 'pbkdf2' // Using Node.js built-in instead of bcrypt (no external dependency)
const HASH_ITERATIONS = 100000
const HASH_KEYLEN = 64
const HASH_DIGEST = 'sha256'
const SALT_LENGTH = 32

// ==================== Database Initialization ====================

/**
 * Get database file path
 */
function getDatabasePath(): string {
  return path.join(app.getPath('userData'), DB_FILE)
}

/**
 * Load user database from file
 */
function loadDatabase(): UserDatabase {
  try {
    const dbPath = getDatabasePath()
    if (!fs.existsSync(dbPath)) {
      console.log('[WebUI User DB] Database does not exist, creating new...')
      return initializeDatabase()
    }

    const data = fs.readJsonSync(dbPath) as UserDatabase
    console.log(`[WebUI User DB] Loaded database with ${data.users.length} users`)
    return data
  } catch (error) {
    console.error('[WebUI User DB] Failed to load database:', error)
    return initializeDatabase()
  }
}

/**
 * Save user database to file
 */
function saveDatabase(db: UserDatabase): void {
  try {
    const dbPath = getDatabasePath()
    fs.ensureDirSync(path.dirname(dbPath))

    const backup = db
    db.updatedAt = Date.now()

    fs.writeJsonSync(dbPath, db, { spaces: 2 })
    console.log(`[WebUI User DB] Database saved (${db.users.length} users)`)
  } catch (error) {
    console.error('[WebUI User DB] Failed to save database:', error)
    throw error
  }
}

/**
 * Initialize empty database
 */
function initializeDatabase(): UserDatabase {
  console.log('[WebUI User DB] Initializing new database...')

  const db: UserDatabase = {
    version: 1,
    users: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }

  // Create default admin user
  const adminUser = createUser('admin', 'admin123')
  db.users.push(adminUser)

  saveDatabase(db)
  console.log('[WebUI User DB] Database initialized with default admin user')

  return db
}

// ==================== Password Hashing ====================

/**
 * Hash password using PBKDF2
 * Production-grade hashing without external dependencies
 */
export function hashPassword(password: string): PasswordHashResult {
  const salt = randomBytes(SALT_LENGTH).toString('hex')
  const hash = pbkdf2Sync(
    password,
    salt,
    HASH_ITERATIONS,
    HASH_KEYLEN,
    HASH_DIGEST
  ).toString('hex')

  return { hash, salt }
}

/**
 * Verify password against stored hash
 */
export function verifyPassword(password: string, hash: string, salt: string): boolean {
  const computedHash = pbkdf2Sync(
    password,
    salt,
    HASH_ITERATIONS,
    HASH_KEYLEN,
    HASH_DIGEST
  ).toString('hex')

  return computedHash === hash
}

// ==================== User Operations ====================

/**
 * Create a new user object
 */
function createUser(username: string, password: string): User {
  const { hash, salt } = hashPassword(password)
  const userId = `user-${randomBytes(8).toString('hex')}`

  return {
    id: userId,
    username,
    passwordHash: hash,
    salt,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    isActive: true,
  }
}

/**
 * Register new user
 */
export function registerUser(username: string, password: string): { success: boolean; user?: User; error?: string } {
  try {
    console.log(`[WebUI User DB] Registering new user: ${username}`)

    if (!username || username.trim().length === 0) {
      console.warn('[WebUI User DB] Registration failed: empty username')
      return { success: false, error: 'Username cannot be empty' }
    }

    if (!password || password.length < 6) {
      console.warn('[WebUI User DB] Registration failed: password too short')
      return { success: false, error: 'Password must be at least 6 characters' }
    }

    const db = loadDatabase()

    // Check if user already exists
    if (db.users.some(u => u.username === username)) {
      console.warn(`[WebUI User DB] Registration failed: user already exists - ${username}`)
      return { success: false, error: 'Username already exists' }
    }

    const newUser = createUser(username, password)
    db.users.push(newUser)
    saveDatabase(db)

    console.log(`[WebUI User DB] User registered successfully: ${username} (ID: ${newUser.id})`)

    return { success: true, user: newUser }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    console.error(`[WebUI User DB] Registration error: ${errMsg}`)
    return { success: false, error: `Registration failed: ${errMsg}` }
  }
}

/**
 * Authenticate user
 */
export function authenticateUser(username: string, password: string): { success: boolean; user?: User; error?: string } {
  try {
    console.log(`[WebUI User DB] Authentication attempt: ${username}`)

    const db = loadDatabase()
    const user = db.users.find(u => u.username === username && u.isActive)

    if (!user) {
      console.warn(`[WebUI User DB] Authentication failed: user not found - ${username}`)
      return { success: false, error: 'User not found or inactive' }
    }

    if (!verifyPassword(password, user.passwordHash, user.salt)) {
      console.warn(`[WebUI User DB] Authentication failed: invalid password - ${username}`)
      return { success: false, error: 'Invalid password' }
    }

    // Update last login
    user.lastLoginAt = Date.now()
    saveDatabase(db)

    console.log(`[WebUI User DB] Authentication successful: ${username}`)

    return { success: true, user }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    console.error(`[WebUI User DB] Authentication error: ${errMsg}`)
    return { success: false, error: `Authentication failed: ${errMsg}` }
  }
}

/**
 * Update user password
 */
export function updateUserPassword(username: string, oldPassword: string, newPassword: string): { success: boolean; error?: string } {
  try {
    console.log(`[WebUI User DB] Password change requested: ${username}`)

    if (!newPassword || newPassword.length < 6) {
      console.warn('[WebUI User DB] Password change failed: new password too short')
      return { success: false, error: 'New password must be at least 6 characters' }
    }

    const db = loadDatabase()
    const user = db.users.find(u => u.username === username)

    if (!user) {
      console.warn(`[WebUI User DB] Password change failed: user not found - ${username}`)
      return { success: false, error: 'User not found' }
    }

    // Verify old password
    if (!verifyPassword(oldPassword, user.passwordHash, user.salt)) {
      console.warn(`[WebUI User DB] Password change failed: invalid current password - ${username}`)
      return { success: false, error: 'Invalid current password' }
    }

    // Update password
    const { hash, salt } = hashPassword(newPassword)
    user.passwordHash = hash
    user.salt = salt
    user.updatedAt = Date.now()
    saveDatabase(db)

    console.log(`[WebUI User DB] Password changed successfully: ${username}`)

    return { success: true }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    console.error(`[WebUI User DB] Password change error: ${errMsg}`)
    return { success: false, error: `Password change failed: ${errMsg}` }
  }
}

/**
 * Get user by username
 */
export function getUserByUsername(username: string): User | null {
  try {
    const db = loadDatabase()
    return db.users.find(u => u.username === username) || null
  } catch (error) {
    console.error(`[WebUI User DB] Error getting user: ${error}`)
    return null
  }
}

/**
 * Get user by ID
 */
export function getUserById(userId: string): User | null {
  try {
    const db = loadDatabase()
    return db.users.find(u => u.id === userId) || null
  } catch (error) {
    console.error(`[WebUI User DB] Error getting user by ID: ${error}`)
    return null
  }
}

/**
 * List all active users
 */
export function listActiveUsers(): User[] {
  try {
    const db = loadDatabase()
    return db.users.filter(u => u.isActive).map(u => ({
      ...u,
      passwordHash: undefined,
      salt: undefined,
    } as any)) // Remove sensitive fields
  } catch (error) {
    console.error(`[WebUI User DB] Error listing users: ${error}`)
    return []
  }
}

/**
 * Deactivate user
 */
export function deactivateUser(username: string): { success: boolean; error?: string } {
  try {
    console.log(`[WebUI User DB] Deactivating user: ${username}`)

    const db = loadDatabase()
    const user = db.users.find(u => u.username === username)

    if (!user) {
      console.warn(`[WebUI User DB] Deactivation failed: user not found - ${username}`)
      return { success: false, error: 'User not found' }
    }

    user.isActive = false
    user.updatedAt = Date.now()
    saveDatabase(db)

    console.log(`[WebUI User DB] User deactivated: ${username}`)

    return { success: true }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    console.error(`[WebUI User DB] Deactivation error: ${errMsg}`)
    return { success: false, error: `Deactivation failed: ${errMsg}` }
  }
}

/**
 * Reactivate user
 */
export function reactivateUser(username: string): { success: boolean; error?: string } {
  try {
    console.log(`[WebUI User DB] Reactivating user: ${username}`)

    const db = loadDatabase()
    const user = db.users.find(u => u.username === username)

    if (!user) {
      console.warn(`[WebUI User DB] Reactivation failed: user not found - ${username}`)
      return { success: false, error: 'User not found' }
    }

    user.isActive = true
    user.updatedAt = Date.now()
    saveDatabase(db)

    console.log(`[WebUI User DB] User reactivated: ${username}`)

    return { success: true }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    console.error(`[WebUI User DB] Reactivation error: ${errMsg}`)
    return { success: false, error: `Reactivation failed: ${errMsg}` }
  }
}

/**
 * Delete user permanently
 */
export function deleteUser(username: string): { success: boolean; error?: string } {
  try {
    console.log(`[WebUI User DB] Deleting user: ${username}`)

    const db = loadDatabase()
    const index = db.users.findIndex(u => u.username === username)

    if (index === -1) {
      console.warn(`[WebUI User DB] Deletion failed: user not found - ${username}`)
      return { success: false, error: 'User not found' }
    }

    const deletedUser = db.users[index]
    db.users.splice(index, 1)
    saveDatabase(db)

    console.log(`[WebUI User DB] User deleted: ${username} (ID: ${deletedUser.id})`)

    return { success: true }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    console.error(`[WebUI User DB] Deletion error: ${errMsg}`)
    return { success: false, error: `Deletion failed: ${errMsg}` }
  }
}

/**
 * Get user statistics
 */
export function getUserStatistics(): {
  totalUsers: number
  activeUsers: number
  inactiveUsers: number
  lastUpdated: number
} {
  try {
    const db = loadDatabase()
    const activeUsers = db.users.filter(u => u.isActive).length

    return {
      totalUsers: db.users.length,
      activeUsers,
      inactiveUsers: db.users.length - activeUsers,
      lastUpdated: db.updatedAt,
    }
  } catch (error) {
    console.error(`[WebUI User DB] Error getting statistics: ${error}`)
    return {
      totalUsers: 0,
      activeUsers: 0,
      inactiveUsers: 0,
      lastUpdated: 0,
    }
  }
}

// ==================== Database Export/Import ====================

/**
 * Export database to JSON string
 */
export function exportDatabase(): string {
  try {
    const db = loadDatabase()
    return JSON.stringify(db, null, 2)
  } catch (error) {
    console.error('[WebUI User DB] Export error:', error)
    throw error
  }
}

/**
 * Import database from JSON string
 */
export function importDatabase(jsonData: string): { success: boolean; error?: string } {
  try {
    console.log('[WebUI User DB] Importing database...')

    const imported = JSON.parse(jsonData) as UserDatabase

    if (!imported.version || !Array.isArray(imported.users)) {
      return { success: false, error: 'Invalid database format' }
    }

    const dbPath = getDatabasePath()
    const backupPath = `${dbPath}.backup.${Date.now()}`

    // Create backup
    if (fs.existsSync(dbPath)) {
      fs.copySync(dbPath, backupPath)
      console.log(`[WebUI User DB] Backup created: ${backupPath}`)
    }

    fs.writeJsonSync(dbPath, imported, { spaces: 2 })
    console.log(`[WebUI User DB] Database imported successfully (${imported.users.length} users)`)

    return { success: true }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    console.error(`[WebUI User DB] Import error: ${errMsg}`)
    return { success: false, error: `Import failed: ${errMsg}` }
  }
}
