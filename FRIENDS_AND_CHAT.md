# Prieteni / Friends — social layer (friend requests, private & group chat, event invites)

DetectLab becomes social: a **Prieteni / Friends** entry sits in the user menu
right under **Evenimente** and **Gestionează Contul** (desktop *and* the PWA
bottom bar) and opens a panel with four tabs — **search friends** („Caută
prieteni”), **your friends** („Prietenii tăi”), friend requests and chats.
Friends can talk 1:1 or in group threads with an **admin**, and any chat
can turn into an **event**: the create-event form also gained an
**„Adaugă prieteni” / “Add friends”** box whose ticked friends receive a real
participation request they can **accept or decline**. The same social layer now
hangs off the map: tapping a **live (orange) or offline (black/white) detectorist
pin** offers **„Adaugă prietenie”**, **„Acceptă cererea”**, the pending
*„Cerere trimisă / Anulează”* state or a **„Trimite mesaj”** button when you are
already friends.

Everything is bounded by quotas that live in a single database row
(`public.app_limits`), because an unbounded chat feature is an unbounded
storage bill.

---

## Files

| File | Purpose |
|---|---|
| `js/friends.js` | The whole social UI + client logic: panel (four tabs: „Caută prieteni”, „Prietenii tăi”, Cereri, Chat-uri), search, requests, private/group chat, media compression, per-account mirror, badges, **the notification surface `window.DetectLabNotify`** (the red badge on the profile button + the pop-up cards, incl. the realtime inbox channel `dl-social-inbox`), the social buttons inside the detectorist map pins (`relationFor()` / `detectorActionsHtml()` / `decorateDetectorPopup()` / `paintDetectorSlots()`), and the `window.DetectLabFriends` API used by the events and map modules (`searchUsers()` / `getSearchResults()` for the add-friends search). |
| `js/events.js` | „Adaugă prieteni” box in the create-event form, quota-aware deadline/creation checks, `friend_event_invite` notification modal, attendance-quota guard on accept, and `updateEventBadges()` — which reports its unread event chats to the **shared** profile badge through `DetectLabNotify.setSourceCount('events', n)` (falling back to painting `#navUserBadge` / `#pwaUserBadge` itself when `js/friends.js` is not loaded). |
| `js/map-app.js` | The nearby-detectorist pins: `detectorSocialSlotHtml()` puts an empty social slot (account id + name) into every live/offline popup and `map.on('popupopen')` hands the popup to `DetectLabFriends.decorateDetectorPopup()`; `searchNearbyDetectors()` starts only live location, and `_presenceVisible()` is the one rule that decides whether a presence row says *visible to others*. |
| `css/styles.css` | `.detector-social-actions` / `.detector-social-btn` — the friend-request / accept / message buttons inside the popup card (next to `.detector-nearby-marker` / `.detector-offline-marker`). |
| `index.html` | „Prieteni / Friends” menu entry (desktop `#userMenu` + PWA `#pwaUserDropdown`) and the `<script>` include (after `events.js`). |
| `js/translations.js` | `nav_friends` → *Prieteni* / *Friends*. |
| `sw.js` | `js/friends.js`, `js/events.js`, `js/map-app.js` and `css/styles.css` pre-cached + cache bumped (currently `detectlab-v110-social-notify`) so installed PWAs pick the profile-button badge, the pop-up notifications, the split „Caută prieteni” / „Prietenii tăi” tabs and the chat safe-area padding up. |
| `supabase/migrations/20260915000000_social_limits_and_directory.sql` | `app_limits` (every quota), `normalise_county()`, `user_social_profiles` (searchable directory), `search_social_users()`, `list_social_counties()`. |
| `supabase/migrations/20260915010000_social_friends.sql` | `friend_requests`, `friendships` + send / cancel / respond / remove functions, `list_my_friends()`, `list_my_friend_requests()`, `get_social_counters()`. |
| `supabase/migrations/20260915020000_social_conversations.sql` | `conversations`, `conversation_members`, `conversation_messages` (RLS = members only, Realtime), direct/group functions, admin powers, `send_conversation_message()` with every limit, `cleanup_social_messages()` + pg_cron job. |
| `supabase/migrations/20260915030000_event_quotas_and_friend_invites.sql` | DB triggers for event creation / attendance / deadline / event-chat size, `get_my_event_quota()`, `invite_friends_to_event()`, `cleanup_event_chat_messages()` + pg_cron job. |
| `supabase/migrations/20260916010000_social_unified_search.sql` | `search_normalise()` (case + diacritic folding) + rewritten `search_social_users()`: unified partial match across name / e-mail / county / city / id, multi-word AND. |
| `supabase/migrations/20260916020000_social_directory_projection.sql` | `mirror_social_profile()` + triggers that keep `user_social_profiles` fed from `user_last_locations` and `detector_presence` (every account that shares a location becomes searchable without ever opening the panel), a one-time backfill, and a `search_social_users()` that also browses the directory when the query is empty. |
| `test-friends-social.js` | Node regression test (no jsdom): runs the real `js/friends.js` and `js/events.js` against an in-memory social server. `node test-friends-social.js`. |
| `test-social-notify.js` | Node regression test (no jsdom) for the notifications: runs the real `js/friends.js` (and the badge contract of `js/events.js`) against an in-memory social server with a fake realtime channel, asserting the profile-button badge count, the events + social merge, and exactly when a pop-up does and does not appear. `node test-social-notify.js`. |
| `test-map-friend-actions.js` | Node regression test (no jsdom) for the map pins: runs the real `searchNearbyDetectors()` / `addOfflineDetectorBubbles()` and the real social module, asserting which button appears per relationship and that it really calls `send_friend_request` / `respond_friend_request`. `node test-map-friend-actions.js`. |

