import type { DataSnapshot } from './prompt-builder'

export type AnalysisPlanIntent = 'summary' | 'trend' | 'relationship' | 'search' | 'comparison' | 'mixed'

export interface AnalysisPlanStep {
  goal: string
  suggestedTools: string[]
  evidenceNeeded: string
}

export interface AnalysisPlanSummary {
  version: 1
  title: string
  route: 'planned_execution'
  intent: AnalysisPlanIntent
  steps: AnalysisPlanStep[]
  successCriteria: string[]
}

export interface PlannerCapabilitySummary {
  id: string
  label: string
  tools: string[]
  guidance: string
}

export interface PlanContentBlock {
  type: 'plan'
  version: 1
  status: 'created' | 'executing' | 'done' | 'skipped'
  plan: AnalysisPlanSummary
}

export interface PlannerInput {
  userMessage: string
  chatType: 'group' | 'private'
  locale: string
  dataSnapshot?: DataSnapshot
  availableTools: string[]
  availableCapabilities?: PlannerCapabilitySummary[]
  assistantSummary?: string
  skillSummary?: string
  recentIntentSummary?: string
}

export type AnalysisPlanner = (input: PlannerInput, signal?: AbortSignal) => Promise<AnalysisPlanSummary | null>
