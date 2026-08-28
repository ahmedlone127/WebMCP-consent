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

## Trust boundary

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

## Demo

`demo/index.html` is a small operations console built on the library. It seeds
a support ticket containing a prompt injection. Ask an agent to triage the
inbox and watch the refund get staged instead of issued.

```
npx serve .
```

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
