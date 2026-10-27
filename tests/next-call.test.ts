import { describe, expect, mock, test } from 'claude-code/testing'

import { calendarServers, callsOf, EMPTY_CACHE, headline, isDue, parseEvents, pickCall, REFRESH_MS, RETRY_MS, retryDelay, videoLinkOf } from '../hooks/calendar'
import {
  BAND,
  calendarAnswer,
  CANCELLED,
  command,
  DECLINED,
  FOCUS,
  MINUTE,
  otherAnswer,
  PLUGIN,
  SERVER,
  SESSION,
  START,
  TOOLS,
  WEEKLY,
  worldOf,
  ZOOM,
} from './world'

describe('reading the calendar', () => {
  test('the video link comes from the conference, as the connector or the Google API spell it, or from the place and notes', () => {
    expect(videoLinkOf(WEEKLY)).toBe('https://meet.google.com/abc-defg-hij')
    expect(videoLinkOf({ conferenceData: { videoEntryPoint: { uri: 'https://meet.google.com/klm-nopq-rst' } } })).toBe('https://meet.google.com/klm-nopq-rst')
    expect(videoLinkOf({ hangoutLink: 'https://meet.google.com/ghi-jklm-nop' })).toBe('https://meet.google.com/ghi-jklm-nop')
    expect(videoLinkOf({ conferenceData: { entryPoints: [{ entryPointType: 'phone', uri: 'tel:+1' }, { entryPointType: 'video', uri: 'https://meet.google.com/qrs-tuvw-xyz' }] } })).toBe(
      'https://meet.google.com/qrs-tuvw-xyz',
    )
    expect(videoLinkOf(ZOOM)).toBe('https://example.zoom.us/j/123456789?pwd=abc')
    expect(videoLinkOf({ description: 'Join: https://teams.microsoft.com/l/meetup-join/19%3ameeting_x end' })).toBe('https://teams.microsoft.com/l/meetup-join/19%3ameeting_x')
    expect(videoLinkOf(FOCUS)).toBeUndefined()
    expect(videoLinkOf({ hangoutLink: 'javascript:alert(1)' })).toBeUndefined()
  })

  test('only timed, confirmed calls with a link that were not declined count', () => {
    const calls = callsOf([WEEKLY, FOCUS, DECLINED, CANCELLED, ZOOM, { id: 'all-day', start: { date: '2026-11-02' }, hangoutLink: 'https://meet.google.com/aaa-bbbb-ccc' }])

    expect(calls.map(call => call.id)).toEqual(['weekly-1', 'zoom-1'])
    expect(calls[0]).toEqual({ id: 'weekly-1', title: 'Weekly sync', startMs: START, time: '15:00', link: 'https://meet.google.com/abc-defg-hij' })
  })

  test('an answer is read only when it has the shape of Google Calendar', () => {
    expect(parseEvents(calendarAnswer([WEEKLY]))).toHaveLength(1)
    expect(parseEvents(otherAnswer)).toBeNull()
    expect(parseEvents({ content: [{ type: 'text', text: 'Resource has been exhausted' }], isError: true })).toBeNull()
    expect(parseEvents({ content: [{ type: 'text', text: 'not json' }], isError: false })).toBeNull()
  })

  test('only connectors that look like Google Calendar are asked, a calendar name first', () => {
    expect(calendarServers(TOOLS), 'an events app is never asked').toEqual([SERVER])
    expect(calendarServers([...TOOLS, { name: 'mcp__claude_ai_Google_Calendar__list_events', description: '', mcp: true }])).toEqual(['claude_ai_Google_Calendar', SERVER])
    expect(calendarServers([{ name: 'Bash', description: '', mcp: false }])).toEqual([])
  })
})