---

## What the user sees

### 1. The „Prieteni” entry

* Desktop: avatar menu → **Gestionează Contul** · **Evenimente** · **Prieteni** · Deconectare.
* PWA bottom bar: profile dropdown → same order, with a two-people icon.
* A red badge appears on the entry when there are **pending requests + unread
  messages** (`get_social_counters()`), refreshed every 20 s and on
  `detectlab:authchange`.

### 1.1 The red dot on the profile button + the pop-up notifications

Nothing waits silently: the same counters drive a badge **on the profile button
itself** and a **pop-up card** the moment something arrives.

* **Where the dot lives** — the desktop pill (`#navUser .user-trigger`, badge
  `#navUserBadge`) and the PWA trigger (`#pwaUserTrigger`, badge
  `#pwaUserBadge`), in the top-right corner, red (`#C42B2B`) with the number
  inside (`99+` when it overflows) and a soft pulse while it is non-zero.
* **What it counts** — *pending friend requests + unread chat messages*
  (`get_social_counters()`) **+ unread event chats** (`js/events.js`). Both
  modules write through `window.DetectLabNotify.setSourceCount(source, n)`
  (`'social'` / `'events'`), which renders the **sum** into those two elements,
  so neither module can erase the other's number. The „Prieteni” and
  „Evenimente” menu entries keep their own single-source badges.
* **When it drops** — reading a thread calls `mark_conversation_read()` and
  subtracts that thread's unread from the counter at once (no 20 s wait);
  accepting/declining a request re-reads the counters; logging out zeroes both
  sources and hides the dot.
* **The pop-up** (`#dlNotifyStack`, top-right under the navbar, `z-index:4400`
  — above the panels at 3500/3600 and the social modals at 4200, and
  `pointer-events:none` on the stack so the map stays clickable between cards):
  * **friend request** → 👤 *„Cerere de prietenie de la Elena Dobre”* + her
    message and county; **tap opens the panel on the „Cereri” tab**.
  * **message** → 💬 *„Mesaj nou de la Mihai Ionescu”* (or 👥 *„Mesaj nou în
    „Detectat Cluj””* for a group) + a two-line preview (🖼 / 🎥 for media) and
    the time; **tap opens that exact conversation** and marks it read.
  * ✕ dismisses, `Esc` dismisses, the card hides by itself after 9 s and the
    countdown pauses while the pointer/finger is on it; at most **3 cards** are
    stacked (the oldest is dropped) and more than 3 arrivals of one kind
    collapse into a single *„Ai 5 mesaje noi”* / *„5 cereri de prietenie noi”*
    card that opens the right tab.
