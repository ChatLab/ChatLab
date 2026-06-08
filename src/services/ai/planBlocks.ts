export type PlanIntent = 'summary' | 'trend' | 'relationship' | 'search' | 'comparison' | 'mixed'
export type PlanBlockStatus = 'created' | 'executing' | 'done' | 'skipped'

export interface PlanStep {
  goal: string
  suggestedTools: string[]
  evidenceNeeded: string
}

export interface PlanSummary {
  version: 1
  title: string
  route: 'planned_execution'
  intent: PlanIntent
  steps: PlanStep[]
  successCriteria: string[]
}

export interface PlanContentBlock {
  type: 'plan'
  version: 1
  status: PlanBlockStatus
  plan: PlanSummary
}

export function toPlanContentBlock(block: PlanContentBlock): PlanContentBlock {
  return JSON.parse(JSON.stringify(block)) as PlanContentBlock
}

export function updateLastPlanBlockStatus(
  blocks: readonly PlanContentBlock[],
  status: PlanBlockStatus
): PlanContentBlock[] {
  const nextBlocks = blocks.map(toPlanContentBlock)
  for (let index = nextBlocks.length - 1; index >= 0; index--) {
    if (nextBlocks[index].type === 'plan') {
      nextBlocks[index].status = status
      break
    }
  }
  return nextBlocks
}
