# Kept: promise tracking for Jira Service Management

> Support agents make promises in their replies to customers every day: *"I'll update you by Thursday"*, *"the fix ships in 2.4"*, *"we'll refund the duplicate charge tomorrow"*. Nothing tracks them. SLAs measure response times, not commitments, so promises slip quietly. An engineer moves the bug out of the sprint, the agent goes on leave, and the customer finds out first.

**Kept** is a Forge app for Jira Service Management. It reads every public reply, records each promise the agent made, connects it to the engineering work it depends on, and makes sure someone keeps it.

Built for **Atlassian Codegeist 2026**, *Apps for Business Teams* category, with a Rovo agent.

## What it does

| | |
|---|---|
| **Catch** | When an agent replies to a customer, Kept extracts every promise: what was promised (update, fix, refund, callback, action), when it is due (resolved in the agent's time zone; "by Thursday" means 5 PM Thursday local time), and who owns it. Internal notes, customer messages, hedges ("we'll try…", "might", "if it happens again") and requests to the customer are ignored. |
| **Connect** | A fix promise is linked to the engineering issue the request is linked to. A release-bound promise ("ships in 2.4") inherits that fix version's release date. |
| **Warn** | When the engineering issue is pulled out of its sprint, moved to another release, or reopened, the promise turns **At risk** with a plain-English reason, and the owner is @mentioned in an internal note. |
| **Close the loop** | When the engineering issue is resolved, the promise turns **Ready to close the loop**. One click drafts the "your fix is live" reply. The agent edits it and sends it as themselves, and the promise is marked **Kept**. |
| **Keep score** | An hourly sweep reminds owners 24 hours before a deadline and marks overdue promises **Broken**. A later reply before the deadline keeps an update promise automatically. |
| **See it all** | A **Promises** panel on every request, a **reverse panel** on engineering issues ("2 customer promises depend on this issue"), and a **dashboard** (due in 24h, at risk, ready, broken, kept rate per agent). |
| **Ask Rovo** | The **Promise Keeper** Rovo agent answers "What did we promise Acme Logistics?" or "Which promises are at risk?", and drafts honest close-the-loop or delay messages from Kept's data. |

## Honesty by design

- **No invented promises.** Every promise links back to the exact sentence in the exact reply.
- **No invented dates.** If the agent gave no date, the promise gets a two-business-day default that is labelled *"no date given, defaulted"* and never shown as if the agent had said it.
- **Every status change has a reason** a human can read, plus a history.
- **Deterministic extraction.** Promises are found with rules and [`chrono-node`](https://github.com/wanasit/chrono), not an LLM. It is free, gives the same answer every time, and is covered by unit tests. Rovo is used for the conversational layer, where generation is the point.
- **Permissions respected.** UI resolvers and Rovo actions only return promises on requests the current user can see (checked with `asUser()`), and replies are sent as the signed-in agent.

## Architecture

```
manifest.yml               Forge modules: issue panel, global page, triggers, hourly scheduled trigger,
                           Rovo agent + 2 actions, KVS custom entity "promise" with 4 indexes
src/core/extract.js        promise extraction (pure): commitment/hedge patterns, kinds, due dates
src/core/time.js           IANA time-zone math with Intl only (wall clock <-> UTC, business days)
src/core/lifecycle.js      status rules (pure): replies keep promises, dev changes -> at risk/ready, sweep
src/core/adf.js            Atlassian Document Format -> plain text
src/index.js               triggers (comment, issue updated, issue link created), hourly sweep,
                           UI resolvers, Rovo actions
src/store.js               Forge KVS custom-entity storage
src/jira.js                Jira REST helpers (asApp for triggers, asUser for user actions)
src/frontend/panel.jsx     Promises panel (UI Kit): request view, reverse dev-issue view, reply modal
src/frontend/dashboard.jsx dashboard (UI Kit)
static/agent/prompt.md     Promise Keeper agent prompt
test/                      52 Vitest tests for extraction, lifecycle and storage conversion
```

## Run it yourself

Requirements: Node.js 22.23+ and the Forge CLI (`npm i -g @forge/cli`), plus an Atlassian site with Jira Service Management. Rovo needs a site where Rovo is enabled. A Forge demo site (`forge site provision`) includes it.

```bash
npm install
npm test                      # 52 unit tests
forge register                # once, to register your own copy of the app
forge deploy -e development
forge install --site <your-site>.atlassian.net --product jira -e development
```

Then, in a service project:
1. Link a request to an issue in a software project. A fix version with a release date makes release-bound promises date-aware.
2. Reply to the customer with something like *"I'll update you by Thursday, and the fix ships in 2.4."*
3. Open **Promises** on the request.
4. Move the linked issue out of its sprint and watch the promise turn **At risk**. Resolve the issue and click **Tell customer**.
5. Open **Apps → Kept — Promises** for the dashboard, or **Ask Rovo → Promise Keeper**.

## Forge notes (things we learned)

- KVS custom-entity `integer` attributes are 32-bit, so timestamps are stored in seconds (`src/store.js`).
- KVS rejects empty-string attribute values, so optional fields are omitted when empty.
- Agile-API sprint moves put sprint **ids** in the changelog, not names. Kept looks the name up.

## License

MIT. See [LICENSE](LICENSE).
