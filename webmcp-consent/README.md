# webmcp-consent

A consent layer for [WebMCP](https://github.com/webmachinelearning/webmcp).

Reads run freely. Writes stop and wait for a human to approve them, on a
control the agent has no way to reach.

It is a **Chrome extension**. It works on any WebMCP site, including sites that
never adopted anything and don't know it exists.

There is also an npm library in this repo, `webmcp-consent`, from an earlier
version of the project. It is documented at the bottom and is not required for
any of the above.

---

## The extension

`registerTool` is a property holding a function. A content script runs at
`document_start` in the MAIN world, which Chrome guarantees happens before any
page script, and replaces it with a wrapper. The site registers its tools the
normal way and is calling ours. It never finds out.

MAIN world is what makes this work. The default isolated world would hand the
script its own private copy of the context, and it would patch something the
page never reads.

### Install

Download [the zip](https://webmcp-consent-7d22c356.netlify.app/webmcp-consent-extension.zip),
unzip it, then open `chrome://extensions`, turn on Developer mode, and click
**Load unpacked**. Or load `extension/` straight from a clone.

You also need WebMCP itself: `chrome://flags/#enable-webmcp-testing`, then
relaunch.

### How it decides

One line:

```js
const isWrite = (def) => def.annotations?.readOnlyHint !== true;
```

No annotation means gated. `readOnlyHint` is a real MCP annotation, not
something invented for this.

It never reads the tool's name or description to guess intent. A site could
defeat that by not naming things suspiciously, and it would put
attacker-authored text in charge of a security decision, which is the problem
this exists to solve. The description is shown in full on the approval card for
a person to read. Nothing automatic keys off it.

### When a site lies

`window.fetch` is patched too. If a non-GET/HEAD request goes out while a
tool's `execute` is running, and that call wasn't already approved, it gets held
the same way a write does.

This can only ever fire for a tool that claimed `readOnlyHint: true` and lied,
because a real write's implementation doesn't run until after approval.
`demo/unprotected.html` has a `check_loyalty_status` tool built to prove it:
annotated read-only, quietly POSTs.

### The approval card

It shows the tool name, the real arguments, the site, and for a held request
the method and full destination URL. No score, no verdict. An earlier version
had a risk score and it was removed: every tool card scored the same, so it was
a number that looked like judgement while saying nothing.

"Always allow" is stored per `origin::toolName`, listed in the popup, and
revocable there. A cache you can't see or undo isn't consent.

A held call also raises a desktop notification naming the tool, the arguments
and the site. It has no Approve/Decline buttons. Chrome on Windows hands
notifications to the system notification centre, which renders buttons but
sends no interaction back to the extension. Tested with the service worker
awake, a click produced no `onButtonClicked`, no `onClicked`, not even
`onClosed`. A button that does nothing is worse than no button, so the
notification tells you something is waiting and the popup is where you answer.
The listeners are still registered, so a platform that does report clicks gets
one-click approval for free.

### The approval channel

The interceptor lives in the MAIN world, so page scripts share it. An early
version relayed proposals over `window.postMessage`, which turned out to be
forgeable: a page could watch for its own proposal, read the id, and post back
an approval. It could approve its own writes.

The two content scripts now hand each other a private `MessagePort` at
`document_start`, before any page script exists. Every proposal and decision
crosses that port. `window.postMessage` carries the one-time handover and
nothing else, and only the first one is accepted. A page can't read a proposal
now, let alone answer one.

### What it can't do

- **A write that never touches the network.** A tool claiming `readOnlyHint:
  true` that only mutates in-page state is invisible to both layers. Both demo
  pages mutate an in-memory array, and their `issue_refund` is caught only
  because it carries no annotation.
- **Writes that skip `fetch`.** `XMLHttpRequest`, `sendBeacon`, WebSockets,
  form submission and image beacons aren't patched.
- **A page that replaces `window.fetch` after load.** The patch is reapplied
  for about two seconds after `document_start`. After that, a page that
  replaces `fetch` outright keeps the tool-level gate but loses the network
  catch. Wrapping `fetch` is fine; it wraps ours.
- **Stay hidden.** A page can call `registerTool.toString()` and see the
  wrapper.
- **Run where extensions can't.** ChatGPT's in-app browser doesn't take
  third-party extensions. This is Chrome with WebMCP enabled.
- **Help someone who approves without reading.**

What it does is raise the cost of a successful injection from "the agent was
convinced" to "the agent was convinced and a human approved a card describing
the action." That's a big gap, and it isn't a proof.

---

## The library

This came first. It is a consent layer a site's own developer adopts, and it
still works, but it only protects users of sites that chose to install it. That
limitation is why the extension exists. Neither demo uses it any more.

It stays published because it is the right answer if you are building your own
WebMCP surface and want the gate designed in rather than applied from outside.
Everything above works without it.

```
npm install webmcp-consent
```

Zero dependencies, ESM, no build step. Works with plain JS, React, or anything
else.

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

Without a build step:

```html
<script type="module">
  import { createConsentLayer } from 'https://esm.sh/webmcp-consent';
</script>
```

### Two kinds of tool

`registerRead` runs immediately, no approval, marked `readOnlyHint` so agents
know they can call it freely. Gating investigation makes an agent feel useless
without making anything safer.

```js
consent.registerRead({
  name: 'get_customer_messages',
  description: 'Read the support inbox.',
  untrusted: true,
  execute: async () => inbox.map(m => `From ${m.from}: ${m.body}`).join('\n'),
});
```

`untrusted: true` wraps the return value in `<untrusted-content>` tags and sets
`untrustedContentHint`. Delimiting isn't a guarantee. It's the cheapest signal
available and it costs nothing.

`registerStaged` never runs directly. It splits `execute` in two:

- `preview(input, ctx)` builds what a person reviews: summary, diff,
  blast radius, reversibility.
- `commit(input, ctx)` is the real side effect, and only runs after approval.

The agent's call returns a Promise that stays unresolved until someone acts.
Approve resolves it, decline rejects it.

### Guards run twice

`guard` fires when the proposal is made and again when it's approved. If
someone's role changed while the proposal sat in the queue, the second check
catches it.

A limit stated only in a tool description is documentation, not a control. Put
it in `guard`, and put it server-side too. This library covers the client half
and can't cover the half that isn't in the browser.

### Roles scope registration, not visibility

A tool with a `roles` array isn't registered at all for other roles. A support
rep's agent doesn't see `propose_price_change` refused. It doesn't see that it
exists.

```js
consent.setRole('manager');   // tears down and re-registers the whole surface
```

WebMCP unregisters through `AbortController`, so the tool surface is a pure
function of current state and `setRole` is just a resync.

### API

`createConsentLayer(options)`

| option | default | meaning |
|---|---|---|
| `role` | `'default'` | Current acting role. |
| `timeoutMs` | `300000` | Expire pending proposals after 5 minutes so an agent isn't hung forever on an absent human. `0` disables. |
| `auditLimit` | `200` | Audit log ring buffer size. |
| `exposeHistory` | `true` | Register `get_action_history` for the agent. |

Instance: `registerRead(def)`, `registerStaged(def)`, `setRole(role)`,
`approve(id)`, `decline(id, reason?)`, `pending`, `audit`, `toolNames`,
`subscribe(fn)`, `destroy()`, and `available`, which is false when WebMCP isn't
there so you can degrade gracefully.

UI: `mountApprovalQueue(layer, target, { emptyText })` and
`mountAuditLog(layer, target, { limit })`, both returning an unmount function.
Themeable with `--wmc-ink`, `--wmc-line`, `--wmc-muted`, `--wmc-surface`,
`--wmc-accent`, `--wmc-accent-bg`, `--wmc-ok`, `--wmc-danger`, `--wmc-font`,
`--wmc-mono`.

React:

```js
import { useConsentLayer } from 'webmcp-consent/react';

const { layer, pending, audit, role, tools } = useConsentLayer({ role: user.role });
```

Tools unregister on unmount, so an agent's capabilities track what's actually
on screen.

Every staged tool gains an optional `idempotency_key` input. An agent retrying
with the same key gets an error instead of a second proposal, and a key that
already committed returns the earlier result.

### Trust boundary

The agent can call any `registerRead` tool plus `get_action_history` on its
own. Every `registerStaged` tool needs a human, with no exceptions. Even a
proposal with no `guard` is checked against the tool's `roles` array at
approval time, so a role change can't be used to approve something that role
was never allowed to see.

The approve and decline buttons are DOM events in the page. An agent with only
WebMCP tool access has no route to them. If your agent surface also has DOM
automation, this boundary weakens and you should say so.

It doesn't protect against a compromised page, a malicious first-party
developer, missing server-side authorization, or someone approving without
reading. It's a consent layer, not a sandbox.

---

## Demos

Neither demo has a consent layer in its own code. Both register plain WebMCP
tools, the way most sites will. Everything that stops a write comes from the
extension.

`demo/unprotected.html` is a storefront. Its `issue_refund` carries no
annotation and gets held. Its `check_loyalty_status` claims to be read-only and
gets caught anyway when it tries to POST.

`demo/index.html` is a support console with a prompt injection planted in its
inbox: a message inventing a prior ticket and a pre-approved refund. Ask an
agent to triage the inbox and watch what it tries. The refund is held either
way, which is the point. It also scopes tools by role, so a support rep's agent
never sees `change_price` at all.

```
npx serve .
```

WebMCP needs a secure context, so `file://` won't work. Use Chrome 149+ with
the flag enabled.

One gotcha if you drive tools from the console: `getTools()` returns a Promise,
so it's `(await mc.getTools()).find(...)`.

## Tests

```
npm test
```

Nine cases: role scoping, staged blocking, decline, guard enforcement at both
checkpoints, idempotency, role enforcement on approval independent of guard,
untrusted wrapping, and expiry.

## License

MIT
