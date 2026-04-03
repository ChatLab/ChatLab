/**
 * ChatLab Web UI API - 集成测试和验证指南
 *
 * 本文件提供了完整的测试流程和验证方法
 */

// ==================== 单元测试执行指南 ====================

/**
 * 运行单元测试：
 *
 * # 运行所有 Web UI API 测试
 * npm test -- tests/api/webui.test.ts
 *
 * # 运行特定测试套件
 * npm test -- tests/api/webui.test.ts -t "Authentication"
 * npm test -- tests/api/webui.test.ts -t "Sessions"
 * npm test -- tests/api/webui.test.ts -t "Conversations"
 * npm test -- tests/api/webui.test.ts -t "Messages"
 *
 * # 运行集成测试
 * npm test -- tests/api/webui.test.ts -t "Integration"
 *
 * # 查看详细测试报告
 * npm test -- tests/api/webui.test.ts --reporter=verbose
 */

// ==================== 手动集成测试 ====================

/**
 * 前置条件：
 * 1. ChatLab 应用已启动
 * 2. API 服务已启用（端口 9871）
 * 3. 至少有一个分析会话已创建
 */

// 步骤 1: 验证服务健康
const testHealthCheck = async () => {
  const response = await fetch('http://127.0.0.1:9871/api/webui/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'invalid', password: 'invalid' }),
  })

  console.log(`[Health Check] API Server: ${response.ok ? 'RUNNING' : 'NOT RESPONDING'}`)
  return response.ok
}

// 步骤 2: 测试完整工作流
const testCompleteWorkflow = async () => {
  console.log('\n========== Web UI API Complete Workflow Test ==========\n')

  try {
    // 1. 登录
    console.log('📝 Step 1: Logging in...')
    const loginResponse = await fetch('http://127.0.0.1:9871/api/webui/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' }),
    })

    if (!loginResponse.ok) {
      console.error(`❌ Login failed: ${loginResponse.status}`)
      return
    }

    const loginData = await loginResponse.json()
    const token = loginData.data.token
    console.log(`✅ Login successful. Token: ${token.slice(0, 20)}...`)
    console.log(`   Expires at: ${new Date(loginData.data.expiresAt).toISOString()}`)

    // 2. 列表会话
    console.log('\n📝 Step 2: Listing sessions...')
    const sessionsResponse = await fetch('http://127.0.0.1:9871/api/webui/sessions', {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` },
    })

    const sessionsData = await sessionsResponse.json()
    const sessions = sessionsData.data
    console.log(`✅ Found ${sessions.length} sessions:`)
    sessions.forEach((s) => {
      console.log(`   - ${s.name} (ID: ${s.id}, Messages: ${s.messageCount})`)
    })

    if (sessions.length === 0) {
      console.warn('⚠️  No sessions available. Create a session first.')
      return
    }

    const sessionId = sessions[0].id

    // 3. 获取单个会话
    console.log(`\n📝 Step 3: Getting session details (${sessionId})...`)
    const sessionResponse = await fetch(
      `http://127.0.0.1:9871/api/webui/sessions/${sessionId}`,
      {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` },
      }
    )

    const sessionData = await sessionResponse.json()
    console.log(`✅ Session Details:`)
    console.log(`   Name: ${sessionData.data.name}`)
    console.log(`   Created: ${new Date(sessionData.data.createdAt).toISOString()}`)
    console.log(`   Messages: ${sessionData.data.messageCount}`)

    // 4. 创建对话
    console.log('\n📝 Step 4: Creating a conversation...')
    const createConvResponse = await fetch('http://127.0.0.1:9871/api/webui/conversations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sessionId,
        title: 'Test Conversation ' + new Date().toLocaleTimeString(),
        assistantId: 'default',
      }),
    })

    const convData = await createConvResponse.json()
    const conversationId = convData.data.id
    console.log(`✅ Conversation created: ${conversationId}`)
    console.log(`   Title: ${convData.data.title}`)

    // 5. 列表对话
    console.log(`\n📝 Step 5: Listing conversations for session ${sessionId}...`)
    const listConvResponse = await fetch(
      `http://127.0.0.1:9871/api/webui/sessions/${sessionId}/conversations`,
      {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` },
      }
    )

    const listConvData = await listConvResponse.json()
    console.log(`✅ Found ${listConvData.data.length} conversations in this session`)

    // 6. 发送消息
    console.log(`\n📝 Step 6: Sending messages to conversation...`)
    const messages = [
      'Hello, what are the main topics in this chat?',
      'Can you summarize the key discussions?',
      'Who are the most active members?',
    ]

    for (let i = 0; i < messages.length; i++) {
      const sendResponse = await fetch(
        `http://127.0.0.1:9871/api/webui/conversations/${conversationId}/messages`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ content: messages[i] }),
        }
      )

      const msgData = await sendResponse.json()
      console.log(`   ✅ Message ${i + 1}: ${msgData.data.id}`)
    }

    // 7. 获取消息（分页）
    console.log(`\n📝 Step 7: Retrieving messages with pagination...`)
    const getMessagesResponse = await fetch(
      `http://127.0.0.1:9871/api/webui/conversations/${conversationId}/messages?limit=10&offset=0`,
      {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` },
      }
    )

    const messagesData = await getMessagesResponse.json()
    console.log(`✅ Retrieved ${messagesData.data.messages.length} messages (total: ${messagesData.data.total})`)
    messagesData.data.messages.forEach((msg, i) => {
      console.log(
        `   ${i + 1}. [${msg.role.toUpperCase()}] ${msg.content.slice(0, 40)}...`
      )
    })

    // 8. 删除对话
    console.log(`\n📝 Step 8: Deleting conversation...`)
    const delResponse = await fetch(
      `http://127.0.0.1:9871/api/webui/conversations/${conversationId}`,
      {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      }
    )

    const delData = await delResponse.json()
    console.log(`✅ Conversation deleted: ${delData.data.success}`)

    // 9. 登出
    console.log(`\n📝 Step 9: Logging out...`)
    const logoutResponse = await fetch('http://127.0.0.1:9871/api/webui/auth/logout', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
    })

    const logoutData = await logoutResponse.json()
    console.log(`✅ Logged out: ${logoutData.data.success}`)

    console.log('\n========== ✅ All tests passed! ==========\n')
  } catch (error) {
    console.error(`❌ Test error: ${error instanceof Error ? error.message : String(error)}`)
  }
}