* **How it notices**
  * *messages*: a permanent Realtime channel `dl-social-inbox` listens for
    `INSERT` on `conversation_messages` (already in the `supabase_realtime`
    publication, RLS = members only), so the card is instant; the 20 s counter
    poll is the fallback for webviews that suspend websockets, and it debounces
    one extra counter read 1.5 s after a frame so the dot and the card agree.
    A thread this device never loaded (a group somebody else just created) is
    fetched once so the card can name the group.
  * *requests*: `friend_requests` is not in the Realtime publication, so the
    20 s poll compares `get_social_counters()` with the counters it had before
    and announces **only what grew**.
* **What never pops** — your own message (another tab/device), a message in the
  thread you are already reading, a request while the „Cereri” tab is open, the
  same item twice (every announcement is marked in the per-account mirror under
  `inboxSeen`, so a reload is silent while the dot stays), anything older than
  7 days (a backlog is a badge, not a pop-up), and anything at all after a
  logout or an account switch (cards are cleared, the channel is removed).
* **Background tab / installed PWA** — if the notification permission was
  *already* granted, the same card is mirrored as a system notification while
  `document.hidden`. DetectLab never prompts for the permission from here.

### 2. Tab „Caută prieteni” (search friends)

* **Search bar** — **unified** partial matching (`search_social_users()`): one
  query is folded (case + Romanian/Hungarian diacritics) and matched as a
  substring against **display name**, **e-mail**, **county**, **city** or the
  **account id** prefix — `"muresan"` finds *Mureșan*, `"cluj"` matches the
  county column, and in a multi-word query (`"ana cluj"`) **every** word must
  be found in at least one column. Plus a **county (județ) filter** dropdown
  built from `list_social_counties()` and the counties of existing friends.
  County matching is diacritic- and label-insensitive: *Județul Cluj*, *cluj*,
  *CLUJ COUNTY* and *Jud. Cluj* are the same county (`public.normalise_county`,
  mirrored by `normaliseCounty()` in JS, same rule as `js/last-location.js`).
* Every result shows what you may do with it: **＋ Adaugă**, **Anulează
  cererea**, **Acceptă** or **💬 Chat**.

How the search box behaves (`scheduleSearch()` in `js/friends.js`):

* typing is **debounced by 300 ms**, so a six-letter name is one query and not
  six; clearing the box triggers a search immediately;
* an **empty query is not a dead end** — it browses the directory (newest first,
  capped), so the tab shows people to add even before you type;
* the RPC `search_social_users()` is tried first and, if the function is missing
  or fails (a project where the migrations were not applied yet), the same
  folding/matching runs **client-side** over `user_social_profiles`
  (`searchFallbackRows()`), so results never depend on one database function;
* `user_social_profiles` is **kept full by the database** (triggers mirroring
  `user_last_locations` and `detector_presence` in migration
  `20260916020000`) — before that, only accounts that had opened the panel were
  searchable, which is why searching a real detectorist used to return nothing.
* whatever the server answers is not silently swallowed: a failed search prints
  the reason in the results area (`state.search.error`).

### 3. Tab „Prietenii tăi” (your friends)

* The friend list shows name, county and a masked e-mail, with a **💬 Chat**
  button per friend (and **✕** to unfriend — which closes the private thread).
* **👥 Grup nou** opens the group creation sheet.
* An **empty list is not a dead end**: a **🔍 Caută prieteni** button jumps
  straight to the search tab.
* On phones the four tabs of the panel snap into a **2×2 grid**
  (`@media (max-width:520px)`), so „Caută prieteni”, „Prietenii tăi”, „Cereri”
  and „Chat-uri” all stay thumb-sized.

### 4. Tab „Cereri” (friend requests)

* **Primite** → *Acceptă* / *Refuză*. Accepting writes one `friendships` row and
  the person immediately appears in the friends list **with the chat button**.
* **Trimise de tine** → *Retrage*.
* Only one pending request per pair in either direction (partial unique index),
  never a request to yourself, never a duplicate of an existing friendship.

### 5. Tab „Chat-uri”

* One card per conversation: title (group) or the friend's name (private), last
  message preview, unread count, member count, `closed` marker.