describe('when the band shows', () => {
  const calls = callsOf([WEEKLY, ZOOM])

  test('from ten minutes before the call to ten minutes after it started', () => {
    expect(pickCall(calls, START - 11 * MINUTE, 10, [])).toBeNull()
    expect(pickCall(calls, START - 10 * MINUTE, 10, [])?.id).toBe('weekly-1')
    expect(pickCall(calls, START + 9 * MINUTE, 10, [])?.id).toBe('weekly-1')
    expect(pickCall(calls, START + 10 * MINUTE, 10, [])).toBeNull()
  })

  test('never for a hidden call, and the next call wins over one already started', () => {
    expect(pickCall(calls, START - 5 * MINUTE, 10, ['weekly-1'])).toBeNull()

    const back = callsOf([WEEKLY, { ...ZOOM, start: { dateTime: '2026-11-02T15:12:00+01:00' } }])

    expect(pickCall(back, START + 5 * MINUTE, 10, [])?.id).toBe('zoom-1')
  })

  test('the line says how far off the call is', () => {
    const [call] = callsOf([WEEKLY])

    if (call === undefined) {
      throw new Error('no call')
    }

    expect(headline({ call, minutesLeft: 7 })).toBe('Call in 7 min · Weekly sync · 15:00')
    expect(headline({ call, minutesLeft: 0 })).toBe('Call starting now · Weekly sync · 15:00')
    expect(headline({ call, minutesLeft: -3 })).toBe('Call started 3 min ago · Weekly sync · 15:00')
  })

  test('the calendar is asked again after ten minutes, or after a wait that doubles with each failure', () => {
    expect(isDue(EMPTY_CACHE, START)).toBe(true)
    expect(isDue({ ...EMPTY_CACHE, fetchedAt: START, askedAt: START }, START + REFRESH_MS - 1)).toBe(false)
    expect(isDue({ ...EMPTY_CACHE, fetchedAt: START, askedAt: START }, START + REFRESH_MS)).toBe(true)
    expect(isDue({ ...EMPTY_CACHE, askedAt: START, failures: 1 }, START + RETRY_MS - 1)).toBe(false)
    expect(isDue({ ...EMPTY_CACHE, askedAt: START, failures: 1 }, START + RETRY_MS)).toBe(true)
    expect(isDue({ ...EMPTY_CACHE, askedAt: START, failures: 3 }, START + 20 * MINUTE - 1)).toBe(false)
    expect(isDue({ ...EMPTY_CACHE, askedAt: START, failures: 3 }, START + 20 * MINUTE)).toBe(true)
    expect([1, 2, 3, 4, 5, 9].map(retryDelay)).toEqual([5, 10, 20, 40, 60, 60].map(minutes => minutes * MINUTE))
    expect(isDue({ ...EMPTY_CACHE, askedAt: START, failures: 5 }, START + MINUTE, MINUTE, MINUTE), '/next-call asks after a minute whatever the wait').toBe(true)
  })
})

