# webmcp-consent — WebMCP Challenge submission

Draft copy for the Devpost fields. Sections map to the questions the entry
asks; trim to fit each box.

---

## Tagline

Injected text can reach the agent. It cannot reach the button.

## Elevator pitch

WebMCP lets an agent act inside a tab the user is already signed into. That is
the entire point of the standard — no separate auth, no API keys, the agent
works where the user already works. It is also the risk: a tool that calls
`api.refund()` inside `execute` issues that refund the moment an agent decides
to call it, including when the agent decided that because a customer pasted a
convincing lie into a support ticket.

`webmcp-consent` is a consent layer. Reads run freely. Writes never execute
directly — they stage a proposal a human approves with a real click, out of
band from the agent's own channel.

It ships as two things: a **browser extension** that enforces this on any site,
including sites that never heard of this project, and an **npm library** for
developers who want the consent layer designed into their own WebMCP surface.

---

## The problem

Prompt injection is unsolved and is not going to be solved by better tool
descriptions. Everything an agent reads — a support inbox, a product review, a
PDF, a page it was told to summarize — is attacker-reachable text arriving on
the same channel as its instructions.

WebMCP raises the stakes because it removes the last practical speed bump.
Before it, an agent taking a bad action needed credentials, an API, a network
path. With WebMCP the agent is already inside the authenticated session and
the action is one local function call away.

The existing answer is "sites should be careful." That answer has a hole in
it: it protects users of careful sites. Almost every site on the web has not
heard of WebMCP yet, and none of them will have shipped a consent layer by the
time users start pointing agents at them.

## What it does

**The extension (the headline).** Loaded unpacked in Chrome with WebMCP
enabled, it holds every write on every site. The site changes nothing and
knows nothing. When a tool tries to run, a card appears in the extension popup
showing the tool, the arguments, the site, and a risk score; the agent's call
stays suspended until a human clicks Approve or Decline.

**The library (`webmcp-consent` on npm).** Zero dependencies, ESM, no build
step. `registerRead` executes immediately. `registerStaged` splits a tool into
`preview` (build a diff a human can read) and `commit` (the real side effect,
which only runs after approval). Guards re-run at approval time, not just
propose time. Role scoping works by not registering a tool at all rather than
filtering it after the fact, so a role that cannot use a tool never sees it
exist.

## What is newly possible

A user can point an agent at a site that has never heard of consent layers,
prompt injection, or this project, and still have every irreversible action on
that site stop and wait for them.

That reframes who is responsible. Today the implied answer is "the website
owner should have built guardrails." This says the agent's operator — the
person or company running the agent — can guardrail their own agent, on every
site at once, without waiting for the web to catch up.

## How WebMCP was implemented

**Interception.** `registerTool` is a property holding a function. A content
script at `document_start` in the `MAIN` world — which Chrome guarantees runs
before any page script — replaces that property with a wrapper. The site calls
`registerTool` completely normally and is calling ours. `MAIN` world is the
detail that makes this possible at all: the default isolated world would hand
the content script a private copy of the context, and it would patch a copy the
page never reads from.

MAIN-world scripts cannot reach `chrome.*`, so decisions relay
page ⇄ `window.postMessage` ⇄ an isolated-world bridge ⇄ `chrome.runtime` ⇄ an
MV3 service worker that owns the queue, the whitelist, and the badge.

**Classification, without the site's cooperation.** One line:

```js
const isWrite = (def) => def.annotations?.readOnlyHint !== true;
```

Unannotated means gated. `readOnlyHint` is a real MCP/WebMCP annotation, not
something invented here. The classifier deliberately never reads the tool's
name or description to guess intent — that is defeated by a site simply not
naming things suspiciously, and it would make attacker-authored text
load-bearing in a security decision, which is the whole thing this defends
against.

