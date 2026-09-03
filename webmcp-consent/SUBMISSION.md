# Devpost submission — paste-ready

One section per field on the form.

---

## Project name

```
webmcp-consent
```

## Elevator pitch

```
Injected text can reach the agent. It cannot reach the button. A Chrome extension that holds every WebMCP write for human approval, on any site, whether or not that site adopted anything.
```

---

## About the project

```
WebMCP lets an agent act inside a tab you are already signed into. No API keys, no
separate auth, the agent works where you already work. That is the point of the
standard and it is also the risk. A tool that calls api.refund() inside execute will
issue that refund the moment an agent decides to call it, including when the agent
decided that because a customer pasted a convincing lie into a support ticket.

webmcp-consent is a consent layer. Reads run freely. Writes never execute directly:
they suspend the agent's call and wait for a person to click Approve, on a surface the
agent has no route to.


WHY THIS FITS WEBMCP

Prompt injection is unsolved, and better tool descriptions are not going to solve it.
Everything an agent reads is attacker-reachable text arriving on the same channel as
its instructions: an inbox, a review, a PDF, a page it was told to summarise.

WebMCP raises the stakes because it removes the last practical speed bump. Before it,
an agent taking a bad action needed credentials, an API, a network path. With WebMCP
the agent is already inside the authenticated session and the action is one local
function call away.

The usual answer is that sites should be careful. That protects users of careful
sites. Almost no site has heard of WebMCP yet, and none of them will have shipped a
consent layer by the time people start pointing agents at them.


WHAT IS NOW POSSIBLE

You can point an agent at a site that has never heard of consent layers, prompt
injection, or this project, and every irreversible action on that site will still stop
and wait for you.

Concretely: an agent can fill a cart on a storefront in one turn instead of you
clicking through six screens, and the checkout still cannot happen without your click.
You get the one-turn agent and the stopping point. Until now that was a choice between
the two.

It also moves the responsibility. Today the implied answer is that the website owner
should have built guardrails. This says the person running the agent can guardrail
their own agent, on every site at once, without waiting for the web to catch up.


HOW WE IMPLEMENTED WEBMCP

registerTool is a property holding a function. A content script runs at document_start
in the MAIN world, which Chrome guarantees happens before any page script, and
replaces that property with a wrapper. The site registers its tools the normal way and
is calling ours. It never finds out. MAIN world is what makes this work at all; the
default isolated world hands the script a private copy of the context and it would
patch something the page never reads.

MAIN-world scripts cannot touch chrome.*, so decisions cross a private MessagePort to
an isolated-world bridge, then chrome.runtime, then an MV3 service worker that owns
the queue, the allow list and the badge.

Classification is one line:

    const isWrite = (def) => def.annotations?.readOnlyHint !== true;

No annotation means gated. readOnlyHint is a real MCP annotation, not something
invented here. It never reads the tool's name or description to guess intent. A site
could defeat that by not naming things suspiciously, and it would put attacker-authored
text in charge of a security decision, which is the problem this exists to solve.

window.fetch is patched too. A non-GET/HEAD request fired while a tool's execute is
running, on a call that was not already approved, is held exactly like a write. This
can only fire for a tool that claimed readOnlyHint: true and lied, because a real
write's implementation does not run until after approval.

A declined call resolves with an explicit refusal rather than rejecting. The runtime
replaces a thrown error with generic text about the script function throwing, so a
rejection reaches the agent looking like a bug, and an agent that thinks a tool is
buggy retries it. Every decline would become another prompt.


WHAT WE TESTED

Cloudflare's coffee shop, a site we did not build: add_to_cart held with the cart at
0/Empty, and on approval the cart became 2 x Guji Shakiso, $44.00. Its roast filter is
annotated read-only and ran free. Three cart mutations gated, no false positives.

Chrome Labs' hotel-chain demo: the patch won the race against a real bundled app. Only
1 of its 6 tools carries readOnlyHint, so gating by default asks about reads there.
That is a real cost of the design, and it is why "Approve & Always Allow" is one click
and why the allow list is visible and revocable.

Vercel's storefront: modelContext present, patch applied, zero WebMCP tools
registered. Found nothing, broke nothing.

Reads measured around 5ms with no prompt. On the annotation-liar test, zero requests
reached the network on decline and exactly one on approve, confirmed both by Resource
Timing in the browser and by the server's own access log.

Testing also found a vulnerability we would rather disclose than have someone find.
Approvals were relayed over window.postMessage, which page scripts share with the
interceptor, so a page could read its own proposal id and post back a forged approval.
It could approve its own writes. Fixed with a private MessagePort handed over at
document_start, before any page script exists. Re-running the exploit, the page cannot
even see a proposal.


WHAT IT CANNOT DO

A write that never touches the network, meaning a tool claiming read-only that only
mutates in-page state, is invisible to both layers. Only fetch is patched, not
XMLHttpRequest or sendBeacon. ChatGPT's in-app browser does not accept third-party
extensions, so this runs in Chrome with WebMCP enabled. And nothing here helps someone
who approves without reading.

What it does is raise the cost of a successful injection from "the agent was
convinced" to "the agent was convinced and a human approved a card describing the
action." That is a big gap, and it is not a proof.


WHERE IT CAME FROM

The first version put the consent layer inside the site, as something a developer
would adopt. Alex Nahas, a judge on this challenge, pointed out the flaw: that only
protects users of sites that chose to install it, which is nobody yet. He suggested
moving enforcement to the user's side. That is the whole project now. Both demo pages
were rewritten to plain WebMCP with no consent layer of their own, so everything that
stops a write comes from the extension.


WHAT'S NEXT

An advisory-only LLM read on newly seen tools, where a person still clicks to
whitelist. Advisory on purpose: a model that auto-approves based on the tool's own
description reopens the exact vulnerability being defended against. Then
destructiveHint and idempotentHint, which are cheap extensions of the same model, and
patching XMLHttpRequest and sendBeacon to close the non-fetch gap.
```

