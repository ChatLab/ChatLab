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
  displayText?: string
}

export interface PlanDraftContentBlock {
  type: 'plan_draft'
  version: 1
  status: 'streaming'
  text: string
}

export type PlanLikeContentBlock = PlanContentBlock | PlanDraftContentBlock
type BlockWithType = { type: string }

export function toPlanContentBlock(block: PlanContentBlock): PlanContentBlock {
  return JSON.parse(JSON.stringify(block)) as PlanContentBlock
}

function cloneBlock<T>(block: T): T {
  return JSON.parse(JSON.stringify(block)) as T
}

function isPlanDraftBlock(block: BlockWithType | undefined): block is PlanDraftContentBlock {
  return block?.type === 'plan_draft' && typeof (block as { text?: unknown }).text === 'string'
}

export function appendPlanDraftDelta<T extends BlockWithType>(
  blocks: readonly T[],
  delta: string
): Array<T | PlanDraftContentBlock> {
  const nextBlocks = blocks.map(cloneBlock) as Array<T | PlanDraftContentBlock>
  const lastBlock = nextBlocks[nextBlocks.length - 1]
  if (isPlanDraftBlock(lastBlock)) {
    lastBlock.text += delta
  } else {
    nextBlocks.push({ type: 'plan_draft', version: 1, status: 'streaming', text: delta })
  }
  return nextBlocks
}

export function replacePlanDraftWithPlan<T extends BlockWithType>(
  blocks: readonly T[],
  plan: PlanContentBlock
): Array<T | PlanContentBlock> {
  const nextBlocks = blocks.map(cloneBlock) as Array<T | PlanContentBlock>
  for (let index = nextBlocks.length - 1; index >= 0; index--) {
    const block = nextBlocks[index]
    if (isPlanDraftBlock(block)) {
      const displayText = block.text.trim()
      nextBlocks[index] = {
        ...toPlanContentBlock(plan),
        ...(displayText ? { displayText } : {}),
      }
      return nextBlocks
    }
  }
  nextBlocks.push(toPlanContentBlock(plan))
  return nextBlocks
}

export function removePlanDraftBlocks<T extends BlockWithType>(blocks: readonly T[]): T[] {
  return blocks.filter((block) => block.type !== 'plan_draft').map(cloneBlock)
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
