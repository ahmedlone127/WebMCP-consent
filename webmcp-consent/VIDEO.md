# Demo video — shot list

Target ~3 minutes. The spine is Cloudflare's coffee shop, because it is a real
third-party WebMCP site we did not build. The cart number is the proof, so keep
it on screen the whole time.

## Before recording

- Fresh Chrome profile, WebMCP flag on, extension loaded, popup icon pinned.
- Popup → **Always Allowed** → revoke everything. A stale whitelist entry means
  a write silently runs and the whole demo dies on camera.
- Reload `webmcp-coffee.jilles.fyi` so the cart reads `CART · 0 · Empty`.
- Have `demo/unprotected.html` open in a second tab for Act 5.
- Close the DevTools console if you are driving tools from it, or at least keep
  it out of frame during the beats where the cart is the subject.

## Act 1 — this is not my site (0:00–0:25)

Show `webmcp-coffee.jilles.fyi`.

> "This is Cloudflare's WebMCP demo storefront. I didn't build it. It has never
> heard of my project, and I've never touched its code."

Show the extension icon in the toolbar.

> "This is my extension. It doesn't know anything about this site either."

That is the entire pitch. Say it in the first twenty seconds.

## Act 2 — reads run free (0:25–0:45)

Call `filter_coffees_by_roast`. The collection filters immediately. No prompt,
no badge.

> "Reads aren't gated. A consent layer that interrupts you for reads is one you
> switch off by Tuesday."

## Act 3 — the write is held (0:45–1:35)

Cart is visible and reads `0 · Empty`. Call `add_to_cart`, 2 bags of Guji
Shakiso.

Nothing happens. Let the silence sit for a beat — the cart still says `0`.
The toolbar badge shows `1`.

> "The agent's call hasn't failed. It's suspended, mid-execution, waiting."

Open the popup. The card shows the tool name, the real arguments
(`product_id: ethiopia-guji`, `quantity: 2`), and the site.

> "Not a yes/no about an opaque tool name. The actual thing that will happen."

**Click Decline.** Cart still `0`. Show what the agent received:

> `DECLINED BY OPERATOR. A human reviewed this action… Nothing was changed…
> Do not retry.`

> "The agent gets a straight answer, not a mystery error it'll retry five times."

## Act 4 — approve (1:35–2:00)

Same call again. This time **Approve**.

Cart becomes `CART · 2 · Guji Shakiso · $44.00`.

> "Identical call. The only difference is that a human clicked a button the
> agent cannot reach."

## Act 5 — the site that lies (2:00–2:40)

Switch to `demo/unprotected.html`.

> "Classification trusts the site's own `readOnlyHint`. So what happens when a
> site lies?"

Show `check_loyalty_status` — annotated `readOnlyHint: true`. Call it.

It is *not* held at the tool layer. Correct: it claimed read-only.

Then the card appears: **`check_loyalty_status → HTTP POST`**.

> "It said it was read-only. While running, it tried to POST to an enrolment
> endpoint."

Decline, then show the Resource Timing check returning `[]`.

> "Zero requests. It never left the browser."

Note on camera: the tool still returns `Loyalty status: Gold`, because the page
swallows its own error. Say so — the site lying about the outcome as well as
the annotation is a better beat than a clean failure.

## Notifications

A held call also raises a desktop notification naming the tool and its
arguments. It has no buttons — Chrome on Windows renders them but reports no
clicks back to the extension, so they were removed rather than shipped dead.
If you show it, show it as the alert ("something is waiting"), then open the
popup to decide.

## Act 6 — close (2:40–3:00)

Popup → **Always Allowed** → show an entry → **Require approval again**.

> "Reads free. Writes held. The allow list visible and revocable — because a
> cache you can't see or undo isn't consent."

Close on the honest limit:

> "It can't see a write that never touches the network. That's in the README,
> along with everything else it can't do."

## Do not

- Do not present a scripted agent run as spontaneous. If a model was told to
  take the injection bait, say so on camera. In a security submission an
  unlabelled staged failure is the thing that unravels under a judge's poke.
- Do not claim "works on every site." It works on WebMCP sites; Vercel's
  storefront registers no WebMCP tools at all and the extension correctly does
  nothing there.
