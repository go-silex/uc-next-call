// What the mod reads from a calendar, without touching the engine: which
// connector to ask, how to read its answer, which call to show and what to say.

import type { McpToolResult, ToolInfo } from 'claude-code'

import type { Banner, Call } from '../types'

export const MINUTE = 60_000
/** How long a call stays on the band after it started. */
export const GRACE_MS = 10 * MINUTE
/** How often the calendar is asked again: connectors refuse calls made too close together. */
export const REFRESH_MS = 10 * MINUTE
/** How long to wait before asking again after a failed call. */
export const RETRY_MS = 5 * MINUTE

/** What the mod keeps across sessions, so several open sessions share one read. */
export type Cache = {
  calls: Call[]
  /** When the calendar last answered. */
  fetchedAt: number
  /** When the calendar was last asked, answered or not. */
  askedAt: number
  /** The connector that answered, once found. */
  server?: string
}

export const EMPTY_CACHE: Cache = { calls: [], fetchedAt: 0, askedAt: 0 }

/** The next twenty regular events from now, soonest first, within the connector's default seven days. */
export const LIST_EVENTS_ARGS = (): Record<string, unknown> => ({ orderBy: 'startTime', eventType: ['DEFAULT'], pageSize: 20 })

const LIST_EVENTS = /^mcp__(.+)__list_events$/

/**
 * The connectors that look like Google Calendar, the likeliest first: a server
 * that offers `list_events` and is named after a calendar or has the calendar's
 * own tools (`respond_to_event`, `suggest_time`). Other apps with events (Luma,
 * Eventbrite) are never asked; `parseEvents` refuses any other answer anyway.
 */
export function calendarServers(tools: readonly ToolInfo[]): string[] {
  const names = new Set(tools.map(tool => tool.name))
  const scored = tools.flatMap(tool => {
    const server = LIST_EVENTS.exec(tool.name)?.[1]

    if (server === undefined) {
      return []
    }

    const has = (name: string) => names.has(`mcp__${server}__${name}`)
    const score = (/calendar/i.test(server) ? 2 : 0) + (has('respond_to_event') || has('suggest_time') ? 1 : 0)

    return score > 0 ? [{ server, score }] : []
  })

  return scored.sort((a, b) => b.score - a.score).map(({ server }) => server)
}

type RawEvent = {
  id?: unknown
  summary?: unknown
  status?: unknown
  start?: { dateTime?: unknown; date?: unknown }
  /** The claude.ai connector's spelling of the call's link. */
  conferenceUrl?: unknown
  /** The Google Calendar API's spelling of a Meet link. */
  hangoutLink?: unknown
  conferenceData?: {
    /** The claude.ai connector's. */
    videoEntryPoint?: { uri?: unknown }
    /** The Google Calendar API's. */
    entryPoints?: { entryPointType?: unknown; uri?: unknown }[]
  }
  location?: unknown
  description?: unknown
  attendees?: { self?: unknown; responseStatus?: unknown }[]
}

/**
 * The events of a Google Calendar `list_events` answer, or `null` when the
 * answer is an error or has another shape (another kind of `list_events`).
 */
export function parseEvents(result: McpToolResult): RawEvent[] | null {
  if (result.isError) {
    return null
  }

  const text = result.content.map(block => (block.type === 'text' ? block.text : '')).join('')
  let data: unknown = result.structuredContent

  if (!isCalendarAnswer(data)) {
    try {
      data = JSON.parse(text)
    } catch {
      return null
    }
  }

  return isCalendarAnswer(data) ? data.events : null
}

function isCalendarAnswer(data: unknown): data is { events: RawEvent[] } {
  if (typeof data !== 'object' || data === null) {
    return false
  }

  const answer = data as { events?: unknown; timeZone?: unknown }

  return Array.isArray(answer.events) && typeof answer.timeZone === 'string'
}

const VIDEO_LINK =
  /https:\/\/(?:meet\.google\.com\/[a-z]+-[a-z]+-[a-z]+|[\w.-]*zoom\.us\/j\/[^\s"'<>)]+|teams\.microsoft\.com\/l\/meetup-join\/[^\s"'<>)]+|teams\.live\.com\/meet\/[^\s"'<>)]+)/i

const isHttps = (value: unknown): value is string => typeof value === 'string' && value.startsWith('https://')

/**
 * The event's video link: the conference's (as the claude.ai connector or the
 * Google Calendar API spells it), or one written in the place or the notes.
 */