* **👥 Creează grup**: a title + a filterable list of **friends only** (max
  `max_group_members`). The creator becomes **admin**: only the admin renames
  the group, adds members, removes members or deletes the group. If the admin
  leaves, the oldest remaining member is promoted automatically, and a group
  with no members left is deleted.
* Chat view: day separators, own/other bubbles, sender names in groups, images
  and videos inline, 📎 attach, live updates through Supabase Realtime with a
  6 s polling fallback (mobile webviews suspend websockets), and a **⋯** sheet
  with members, rename, remove member, leave and delete. In the installed PWA
  the chat header sits **below the phone status bar** — `html.is-pwa
  .fr-chat-panel` gets `padding-top:calc(16px + max(32px,
  env(safe-area-inset-top, 0px)))` plus an opaque `#060D1D` inset (the same
  rule as the event chat), so ← / ⋯ / 📅 stay tappable under the translucent
  system bar.
* **📅 Creează eveniment** inside a chat:
  * private chat → an event with **that friend**;
  * group chat → an event with **every member of the group** (friends only).
  The create-event form opens with those friends already ticked and with
  editable coordinates (map centre by default, since there is no pin behind a
  chat). After saving, the chat itself receives a summary message.

### 6. „Adaugă prieteni / Add friends” in the create-event form

A box in the same modal lists **all friends** (filterable), pre-ticked with
whoever the chat passed in. On save, `invite_friends_to_event()` writes for each
ticked friend:

1. an `event_inquiries` row with `status = 'pending'` — a normal participation
   request, so the existing manage-event UI keeps working unchanged;
2. an `event_notifications` row with `kind = 'friend_event_invite'`.

The invited friend gets a dedicated modal — **„Invitație de la un prieten”** —
with the event title and date and **Acceptă / Refuză**. Accepting runs the very
same `_acceptInquiry()` path as any other request (1-event-per-day check,
attendance quota, attendee row, event chat creation, outcome notification).
Inviting is restricted to the **event creator**, to **existing friends**, and
reports per person: `invited`, `already_pending`, `already_attending`,
`not_friend`, `event_full`, `invite_limit`.

### 7. Location live / offline a detectoriștilor pe hartă

A tap on **any** detectorist pin in „Vezi alți detectoriști în zonă" — the orange
live pin *and* the black/white offline bubble — opens the usual info card plus
the one social action that matches the relationship with that account:

