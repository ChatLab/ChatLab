/**
 * Phase 4 - Admin Management API Tests
 * Tests for API server management and user administration endpoints
 * Comprehensive test coverage for all admin operations
 */

import { describe, it, expect, beforeAll } from 'vitest'

describe('Phase 4: Admin Management API', () => {
  let adminToken: string
  let testBaseURL = 'http://127.0.0.1:9871'

  /**
   * Test HTTP request helper
   */
  async function adminRequest(
    method: string,
    path: string,
    options?: { body?: any; token?: string }
  ): Promise<{ status: number; data: any }> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    if (options?.token) {
      headers['Authorization'] = `Bearer ${options.token}`
    }

    const response = await fetch(`${testBaseURL}${path}`, {
      method,
      headers,
      body: options?.body ? JSON.stringify(options.body) : undefined,
    })

    const data = await response.json()
    return { status: response.status, data }
  }

  beforeAll(async () => {
    console.log('[Test] Setup: Logging in as admin')
    // Get admin token
    const loginResponse = await adminRequest('POST', '/api/webui/auth/login', {
      body: { username: 'admin', password: 'admin123' },
    })
    if (loginResponse.data.success) {
      adminToken = loginResponse.data.data.token
      console.log('[Test] Admin token obtained')
    } else {
      console.error('[Test] Failed to get admin token')
    }
  })

  // ==================== Server Status Tests ====================

  describe('Server Status Management', () => {
    it('should get server status', async () => {
      console.log('[Test] Getting server status')
      const response = await adminRequest('GET', '/api/webui/admin/server/status', {
        token: adminToken,
      })

      expect(response.status).toBe(200)
      expect(response.data.success).toBe(true)
      expect(response.data.data).toBeDefined()
      expect(response.data.data.server).toBeDefined()
      expect(response.data.data.server.running).toBeDefined()
      console.log('[Test] Server status retrieved:', response.data.data.server)
    })

    it('should reject unauthorized access to server status', async () => {
      console.log('[Test] Testing unauthorized access to server status')
      const response = await adminRequest('GET', '/api/webui/admin/server/status')

      expect(response.status).toBe(401)
      expect(response.data.success).toBe(false)
      console.log('[Test] Unauthorized access rejected')
    })

    it('should reject with invalid token', async () => {
      console.log('[Test] Testing invalid token for server status')
      const response = await adminRequest('GET', '/api/webui/admin/server/status', {
        token: 'invalid.token.here',
      })

      expect(response.status).toBe(401)
      expect(response.data.success).toBe(false)
      console.log('[Test] Invalid token rejected')
    })
  })

  // ==================== Server Control Tests ====================

  describe('Server Enable/Disable', () => {
    it('should disable server', async () => {
      console.log('[Test] Disabling server')
      const response = await adminRequest('POST', '/api/webui/admin/server/disable', {
        token: adminToken,
      })

      expect(response.status).toBe(200)
      expect(response.data.success).toBe(true)
      console.log('[Test] Server disabled')
    })

    it('should enable server', async () => {
      console.log('[Test] Enabling server')
      const response = await adminRequest('POST', '/api/webui/admin/server/enable', {
        token: adminToken,
      })

      expect(response.status).toBe(200)
      expect(response.data.success).toBe(true)
      console.log('[Test] Server enabled')
    })
  })

  // ==================== Port Management Tests ====================

  describe('Port Configuration', () => {
    it('should reject invalid port', async () => {
      console.log('[Test] Testing invalid port number')
      const response = await adminRequest('POST', '/api/webui/admin/server/port', {
        body: { port: 100 }, // Too low
        token: adminToken,
      })

      expect(response.status).toBeGreaterThanOrEqual(400)
      expect(response.data.success).toBe(false)
      console.log('[Test] Invalid port rejected')
    })

    it('should reject port above 65535', async () => {
      console.log('[Test] Testing port above 65535')
      const response = await adminRequest('POST', '/api/webui/admin/server/port', {
        body: { port: 70000 },
        token: adminToken,
      })

      expect(response.status).toBeGreaterThanOrEqual(400)
      expect(response.data.success).toBe(false)
      console.log('[Test] High port rejected')
    })

    // Note: Actual port change test commented out to avoid server restart in tests
    // it('should change port to valid value', async () => {
    //   const response = await adminRequest('POST', '/api/webui/admin/server/port', {
    //     body: { port: 9872 },
    //     token: adminToken,
    //   })
    //   expect(response.status).toBe(200)
    // })
  })

  // ==================== User Management Tests ====================

  describe('User Management', () => {
    beforeAll(async () => {
      console.log('[Test] Setup: Creating test user')
      // Create a test user for management tests
      await adminRequest('POST', '/api/webui/auth/register', {
        body: { username: 'testadmin', password: 'testpass123' },
      })
    })

    it('should list all users', async () => {
      console.log('[Test] Listing all users')
      const response = await adminRequest('GET', '/api/webui/admin/users', {
        token: adminToken,
      })

      expect(response.status).toBe(200)
      expect(response.data.success).toBe(true)
      expect(Array.isArray(response.data.data.users)).toBe(true)
      expect(response.data.data.statistics).toBeDefined()
      console.log('[Test] Users listed:', response.data.data.users.length)
    })

    it('should show user statistics', async () => {
      console.log('[Test] Checking user statistics')
      const response = await adminRequest('GET', '/api/webui/admin/users', {
        token: adminToken,
      })

      const stats = response.data.data.statistics
      expect(stats.totalUsers).toBeGreaterThan(0)
      expect(stats.activeUsers).toBeGreaterThanOrEqual(0)
      expect(stats.inactiveUsers).toBeGreaterThanOrEqual(0)
      console.log('[Test] Statistics:', stats)
    })

    it('should disable a user', async () => {
      console.log('[Test] Disabling test user')
      const response = await adminRequest('POST', '/api/webui/admin/users/disable', {
        body: { username: 'testadmin' },
        token: adminToken,
      })

      expect(response.status).toBe(200)
      expect(response.data.success).toBe(true)
      console.log('[Test] User disabled')
    })

    it('should enable a disabled user', async () => {
      console.log('[Test] Enabling test user')
      const response = await adminRequest('POST', '/api/webui/admin/users/enable', {
        body: { username: 'testadmin' },
        token: adminToken,
      })

      expect(response.status).toBe(200)
      expect(response.data.success).toBe(true)
      console.log('[Test] User enabled')
    })

    it('should reject deleting admin user', async () => {
      console.log('[Test] Testing admin user deletion protection')
      const response = await adminRequest('POST', '/api/webui/admin/users/delete', {
        body: { username: 'admin' },
        token: adminToken,
      })

      expect(response.status).toBeGreaterThanOrEqual(400)
      expect(response.data.success).toBe(false)
      console.log('[Test] Admin user deletion prevented')
    })

    it('should delete non-admin user', async () => {
      console.log('[Test] Deleting test user')
      const response = await adminRequest('POST', '/api/webui/admin/users/delete', {
        body: { username: 'testadmin' },
        token: adminToken,
      })

      expect(response.status).toBe(200)
      expect(response.data.success).toBe(true)
      console.log('[Test] User deleted')
    })

    it('should reject disable without username', async () => {
      console.log('[Test] Testing disable without username')
      const response = await adminRequest('POST', '/api/webui/admin/users/disable', {
        body: {},
        token: adminToken,
      })

      expect(response.status).toBeGreaterThanOrEqual(400)
      expect(response.data.success).toBe(false)
      console.log('[Test] Request without username rejected')
    })
  })

  // ==================== Statistics Tests ====================

  describe('System Statistics', () => {
    it('should get system statistics', async () => {
      console.log('[Test] Getting system statistics')
      const response = await adminRequest('GET', '/api/webui/admin/statistics', {
        token: adminToken,
      })

      expect(response.status).toBe(200)
      expect(response.data.success).toBe(true)
      expect(response.data.data.users).toBeDefined()
      expect(response.data.data.server).toBeDefined()
      expect(response.data.data.timestamp).toBeDefined()
      console.log('[Test] Statistics:', {
        users: response.data.data.users,
        server: response.data.data.server,
      })
    })

    it('should include timestamp in statistics', async () => {
      console.log('[Test] Verifying timestamp in statistics')
      const response = await adminRequest('GET', '/api/webui/admin/statistics', {
        token: adminToken,
      })

      const timestamp = response.data.data.timestamp
      expect(timestamp).toBeGreaterThan(0)
      expect(timestamp).toBeLessThan(Date.now() + 1000) // Within 1 second
      console.log('[Test] Timestamp valid')
    })
  })

  // ==================== Authorization Tests ====================

  describe('Admin Authorization', () => {
    it('should reject all admin endpoints without token', async () => {
      console.log('[Test] Testing endpoints without auth')

      const endpoints = [
        { method: 'GET', path: '/api/webui/admin/server/status' },
        { method: 'POST', path: '/api/webui/admin/server/enable' },
        { method: 'POST', path: '/api/webui/admin/server/disable' },
        { method: 'GET', path: '/api/webui/admin/users' },
        { method: 'GET', path: '/api/webui/admin/statistics' },
      ]

      for (const endpoint of endpoints) {
        const response = await adminRequest(endpoint.method, endpoint.path)
        expect(response.status).toBe(401)
        expect(response.data.success).toBe(false)
        console.log(`[Test] ${endpoint.method} ${endpoint.path} - rejected`)
      }
    })

    it('should reject with invalid token', async () => {
      console.log('[Test] Testing endpoints with invalid token')
      const response = await adminRequest('GET', '/api/webui/admin/server/status', {
        token: 'invalid.token.format',
      })

      expect(response.status).toBe(401)
      expect(response.data.success).toBe(false)
      console.log('[Test] Invalid token rejected')
    })
  })

  // ==================== Integration Tests ====================

  describe('Admin Complete Workflow', () => {
    it('should complete admin workflow: check status, list users, get stats', async () => {
      console.log('[Test] Starting admin workflow')

      // 1. Check server status
      console.log('[Test] Step 1: Check server status')
      let response = await adminRequest('GET', '/api/webui/admin/server/status', {
        token: adminToken,
      })
      expect(response.status).toBe(200)
      const initialStatus = response.data.data.server.running

      // 2. List users
      console.log('[Test] Step 2: List users')
      response = await adminRequest('GET', '/api/webui/admin/users', {
        token: adminToken,
      })
      expect(response.status).toBe(200)
      expect(response.data.data.users.length).toBeGreaterThan(0)
      const userCount = response.data.data.users.length

      // 3. Get statistics
      console.log('[Test] Step 3: Get statistics')
      response = await adminRequest('GET', '/api/webui/admin/statistics', {
        token: adminToken,
      })
      expect(response.status).toBe(200)
      expect(response.data.data.users.totalUsers).toBe(userCount)

      // 4. Verify server status again
      console.log('[Test] Step 4: Verify status unchanged')
      response = await adminRequest('GET', '/api/webui/admin/server/status', {
        token: adminToken,
      })
      expect(response.status).toBe(200)
      expect(response.data.data.server.running).toBe(initialStatus)

      console.log('[Test] ✅ Admin workflow completed successfully')
    })
  })
})
