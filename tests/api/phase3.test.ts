/**
 * Phase 3 - User Management & Authentication Tests
 * Tests for registration, password hashing, and user database operations
 * Comprehensive test coverage for all user operations
 */

import { describe, it, expect, beforeAll } from 'vitest'
import * as userDb from '../../electron/main/api/user-db'
import * as authDb from '../../electron/main/api/auth-db'

describe('Phase 3: User Management & Authentication', () => {
  // ==================== User Database Tests ====================

  describe('User Registration (registerUser)', () => {
    it('should register a new user successfully', () => {
      console.log('[Test] Register new user: testuser1')
      const result = userDb.registerUser('testuser1', 'password123')

      expect(result.success).toBe(true)
      expect(result.user).toBeDefined()
      expect(result.user?.username).toBe('testuser1')
      expect(result.user?.isActive).toBe(true)
      expect(result.user?.id).toBeDefined()
      console.log('[Test] User registered:', result.user?.id)
    })

    it('should reject empty username', () => {
      console.log('[Test] Attempt register with empty username')
      const result = userDb.registerUser('', 'password123')

      expect(result.success).toBe(false)
      expect(result.error).toContain('empty')
      console.log('[Test] Empty username rejected:', result.error)
    })

    it('should reject short password', () => {
      console.log('[Test] Attempt register with short password')
      const result = userDb.registerUser('testuser2', 'short')

      expect(result.success).toBe(false)
      expect(result.error).toContain('at least 6')
      console.log('[Test] Short password rejected:', result.error)
    })

    it('should reject duplicate username', () => {
      console.log('[Test] Register duplicate username')
      userDb.registerUser('duplicateuser', 'password123')
      const result = userDb.registerUser('duplicateuser', 'password456')

      expect(result.success).toBe(false)
      expect(result.error).toContain('already exists')
      console.log('[Test] Duplicate username rejected:', result.error)
    })
  })

  // ==================== Password Hashing Tests ====================

  describe('Password Hashing (hashPassword/verifyPassword)', () => {
    it('should hash password differently each time (salt)', () => {
      console.log('[Test] Hash same password twice')
      const hash1 = userDb.hashPassword('testpass')
      const hash2 = userDb.hashPassword('testpass')

      expect(hash1.hash).not.toBe(hash2.hash)
      expect(hash1.salt).not.toBe(hash2.salt)
      console.log('[Test] Hashes differ due to salt')
    })

    it('should verify correct password', () => {
      console.log('[Test] Verify correct password')
      const { hash, salt } = userDb.hashPassword('testpass')
      const isValid = userDb.verifyPassword('testpass', hash, salt)

      expect(isValid).toBe(true)
      console.log('[Test] Correct password verified')
    })

    it('should reject incorrect password', () => {
      console.log('[Test] Verify incorrect password')
      const { hash, salt } = userDb.hashPassword('testpass')
      const isValid = userDb.verifyPassword('wrongpass', hash, salt)

      expect(isValid).toBe(false)
      console.log('[Test] Incorrect password rejected')
    })

    it('should not accept hash tampering', () => {
      console.log('[Test] Test hash tampering detection')
      const { hash, salt } = userDb.hashPassword('testpass')
      const tamperedHash = hash.slice(0, -5) + 'XXXXX'
      const isValid = userDb.verifyPassword('testpass', tamperedHash, salt)

      expect(isValid).toBe(false)
      console.log('[Test] Hash tampering detected')
    })
  })

  // ==================== User Lookup Tests ====================

  describe('User Lookup', () => {
    beforeAll(() => {
      userDb.registerUser('lookupuser', 'password123')
    })

    it('should find user by username', () => {
      console.log('[Test] Find user by username')
      const user = userDb.getUserByUsername('lookupuser')

      expect(user).toBeDefined()
      expect(user?.username).toBe('lookupuser')
      console.log('[Test] User found by username')
    })

    it('should find user by ID', () => {
      console.log('[Test] Find user by ID')
      const user = userDb.getUserByUsername('lookupuser')
      if (user) {
        const foundUser = userDb.getUserById(user.id)
        expect(foundUser).toBeDefined()
        expect(foundUser?.id).toBe(user.id)
        console.log('[Test] User found by ID')
      }
    })

    it('should return null for non-existent user', () => {
      console.log('[Test] Lookup non-existent user')
      const user = userDb.getUserByUsername('nonexistent')

      expect(user).toBeNull()
      console.log('[Test] Non-existent user returns null')
    })
  })

  // ==================== Authentication Tests ====================

  describe('User Authentication (authenticateUser)', () => {
    beforeAll(() => {
      userDb.registerUser('authuser', 'mypassword123')
    })

    it('should authenticate with correct credentials', () => {
      console.log('[Test] Authenticate with correct credentials')
      const result = userDb.authenticateUser('authuser', 'mypassword123')

      expect(result.success).toBe(true)
      expect(result.user).toBeDefined()
      expect(result.user?.lastLoginAt).toBeDefined()
      console.log('[Test] Authentication successful, lastLoginAt updated')
    })

    it('should reject incorrect password', () => {
      console.log('[Test] Authenticate with wrong password')
      const result = userDb.authenticateUser('authuser', 'wrongpassword')

      expect(result.success).toBe(false)
      expect(result.error).toContain('password')
      console.log('[Test] Wrong password rejected')
    })

    it('should reject non-existent user', () => {
      console.log('[Test] Authenticate non-existent user')
      const result = userDb.authenticateUser('ghostuser', 'anypassword')

      expect(result.success).toBe(false)
      expect(result.error).toContain('not found')
      console.log('[Test] Non-existent user rejected')
    })
  })

  // ==================== Password Change Tests ====================

  describe('Password Management (updateUserPassword)', () => {
    beforeAll(() => {
      userDb.registerUser('pwduser', 'oldpass123')
    })

    it('should change password with correct old password', () => {
      console.log('[Test] Change password with correct old password')
      const result = userDb.updateUserPassword('pwduser', 'oldpass123', 'newpass456')

      expect(result.success).toBe(true)
      console.log('[Test] Password changed successfully')
    })

    it('should authenticate with new password', () => {
      console.log('[Test] Authenticate with new password')
      const result = userDb.authenticateUser('pwduser', 'newpass456')

      expect(result.success).toBe(true)
      console.log('[Test] New password works')
    })

    it('should reject with old password', () => {
      console.log('[Test] Authenticate with old password')
      const result = userDb.authenticateUser('pwduser', 'oldpass123')

      expect(result.success).toBe(false)
      console.log('[Test] Old password no longer works')
    })

    it('should reject wrong old password', () => {
      console.log('[Test] Change password with wrong old password')
      const result = userDb.updateUserPassword('pwduser', 'wrongold', 'anotherpass')

      expect(result.success).toBe(false)
      expect(result.error).toContain('Invalid current')
      console.log('[Test] Wrong old password rejected')
    })

    it('should reject short new password', () => {
      console.log('[Test] Change password to short password')
      const result = userDb.updateUserPassword('pwduser', 'newpass456', 'short')

      expect(result.success).toBe(false)
      expect(result.error).toContain('at least 6')
      console.log('[Test] Short new password rejected')
    })
  })

  // ==================== User Activation Tests ====================

  describe('User Status Management', () => {
    beforeAll(() => {
      userDb.registerUser('statususer', 'password123')
    })

    it('should deactivate user', () => {
      console.log('[Test] Deactivate user')
      const result = userDb.deactivateUser('statususer')

      expect(result.success).toBe(true)
      console.log('[Test] User deactivated')
    })

    it('should prevent deactivated user login', () => {
      console.log('[Test] Login as deactivated user')
      const result = userDb.authenticateUser('statususer', 'password123')

      expect(result.success).toBe(false)
      expect(result.error).toContain('inactive')
      console.log('[Test] Deactivated user cannot login')
    })

    it('should reactivate user', () => {
      console.log('[Test] Reactivate user')
      const result = userDb.reactivateUser('statususer')

      expect(result.success).toBe(true)
      console.log('[Test] User reactivated')
    })

    it('should allow reactivated user login', () => {
      console.log('[Test] Login as reactivated user')
      const result = userDb.authenticateUser('statususer', 'password123')

      expect(result.success).toBe(true)
      console.log('[Test] Reactivated user can login')
    })
  })

  // ==================== User Statistics ====================

  describe('User Statistics', () => {
    it('should return correct statistics', () => {
      console.log('[Test] Get user statistics')
      const stats = userDb.getUserStatistics()

      expect(stats.totalUsers).toBeGreaterThan(0)
      expect(stats.activeUsers).toBeGreaterThanOrEqual(0)
      expect(stats.inactiveUsers).toBeGreaterThanOrEqual(0)
      expect(stats.totalUsers).toBe(stats.activeUsers + stats.inactiveUsers)
      console.log('[Test] Statistics:', stats)
    })
  })

  // ==================== Auth Token Tests ====================

  describe('Token-Based Authentication', () => {
    it('should generate and verify token on login', async () => {
      console.log('[Test] Login and verify token')
      const loginResult = await authDb.handleLogin('admin', 'admin123')

      expect(loginResult.success).toBe(true)
      expect(loginResult.token).toBeDefined()
      expect(loginResult.userId).toBeDefined()
      expect(loginResult.expiresAt).toBeDefined()

      const verification = authDb.verifyToken(loginResult.token!)
      expect(verification.valid).toBe(true)
      expect(verification.userId).toBe(loginResult.userId)
      expect(verification.username).toBe(loginResult.username)

      console.log('[Test] Token generated and verified')
    })

    it('should reject invalid token', () => {
      console.log('[Test] Verify invalid token')
      const verification = authDb.verifyToken('invalid.token.here')

      expect(verification.valid).toBe(false)
      console.log('[Test] Invalid token rejected')
    })

    it('should revoke token on logout', async () => {
      console.log('[Test] Logout and verify token revoked')
      const loginResult = await authDb.handleLogin('admin', 'admin123')
      const token = loginResult.token!

      authDb.handleLogout(token)
      const verification = authDb.verifyToken(token)

      expect(verification.valid).toBe(false)
      console.log('[Test] Token revoked on logout')
    })
  })

  // ==================== Rate Limiting Tests ====================

  describe('Rate Limiting', () => {
    it('should enforce login rate limiting', async () => {
      console.log('[Test] Test rate limiting on failed attempts')

      // Attempt to login 6 times with wrong password
      for (let i = 0; i < 6; i++) {
        const result = await authDb.handleLogin('admin', 'wrongpass')
        console.log(`[Test] Attempt ${i + 1}: ${result.success ? 'success' : 'failed'}`)

        if (i < 5) {
          expect(result.success).toBe(false)
          expect(result.error).toContain('Invalid')
        } else {
          // 6th attempt should be rate limited
          expect(result.success).toBe(false)
          expect(result.error).toContain('Too many')
        }
      }

      console.log('[Test] Rate limiting enforced')
    })
  })

  // ==================== Integration Tests ====================

  describe('End-to-End User Lifecycle', () => {
    it('should complete full user lifecycle', async () => {
      console.log('[Test] Starting full lifecycle test')

      // 1. Register
      console.log('[Test] Step 1: Register user')
      const registerResult = userDb.registerUser('lifecycle', 'initial123')
      expect(registerResult.success).toBe(true)
      const userId = registerResult.user!.id

      // 2. Authenticate
      console.log('[Test] Step 2: Authenticate')
      let authResult = userDb.authenticateUser('lifecycle', 'initial123')
      expect(authResult.success).toBe(true)

      // 3. Change password
      console.log('[Test] Step 3: Change password')
      let pwdResult = userDb.updateUserPassword('lifecycle', 'initial123', 'updated456')
      expect(pwdResult.success).toBe(true)

      // 4. Verify password changed
      console.log('[Test] Step 4: Verify new password')
      authResult = userDb.authenticateUser('lifecycle', 'updated456')
      expect(authResult.success).toBe(true)

      // 5. Token-based auth
      console.log('[Test] Step 5: Token-based login')
      const loginResult = await authDb.handleLogin('lifecycle', 'updated456')
      expect(loginResult.success).toBe(true)
      const token = loginResult.token!

      // 6. Verify token
      console.log('[Test] Step 6: Verify token')
      const verification = authDb.verifyToken(token)
      expect(verification.valid).toBe(true)

      // 7. Deactivate
      console.log('[Test] Step 7: Deactivate user')
      const deactivateResult = userDb.deactivateUser('lifecycle')
      expect(deactivateResult.success).toBe(true)

      // 8. Verify deactivation prevents login
      console.log('[Test] Step 8: Verify deactivated user cannot login')
      authResult = userDb.authenticateUser('lifecycle', 'updated456')
      expect(authResult.success).toBe(false)

      // 9. Reactivate
      console.log('[Test] Step 9: Reactivate user')
      const reactivateResult = userDb.reactivateUser('lifecycle')
      expect(reactivateResult.success).toBe(true)

      // 10. Verify reactivation
      console.log('[Test] Step 10: Verify reactivated user can login')
      authResult = userDb.authenticateUser('lifecycle', 'updated456')
      expect(authResult.success).toBe(true)

      // 11. Delete
      console.log('[Test] Step 11: Delete user')
      const deleteResult = userDb.deleteUser('lifecycle')
      expect(deleteResult.success).toBe(true)

      // 12. Verify deletion
      console.log('[Test] Step 12: Verify user deleted')
      const user = userDb.getUserById(userId)
      expect(user).toBeNull()

      console.log('[Test] ✅ Full lifecycle completed successfully')
    })
  })
})