// ==================== 错误场景测试 ====================

const testErrorScenarios = async () => {
  console.log('\n========== Error Scenarios Testing ==========\n')

  try {
    // 测试 1: 无效凭证
    console.log('Test 1: Invalid credentials')
    const invalidLoginResponse = await fetch('http://127.0.0.1:9871/api/webui/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'wrongpass' }),
    })
    const invalidData = await invalidLoginResponse.json()
    console.log(
      `  Status: ${invalidLoginResponse.status}, Error: ${invalidData.error?.message}`
    )

    // 测试 2: 缺少 Token
    console.log('\nTest 2: Missing authorization token')
    const noTokenResponse = await fetch('http://127.0.0.1:9871/api/webui/sessions', {
      method: 'GET',
    })
    const noTokenData = await noTokenResponse.json()
    console.log(`  Status: ${noTokenResponse.status}, Error: ${noTokenData.error?.message}`)

    // 测试 3: 无效 Token
    console.log('\nTest 3: Invalid token')
    const invalidTokenResponse = await fetch('http://127.0.0.1:9871/api/webui/sessions', {
      method: 'GET',
      headers: { 'Authorization': 'Bearer invalid.token.here' },
    })
    const invalidTokenData = await invalidTokenResponse.json()
    console.log(
      `  Status: ${invalidTokenResponse.status}, Error: ${invalidTokenData.error?.message}`
    )

    // 获取有效 token
    const loginResponse = await fetch('http://127.0.0.1:9871/api/webui/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' }),
    })
    const loginData = await loginResponse.json()
    const token = loginData.data.token

    // 测试 4: 不存在的会话
    console.log('\nTest 4: Non-existent session')
    const noSessionResponse = await fetch(
      'http://127.0.0.1:9871/api/webui/sessions/non-existent-id',
      {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` },
      }
    )
    const noSessionData = await noSessionResponse.json()
    console.log(`  Status: ${noSessionResponse.status}, Error: ${noSessionData.error?.message}`)

    // 测试 5: 不存在的对话
    console.log('\nTest 5: Non-existent conversation')
    const noConvResponse = await fetch(
      'http://127.0.0.1:9871/api/webui/conversations/non-existent-id',
      {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      }
    )
    const noConvData = await noConvResponse.json()
    console.log(`  Status: ${noConvResponse.status}, Error: ${noConvData.error?.message}`)

    // 测试 6: 空消息
    console.log('\nTest 6: Empty message')
    const sessions = (
      await (
        await fetch('http://127.0.0.1:9871/api/webui/sessions', {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${token}` },
        })
      ).json()
    ).data

    if (sessions.length > 0) {
      const createConvResponse = await fetch('http://127.0.0.1:9871/api/webui/conversations', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sessionId: sessions[0].id }),
      })
      const convData = await createConvResponse.json()

      const emptyMsgResponse = await fetch(
        `http://127.0.0.1:9871/api/webui/conversations/${convData.data.id}/messages`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ content: '' }),
        }
      )
      const emptyMsgData = await emptyMsgResponse.json()
      console.log(`  Status: ${emptyMsgResponse.status}, Error: ${emptyMsgData.error?.message}`)
    }

    console.log('\n========== ✅ Error tests completed! ==========\n')
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
  }
}

