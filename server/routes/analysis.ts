/**
 * Analysis data API routes (US-006)
 *
 * Replaces the Electron IPC handlers for all analysis/statistics endpoints:
 *   GET /api/sessions/:id/member-activity
 *   GET /api/sessions/:id/hourly-activity
 *   GET /api/sessions/:id/daily-activity
 *   GET /api/sessions/:id/weekday-activity
 *   GET /api/sessions/:id/monthly-activity
 *   GET /api/sessions/:id/yearly-activity
 *   GET /api/sessions/:id/message-length-distribution
 *   GET /api/sessions/:id/message-type-distribution
 *   GET /api/sessions/:id/catchphrase-analysis
 *   GET /api/sessions/:id/mention-analysis
 *   GET /api/sessions/:id/mention-graph
 *   GET /api/sessions/:id/cluster-graph
 *   GET /api/sessions/:id/laugh-analysis
 *   GET /api/sessions/:id/member-name-history/:memberId
 *
 * All endpoints accept optional startTs/endTs query params for time filtering.
 */

import { Router } from 'express'
import type { TimeFilter } from '../services/db-pool'
import {
  getMemberActivity,
  getHourlyActivity,
  getDailyActivity,
  getWeekdayActivity,
  getMonthlyActivity,
  getYearlyActivity,
  getMessageLengthDistribution,
  getMessageTypeDistribution,
  getMemberNameHistory,
} from '../services/queries/basic'
import {
  getCatchphraseAnalysis,
  getMentionAnalysis,
  getMentionGraph,
  getLaughAnalysis,
  getClusterGraph,
} from '../services/queries/advanced'

const router = Router({ mergeParams: true })

/**
 * Parse optional time filter query params from the request.
 */
function parseTimeFilter(query: Record<string, any>): TimeFilter | undefined {
  const startTs = query.startTs ? Number(query.startTs) : undefined
  const endTs = query.endTs ? Number(query.endTs) : undefined

  if (startTs === undefined && endTs === undefined) return undefined

  const filter: TimeFilter = {}
  if (startTs !== undefined && !isNaN(startTs)) filter.startTs = startTs
  if (endTs !== undefined && !isNaN(endTs)) filter.endTs = endTs
  return filter
}

/**
 * GET /api/sessions/:id/member-activity
 */
router.get('/:id/member-activity', (req, res) => {
  try {
    const filter = parseTimeFilter(req.query)
    const data = getMemberActivity(req.params.id, filter)
    res.json(data)
  } catch (error) {
    console.error('[API] Failed to get member activity:', error)
    res.status(500).json({ error: 'Failed to get member activity' })
  }
})

/**
 * GET /api/sessions/:id/hourly-activity
 */
router.get('/:id/hourly-activity', (req, res) => {
  try {
    const filter = parseTimeFilter(req.query)
    const data = getHourlyActivity(req.params.id, filter)
    res.json(data)
  } catch (error) {
    console.error('[API] Failed to get hourly activity:', error)
    res.status(500).json({ error: 'Failed to get hourly activity' })
  }
})

/**
 * GET /api/sessions/:id/daily-activity
 */
router.get('/:id/daily-activity', (req, res) => {
  try {
    const filter = parseTimeFilter(req.query)
    const data = getDailyActivity(req.params.id, filter)
    res.json(data)
  } catch (error) {
    console.error('[API] Failed to get daily activity:', error)
    res.status(500).json({ error: 'Failed to get daily activity' })
  }
})

/**
 * GET /api/sessions/:id/weekday-activity
 */
router.get('/:id/weekday-activity', (req, res) => {
  try {
    const filter = parseTimeFilter(req.query)
    const data = getWeekdayActivity(req.params.id, filter)
    res.json(data)
  } catch (error) {
    console.error('[API] Failed to get weekday activity:', error)
    res.status(500).json({ error: 'Failed to get weekday activity' })
  }
})

/**
 * GET /api/sessions/:id/monthly-activity
 */
router.get('/:id/monthly-activity', (req, res) => {
  try {
    const filter = parseTimeFilter(req.query)
    const data = getMonthlyActivity(req.params.id, filter)
    res.json(data)
  } catch (error) {
    console.error('[API] Failed to get monthly activity:', error)
    res.status(500).json({ error: 'Failed to get monthly activity' })
  }
})

/**
 * GET /api/sessions/:id/yearly-activity
 */
