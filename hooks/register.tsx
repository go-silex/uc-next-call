// next-call: your next video call above the prompt, ten minutes before it starts,
// with a one-click Join link. Reads Google Calendar through your own connector.
//
// Built by Unkillable Companies (https://unkillablecompanies.com). MIT License.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register } from 'claude-code'

import type { Banner } from '../types'
import {
  cacheOf,
  calendarServers,
  callsOf,
  distance,
  headline,
  isDue,
  LIST_EVENTS_ARGS,
  MINUTE,
  minutesLeft,
  nextCall,
  parseEvents,
  pickCall,
  type Cache,
} from './calendar'

const banner = atom({ plugin: 'next-call', key: 'banner' } as const, null)
const dismissed = atom({ plugin: 'next-call', key: 'dismissed' } as const, [])
const toasted = atom({ plugin: 'next-call', key: 'toasted' } as const, [])

const CACHE_KEY = 'cache'
const TICK_MS = 30_000
const DEFAULT_LEAD_MINUTES = 10

type Settings = { leadMinutes: number; calendarServer: string }

const settingsOf = (options: PluginOptions): Settings => {
  const lead = Number(options.leadMinutes)
  const server = options.calendarServer

  return {
    leadMinutes: Number.isFinite(lead) && lead > 0 ? lead : DEFAULT_LEAD_MINUTES,
    calendarServer: typeof server === 'string' ? server.trim() : '',
  }
}

/** Why the last read gave no calls, for `/next-call`. */
type Outcome = 'ok' | 'no-connector' | 'no-answer'

type Refreshed = { cache: Cache; outcome: Outcome }

/** The read under way in this session: a second one waits for it rather than racing it. */
let inFlight: Promise<Refreshed> | null = null

/** Reads the calendar when due (see `askCalendar`), one read at a time. */
async function refresh($: EngineInterface, settings: Settings, maxAgeMs?: number): Promise<Refreshed> {
  while (inFlight !== null) {
    await inFlight.catch(() => undefined)
  }

  const reading = askCalendar($, settings, maxAgeMs)

  inFlight = reading

  try {
    return await reading
  } finally {
    inFlight = null
  }
}

/**
 * Asks the calendar for the next events when the shared cache is older than
 * `maxAgeMs`, and stores the answer for every open session.
 */
async function askCalendar($: EngineInterface, settings: Settings, maxAgeMs?: number): Promise<Refreshed> {
  const now = await $.clock.now()
  const cache = cacheOf(await $.store.get(CACHE_KEY))

  // `/next-call` passes a minute for both: an answer no older, and no longer wait after a refusal.
  if (!isDue(cache, now, maxAgeMs, maxAgeMs)) {
    return { cache, outcome: 'ok' }
  }

  const known = settings.calendarServer || cache.server
  const servers = known ? [known] : calendarServers(await $.tool.list())

  if (servers.length === 0) {
    return { cache, outcome: 'no-connector' }
  }

  await $.store.set(CACHE_KEY, { ...cache, askedAt: now })

  let isGone = false

  for (const server of servers) {
    try {
      const events = parseEvents(await $.mcp.call(server, 'list_events', LIST_EVENTS_ARGS()))

      if (events !== null) {
        const fresh: Cache = { calls: callsOf(events), fetchedAt: now, askedAt: now, failures: 0, server }

        await $.store.set(CACHE_KEY, fresh)

        return { cache: fresh, outcome: 'ok' }
      }
    } catch (error) {
      $.ui.log(`next-call: ${server} did not answer: ${String(error)}`, { to: 'debug' })
      // A connector that is gone (renamed, removed) is looked for again next time.
      isGone = isGone || (server === cache.server && !settings.calendarServer)
    }
  }

  const failed: Cache = { ...cache, askedAt: now, failures: cache.failures + 1, ...(isGone && { server: undefined }) }

  await $.store.set(CACHE_KEY, failed)

  return { cache: failed, outcome: 'no-answer' }
}

/** Puts the call due now on the band (or takes it down), and raises a toast the first time. */
async function show($: EngineInterface, settings: Settings, cache: Cache): Promise<void> {
  const now = await $.clock.now()
  const call = pickCall(cache.calls, now, settings.leadMinutes, await read($, dismissed))
  const shown: Banner | null = call === null ? null : { call, minutesLeft: minutesLeft(call, now) }

  if (JSON.stringify(shown) !== JSON.stringify(await read($, banner))) {
    await update($, banner, () => shown)
  }

  if (shown !== null && !(await read($, toasted)).includes(shown.call.id)) {
    await update($, toasted, list => [...list, shown.call.id].slice(-50))
    $.ui.toast(`${headline(shown)}. Join from the band above the prompt.`, { timeoutMs: 10_000 })
  }
}

let isTicking = false

/** One beat of the timer: read the calendar when due, then update the band. */
async function tick($: EngineInterface, settings: Settings): Promise<void> {
  if (isTicking) {
    return
  }

  isTicking = true

  try {
    const { cache } = await refresh($, settings)

    await show($, settings, cache)
  } catch (error) {
    $.ui.log(`next-call: ${String(error)}`, { to: 'debug' })
  } finally {
    isTicking = false
  }
}

/** Hides the call on the band, and shows the next one due, if any. */
async function hide($: EngineInterface, settings: Settings, id: string): Promise<void> {
  await update($, dismissed, list => [...list, id].slice(-50))
  await show($, settings, cacheOf(await $.store.get(CACHE_KEY)))
}

export const register: Register = (on, options) => {
  const settings = settingsOf(options)

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'next-call', description: 'Show your next video call and its Join link' })
    void tick($, settings)
    $.clock.every(TICK_MS, () => void tick($, settings))

    return next(e)
  })

  on('command.run', { command: 'next-call' }, async $ => {
    const { cache, outcome } = await refresh($, settings, MINUTE)
    const now = await $.clock.now()

    await show($, settings, cache)

    if (outcome === 'no-connector') {
      return {
        text: 'No Google Calendar connector found. If this session just started, try again in a few seconds; otherwise connect Google Calendar in claude.ai (Settings, then Connectors).',
      }
    }

    if (cache.fetchedAt === 0) {
      return { text: 'Your calendar did not answer yet (connectors limit how often they are asked). next-call tries again in a few minutes.' }
    }

    const call = nextCall(cache.calls, now)

    return call === null
      ? { text: 'No call with a video link in your upcoming events.' }
      : { text: `Next call: ${call.title} at ${call.time}, ${distance(call, now)}.\nJoin: ${call.link}` }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const shown = await read($, banner)

    if (shown === null || e.props.hasSurvey) {
      return next(e)
    }

    const { Box, Button, Link, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="row">
        <Text bold>{headline(shown)} </Text>
        <Link href={shown.call.link} label="Join" />
        <Text> </Text>
        <Button key="hide" label="Hide" onPress={() => hide($, settings, shown.call.id)} />
      </Box>
    )
  })
}
