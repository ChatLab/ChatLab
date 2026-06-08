import type { DataSnapshot } from './prompt-builder'

export type RequestRoute = 'direct_response' | 'tool_assisted' | 'planned_execution'
export type RouteDecisionSource = 'rule' | 'llm'

export interface RouterInput {
  userMessage: string
  chatType: 'group' | 'private'
  locale: string
  dataSnapshot?: DataSnapshot
  availableTools?: string[]
  assistantSummary?: string
  skillSummary?: string
  recentIntentSummary?: string
}

export interface RouteDecision {
  route: RequestRoute
  /** Confidence is normalized to 0-1. Rule fallbacks below 0.6 should be treated as uncertain. */
  confidence: number
  reason: string
  source: RouteDecisionSource
}

export type LlmRouteDecider = (
  input: RouterInput,
  ruleDecision: RouteDecision
) => Promise<RouteDecision> | RouteDecision
