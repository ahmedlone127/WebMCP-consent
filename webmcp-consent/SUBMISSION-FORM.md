# Devpost form — paste-ready

One section per field on the submission form. `SUBMISSION.md` is the longer
working draft; this is the version that goes in the boxes.

---

## Project name

```
webmcp-consent
```

## Elevator pitch (one line, ~200 char limit)

```
Injected text can reach the agent. It cannot reach the button. A Chrome extension that holds every WebMCP write for human approval — on any site, whether or not that site adopted anything.
```

---

## About the project

```
WebMCP lets an agent act inside a tab you are already signed into. No API keys, no
separate auth, the agent works where you already work. That is the point of the
standard, and it is also the risk: a tool that calls api.refund() inside execute
issues that refund the moment an agent decides to call it — including when the agent
decided that because a customer pasted a convincing lie into a support ticket.

webmcp-consent is a consent layer. Reads run freely. Writes never execute directly:
they suspend the agent's call and wait for a human to click Approve, on a surface the
agent cannot reach.


WHY THIS IS A STRONG FIT FOR WEBMCP

Prompt injection is unsolved and is not going to be solved by better tool
descriptions. Everything an agent reads — an inbox, a review, a PDF — is
attacker-reachable text arriving on the same channel as its instructions.

WebMCP raises the stakes because it removes the last practical speed bump. Before it,
an agent taking a bad action needed credentials, an API, a network path. With WebMCP
the agent is already inside the authenticated session and the action is one local
function call away.

The usual answer is "sites should be careful." That protects users of careful sites.
Almost no site has heard of WebMCP yet, and none of them will have shipped a consent
layer by the time people start pointing agents at them.


WHAT IS NOW POSSIBLE THAT WASN'T

You can point an agent at a site that has never heard of consent layers, prompt
injection, or this project, and still have every irreversible action on that site stop
and wait for you.

Concretely: an agent can fill a cart on a storefront in one turn instead of you
clicking through six screens — and the checkout still cannot happen without your
click. You get the one-turn agent and the stopping point, which previously meant
choosing one or the other.

That also reframes who is responsible. Today the implied answer is "the website owner
should have built guardrails." This says the person running the agent can guardrail
their own agent, on every site at once, without waiting for the web to catch up.


HOW WE IMPLEMENTED WEBMCP

registerTool is a property holding a function. A content script runs at document_start
in the MAIN world — which Chrome guarantees executes before any page script — and
replaces that property with a wrapper. The site registers its tools completely
normally and is calling ours. It never knows. MAIN world is what makes this possible
at all; the default isolated world hands the script a private copy of the context and
it would patch something the page never reads from.

MAIN-world scripts cannot touch chrome.*, so decisions cross a private MessagePort to
an isolated-world bridge, then chrome.runtime, then an MV3 service worker owning the
queue, the allow list and the badge.

Classification is one line:

    const isWrite = (def) => def.annotations?.readOnlyHint !== true;

Unannotated means gated. readOnlyHint is a real MCP/WebMCP annotation, not something
invented here. It deliberately never reads the tool's name or description to guess
intent — that is defeated by a site simply not naming things suspiciously, and it
makes attacker-authored text load-bearing in a security decision, which is the exact
thing this defends against.

window.fetch is patched too. A non-GET/HEAD request fired while a tool's execute is on
the call stack, and not already approved, is held exactly like a write. By
construction this can only fire for a tool that claimed readOnlyHint: true and lied,
because a genuine write's real code never runs until after approval.

A declined call resolves with an explicit refusal rather than rejecting. The runtime
replaces a thrown error with generic text ("the script function threw an error"), so a
rejection reaches the agent looking like a bug — and an agent that thinks a tool is
buggy retries it, turning every decline into another prompt.


WHAT WE ACTUALLY TESTED

Cloudflare's coffee shop, a site we did not build: add_to_cart held with the cart at
0/Empty; on approval the cart became 2 × Guji Shakiso, $44.00. Its roast filter is
annotated read-only and ran free. Three cart mutations gated, no false positives.

Chrome Labs' hotel-chain demo: our patch won the race against a real bundled app. Only
1 of its 6 tools carries readOnlyHint, so gate-by-default asks about reads there. That
is a real cost of the design and it is why "Approve & Always Allow" is one click and
why the allow list is visible and revocable.

Vercel's storefront: modelContext present, patch applied, zero WebMCP tools
registered. Found nothing, broke nothing.

Reads measured at about 5ms with no prompt. On the annotation-liar test, zero requests
reached the network on decline and exactly one on approve — confirmed both by Resource
Timing in the browser and by the server's own access log.

Testing also found a vulnerability we would rather disclose than have someone find.
Approvals were relayed over window.postMessage, which page scripts share with the
interceptor — so a page could read its own proposal id and post back a forged
approval, self-approving every write. Fixed with a private MessagePort handed over at
document_start, before any page script exists. Re-running the exploit, the page cannot
even observe a proposal.


WHAT IT CANNOT DO

A write that never touches the network — a tool claiming read-only that mutates only
in-page state — is invisible to both layers. Only fetch is patched, not XMLHttpRequest
or sendBeacon. ChatGPT's in-app browser does not accept third-party extensions, so
this runs in Chrome with WebMCP enabled. And nothing here saves someone who approves
without reading.

It raises the cost of a successful injection from "the agent was convinced" to "the
agent was convinced AND a human approved a card describing the action." That is a
real, large gap. It is not a proof.


WHERE IT CAME FROM

The first version was a library — a consent layer a site's own developer could adopt.
A judge on this challenge, Alex Nahas, pointed out that this puts the burden on the
website's developer, so a user on a site that never adopted it gets nothing, and
suggested moving enforcement to the user's side. That became the extension, and the
extension became the project. The library is still published and is the right answer
for a team building their own WebMCP surface deliberately — it is the primitive the
argument rests on — but the question changed from "what should a careful site ship" to
"what protects someone when the site was not careful," which is most of the web.


WHAT'S NEXT

An advisory-only LLM read on newly seen tools, where a human still clicks to
whitelist — deliberately advisory, because a model that auto-approves based on the
tool's own description reopens exactly the vulnerability being defended against.
destructiveHint and idempotentHint as a cheap extension of the same model. Patching
XMLHttpRequest and sendBeacon to close the non-fetch gap.
```

