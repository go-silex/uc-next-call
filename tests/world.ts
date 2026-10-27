// Copyright (c) 2026 Unkillable Companies (https://unkillablecompanies.com)
// SPDX-License-Identifier: MIT
//
// The world beneath the mod in tests: a made-up calendar connector, the
// engine's commands, toasts and logs, all in memory. Every event is invented.

import type { McpToolResult, On, RenderInput, SessionStartInput, ToolInfo } from 'claude-code'

export const PLUGIN = 'next-call'
export const SERVER = 'a1b2c3'
export const MINUTE = 60_000

/** 15:00 in Paris on 2 November 2026, when the weekly sync starts. */
export const START = Date.parse('2026-11-02T14:00:00Z')

/** As the claude.ai Google Calendar connector spells a Meet call. */
export const WEEKLY = {
  id: 'weekly-1',
  summary: 'Weekly sync',
  status: 'confirmed',
  eventType: 'DEFAULT',
  start: { dateTime: '2026-11-02T15:00:00+01:00', timeZone: 'Europe/Paris' },
  conferenceUrl: 'https://meet.google.com/abc-defg-hij',
  conferenceData: {
    solutionName: 'Google Meet',
    videoEntryPoint: { uri: 'https://meet.google.com/abc-defg-hij' },
    phoneEntryPoints: [{ phoneNumber: '+1 555 0100', regionCode: 'US' }],
  },
  attendees: [{ email: 'me@example.com', self: true, responseStatus: 'accepted' }],
}

export const FOCUS = { id: 'focus-1', summary: 'Deep work', status: 'confirmed', start: { dateTime: '2026-11-02T14:55:00+01:00' } }

export const DECLINED = {
  id: 'declined-1',
  summary: 'Optional demo',
  status: 'confirmed',
  start: { dateTime: '2026-11-02T14:58:00+01:00' },
  hangoutLink: 'https://meet.google.com/xyz-wxyz-xyz',
  attendees: [{ email: 'me@example.com', self: true, responseStatus: 'declined' }],
}

export const CANCELLED = { ...WEEKLY, id: 'cancelled-1', summary: 'Old sync', status: 'cancelled' }

export const ZOOM = {
  id: 'zoom-1',
  summary: 'Partner call',
  status: 'confirmed',
  start: { dateTime: '2026-11-02T17:00:00+01:00' },
  location: 'https://example.zoom.us/j/123456789?pwd=abc',
}

export const TOOLS: ToolInfo[] = [
  { name: 'Bash', description: 'Runs a shell command.', mcp: false },
  { name: 'mcp__events_app__list_events', description: 'Lists the events of a community calendar.', mcp: true },
  { name: `mcp__${SERVER}__list_events`, description: 'Returns events on the given calendar matching all specified constraints.', mcp: true },
  { name: `mcp__${SERVER}__respond_to_event`, description: 'Responds to an event.', mcp: true },
]

export const calendarAnswer = (events: unknown[]): McpToolResult => ({
  content: [{ type: 'text', text: JSON.stringify({ summary: 'me@example.com', timeZone: 'Europe/Paris', events }) }],
  isError: false,
})

export const otherAnswer: McpToolResult = { content: [{ type: 'text', text: JSON.stringify({ entries: [] }) }], isError: false }

export const SESSION: SessionStartInput = { surface: 'terminal', isInteractive: true, cwd: '/work' }

export const BAND: RenderInput<'AbovePrompt'> = {
  component: 'AbovePrompt',
  surface: 'terminal',
  requestId: 'band',
  viewport: { columns: 120, rows: 40, isFullscreen: true },
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 110,
    scroll: { offset: 0, bodyRows: 9 },
    view: {},
  },
}

export const command = (name: string) => ({
  command: name,
  args: '',
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: true, columns: 120 },
})

export type World = {
  asked: { server: string; tool: string }[]
  toasts: string[]
  commands: string[]
  tools: ToolInfo[]
  events: unknown[]
  /** Set to make the calendar refuse, as a connector over its quota does. */
  isRefusing: boolean
  /** Set to make the calendar answer late: awaited before each answer. */
  delay?: () => Promise<void>
}

/** Seats the world beneath the mod. The store and the clock are the kit's mocks, seated by each test. */
export function worldOf(on: On, events: unknown[] = [WEEKLY, FOCUS, DECLINED, CANCELLED, ZOOM]): World {
  const world: World = { asked: [], toasts: [], commands: [], tools: TOOLS, events, isRefusing: false }

  on('tool.list', () => ({ value: world.tools }))

  on('mcp.call', async ($, e) => {
    world.asked.push({ server: e.server, tool: e.tool })
    await world.delay?.()

    if (world.isRefusing) {
      return { value: { content: [{ type: 'text', text: 'Resource has been exhausted (e.g. check quota).' }], isError: true } }
    }

    return { value: e.server === SERVER ? calendarAnswer(world.events) : otherAnswer }
  })

  on('command.register', ($, e) => {
    world.commands.push(e.name)

    return { value: { command: e.name } }
  })

  on('ui.toast', ($, e) => {
    world.toasts.push(e.text)

    return { value: undefined }
  })

  on('ui.log', () => ({ value: undefined }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('ui.render', () => ({ type: 'Text', children: [''] }))

  return world
}