describe('the mod in a session', () => {
  test('the band shows ten minutes before, with the Join link, on every surface that draws it', async ($, on) => {
    const world = worldOf(on)
    const clock = mock.clock(on, { now: START - 11 * MINUTE })

    mock.store(on)
    await $.session.start(SESSION)
    await clock.settle()

    expect(world.commands).toEqual(['next-call'])

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ ...BAND, plugin: PLUGIN, surface })

      expect(await ui.find({ type: 'Link' }), 'eleven minutes before: nothing').toBeUndefined()
      await ui.unmount()
    }

    await clock.advance(MINUTE)

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ ...BAND, plugin: PLUGIN, surface })
      const link = await ui.find({ type: 'Link' })

      expect((await ui.find({ type: 'Text', text: /Call in/ }))?.text).toBe('Call in 10 min · Weekly sync · 15:00 ')
      expect(link?.props.href).toBe('https://meet.google.com/abc-defg-hij')
      expect(link?.props.label).toBe('Join')
      await ui.unmount()
    }

    expect(world.toasts).toEqual(['Call in 10 min · Weekly sync · 15:00. Join from the band above the prompt.'])
    expect(world.asked).toEqual([{ server: SERVER, tool: 'list_events' }])
  })

  test('Hide takes the band down for that call', async ($, on) => {
    worldOf(on)
    const clock = mock.clock(on, { now: START - 5 * MINUTE })

    mock.store(on)
    await $.session.start(SESSION)
    await clock.settle()

    const ui = await $.ui.mount({ ...BAND, plugin: PLUGIN, surface: 'desktop' })

    expect(await ui.find({ type: 'Link' })).toBeDefined()
    await ui.press({ key: 'hide' })
    await clock.advance(MINUTE)
    expect(await ui.find({ type: 'Link' })).toBeUndefined()
    await ui.unmount()
  })

  test('the band goes ten minutes after the start', async ($, on) => {
    worldOf(on)
    const clock = mock.clock(on, { now: START + 9 * MINUTE })

    mock.store(on)
    await $.session.start(SESSION)
    await clock.settle()

    const ui = await $.ui.mount({ ...BAND, plugin: PLUGIN, surface: 'terminal' })

    expect((await ui.find({ type: 'Text', text: /Call started/ }))?.text).toBe('Call started 9 min ago · Weekly sync · 15:00 ')
    await clock.advance(MINUTE)
    expect(await ui.find({ type: 'Link' })).toBeUndefined()
    await ui.unmount()
  })

  test('the calendar is asked once every ten minutes, and ever less often while it refuses', async ($, on) => {
    const world = worldOf(on)
    const clock = mock.clock(on, { now: START - 200 * MINUTE })
    const asksAt = async (minutes: number) => {
      await clock.set(START - 200 * MINUTE + minutes * MINUTE)

      return world.asked.length
    }

    mock.store(on)
    await $.session.start(SESSION)
    await clock.settle()
    expect(await asksAt(9)).toBe(1)
    expect(await asksAt(10)).toBe(2)

    world.isRefusing = true
    expect(await asksAt(20), 'refused').toBe(3)
    expect(await asksAt(24), 'waits 5 min').toBe(3)
    expect(await asksAt(25), 'refused again').toBe(4)
    expect(await asksAt(34), 'waits 10 min').toBe(4)
    expect(await asksAt(35)).toBe(5)
    expect(await asksAt(54), 'waits 20 min').toBe(5)
    expect(await asksAt(55)).toBe(6)

    world.isRefusing = false
    expect(await asksAt(94), 'waits 40 min').toBe(6)
    expect(await asksAt(95), 'answered').toBe(7)
    expect(await asksAt(104), 'back to every ten minutes').toBe(7)
    expect(await asksAt(105)).toBe(8)
  })

  test('/next-call gives the next call and its link', async ($, on) => {
    worldOf(on)
    const clock = mock.clock(on, { now: START - 125 * MINUTE })

    mock.store(on)
    await $.session.start(SESSION)
    await clock.settle()

    const { text } = await $.command.run(command('next-call'))

    expect(text).toBe('Next call: Weekly sync at 15:00, in 2 h 05 min.\nJoin: https://meet.google.com/abc-defg-hij')
  })

  test('/next-call run while the first read is under way waits for it', async ($, on) => {
    const world = worldOf(on)
    const clock = mock.clock(on, { now: START - 125 * MINUTE })

    world.delay = () => clock.sleep(2_000)
    mock.store(on)
    await $.session.start(SESSION)

    const running = $.command.run(command('next-call'))

    await clock.advance(5_000)

    expect((await running).text).toContain('Next call: Weekly sync at 15:00')
    expect(world.asked, 'one read for both').toHaveLength(1)
  })

  test('/next-call says how to connect a calendar when none is there', async ($, on) => {
    const world = worldOf(on)

    world.tools = [{ name: 'Bash', description: 'Runs a shell command.', mcp: false }]
    mock.clock(on, { now: START })
    mock.store(on)
    await $.session.start(SESSION)

    const { text } = await $.command.run(command('next-call'))

    expect(text).toContain('No Google Calendar connector found')
    expect(world.asked).toEqual([])
  })

  test('found automatically, the calendar is asked and the other events app is not', async ($, on) => {
    const world = worldOf(on)
    const clock = mock.clock(on, { now: START - 5 * MINUTE })

    mock.store(on)
    await $.session.start(SESSION)
    await clock.settle()

    expect(world.asked.map(ask => ask.server)).toEqual([SERVER])
  })

  test('with the setting, that connector is asked and no other', { options: { calendarServer: 'events_app' } }, async ($, on) => {
    const world = worldOf(on)
    const clock = mock.clock(on, { now: START - 5 * MINUTE })

    mock.store(on)
    await $.session.start(SESSION)
    await clock.settle()

    expect(world.asked.map(ask => ask.server)).toEqual(['events_app'])
  })
})
