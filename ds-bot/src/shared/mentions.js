// "@Name" is read by one rule everywhere: the group host picks who answers with it,
// and the client draws the same mentions in the bubbles, so what the user sees called
// is what gets called. Pure, so both sides import it.

export const ALL_WORDS = ['all', 'everyone', '所有人', '全体']
// The speaker names a group log and a Bot's own chat give the user ("User: …",
// "You: …"). A Bot with one of them would read as the user.
export const USER_NAMES = ['user', 'you']
// The name a group log line goes by. A Bot named before such names were refused still
// never reads as the user.
export const speakerOf = line => (line.botId !== undefined && USER_NAMES.includes(String(line.who ?? '').trim().toLowerCase()) ? `Bot "${line.who}"` : line.who)
// A letter, digit, "_" or "-" after a name means a longer word ("@Mi" in "@MiniMax"),
// and "/", "\" or a "." that goes on into a word mean a path: DSH writes a file
// reference as "@docs/guide.md", which must not call a Bot named Docs. A letter,
// digit, "_", "." or "/" before "@" means an address ("a@b", "medium.com/@Writer").
const NAME_GOES_ON = /^(?:[a-z0-9_\-/\\]|\.[a-z0-9_-])/i
const ADDRESS_BEFORE = /[a-z0-9_./]/i
// Code and Markdown links, with or without a title, are literal text.
const LITERAL = /```[\s\S]*?(?:```|$)|`[^`\n]*`|\[[^\]\n]*\]\([^)\s]*(?:\s+(?:"[^"\n]*"|'[^'\n]*'))?\)/g
// A call is written "@Name", but a model or a Chinese input method may write the at as
// "＠" (full-width, U+FF20) or put a space after it ("@ Name"); issue #1. All of them
// lead to the name the same way, so whoever reads the text reads one and the same call.
const isAt = char => char === '@' || char === '＠'
// The next at mark at or after `from`, or -1.
const searchAt = (text, from) => {
  for (let at = from; at < text.length; at += 1) if (isAt(text[at])) return at
  return -1
}
const overlaps = (spans, start, end) => spans.some(span => start < span.end && span.start < end)

// What a Bot may be named: something "@" can call without a second reading.
export function nameProblem(name) {
  const text = String(name ?? '').trim()
  if (text === '') return 'A Bot needs a name'
  if (/[@`\r\n]/.test(text)) return 'A Bot name cannot contain @, ` or a line break'
  if (ALL_WORDS.includes(text.toLowerCase())) return `"${text}" calls everyone in a group, so it cannot be a Bot name`
  if (USER_NAMES.includes(text.toLowerCase())) return `"${text}" stands for the user in a chat, so it cannot be a Bot name`
  return undefined
}

// Where a call starts and where its name starts. The at run and the spaces after it are
// part of the call ("＠＠Name" and "@ Name" each call once), and `name` is what the
// bubbles draw. A line break after the at is not a call.
const atRun = (text, at) => {
  let start = at
  while (start > 0 && isAt(text[start - 1])) start -= 1
  let name = at
  while (isAt(text[name])) name += 1
  while (/[^\S\r\n]/.test(text[name] ?? '')) name += 1
  return { start, name }
}

// DSH writes each referenced conversation into the message once as "@label"; that one
// occurrence per listed label is a reference, not a call. Longest labels go first so
// "@K notes" is never read as the label "K".
export function referenceSpans(text, labels = []) {
  const spans = []
  for (const label of [...labels].sort((a, b) => b.length - a.length)) {
    for (let at = searchAt(text, 0); at !== -1; at = searchAt(text, at + 1)) {
      const { start, name } = atRun(text, at)
      const end = name + label.length
      if (text.slice(name, end) !== label) continue
      if ((start > 0 && ADDRESS_BEFORE.test(text[start - 1])) || NAME_GOES_ON.test(text.slice(end)) || overlaps(spans, start, end)) continue
      spans.push({ start, end, label })
      break
    }
  }
  return spans.sort((a, b) => a.start - b.start)
}

// Every "@Name" and "@all" outside code, links and references, in order. Longest names
// match first, so "@新 Bot 2" is never "@新 Bot"; a name may hold spaces.
export function mentionSpans(text, bots, { references = [] } = {}) {
  const value = String(text ?? '')
  const skip = [
    ...[...value.matchAll(LITERAL)].map(match => ({ start: match.index, end: match.index + match[0].length })),
    ...referenceSpans(value, references),
  ]
  const byLength = bots.filter(bot => bot?.name).sort((a, b) => b.name.length - a.name.length)
  const spans = []
  for (let at = searchAt(value, 0); at !== -1; at = searchAt(value, at + 1)) {
    const { start, name } = atRun(value, at)
    if ((start > 0 && ADDRESS_BEFORE.test(value[start - 1])) || overlaps(skip, start, Math.max(name, at + 1))) continue
    const fits = word => value.slice(name, name + word.length).toLowerCase() === word.toLowerCase()
      && !NAME_GOES_ON.test(value.slice(name + word.length))
    const bot = byLength.find(candidate => fits(candidate.name))
    const all = bot ? undefined : ALL_WORDS.find(fits)
    if (!bot && !all) continue
    const end = name + (bot ? bot.name.length : all.length)
    spans.push(bot ? { start, end, name, bot } : { start, end, name, all: true })
    at = end - 1
  }
  return spans
}