---

## Built with

```
javascript, chrome-extension, manifest-v3, webmcp, mcp, web-apis, service-worker, messagechannel
```

## Try it out links

```
https://webmcp-consent-7d22c356.netlify.app
https://github.com/ahmedlone127/WebMCP-consent
```

## Video

```
<YouTube URL, public, under 3 minutes>
```

---

## Testing instructions

```
No login or credentials needed.

1. Enable WebMCP: chrome://flags/#enable-webmcp-testing, set to Enabled, relaunch.
2. Open https://webmcp-consent-7d22c356.netlify.app and download the extension
   (15 KB zip, linked on the page).
3. Unzip it, open chrome://extensions, turn on Developer mode, click Load unpacked,
   and select the unzipped folder.

The homepage detects and shows whether both steps worked.

Then open "Anywhere Goods" from the homepage and point an agent at it. Neither demo
has a consent layer in its own code. Anywhere Goods registers issue_refund with no
annotation, so it is held, and check_loyalty_status which claims readOnlyHint: true
and quietly POSTs, so that request is caught at the network layer. Ledger has a prompt
injection planted in its inbox: ask an agent to triage it and watch what it tries.

It also works on third-party WebMCP sites we did not build. Try
https://webmcp-coffee.jilles.fyi and ask an agent to add coffee to the cart. The call
is suspended until you approve it in the extension popup.
```

---

## Before submitting

- [ ] Video on YouTube, **public** (not unlisted), under 3 minutes, with audio
- [ ] Live URL loads and both detection chips work
- [ ] Repo public, MIT license visible at root
- [ ] Testing instructions filled in
- [ ] Teammates added, if any
- [ ] Submitted. Deadline 1:00 PM PT, Thursday 3 September. Hard stop.