router.get('/:id/yearly-activity', (req, res) => {
  try {
    const filter = parseTimeFilter(req.query)
    const data = getYearlyActivity(req.params.id, filter)
    res.json(data)
  } catch (error) {
    console.error('[API] Failed to get yearly activity:', error)
    res.status(500).json({ error: 'Failed to get yearly activity' })
  }
})

/**
 * GET /api/sessions/:id/message-length-distribution
 */
router.get('/:id/message-length-distribution', (req, res) => {
  try {
    const filter = parseTimeFilter(req.query)
    const data = getMessageLengthDistribution(req.params.id, filter)
    res.json(data)
  } catch (error) {
    console.error('[API] Failed to get message length distribution:', error)
    res.status(500).json({ error: 'Failed to get message length distribution' })
  }
})

/**
 * GET /api/sessions/:id/message-type-distribution
 */
router.get('/:id/message-type-distribution', (req, res) => {
  try {
    const filter = parseTimeFilter(req.query)
    const data = getMessageTypeDistribution(req.params.id, filter)
    res.json(data)
  } catch (error) {
    console.error('[API] Failed to get message type distribution:', error)
    res.status(500).json({ error: 'Failed to get message type distribution' })
  }
})

/**
 * GET /api/sessions/:id/catchphrase-analysis
 */
router.get('/:id/catchphrase-analysis', (req, res) => {
  try {
    const filter = parseTimeFilter(req.query)
    const data = getCatchphraseAnalysis(req.params.id, filter)
    res.json(data)
  } catch (error) {
    console.error('[API] Failed to get catchphrase analysis:', error)
    res.status(500).json({ error: 'Failed to get catchphrase analysis' })
  }
})

/**
 * GET /api/sessions/:id/mention-analysis
 */
router.get('/:id/mention-analysis', (req, res) => {
  try {
    const filter = parseTimeFilter(req.query)
    const data = getMentionAnalysis(req.params.id, filter)
    res.json(data)
  } catch (error) {
    console.error('[API] Failed to get mention analysis:', error)
    res.status(500).json({ error: 'Failed to get mention analysis' })
  }
})

/**
 * GET /api/sessions/:id/mention-graph
 */
router.get('/:id/mention-graph', (req, res) => {
  try {
    const filter = parseTimeFilter(req.query)
    const data = getMentionGraph(req.params.id, filter)
    res.json(data)
  } catch (error) {
    console.error('[API] Failed to get mention graph:', error)
    res.status(500).json({ error: 'Failed to get mention graph' })
  }
})

/**
 * GET /api/sessions/:id/cluster-graph
 */
router.get('/:id/cluster-graph', (req, res) => {
  try {
    const filter = parseTimeFilter(req.query)
    const data = getClusterGraph(req.params.id, filter)
    res.json(data)
  } catch (error) {
    console.error('[API] Failed to get cluster graph:', error)
    res.status(500).json({ error: 'Failed to get cluster graph' })
  }
})

/**
 * GET /api/sessions/:id/laugh-analysis
 */
router.get('/:id/laugh-analysis', (req, res) => {
  try {
    const filter = parseTimeFilter(req.query)
    // Parse keywords from query params (comma-separated or repeated param)
    let keywords: string[] | undefined
    if (req.query.keywords) {
      keywords = typeof req.query.keywords === 'string'
        ? req.query.keywords.split(',').map((k: string) => k.trim()).filter(Boolean)
        : Array.isArray(req.query.keywords)
          ? (req.query.keywords as string[])
          : undefined
    }
    const data = getLaughAnalysis(req.params.id, filter, keywords)
    res.json(data)
  } catch (error) {
    console.error('[API] Failed to get laugh analysis:', error)
    res.status(500).json({ error: 'Failed to get laugh analysis' })
  }
})

/**
 * GET /api/sessions/:id/member-name-history/:memberId
 */
router.get('/:id/member-name-history/:memberId', (req, res) => {
  try {
    const memberId = parseInt(req.params.memberId, 10)
    if (isNaN(memberId)) {
      res.status(400).json({ error: 'Invalid memberId parameter' })
      return
    }
    const data = getMemberNameHistory(req.params.id, memberId)
    res.json(data)
  } catch (error) {
    console.error('[API] Failed to get member name history:', error)
    res.status(500).json({ error: 'Failed to get member name history' })
  }
})

export default router
