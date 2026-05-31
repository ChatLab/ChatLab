import { getRegisteredAdapter } from '../registry'
import type { SkillServiceAdapter } from './types'

export function useSkillService(): SkillServiceAdapter {
  return getRegisteredAdapter<SkillServiceAdapter>('skill-crud')
}
