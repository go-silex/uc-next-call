/** One upcoming event that has a video link. */
export type Call = {
  id: string
  title: string
  startMs: number
  /** The start as the calendar wrote it, `HH:MM` in the event's own time zone. */
  time: string
  link: string
}

/** The call the band shows, and how many whole minutes are left before it starts. */
export type Banner = { call: Call; minutesLeft: number }

declare module 'claude-code' {
  interface PluginState {
    'next-call': {
      banner: Banner | null
      /** Ids of the calls the person hid. */
      dismissed: string[]
      /** Ids of the calls a toast was already raised for. */
      toasted: string[]
    }
  }
}