| Relationship | What the popup shows |
|---|---|
| Stranger | **＋ Adaugă prietenie** → `send_friend_request()`; the card flips to *Cerere de prietenie trimisă* without closing the popup. |
| They already asked you | **✓ Acceptă cererea** → `respond_friend_request(accept)` (a popup is a bad place to decline somebody, so „Refuză" stays in the Cereri tab). |
| Your request is pending | *⏳ Cerere de prietenie trimisă* + **Anulează** → `cancel_friend_request()`. |
| Already friends | **💬 Trimite mesaj** → `openChatWithUser()` (private thread), same path as the 💬 button in the friends list. |
| Another device of your own account | A „Un alt dispozitiv al contului tău" note — no action. |
| Nobody signed in | No button; tapping would open the sign-in dialog. |

Notes:

* The buttons are painted **from the live friend state**, not from the markup:
  the popup only carries the account id (`data-user-id`) and the display name,
  and `map.on('popupopen')` → `DetectLabFriends.decorateDetectorPopup(popup)`
  re-renders the slot on every open (and again once the fresh lists arrive, so a
  request accepted a second ago never shows a stale button). Nothing is rendered
  for yourself, for a pin without an account id, when nobody is signed in or
  when the social module is not loaded — the map always keeps working. An
  account that opted out of search (`discoverable = false`) still shows the
  button, but the database refuses with `USER_NOT_DISCOVERABLE` and the popup
  prints the reason.
* One delegated, capture-phase `click` listener on `document`
  (`[data-social-action]`) handles every button, so Leaflet rebuilding the popup
  DOM cannot lose it or answer a tap twice; quota refusals arrive as the usual
  codes (`ALREADY_FRIENDS`, `REQUEST_ALREADY_PENDING`,
  `DAILY_REQUEST_LIMIT_REACHED:50`, `ADDRESSEE_FRIEND_LIMIT_REACHED:1000`, …)
  and are printed inside the popup by `friendlyError()`. On touch screens the
  action also runs straight from a capture-phase `touchend` listener (PWA
  webviews often never synthesise the click): a 20 px swipe guard ignores
  scrolls/drags, and a 900 ms timestamp dedup swallows the synthetic click
  when it does arrive, so a tap can neither be lost nor double-fire.
* Friend lists/requests are refreshed at most once every 15 s while tapping pins
  (`ensureDetectorSocialState()`, which first waits for the session to restore so
  a reload does not briefly look "signed out"), on `detectlab:authchange` and
  whenever the Panel reloads them.
* The buttons are repainted **in the live popup node**: `updateOpenDetectorPopup()`
  only re-measures (`_updateLayout()` / `_adjustPan()`) instead of calling
  `popup.update()`, because Leaflet's `update()` re-assigns the content string and
  would wipe the buttons that were just painted. `paintDetectorSlots()` re-queries
  the slots rather than holding on to node references, so a tap after Leaflet has
  rebuilt the popup still lands on a button that exists.
* **„Vezi alți detectoriști în zonă” starts live location only.** It never flips
  your Detect mode on — the two switches stay independent, and being seen does not
  require detecting:

  * **seen by others** = live location running **and** the „Da” answer
    (`_visibleToOthers`);
  * the **Detect** switch only decides whether your finds are recorded;
  * turning Detect **off** no longer hides you — the pin disappears when live
    location stops or the consent is withdrawn.

  Every publish site in `js/map-app.js` routes through one `_presenceVisible()`
  helper, so no code path can write a `visible` row that disagrees with that rule.
* **The consent is asked by both entry points, with the same window.** Turning the
  Detect switch (or the 🎯 live-location button) ON already asked „Vrei să fii
  vizibil și pentru alți utilizatori?” (`#visibilityModal`, Da/Nu); pressing
  „Da / Yes” in „Vezi alți detectoriști în zonă” asks it too, because wanting to
  see the neighbours is exactly the moment your own position would be published.
  `searchNearbyDetectors()` **awaits** the answer (`_promptVisibleToOthers()`
  returns a Promise; the search dialog steps aside for the question and returns
  afterwards), „Nu” still runs the search — you just stay invisible — and the
  answer is applied through the same `_presenceVisible()` helper. Programmatic
  re-activations (resume from background, auto-enable) never re-ask: they reuse
  the stored answer.

---

## Storage model — per account, not per device

The requirement was: conversations must follow the **login account**, so signing
in on another device shows the same threads.

* **Source of truth = Postgres, scoped to the account.**
  `conversations` ← `conversation_members` ← `conversation_messages`, with RLS
  that lets a signed-in user read **only threads they belong to**
  (`exists (select 1 from conversation_members …  and user_id = auth.uid())`).
  Writes are **not** allowed directly: every mutation goes through a
  `SECURITY DEFINER` function, so a browser cannot forge a membership, skip a
  quota or post into somebody else's thread.
* **Per-account local mirror (offline + instant paint).**
  `localStorage["detectlab_social_v1:<userId>"]` holds limits, friends,
  requests, conversations and the last 60 messages of each thread. The key
  contains the user id, so two accounts on the same phone never see each
  other's threads, and the mirror is what renders the panel before the network
  answers.
* **Media never enters the mirror.** Attachments are base64 data URLs; caching
  a handful of photos would blow the 5 MB browser quota. Images are also
  **downscaled in the browser** (max 1280 px edge, JPEG ~0.72) before upload, so
  a 12 MP phone photo lands in the DB as ~150 KB instead of ~8 MB. Videos are
  sent as-is but only under the attachment cap.
* The mirror itself is capped (~3 MB): it keeps the 12 most recent threads and
  trims to the last 25 messages when the budget is exceeded.

---

## Delivery guarantees (PWA report, 2026-09-17)

Two failures were reported from the installed PWA: detectorist pins that could
not be tapped, and chat messages that looked sent to the sender but never
reached the friends. Both are fixed, with regression tests pinning the fixes.

**Chat reads are member-checked and newest-first.**
`loadConversationMessages()` reads through the `SECURITY DEFINER` function
`get_conversation_messages()` (migration
`20260917000000_conversation_messages_read.sql`), which enforces membership
itself and returns the newest page (`order by created_at desc, id desc`, max
1000, the client asks for 400) — so the thread stays readable even if the
direct-`SELECT` policies on a project drift, and long threads keep showing
fresh arrivals instead of stranding on the first page ever written. A direct
`SELECT` with the same newest-first ordering stays as the fallback for
projects where the migration was not applied yet; when *both* paths fail the
chat shows a read-error notice instead of a silently empty thread.

**Every send is verified.** After `send_conversation_message()` answers OK, the
client re-reads the thread and only reports success when the new row reads back
from the same place the other members read. A send the server never stored
keeps the draft in the composer and warns loudly instead of showing „sent”.

**Pin taps survive the PWA.** Live/offline detectorist pins wrap the 32 px
visual in an invisible 44 px tap pad (`.detector-tap-pad`); the social action
runs straight from `touchend` (with a 20 px swipe guard and a 900 ms dedup
against the synthetic click that follows); refresh passes that do not change
the relationship no longer rebuild the buttons mid-tap; and the popup is never
auto-panned while the finger is down.

---

## Constraints

One row in `public.app_limits` is the single source of truth. The browser reads
it with `get_app_limits()` / `get_my_event_quota()` and prints the relevant
numbers next to the inputs; the database enforces it inside the
`SECURITY DEFINER` functions and triggers, so a second device, an old cached
client or a hand-crafted request cannot bypass anything.

| Domain | Limit (default) | Enforced by |
|---|---|---|
| Events created | **10** future events per creator | `trigger_guard_event_limits` + pre-check in the create-event form |
| Events attended | **15** future events per user | `trigger_guard_event_attendance_limits` + pre-check in `_acceptInquiry` (rolls the inquiry back to `pending` if the DB still refuses) |
| Event deadline | at most **365 days** ahead | `trigger_guard_event_limits` + the form's date check (both read `max_event_deadline_days`) |
| Invites per event | **50** pending friend invites | `invite_friends_to_event()` |
| Event chat message | **2 000** chars, attachment ≤ **5 MB**, 60/min, 2 000/day | `trigger_guard_event_chat_message_limits` |
| Event chat retention | **90 days**, plus a 5 000-message cap per event | `cleanup_event_chat_messages()` (pg_cron 03:35 + browser) |
| Friends | **1 000** per account (both sides) | `send_friend_request()`, `respond_friend_request()` |
| Friend requests | **50** sent per day, 200-char note | `send_friend_request()` |
| Groups | **50** active groups, **100** members, 60-char title | `create_group_conversation()`, `add_conversation_members()` |
| Message length | **2 000** characters | `send_conversation_message()` + `maxlength` on the textarea |
| Messages per thread | **5 000** — the oldest are dropped first, the thread never locks up | `send_conversation_message()`, `cleanup_social_messages()` |
| Message rate | **60/minute**, **2 000/day** per user | `send_conversation_message()` (+ a client-side 60/min pre-check) |
| Retention | **90 days** for every social message | `cleanup_social_messages()` (pg_cron 03:15 + browser) |
| Attachment | **5 MB** encoded | `send_conversation_message()` (`greatest(reported bytes, octet_length(media_url))`) + browser-side pre-check with the ×4/3 base64 factor |
| Storage per thread | **200 MB** of media | `send_conversation_message()` frees room by deleting the oldest media, then refuses |
| Storage per account | **500 MB** of chat media | `send_conversation_message()` |

Refusals come back as stable codes (`MESSAGE_TOO_LONG:2000`,
`RATE_LIMIT_MINUTE:60`, `EVENT_CREATION_LIMIT:10`, `ADMIN_ONLY`, `NOT_FRIENDS`,
…) that `friendlyError()` in `js/friends.js` and `eventQuotaMessage()` in
`js/events.js` translate into Romanian/English UI copy.

**Tuning a limit needs no migration:**

```sql
update public.app_limits
   set max_events_created_active = 15,
       message_retention_days = 60
 where id = true;
```

---

## Deployment

The six migrations are idempotent and must be applied in order:

```bash
supabase db push          # or paste them into the SQL editor, in filename order
```

1. `20260915000000_social_limits_and_directory.sql`
2. `20260915010000_social_friends.sql`
3. `20260915020000_social_conversations.sql`
4. `20260915030000_event_quotas_and_friend_invites.sql`
5. `20260916010000_social_unified_search.sql`
6. `20260916020000_social_directory_projection.sql`
7. `20260917000000_conversation_messages_read.sql`

Notes:

* They only **add** objects. Migration 4 attaches triggers to the existing
  `events`, `event_attendees` and `event_chat_messages` tables; those triggers
  no-op when `app_limits` has no row, so a partially applied deploy cannot break
  event creation.
* `conversation_messages` is added to the `supabase_realtime` publication by the
  migration (guarded, same as the existing event-chat one). If your project
  blocks `alter publication`, add the table in *Database → Replication* instead.
* The cleanup jobs use **pg_cron** best-effort (guarded `do` blocks, exactly like
  `cleanup_expired_event_chats`). Where pg_cron is unavailable the browser still
  calls `DetectLabFriends.cleanupRemote()` / the existing event cleanup, so
  retention is applied on the next visit.
* Profiles are created lazily: `upsert_my_social_profile()` runs when the panel
  opens, filling `display_name` / `email` from the auth user and `county` /
  `city` from `user_last_locations` when the user shared a location.
* Migration 6 adds the **directory projection**: `mirror_social_profile()` keeps
  one `user_social_profiles` row per account from the two tables that already
  have the person (`user_last_locations`, `detector_presence`), and the same
  function backfills the accounts that exist today. `discoverable` is never
  touched by the trigger — an account that hid itself stays hidden — and nothing
  is written when the row is already complete, so a location refresh (which
  happens every ~30 s) does not churn the directory. Without it,
  `send_friend_request()` answered `USER_NOT_FOUND` for everybody who had never
  opened the Friends panel.

**Graceful degradation.** If the migrations are not applied yet, the panel says
so explicitly (*„Modulul social nu este încă activ pe server: rulează migrațiile
supabase/migrations/20260915*.sql”*) instead of showing empty lists, and the
create-event form simply hides the invite results. Event creation, event chats
and every existing feature keep working untouched.

---

## Privacy and abuse

* The directory is readable **only by signed-in users**, and only rows with
  `discoverable = true` (`set_social_discoverable(false)` opts an account out of
  search entirely).
* E-mails are shown **masked** in lists (`a…na@detectlab.ro`); search still
  matches the full address because matching happens server-side.
* Friend requests and group invites require **mutual opt-in**: you can only
  message people who accepted you, and you can only invite **existing friends**
  to a group or to an event.
* Unfriending **closes** the private thread (no new messages); the history ages
  out with the retention job. Group threads are unaffected.
* Rate limits (per minute / per day) plus the daily request cap are the spam
  brake; the per-thread and per-account byte caps are the cost brake.

---

## Tests

```bash
node test-friends-social.js      # 25 checks
node test-map-friend-actions.js  # 77 checks
node test-social-notify.js       # 23 checks
```

`test-social-notify.js` covers the notification layer: the badge on the profile
button (desktop + PWA) counts requests + unread messages, `events` and `social`
add up instead of overwriting each other, reading a thread drops the dot at
once, a request/message pops a card that opens exactly what it announces, and
nothing pops for the open thread, your own message, an already-visible
„Cereri” tab, a replayed reload or a 7-day-old backlog.

The test loads the **real** `js/friends.js` and `js/events.js` into a `vm`
sandbox with a hand-rolled DOM and an in-memory social server that reproduces
the migration rules, and asserts:

1. limits are read from `public.app_limits`;
2. unified search (partial, diacritic-insensitive, across name / e-mail /
   county / city / id, multi-word AND) and the county filter (incl. *Județul
   Cluj* normalisation, and never returning the caller);
3. one request per pair, requests tab, accept → both sides become friends;
4. the panel splits „Caută prieteni” (search bar + county filter) from
   „Prietenii tăi” (friend list + a 💬 button per friend);
5. message length, attachment size and the per-thread cap (oldest dropped
   first);
6. attachments are rejected over the cap and downscaled under it;
7. group chat: title required, friends only, creator = admin, admin-only
   rename/remove, invites reach friends only;
8. the mirror is keyed per account, holds no media, and two accounts never mix;
9. a missing backend shows the migration notice;
10. the create-event form invites exactly the ticked friends;
11. a DB quota refusal is shown and never cached as a ghost event;
12. the deadline cap comes from `app_limits`, not a hard-coded year;
13. a `friend_event_invite` notification shows the event and accepting joins it;
14. the nav entry, RO/EN labels, script order and PWA pre-cache are in place;
15. the migrations define the tables, triggers and cleanup jobs;
16. the add-friends search really is wired up (debounced input, results list,
    error line) and the client-side fallback matches name / e-mail / county /
    city / id the same way the RPC does, returns nothing for a query that does
    not match, and **browses** the directory when the query is empty;
17. the directory-projection migration guards its writes (trigger on the right
    columns, INSERT-only for presence, no-op when the row is already complete,
    `discoverable` never flipped by the mirror) and ships the backfill;
18. sending through the real composer stores exactly one server-side copy and
    every send is verified by re-reading the thread;
19. the friend reads the message on his own account (a second client sandbox),
    so delivery is real and not sender-side echo;
20. long threads read newest-first (the latest page survives, the oldest
    scrolls out, no read-error notice on success);
21. without the read function the newest-first direct-`SELECT` fallback keeps
    the chat working;
22. a send the server answers-but-never-stores is reported as failed: the
    draft stays in the composer and the user is warned loudly.

`test-map-friend-actions.js` covers the map pins end to end: it runs the real
`searchNearbyDetectors()` + `addOfflineDetectorBubbles()` against Leaflet stubs
(and asserts that the magnifier only starts live location — it must never call
`toggleDetection()`), that a repaint does not destroy an already-open popup, and
that the buttons are re-painted on the node Leaflet actually kept
and asserts both popups carry the slot for the right account (and that the
`popupopen` hook calls into `js/friends.js`), renders the real
`detectorActionsHtml()` for every relationship, and drives the real module in a
tiny fake DOM so that tapping „＋ Adaugă prietenie" produces a genuine
`send_friend_request` call, „Acceptă cererea" a `respond_friend_request`,
„Anulează" a `cancel_friend_request` and „Trimite mesaj" the chat flow — while a
signed-out visitor only gets sent to the sign-in dialog. It also pins the PWA
tap fixes: both pins wrap the 32 px visual in an invisible 44 px tap pad
(`.detector-tap-pad`, centred anchor), refresh passes that change nothing must
not rewrite `innerHTML` (while a real relationship change still repaints), a
tap acts straight from `touchend` without any click, the synthetic click after
a tap does not double-fire, and a swipe across the button does not act. The
wiring part asserts the threaded-read migration ships
(`get_conversation_messages`: `SECURITY DEFINER`, member-checked,
newest-first) and that `friends.js` reads through it, sorts chronologically,
verifies every send and falls back to the newest-first `SELECT`.

The pre-existing event tests still pass unchanged
(`test-anonymous-events.js`, `test-event-chat-load.js`,
`test-event-accept-notification.js`, `test-event-multiuser-sync.js`,
`test-event-join-sync.js`, `test-event-delete-sync.js`).

---

## Deliberately out of scope (next steps)

* **Message editing / deletion by the sender** and read receipts beyond
  `last_read_at` (the column is there and already drives the unread badges).
* **Blocking / reporting** a user — today the only defence is unfriending plus
  `discoverable = false`.
* **Supabase Storage for media** instead of inline base64. Inline was chosen to
  stay consistent with the existing event chat and to keep the retention story
  trivial (deleting a row deletes its media); moving to Storage buckets means
  a lifecycle rule per bucket and signed URLs.
* **Push notifications** for friend requests and chat messages (the events
  module already has an in-app + `Notification` path that can be reused).
* **Paginated history** — the chat currently reads the newest 400 messages of a
  thread, which is below the 5 000 cap; a “load older” button would need a
  keyset page on `(created_at, id)`.
