# webmcp-consent

A consent layer for [WebMCP](https://github.com/webmachinelearning/webmcp) tools.

Reads run freely. Writes never execute. They stage a proposal that a human
approves with a button in the page, out of band from the agent's own channel.

```js
import { createConsentLayer, mountApprovalQueue } from 'webmcp-consent';

const consent = createConsentLayer({ role: currentUser.role });

consent.registerStaged({
  name: 'issue_refund',
  description: 'Refund an order.',
  roles: ['manager', 'owner'],
  guard: ({ amount }, { role }) => amount <= CEILING[role] || `Over the ${role} ceiling.`,
  preview: ({ order_id, amount }) => ({
    summary: `Refund ${order_id}`,
    diff: [{ field: 'refunded', before: '$0.00', after: `$${amount}` }],
    reversible: false,
  }),
  commit: ({ order_id, amount }) => api.refund(order_id, amount),
});

mountApprovalQueue(consent, '#approvals');
```

Zero dependencies. ESM. Works with plain JS, React, or any framework.

## Two halves

**The browser extension** (`extension/`) enforces this on sites you don't
control. It replaces `registerTool` from the user's side at `document_start`,
before the page's own scripts run, so a write is held for approval whether or
not that site ever heard of this library. Nothing about the site changes; it
registers tools normally and is calling a wrapper. Load it unpacked from
`extension/`.

**The library** (this npm package) is for developers building their own WebMCP
surface who want the consent layer designed in rather than patched on from
outside: staged proposals with real diffs, role scoping, guards that re-run at
approval time, an audit trail.

They answer different questions. The library asks what a careful site should
ship. The extension asks what protects a user when the site wasn't careful —
which is most sites, because almost none of them have heard of any of this yet.

Same rule underneath both: reads run freely, writes need a human hand on a
control the agent cannot reach.

## Why

WebMCP tools run inside the user's authenticated session. That is the whole
point of the standard, and it is also the risk: a tool that calls
`api.refund()` inside `execute` will issue that refund the moment an agent
decides to call it, including when the agent decided that because a customer
pasted `SYSTEM OVERRIDE` into a support ticket.

Prompt injection is unsolved. It is not going to be solved by better tool
descriptions. What can be done today is to make the irreversible actions
require a human hand on a control the agent cannot reach.

That is a few hundred lines of proposal queue, diff rendering, held promises,
role scoping, and audit trail, per site, and most teams will not write it.
This is that layer as one import.

## Install

```
npm install webmcp-consent
```

Or without a build step:

```html
<script type="module">
  import { createConsentLayer } from 'https://esm.sh/webmcp-consent';
</script>
```

## The two kinds of tool

**`registerRead`** — executes immediately, no approval. Marked `readOnlyHint`
so agents know it is safe to call freely. Investigation should never be gated;
gating it makes the agent feel useless without making anything safer.

```js
consent.registerRead({
  name: 'get_customer_messages',
  description: 'Read the support inbox.',
  untrusted: true,        // adds untrustedContentHint and delimits the output
  execute: async () => inbox.map(m => `From ${m.from}: ${m.body}`).join('\n'),
});
```

`untrusted: true` wraps the return value in `<untrusted-content>` tags and sets
`untrustedContentHint`. Delimiting is not a guarantee. It is the cheapest
signal available and it costs nothing.

**`registerStaged`** — never executes. Splits your old `execute` into two:

- `preview(input, ctx)` builds the reviewable artifact: summary, diff, blast
  radius, reversibility.
- `commit(input, ctx)` is the real side effect, and runs only after approval.

The agent's call returns a Promise that stays unresolved until a human acts.
Approve resolves it. Decline rejects it.

## Enforcement runs twice

`guard` fires at propose time and again at approve time. If the user's role
changed while a proposal sat in the queue, the second check catches it.

A limit stated only in a tool description is documentation, not a control.
Enforce in `guard`, and enforce again server-side. This library covers the
client half; it cannot cover the half that isn't in the browser.

## Role scoping is registration, not filtering

Tools carrying a `roles` array are not registered at all for other roles. A
support rep's agent does not see `propose_price_change` refused. It does not
see that the tool exists.

```js
consent.setRole('manager');   // tears down and re-registers the whole surface
```

Because WebMCP unregisters via `AbortController`, the tool surface is a pure
function of current state, and `setRole` is just a resync.

## API

### `createConsentLayer(options)`

| option | default | meaning |
|---|---|---|
| `role` | `'default'` | Current acting role. |
| `timeoutMs` | `300000` | Auto-expire pending proposals after 5 minutes so an agent is never hung forever on an absent human. `0` disables expiry. |
| `auditLimit` | `200` | Audit log ring buffer size. |
| `exposeHistory` | `true` | Register `get_action_history` for the agent. |

### Instance

- `registerRead(def)` / `registerStaged(def)`
- `setRole(role)`
- `approve(id)` / `decline(id, reason?)`
- `pending` / `audit` / `toolNames`
- `subscribe(fn)` → unsubscribe
- `destroy()`
- `available` — false when WebMCP is absent, so you can degrade gracefully

### UI

- `mountApprovalQueue(layer, target, { emptyText })` → unmount
- `mountAuditLog(layer, target, { limit })` → unmount

Themeable with CSS variables: `--wmc-ink`, `--wmc-line`, `--wmc-muted`,
`--wmc-surface`, `--wmc-accent`, `--wmc-accent-bg`, `--wmc-ok`, `--wmc-danger`,
`--wmc-font`, `--wmc-mono`.

### React

```js
import { useConsentLayer } from 'webmcp-consent/react';

const { layer, pending, audit, role, tools } = useConsentLayer({ role: user.role });
```

Tools unregister on unmount, so the agent's capabilities track what is
actually on screen.

## Tools the library registers for you

- `get_action_history` — the audit log, actor-tagged, so an agent can check
  what it already did instead of duplicating work.

## Idempotency

Every staged tool gains an optional `idempotency_key` input. A retrying agent
reusing the key gets an error rather than a second proposal, and a key that
already committed returns the prior result.

## Trust boundary — the library

What the agent can do unilaterally: every `registerRead` tool, plus
`get_action_history`.

What requires a human: every `registerStaged` tool, without exception. Even if
a proposal has no `guard`, approval is still checked against the tool's
`roles` array — a role change while a proposal sits in the queue cannot be
used to approve a tool that role was never allowed to see.

What the agent cannot reach at all: the approve and decline buttons. They are
DOM events in the page. An agent that only has WebMCP tool access has no path
to them. If your agent surface also has DOM automation, this boundary weakens
and you should say so.

What this does not protect against: a compromised page, a malicious first-party
developer, missing server-side authorization, or a human who approves without
reading. It is a consent layer, not a sandbox.

## Trust boundary — the extension

The extension protects a user on a site that never opted in, so it cannot
assume anything the site tells it is true. Two things follow from that.

**Classification is fail-safe, not clever.** A tool is treated as a write
unless it explicitly carries `readOnlyHint: true`. Unannotated means gated.
The classifier deliberately does not read the tool's name or description to
guess intent — that would be defeated by a site simply not naming things
suspiciously, and it would make attacker-authored text load-bearing in a
security decision, which is the exact thing this project exists to prevent.

**A site that lies in its annotations is caught at the network layer.**
`window.fetch` is patched too. A non-GET/HEAD request issued while a tool's
`execute` is on the call stack, and that hasn't already been approved, is held
the same way a write is. By construction this can only ever fire for a tool
that claimed `readOnlyHint: true` and lied, because a genuine write's real
implementation never runs until after approval. `demo/unprotected.html` ships
a `check_loyalty_status` tool that exercises exactly this: annotated read-only,
silently POSTs.

**A held call raises a desktop notification.** A suspended agent is invisible
if you are not already watching the toolbar, and it stays suspended for as long
as it takes you to notice. The notification carries the tool name, the real
arguments and the site, with Approve and Decline on it, so a proposal can be
answered without opening anything. It is marked `requireInteraction`, so it
does not quietly time out while an agent waits. Dismissing it is deliberately
not a decision — the proposal stays queued and the popup still shows it, since
silently declining on a stray click is worse than making you look. Answering on
either surface clears the other.

**The card shows facts, not a verdict.** Each approval card shows the tool
name, the actual arguments, the site, and — for a held request — the method and
full destination URL. There is no risk score. An earlier version had one,
computed only from structural facts, and it was removed after testing against
real sites showed every tool card scoring identically: it added a number that
looked like a judgement while carrying no information the card did not already
state. A score that is always the same trains people to ignore the card.

What the score deliberately never used, and what classification still never
uses, is the tool's own description. It is displayed in full for a human to
read, but nothing automatic keys off it. Any heuristic or LLM that approves
based on self-authored description text reopens the whole vulnerability class
inside the thing meant to defend against it.

"Always allow" is stored per `origin::toolName`, listed in the popup, and
revocable there. A cache you cannot see or undo is not consent.

**The approval channel is private to the extension.** The interceptor has to
run in the MAIN world to patch the page's own `registerTool`, which means page
scripts share that world. An earlier version relayed proposals and decisions
over `window.postMessage`, and that was forgeable: a page could listen for its
own proposal, read the id, and post back an approval for it — self-approving
every write with no human involved. The two content scripts now hand each
other a private `MessagePort` at `document_start`, before any page script
exists, and every proposal and decision crosses that port. `window.postMessage`
carries nothing but the one-time handover, and only the first one is accepted.
A page can no longer read a proposal, let alone answer one.

### What the extension cannot do

- **A write that never touches the network.** A tool that claims
  `readOnlyHint: true` and mutates only in-page state — a JS object, the DOM,
  `localStorage` — is invisible to both layers. Nothing observes it. Both demo
  pages mutate an in-memory array, and their `issue_refund` is caught only
  because it is unannotated, not because the mutation was detected.
- **Writes that don't go through `fetch`.** `XMLHttpRequest`,
  `navigator.sendBeacon`, WebSockets, form submission and image beacons are
  not patched. Only `fetch` is.
- **A page that installs its own `window.fetch` after load.** The patch is
  re-applied for about two seconds after `document_start`; a page that replaces
  `fetch` outright after that window keeps the tool-level gate but loses the
  network-level catch. A page that *wraps* `fetch` is fine — it wraps ours.
- **Hide that it is there.** A page can read `registerTool.toString()` and see
  it has been wrapped, and could behave differently when it does.
- **Protect a browser it cannot run in.** ChatGPT's in-app browser is a closed
  platform that does not accept third-party extensions. This runs in Chrome
  with WebMCP enabled.
- **Save a human who approves without reading.** Nothing here can.

The honest summary: this raises the cost of a successful injection from "the
agent was convinced" to "the agent was convinced *and* a human clicked
approve on a card describing the action." That is a real, large gap. It is
not a proof.

## Demo

`demo/index.html` is a small operations console built on the library. It seeds
a support ticket containing a prompt injection. Ask an agent to triage the
inbox and watch the refund get staged instead of issued.

`demo/unprotected.html` is the opposite: a plain page with no consent layer of
any kind, which is what the extension is for. Its `issue_refund` executes
immediately and is caught because it carries no `readOnlyHint`. Its
`check_loyalty_status` claims `readOnlyHint: true` and is caught anyway, at the
network layer, when it tries to POST.

```
npx serve .
```

To run the extension: `chrome://extensions` → Developer mode → **Load
unpacked** → select `extension/`. Writes are then held on any site, including
`demo/unprotected.html`, and the toolbar badge shows how many are waiting.
Note that `getTools()` returns a Promise, so driving tools from the console
means `(await mc.getTools()).find(...)`, not `mc.getTools().find(...)`.

WebMCP needs a secure context, so `file://` will not work. Open in Chrome 149+
with `chrome://flags/#enable-webmcp-testing`, or in the ChatGPT desktop app's
in-app browser.

## Tests

```
npm test
```

Nine cases covering role scoping, staged blocking, decline, guard enforcement
at both checkpoints, idempotency, role enforcement on approval independent of
guard, untrusted wrapping, and expiry.

## License

MIT
