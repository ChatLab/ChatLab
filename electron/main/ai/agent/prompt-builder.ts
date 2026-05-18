/**
 * Agent system prompt builder — Electron adapter.
 * Injects the Electron i18n `t` function into the shared builder.
 */

import { t as i18nT } from '../../i18n'
import { buildSystemPrompt as buildSystemPromptCore } from '@openchatlab/node-runtime'
import type { OwnerInfo, SkillContext, MentionedMember, DataSnapshot } from '@openchatlab/node-runtime'

export type { OwnerInfo, SkillContext, MentionedMember, DataSnapshot }

export function buildSystemPrompt(
  chatType: 'group' | 'private' = 'group',
  assistantSystemPrompt?: string,
  ownerInfo?: OwnerInfo,
  locale: string = 'zh-CN',
  skillCtx?: SkillContext,
  mentionedMembers?: MentionedMember[],
  dataSnapshot?: DataSnapshot
): string {
  return buildSystemPromptCore({
    t: i18nT,
    chatType,
    assistantSystemPrompt,
    ownerInfo,
    locale,
    skillCtx,
    mentionedMembers,
    dataSnapshot,
  })
}
