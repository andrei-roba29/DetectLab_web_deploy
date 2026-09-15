# Prieteni / Friends — social layer (friend requests, private & group chat, event invites)

DetectLab becomes social: a **Prieteni / Friends** entry sits in the user menu
right under **Evenimente** and **Gestionează Contul** (desktop *and* the PWA
bottom bar) and opens a panel with three tabs — friends, friend requests and
chats. Friends can talk 1:1 or in group threads with an **admin**, and any chat
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
| `js/friends.js` | The whole social UI + client logic: panel, search, requests, private/group chat, media compression, per-account mirror, badges, the social buttons inside the detectorist map pins (`relationFor()` / `detectorActionsHtml()` / `decorateDetectorPopup()`), and the `window.DetectLabFriends` API used by the events and map modules. |
| `js/events.js` | „Adaugă prieteni” box in the create-event form, quota-aware deadline/creation checks, `friend_event_invite` notification modal, attendance-quota guard on accept. |
| `js/map-app.js` | The nearby-detectorist pins: `detectorSocialSlotHtml()` puts an empty social slot (account id + name) into every live/offline popup and `map.on('popupopen')` hands the popup to `DetectLabFriends.decorateDetectorPopup()`. |
| `css/styles.css` | `.detector-social-actions` / `.detector-social-btn` — the friend-request / accept / message buttons inside the popup card (next to `.detector-nearby-marker` / `.detector-offline-marker`). |
| `index.html` | „Prieteni / Friends” menu entry (desktop `#userMenu` + PWA `#pwaUserDropdown`) and the `<script>` include (after `events.js`). |
| `js/translations.js` | `nav_friends` → *Prieteni* / *Friends*. |
| `sw.js` | `js/friends.js`, `js/map-app.js` and `css/styles.css` pre-cached + cache bumped (`detectlab-v88-map-social`) so installed PWAs pick the new popup buttons up. |
| `supabase/migrations/20260915000000_social_limits_and_directory.sql` | `app_limits` (every quota), `normalise_county()`, `user_social_profiles` (searchable directory), `search_social_users()`, `list_social_counties()`. |
| `supabase/migrations/20260915010000_social_friends.sql` | `friend_requests`, `friendships` + send / cancel / respond / remove functions, `list_my_friends()`, `list_my_friend_requests()`, `get_social_counters()`. |
| `supabase/migrations/20260915020000_social_conversations.sql` | `conversations`, `conversation_members`, `conversation_messages` (RLS = members only, Realtime), direct/group functions, admin powers, `send_conversation_message()` with every limit, `cleanup_social_messages()` + pg_cron job. |
| `supabase/migrations/20260915030000_event_quotas_and_friend_invites.sql` | DB triggers for event creation / attendance / deadline / event-chat size, `get_my_event_quota()`, `invite_friends_to_event()`, `cleanup_event_chat_messages()` + pg_cron job. |
| `test-friends-social.js` | Node regression test (no jsdom): runs the real `js/friends.js` and `js/events.js` against an in-memory social server. `node test-friends-social.js`. |
| `test-map-friend-actions.js` | Node regression test (no jsdom) for the map pins: runs the real `searchNearbyDetectors()` / `addOfflineDetectorBubbles()` and the real social module, asserting which button appears per relationship and that it really calls `send_friend_request` / `respond_friend_request`. `node test-map-friend-actions.js`. |

---

## What the user sees

### 1. The „Prieteni” entry

* Desktop: avatar menu → **Gestionează Contul** · **Evenimente** · **Prieteni** · Deconectare.
* PWA bottom bar: profile dropdown → same order, with a two-people icon.
* A red badge appears on the entry when there are **pending requests + unread
  messages** (`get_social_counters()`), refreshed every 20 s and on
  `detectlab:authchange`.

### 2. Tab „Prieteni”

* **Search bar** — matches **e-mail**, **display name** or the **account id**
  prefix (`search_social_users()`), plus a **county (județ) filter** dropdown
  built from `list_social_counties()` and the counties of existing friends.
  County matching is diacritic- and label-insensitive: *Județul Cluj*, *cluj*,
 *CLUJ COUNTY* and *Jud. Cluj* are the same county (`public.normalise_county`,
  mirrored by `normaliseCounty()` in JS, same rule as `js/last-location.js`).
* Every result shows what you may do with it: **＋ Adaugă**, **Anulează
  cererea**, **Acceptă** or **💬 Chat**.
* The friend list shows name, county and a masked e-mail, with a **💬 Chat**
  button per friend (and **✕** to unfriend — which closes the private thread).
* **👥 Grup nou** opens the group creation sheet.

### 3. Tab „Cereri” (friend requests)

* **Primite** → *Acceptă* / *Refuză*. Accepting writes one `friendships` row and
  the person immediately appears in the friends list **with the chat button**.
* **Trimise de tine** → *Retrage*.
* Only one pending request per pair in either direction (partial unique index),
  never a request to yourself, never a duplicate of an existing friendship.

### 4. Tab „Chat-uri”

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
  with members, rename, remove member, leave and delete.
* **📅 Creează eveniment** inside a chat:
  * private chat → an event with **that friend**;
  * group chat → an event with **every member of the group** (friends only).
  The create-event form opens with those friends already ticked and with
  editable coordinates (map centre by default, since there is no pin behind a
  chat). After saving, the chat itself receives a summary message.

### 5. „Adaugă prieteni / Add friends” in the create-event form

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

### 6. Location live / offline a detectoriștilor pe hartă

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
  and are printed inside the popup by `friendlyError()`.
* Friend lists/requests are refreshed at most once every 15 s while tapping pins
  (`ensureDetectorSocialState()`), on `detectlab:authchange` and whenever the
  Panel reloads them.

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

The four migrations are idempotent and must be applied in order:

```bash
supabase db push          # or paste them into the SQL editor, in filename order
```

1. `20260915000000_social_limits_and_directory.sql`
2. `20260915010000_social_friends.sql`
3. `20260915020000_social_conversations.sql`
4. `20260915030000_event_quotas_and_friend_invites.sql`

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
node test-friends-social.js      # 15 checks
node test-map-friend-actions.js  # 51 checks
```

The test loads the **real** `js/friends.js` and `js/events.js` into a `vm`
sandbox with a hand-rolled DOM and an in-memory social server that reproduces
the migration rules, and asserts:

1. limits are read from `public.app_limits`;
2. search by e-mail / name / id and the county filter (incl. *Județul Cluj*
   normalisation, and never returning the caller);
3. one request per pair, requests tab, accept → both sides become friends;
4. the friends tab renders the search bar, the county filter and a 💬 button;
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
15. the migrations define the tables, triggers and cleanup jobs.

`test-map-friend-actions.js` covers the map pins end to end: it runs the real
`searchNearbyDetectors()` + `addOfflineDetectorBubbles()` against Leaflet stubs
and asserts both popups carry the slot for the right account (and that the
`popupopen` hook calls into `js/friends.js`), renders the real
`detectorActionsHtml()` for every relationship, and drives the real module in a
tiny fake DOM so that tapping „＋ Adaugă prietenie" produces a genuine
`send_friend_request` call, „Acceptă cererea" a `respond_friend_request`,
„Anulează" a `cancel_friend_request` and „Trimite mesaj" the chat flow — while a
signed-out visitor only gets sent to the sign-in dialog.

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
