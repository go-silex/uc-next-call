# next-call

A Claude Code mod that puts your next video call above the prompt ten minutes before it starts, with a link that opens it in one click.

```
Call in 7 min · Weekly sync · 15:00   Join   [ Hide ]
```

- **Join** opens the Google Meet (or Zoom, or Teams) link of the call.
- **Hide** takes the band down for that call.
- A short notice also pops up when the band first appears.
- `/next-call` gives you your next call and its link at any time.

It reads Google Calendar through the connector you already use with Claude. No account to create, no key to paste, nothing to configure.

## Requirements

- **Claude Code** 2.1.299 or later. next-call is a mod (a plugin of function hooks), an early-access feature of Claude Code. It works in the terminal and in the Code tab of the Claude desktop app.
- **The Google Calendar connector**, turned on for your claude.ai account: on [claude.ai](https://claude.ai), open Settings, then Connectors, and connect Google Calendar. Claude Code picks it up when you are signed in with that account. To check, run `/mcp` in a terminal session: "claude.ai Google Calendar" should be listed.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install next-call --marketplace go-silex/uc-next-call
```

Or from a shell:

```bash
claude plugin install next-call --marketplace go-silex/uc-next-call
```

Or in the Claude desktop app (Code tab), where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `go-silex/uc-next-call`, then **Add plugin** on next-call.

Answer `y` when asked to add the marketplace, then pick the **user** scope so the mod runs in every session. It is active at once.

To check that it works, run `/next-call`. The first answer can take a few seconds while the connector starts.

## Settings

| Option | Default | What it does |
| --- | --- | --- |
| `leadMinutes` | `10` | How many minutes before a call the band shows up. |
| `calendarServer` | empty | The MCP server to read events from, as `/mcp` names it. Leave it empty: next-call finds your Google Calendar connector by itself. |

Change them in the config menu (`/config` in a terminal session, where each option of the mod is a row), or in `~/.claude/settings.json`:

```json
{
  "pluginConfigs": {
    "next-call@uc-next-call": { "options": { "leadMinutes": 5 } }
  }
}
```

## How it works

- Every 30 seconds, the mod checks whether a call is due and updates the band.
- Every 10 minutes at most, it asks your calendar for your next 20 events. Your open sessions share one cache, so opening several does not ask more often.
- The connector has a quota, which Claude also uses when you ask it about your calendar. When the connector refuses ("Resource has been exhausted"), next-call waits 5 minutes, then 10, 20, 40, up to an hour between tries, and goes back to every 10 minutes once it answers. Meanwhile the band keeps using the calls from the last read that worked.
- A call is an event that has a video link, was not cancelled and that you did not decline. The link comes from the event's conference (Google Meet), or from a Zoom or Teams link written in its place or notes. Focus time, all-day events and events without a link are left out.
- The band shows from 10 minutes before the start until 10 minutes after it, or until you hide it.

## Privacy

- next-call has no server of its own and sends nothing anywhere. The only call it makes is to your own Google Calendar connector, the way Claude does when you ask it about your calendar.
- It keeps the calls it found (title, start time, link) in Claude Code's local plugin store on your machine (`~/.claude/plugins/store/`), and nothing else.
- It does not show your calendar to the model. The model sees a call only when you run `/next-call`, since a command's answer is part of the conversation.

## Limits

- It only runs while a Claude Code session is open. With no session open, there is no reminder.
- Each open session shows its own band.
- A call added less than 10 minutes before it starts can show up to 10 minutes late, because the calendar is read every 10 minutes.
- Mods are an early-access feature: a future Claude Code release may change the API. If the band stops showing, update the mod (`claude plugin update next-call`) and open an issue if that does not fix it.
- In the desktop app, Claude Code cannot raise a macOS notification from a mod, so the reminder is the band and the in-app notice.

## Development

```bash
git clone https://github.com/go-silex/uc-next-call
cd uc-next-call
claude --plugin-dir .            # run Claude Code with the mod loaded from this folder
claude plugin validate .         # check the manifest and the hooks module
claude plugin test .             # run the tests in tests/
```

Claude Code writes the API's types into `.claude-plugin/types/` the first time it loads the mod from a folder, so `npx tsc -p .` type-checks the code after that.

- `hooks/register.tsx`: the timer, the band, the `/next-call` command.
- `hooks/calendar.ts`: reading the connector's answer, finding the link, choosing which call to show.
- `tests/`: tests with a made-up calendar.

Issues and pull requests are welcome.

## License

MIT. See [LICENSE](LICENSE).

## Built by Unkillable Companies

[Unkillable Companies](https://unkillablecompanies.com) helps business leaders rebuild how their company runs with AI: the leader builds their own system first, then brings the team along. We build tools like this one for ourselves first, and share the ones worth sharing.
