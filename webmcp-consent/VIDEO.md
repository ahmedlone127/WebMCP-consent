# Demo video — shot list

Built against Devpost's stated guidance: under 3 minutes (this runs ~80s),
public on YouTube, audio narration, the project working inside the first 15
seconds, and the agent using the tools as the centerpiece. No intro, no title
card, no setup, no live typing.

Spine is Cloudflare's coffee shop, because it is a real third-party WebMCP site
we did not build. The cart number is the proof — keep it in frame throughout.

## Before recording

- Fresh Chrome profile, WebMCP flag on, extension loaded, popup icon pinned.
- Popup → **Always Allowed** → revoke everything. A stale entry means the write
  runs silently and there is no demo.
- Coffee shop cart cleared to `CART · 0` (it persists — remove items by hand).
- Claude session already open, browser tool connected, **prompt already pasted
  and ready to send**. Judges are told not to watch setup; do not film it.
- Record in short clips so one bad beat can be redone alone.

## 0:00–0:14 — COLD OPEN: it works, immediately

No intro. First frame is the agent already working.

Screen: Claude session on the left, coffee shop on the right, cart visible at
`CART · 0`.

Hit send on the prompt. Claude reads the shop and calls `add_to_cart`.

**Then it stops.** Cart stays at `0`. Badge shows `1`.

> "An agent just tried to add something to a cart. It got stopped — and it's
> still waiting."

On-screen text: **`Agent call suspended — waiting for a human`**

Let the cart sit at `0` for a beat. The pause is the product.

## 0:14–0:28 — why that matters

> "This is Cloudflare's WebMCP storefront. I didn't build it and it's never
> heard of my extension. It exposed its tools normally — my extension replaced
> registerTool before the page's own scripts ran, so every write goes through
> me first."

On-screen text: **`No SDK. No code change. Nothing for the site to adopt.`**

## 0:28–0:42 — the human decision

Open the popup. Card shows `add_to_cart`, `product_id: ethiopia-guji`,
`quantity: 2`, and the site.

> "Not a yes/no on a tool name — the actual arguments."

Click **Approve**. Cart jumps to `CART · 2 · $44.00`. Claude picks straight back
up and reports the real result.

> "Same call. The only difference is that a human clicked something the agent
> can't reach."

## 0:42–1:05 — the second feature: catching a site that lies

Cut to `demo/unprotected.html`.

> "Classification trusts the site's own readOnlyHint. So what about a site that
> lies?"

Call `check_loyalty_status` — annotated `readOnlyHint: true`. It is *not* held
at the tool layer, correctly.

Then the card appears: **`check_loyalty_status → HTTP POST`**

> "It declared itself read-only. While running, it tried to POST to an
> enrolment endpoint. I patch fetch too, so the request is held before it's
> sent."

Decline. Show the Resource Timing check returning `[]`.

On-screen text: **`0 requests reached the network`**

## 1:05–1:20 — close

Popup → **Always Allowed** → an entry → **Require approval again**.

> "Reads run free — about five milliseconds, no prompt. Writes stop. The allow
> list is visible and revocable, because a cache you can't see isn't consent.
> Injected text can reach the agent. It can't reach this button."

## Optional beat, only if under time

Desktop notification naming the tool and arguments. It has no buttons — Chrome
on Windows renders them but reports no clicks back to the extension, so they
were removed rather than shipped dead. Show it as the alert, then open the
popup.

## Do not

- Do not film setup, sign-in, the extension being installed, or loading.
- Do not type live. The prompt is pre-pasted; hit send.
- Do not present a scripted agent run as spontaneous. If a model was told to
  take the injection bait, say so on camera.
- Do not claim "works on every site." It works on sites exposing WebMCP tools;
  Vercel's storefront registers none and the extension correctly does nothing.
- Do not save the good material for the end. Judges are not required to watch
  past 3 minutes and may stop far sooner.

## How this maps to the four criteria

- **WebMCP Leverage** — patching `registerTool` at `document_start` in the MAIN
  world, plus a `fetch` layer catching tools that lie in their annotations.
- **Execution** — driven on two real third-party sites, not a toy page.
- **Potential Impact** — 0:00–0:14 is the problem and the fix in one shot.
- **Creativity** — protection that needs no adoption by the site at all.