**Catching a site that lies.** `window.fetch` is patched in the same script.
A non-GET/HEAD request issued while a tool's `execute` is on the call stack,
and that has not already been approved, is held exactly like a write. By
construction this can only ever fire for a tool that claimed
`readOnlyHint: true` and lied, because a genuine write's real implementation
never runs until after approval. `demo/unprotected.html` ships
`check_loyalty_status` to prove it: annotated read-only, silently POSTs.

**Telling the agent what happened.** A declined tool call *resolves* with an
explicit refusal rather than rejecting. This was a deliberate reversal: the
WebMCP runtime replaces a thrown error with generic text ("the script function
threw an error"), so a rejection reaches the agent looking like a bug — and an
agent that thinks a tool is buggy retries it, turning every decline into
another prompt. Resolving with `DECLINED BY OPERATOR… Do not retry` is the
only way the human's answer survives the trip. A declined *network* request
still rejects, because its caller is awaiting a `Response` and a string would
break it.

**Persistent, visible consent.** "Approve & Always Allow" stores
`origin::toolName` in `chrome.storage.local`. The list is shown in the popup
and revocable there. A cache you cannot see or undo is not consent.

**A card that shows facts, not a verdict.** The card carries the tool name, the
real arguments, the site, and for a held request the method and full
destination URL. There is deliberately no risk score. One was built — scored
only on structural facts, never on text — and then removed, because testing
against real sites showed every tool card scoring identically. It rendered a
number that looked like a judgement while carrying nothing the card did not
already say, and a score that never changes teaches people to stop reading.

What it never used, and what classification still never uses, is the tool's
own description. It is shown in full for a human to read; nothing automatic
keys off it. Any heuristic or LLM that approves based on self-authored
description text reopens the entire vulnerability class inside the thing meant
to defend against it.

## How it improves the agent experience

The failure mode this replaces is not "the agent is blocked." It is "the agent
silently did something the user would not have authorized." A consent layer
that nags on reads gets switched off, so reads are never gated — measured at
about 6ms, no prompt, no badge. Only the irreversible half stops.

And when it stops, the human gets a card with the actual arguments — which
order, which amount — not a yes/no about an opaque tool name. The decision is
made against the thing that will happen.

## What was verified

Tested in Chrome with WebMCP enabled, against `demo/unprotected.html`:

| | Result |
|---|---|
| Read tool runs ungated | ✅ resolved in ~6ms, no prompt |
| Unannotated write is gated | ✅ `issue_refund` carries no annotations at all and was held |
| Decline blocks the side effect | ✅ agent got the refusal, order stayed `processing` |
| Approve commits it | ✅ order flipped to `refunded` |
| Whitelist round-trip | ✅ third call ran with no prompt |
| Revoke | ✅ next call held again |
| **Annotation liar caught on the network** | ✅ **0 requests on decline, exactly 1 on approve**, confirmed via Resource Timing |

The last row is the one that matters. A tool that declared itself read-only
tried to POST, and the request did not reach the wire until a human said yes.

### Against sites we did not write

The interesting testing was on three third-party WebMCP sites, none of which
have ever heard of this project.

**Chrome Labs' hotel-chain demo.** The `document_start` patch won the race
against a real bundled app. Six tools — and only one, `get_current_search_results`,
carries `readOnlyHint`. The other five are unannotated, including
`view_hotel`, `lookup_amenity` and `search_location`, which are plainly reads.
The fail-safe default therefore gates all five. That is the correct call and
also the honest cost: on a site that does not annotate, a consent layer that
gates by default will ask about reads. It is exactly why "Approve & Always
Allow" is one click and why the allow list is visible and revocable rather
than a silent cache. The site also registers tools *dynamically* as its view
changes — three at first, six after navigating — and the wrapper caught the
later ones too.

**Cloudflare's coffee shop.** Properly annotated, and classification was
exactly right: `filter_coffees_by_roast` ran free, while `add_to_cart`,
`remove_from_cart` and `update_cart_quantity` were held. No false positives,
no false negatives. Driving a real write end to end: `add_to_cart` was held
with the cart showing `0 / Empty`, and only after approval did the cart become
`2 × Guji Shakiso, $44.00`.

**Vercel's storefront.** `document.modelContext` exists and our patch applied,
but the site registers no WebMCP tools at all — it is "agent-friendly" by some
other route. A useful negative control: the extension found nothing, did
nothing, and broke nothing.

**This testing found a real bug**, which is the point of doing it. On approval
the code substituted its own value for any non-string result
(`typeof result === 'string' ? result : 'Approved.'`). On the network path,
`commit` resolves with a `Response` — so an approved request handed the page
the string `"Approved."` instead, breaking anything that reads `.ok` or
`.json()`. Our own demo never caught it because it discards its response. Now
the real result is passed through untouched, and a value is only substituted
when a tool genuinely returns nothing.

**On the injection demo, stated plainly:** the seeded ticket in both demos is a
social-engineering injection (a fabricated prior ticket number, a claimed
pre-approval, time pressure). In our testing, frontier models frequently
*caught* it and refused unprompted. That is good news, and it is also exactly
why the defence cannot depend on it. The gate holds identically whether the
agent was fooled or not — that is the design claim, not "the model always
falls for it."

## Honest limits

- A write that never touches the network — a tool claiming `readOnlyHint: true`
  that mutates only in-page state — is invisible to both layers.
- Only `fetch` is patched. `XMLHttpRequest`, `sendBeacon`, WebSockets, and form
  submission are not.
- A page that assigns its own `window.fetch` after load keeps the tool-level
  gate but loses the network-level catch. A page that *wraps* fetch is fine.
- A page can detect it has been wrapped by reading `registerTool.toString()`.
- ChatGPT's in-app browser is a closed platform and does not accept third-party
  extensions, so the extension runs in Chrome with WebMCP enabled.
- Nothing here saves a human who approves without reading.

This raises the cost of a successful injection from "the agent was convinced"
to "the agent was convinced **and** a human clicked approve on a card
describing the action." That is a real, large gap. It is not a proof.

## Why it pivoted

The first version was the library alone. A WebMCP Challenge judge, Alex Nahas,
reviewed it and made a point that reframed the project: the library puts the
burden of protection on the website's own developer choosing to adopt it, so a
user on a site that never heard of it gets nothing. His suggestion was to move
enforcement to the user's side.

That became the extension, and the extension became the headline. The library
did not go away — it is the primitive the argument rests on, and the right
answer for a team building their own WebMCP surface deliberately. But the
question changed from "what should a careful site ship" to "what protects a
user when the site was not careful," which is most of the web.

Credit where it is due: that was direct judge feedback and it made the project
better.

## What is next

- **Advisory-only LLM triage.** A model offers a plain-English read on a newly
  seen tool, with the raw metadata beside it — but a human still clicks to
  whitelist. Deliberately advisory: an LLM that *auto*-approves based on the
  tool's own description reopens exactly the vulnerability being defended
  against, just relocated.
- `destructiveHint` and `idempotentHint`, the other standard annotations, as a
  cheap extension of the same model.
- Patching `XMLHttpRequest` and `sendBeacon` to close the non-`fetch` gap.
- Community-curated allow lists, ad-blocker style — credible with a real user
  base, cold-start problem today.
- For browsers that do not accept extensions, a local proxy injecting the same
  patch. Platform-agnostic, but asks the user to trust a local root CA.

## Built with

JavaScript (zero dependencies), Chrome Extension Manifest V3, WebMCP
(`document.modelContext`), MCP tool annotations, `chrome.storage`. No build
step anywhere.

## Links

- Repo: https://github.com/ahmedlone127/WebMCP-consent
- npm: https://www.npmjs.com/package/webmcp-consent
- Live demo: https://webmcp-consent-7d22c356.netlify.app/