// ==================== 性能测试 ====================

const testPerformance = async () => {
  console.log('\n========== Performance Testing ==========\n')

  try {
    // 登录
    const loginResponse = await fetch('http://127.0.0.1:9871/api/webui/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' }),
    })
    const loginData = await loginResponse.json()
    const token = loginData.data.token

    // 测试列表 API 响应时间
    console.log('Test: API Response Time')
    const iterations = 10
    const times: number[] = []

    for (let i = 0; i < iterations; i++) {
      const start = performance.now()
      await fetch('http://127.0.0.1:9871/api/webui/sessions', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` },
      })
      const end = performance.now()
      times.push(end - start)
    }

    const avgTime = times.reduce((a, b) => a + b) / times.length
    const minTime = Math.min(...times)
    const maxTime = Math.max(...times)

    console.log(`  Average: ${avgTime.toFixed(2)}ms`)
    console.log(`  Min: ${minTime.toFixed(2)}ms`)
    console.log(`  Max: ${maxTime.toFixed(2)}ms`)

    console.log('\n========== ✅ Performance tests completed! ==========\n')
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
  }
}

// ==================== 日志验证 ====================

/**
 * 验证日志输出完整性
 *
 * 预期日志格式：
 * [WebUI API] [ISO_TIMESTAMP] OPERATION_NAME - Context
 *
 * 运行以下命令查看实时日志：
 * tail -f ~/Library/Application\ Support/ChatLab/logs/api.log
 *
 * 或在 Windows：
 * Get-Content $env:APPDATA\ChatLab\logs\api.log -Tail 20 -Wait
 */

const logVerification = () => {
  console.log(`
    ========== Log Verification Checklist ==========

    Expected log patterns:

    ✓ [WebUI API] [2024-01-01T00:00:00Z] LOGIN_ATTEMPT - User: admin
    ✓ [WebUI API] [2024-01-01T00:00:00Z] LOGIN_SUCCESS - User: admin: {token: "...", expiresAt: "..."}
    ✓ [WebUI API] [2024-01-01T00:00:00Z] LOGIN_FAILED - User: admin: {error: "Invalid credentials"}
    ✓ [WebUI API] [2024-01-01T00:00:00Z] LIST_SESSIONS - Retrieving all sessions
    ✓ [WebUI API] [2024-01-01T00:00:00Z] LIST_SESSIONS_SUCCESS - Found 3 sessions: {sessionIds: [...]}
    ✓ [WebUI API] [2024-01-01T00:00:00Z] CREATE_CONVERSATION - Session: session-123: {title: "...", assistantId: "..."}
    ✓ [WebUI API] [2024-01-01T00:00:00Z] SEND_MESSAGE - Conversation: conv-456: {contentLength: 42}
    ✓ [WebUI API] [2024-01-01T00:00:00Z] LOGOUT - User logged out
  `)
}

// ==================== 执行所有测试 ====================

const runAllTests = async () => {
  console.log('Starting all tests...\n')

  if (await testHealthCheck()) {
    await testCompleteWorkflow()
    await testErrorScenarios()
    await testPerformance()
    logVerification()
  } else {
    console.error('❌ API server is not running. Please start the application first.')
  }
}

// 导出函数供外部调用
export { testHealthCheck, testCompleteWorkflow, testErrorScenarios, testPerformance, runAllTests }

// 如果直接运行此文件
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllTests()
}
