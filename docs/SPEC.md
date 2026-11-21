# Kept: promise tracking for Jira Service Management

Codegeist 2026 entry: **Apps for Business Teams**, plus the **Rovo Agent** bonus. Due Dec 22, 2026, 12:00 PT.

## Problem
Support agents make promises in their replies to customers: *"I'll update you by Thursday"*, *"the fix ships in 2.4"*, *"we'll refund the charge tomorrow"*.

Jira Service Management has SLAs for response and resolution, but **nothing tracks the commitments an agent actually wrote**. So promises slip quietly:
- the agent goes on leave;
- the bug the fix depends on gets moved out of the sprint;
- nobody notices until the customer writes back angry.

Broken promises are a leading cause of churn.

## What Kept does
1. **Catch.** When an agent posts a *public reply* on a request, Kept reads it and pulls out each promise:
   - **what** was promised, sorted into a kind: update, fix, refund, callback or action;
   - **when** it's due: an explicit date or time, a release (v2.4), or a default of two business days if the agent was vague;
   - **who** owns it.
2. **Connect.** A fix promise is linked to the DEV issue the request is linked to, using Jira issue links. Kept watches that issue.
   - If the issue moves out of the sprint, its fix version changes, or it is reopened, the promise becomes **At risk**, with the reason: *"DEV-12 was removed from Sprint 14. You promised a fix by Fri."*
   - When the issue is resolved or released, the promise becomes **Ready to close the loop**. Kept drafts the "your fix is live" reply.
3. **Remind.** A scheduled job runs every hour:
   - a promise due within 24 hours gets an internal note that @mentions its owner;
   - an overdue promise becomes **Broken** and is flagged on the request.
4. **Keep score.**
   - A promise is **Kept** when the agent posts a later public reply that satisfies it before the due date: any reply counts for an update promise; a fix promise also needs the linked issue to be resolved.
   - The Promises page shows: due today, at risk, broken, kept rate per agent and per team, and promises orphaned by an agent who is on leave.
5. **Ask.** A Rovo agent, *Promise Keeper*, answers questions such as:
   - "What did we promise Acme?"
   - "Which promises are at risk this week?"
   - "Draft the close-the-loop reply for SUP-12."

   It answers through actions backed by Kept's store.

## Surfaces (Forge modules)

| Module | Where | Purpose |
|---|---|---|
| `jira:issuePanel` "Promises" | SUP requests | List of the request's promises with status, due date, owner and linked issue. Actions: mark kept, extend, dismiss, link issue. |
| `jira:issuePanel` (same module) | DEV issues | **Reverse view:** the customer promises riding on this issue ("3 customers were promised this by Fri"). |
| `jira:globalPage` "Promises" | Jira apps menu | Dashboard: due today / at risk / broken / kept rate. |
| `trigger` `avi:jira:commented:issue` | backend | Extract promises from public replies. A later reply can also satisfy an update promise. |
| `trigger` `avi:jira:updated:issue` | backend | Watch linked DEV issues for sprint, fix version, status and resolution changes. |
| `scheduledTrigger` (hourly) | backend | Due-soon reminders and detection of broken promises. |
| `rovo:agent` + `action`s | Rovo | Promise Keeper agent. |

## Data
A Forge KVS custom entity named `promise`:
- `id`
- `issueKey`, `issueId`, `projectKey`
- `commentId`
- `ownerAccountId`
- `customerAccountId`
- `kind`
- `text`, the sentence as the agent wrote it
- `dueAt` (ms), `dueSource` (`explicit` | `release` | `default`), `dueLabel`
- `releaseRef`
- `devIssueKey`
- `status`: `open` | `at_risk` | `ready` | `kept` | `broken` | `dismissed`
- `riskReason`
- `createdAt`, `updatedAt`, `resolvedAt`

Indexes:
- `by-issue` (issueKey)
- `by-dev-issue` (devIssueKey)
- `by-status-due` (status, dueAt)

## Extraction: deterministic, explainable, testable
The extractor is pure and lives in `src/core/`. It uses rules and `chrono-node`, with **no LLM calls**:
- it's free;
- it gives the same answer every time;
- it can be unit tested.

Rovo handles the conversational layer.

Rules:
- **Commitment patterns:** "I'll / I will / we'll / we will / I'm going to / you'll get|receive|hear|have|see / expect … by".
- **Hedges are excluded:** "we'll try", "might", "may", "hopefully", "we'll see", "if …". Vague reassurance with no action, such as "we're looking into it", is not a promise.
- **Due dates resolve in the agent's time zone.** A date with no time means 17:00 local. "End of day" means 17:00. "Within N hours/days" is supported. "Next release" or "vX.Y" sets `releaseRef`.

## Honesty rules (same spirit as Plague Doctor)
- Kept never invents a promise. Every promise links back to the exact sentence in the exact comment.
- Every status change records a reason that a human can read.
- A vague promise is labelled *"no date given, defaulted to 2 business days"*, never presented as if the agent had named a date.

## Demo script (under 5 minutes)
1. An agent replies "I'll update you by Thursday, and the fix ships in 2.4". Two promises appear instantly.
2. The PM drags DEV-12 out of the sprint. The promise turns **At risk**, and the reason appears on the support ticket.
3. DEV-12 is resolved. The promise shows **Ready to close the loop**, and the drafted reply is sent.
4. The dashboard shows kept rate, plus orphaned promises from an agent on leave.
5. Rovo: "What did we promise Acme this month?"