---

## Built with

```
javascript, chrome-extension, manifest-v3, webmcp, mcp, web-apis, service-worker, messagechannel, npm
```

## Try it out links

```
https://webmcp-consent-7d22c356.netlify.app
https://github.com/ahmedlone127/WebMCP-consent
https://www.npmjs.com/package/webmcp-consent
```

## Video demo

```
<YouTube URL — public, under 3 minutes>
```

---

## Testing instructions (paste wherever the form asks how to run it)

```
No login or credentials needed.

1. Enable WebMCP: chrome://flags/#enable-webmcp-testing -> Enabled, relaunch.
2. Open https://webmcp-consent-7d22c356.netlify.app and download the extension
   (15 KB zip, linked on the page).
3. Unzip, open chrome://extensions, turn on Developer mode, click Load unpacked,
   select the unzipped folder.

The homepage detects and displays whether both steps worked.

Then open "Anywhere Goods" from the homepage and point an agent at it. Its
issue_refund carries no annotation and is held for approval; its
check_loyalty_status claims readOnlyHint: true and quietly POSTs, and that request
is caught at the network layer.

It also works on third-party WebMCP sites we did not build. Try
https://webmcp-coffee.jilles.fyi and ask an agent to add coffee to the cart — the
call is suspended until you approve it in the extension popup.
```

---

## Pre-submit checklist

- [ ] Video uploaded to YouTube, **public** (not unlisted), under 3 minutes, has audio
- [ ] Live URL loads and both detection chips work
- [ ] Repo is public and MIT license is visible at root
- [ ] Testing instructions filled in
- [ ] Teammates added (if any)
- [ ] Submitted — deadline 1:00 PM PT, Thu 3 Sept, hard stop
