/**
 * 技能系统模块入口
 */

export type {
  SkillDef,
  SkillSummary,
  BuiltinSkillInfo,
  SkillInitResult,
  SkillSaveResult,
} from './types'

export {
  initSkillManager,
  getAllSkills,
  getSkillConfig,
  getBuiltinCatalog,
  importSkill,
  reimportSkill,
  updateSkill,
  createSkill,
  deleteSkill,
  getSkillMenu,
} from './manager'

export { parseSkillFile } from './parser'