export function videoLinkOf(event: RawEvent): string | undefined {
  const conference = [
    event.conferenceUrl,
    event.conferenceData?.videoEntryPoint?.uri,
    event.hangoutLink,
    event.conferenceData?.entryPoints?.find(point => point.entryPointType === 'video')?.uri,
  ].find(isHttps)

  if (conference !== undefined) {
    return conference
  }

  for (const text of [event.location, event.description]) {
    const found = typeof text === 'string' ? VIDEO_LINK.exec(text)?.[0] : undefined

    if (found !== undefined) {
      return found
    }
  }

  return undefined
}

/** The events that are calls: timed, confirmed, not declined, with a video link. */
export function callsOf(events: readonly RawEvent[]): Call[] {
  return events.flatMap(event => {
    const link = videoLinkOf(event)
    const start = event.start?.dateTime
    const startMs = typeof start === 'string' ? Date.parse(start) : NaN
    const isDeclined = event.attendees?.some(person => person.self === true && person.responseStatus === 'declined') === true

    if (link === undefined || typeof start !== 'string' || Number.isNaN(startMs) || event.status === 'cancelled' || isDeclined) {
      return []
    }

    const title = typeof event.summary === 'string' && event.summary.trim() !== '' ? event.summary.trim() : 'Untitled call'
    const id = typeof event.id === 'string' ? event.id : `${startMs}-${link}`

    return [{ id, title, startMs, time: start.slice(11, 16), link }]
  })
}

/**
 * The call the band shows now: one starting within `leadMinutes` (the soonest),
 * else one that started less than `GRACE_MS` ago (the latest), never a hidden one.
 */
export function pickCall(calls: readonly Call[], now: number, leadMinutes: number, dismissed: readonly string[]): Call | null {
  const open = calls.filter(call => !dismissed.includes(call.id))
  const coming = open.filter(call => call.startMs > now && call.startMs - now <= leadMinutes * MINUTE).sort((a, b) => a.startMs - b.startMs)
  const started = open.filter(call => call.startMs <= now && now - call.startMs < GRACE_MS).sort((a, b) => b.startMs - a.startMs)

  return coming[0] ?? started[0] ?? null
}

/** The next call still to come, for `/next-call`. */
export function nextCall(calls: readonly Call[], now: number): Call | null {
  return [...calls].filter(call => call.startMs > now - GRACE_MS).sort((a, b) => a.startMs - b.startMs)[0] ?? null
}

/** Whole minutes left before the call: rounded up, so a call 30 s away is "in 1 min". */
export const minutesLeft = (call: Call, now: number): number => Math.ceil((call.startMs - now) / MINUTE)

/** The band's line, before its Join link. */
export function headline({ call, minutesLeft: left }: Banner): string {
  const when = left > 0 ? `Call in ${left} min` : left === 0 ? 'Call starting now' : `Call started ${-left} min ago`

  return `${when} · ${call.title} · ${call.time}`
}

/** How far off a call is, for `/next-call`: "in 2 h 05 min", "in 7 min", "now". */
export function distance(call: Call, now: number): string {
  const left = minutesLeft(call, now)

  if (left <= 0) {
    return left === 0 ? 'now' : `started ${-left} min ago`
  }

  if (left < 60) {
    return `in ${left} min`
  }

  const hours = Math.floor(left / 60)
  const minutes = String(left % 60).padStart(2, '0')

  return hours < 24 ? `in ${hours} h ${minutes} min` : `in ${Math.floor(hours / 24)} d ${hours % 24} h`
}

/** Reads the cache back from the store, whatever it holds. */
export function cacheOf(value: unknown): Cache {
  if (typeof value !== 'object' || value === null) {
    return EMPTY_CACHE
  }

  const cache = value as Partial<Cache>

  return {
    calls: Array.isArray(cache.calls) ? cache.calls : [],
    fetchedAt: typeof cache.fetchedAt === 'number' ? cache.fetchedAt : 0,
    askedAt: typeof cache.askedAt === 'number' ? cache.askedAt : 0,
    ...(typeof cache.server === 'string' && { server: cache.server }),
  }
}

/**
 * Whether the calendar should be asked again now: its answer is older than
 * `maxAgeMs`, and no ask is under way or failed less than `RETRY_MS` ago (an
 * ask newer than the answer is one of those: another session may be making it).
 */
export function isDue(cache: Cache, now: number, maxAgeMs = REFRESH_MS): boolean {
  const isWaiting = cache.askedAt > cache.fetchedAt && now - cache.askedAt < Math.min(RETRY_MS, maxAgeMs)

  return now - cache.fetchedAt >= maxAgeMs && !isWaiting
}
