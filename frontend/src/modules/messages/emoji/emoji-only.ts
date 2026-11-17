// One to three emoji and nothing else (spaces between them allowed). A unit is a flag (two regional
// indicators), a subdivision flag (black flag + tag characters), or a pictograph with optional
// variation selector / skin tone, joined to more of them by ZWJ.
const PICTOGRAPH = String.raw`\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})*`
const UNIT = String.raw`(?:\p{Regional_Indicator}{2}|\u{1F3F4}[\u{E0020}-\u{E007E}]+\u{E007F}|${PICTOGRAPH}(?:‍${PICTOGRAPH})*)`

const EMOJI_ONLY = new RegExp(String.raw`^(?:${UNIT}\s*){1,3}$`, 'u')

export function isEmojiOnly(text: string): boolean {
  return EMOJI_ONLY.test(text.trim())
}
