const HAN_CHARACTER_PATTERN = /\p{Script=Han}/u

export function maskRelationshipGalaxyPrivateText(value: string | null | undefined): string {
  const text = value?.trim() ?? ''
  if (!text) return '*'

  const characters = Array.from(text)
  const lastHanCharacter = [...characters].reverse().find((character) => HAN_CHARACTER_PATTERN.test(character))
  if (lastHanCharacter) return `**${lastHanCharacter}`

  if (characters.length === 1) return '*'
  if (characters.length === 2) return `${characters[0]}***`
  return `${characters[0]}***${characters.at(-1)}`
}

export function relationshipGalaxyPrivateAvatarText(): string {
  return '*'
}
