# Changelog

Notable changes, newest first. The app is deployed continuously from `main`, so entries are
dated rather than versioned. What users see is also listed in the app, under Updates
(`frontend/src/modules/updates/releases.ts`).

## 2026-11-10: Clients: team ownership, prospecting, automations

### Team and access
- Every prospect has an owner. Without `clienti.toti` a person sees their own prospects, the free
  ones and those where they collaborate; one function (`visibleProspectsWhere`) applies this on
  every route, Ctrl K and message cards included. An object the person cannot see answers `404`.
- Claim, release, transfer (with a note), transfer and access requests, and collaborators
  (`view` / `edit`): `POST /api/prospects/:id/claim`, `/release`, `/transfer`,
  `/transfer-requests`, `PUT /api/prospects/:id/collaborators/:userId`. A transfer by someone who
  does not own the prospect and has no `clienti.repartizare` answers 200 with `skipped: notYours`.
- New features: `clienti.toti` (migration gives it to everyone who had `clienti.view`),
  `clienti.repartizare`, `clienti.export`.
- Automatic release of idle prospects (`jobs/prospect-release.ts`, settings in
  `GET/PUT /api/prospects/release-settings`); deactivating a person releases their prospects.
- In-app notifications: `GET /api/notifications`, `POST /api/notifications/read`.

### Prospect sheet
- Contact people with several phones and emails each, notes with @mentions and pinning, tasks
  with call outcomes and a next step, text snippets, stage history (`prospect_stage_events`), a
  timeline. The old `phone`, `email`, `contact_name` and `notes` columns on `prospects` are
  migrated but not dropped yet.
- Migrations 0084-0089.

### Prospecting
- One filter compiler (`filters.ts`, an allowlist) behind the list, count, aggregate, board,
  forecast, funnel, export and list-from-search routes; the list is paginated on the server.
- Saved views with stars, shared views and an alert for new results; static lists with folders and
  rules for filling them from a search.
- Board, forecast, sales funnel, per-agent numbers, a Tasks page and a full-screen call session.
- Import from `.xlsx` or `.csv` with a preview step and a token (5,000 rows), an `.xlsx`
  template, distribution between people, and export with an audit entry (10,000 rows).
- Data health and duplicates: a nightly duplicate scan, a field-by-field merge in one transaction.
- Phrase search (`POST /api/prospects/nl-filters`) over the assistant's provider.

### Automations and scoring
- Six fixed rules (reply creates a call task, bounce notifies, no next step, meeting moves the
  stage, won cleanup, import into a list) under `clienti.repartizare`.
- A configurable score (normalized criteria, live distribution preview) and signals, built-in
  and custom, that show as chips with a talking tip.

### Email sequences
- Steps of kind `email`, `call`, `task` and four LinkedIn kinds; the non-email ones become
  tasks on the prospect. A/B templates on an email step, stop rules for a meeting and for won or
  lost, enrolling a whole list, `GET /api/email/sequences/:id/diagnostics`.
- A bounce is no longer an unsubscribe: it marks the contact point and stops that address; a
  sequence with too many bounces pauses itself until a person resumes it.
- `ILIKE` patterns from user input are escaped.

### Pricing and contracts
- The calculator applies in full to a client: plan, modules, operators, work sites and setup fee,
  with an addendum when a signed contract's price or modules change. An offer can be saved on a
  prospect (`PUT /api/prospects/:id/offer`) and is applied on promotion.
- `GET /api/contracts/list` (filters `q`, `state`, paged) feeds the Contracts tab.

### Fixed
- The sheet timeline answered 500 on prospects with calls (`calls` has no creator column).
- `owner not_in` dropped free prospects.
- Tabs on the Clients page ran off the screen at 360 px.

## 2026-11-09: Calendar series exceptions, undo, reminders, new views

### Calendar
- One occurrence of a series can be moved or cancelled on its own: `calendar_event_exceptions`
  (migration 0083), keyed by `occurrence_start`. "This and following" splits the series in two.
  `PATCH` and `DELETE /api/calendar/events/:id` take `scope=occurrence|following|all` and
  `occurrence=<ISO key>`; on a recurring event both are required, else `400 SCOPE_REQUIRED`.
  Moving a series to another weekday rotates `BYDAY`.
- Every calendar write returns a `revertToken`; `POST /api/calendar/events/revert/:token` undoes it
  (60 seconds, only for its author, server-side).
- New routes: `POST /api/calendar/events/:id/duplicate` and `GET /api/calendar/events/search?q=`
  (2-120 characters, ignores diacritics, returns the next occurrence).
- Several reminders per event (`reminders: number[]`, 0-5 values, 0..40320 minutes) in
  `calendar_event_reminders`. `reminderMinutesBefore` is still accepted. The reminder job dedups per
  reminder and occurrence.
- Series are expanded on the company's wall clock. A weekly 10:00 meeting created in summer used to
  show at 09:00 after the clock change on 25 October; public booking slots had the same drift.
  Both are fixed.
- Recurring payments show in the calendar only for people with `facturi.cheltuieli`.
- `GET /api/booking/bookings` returns `call: { id, url, status } | null`.
- UI: Day, Week, Month and Agenda views; drag to move, drag the bottom edge to resize, draw a range
  to create; read view before editing; scope dialog for recurring events; undo toast and Ctrl+Z;
  period, event and view in the URL; search; keyboard shortcuts; mini month calendar; one
  "Calendars" filter instead of a row of checkboxes; more recurrence rules (monthly by date or by
  weekday position, yearly, weekdays) with the rule written out; bookings panel opened from a button.
- `db:seed:demo` adds a weekly series with a moved and a cancelled occurrence, an event with two
  reminders, a common event, a calendar share, three calls and a booking.

## 2026-11-09: Archive spaces created twice

### Fixed
- The requests of a first visit to the Archive each created a space root, so some people got
  two or three identical spaces. The root is now found or created under a per-person advisory
  lock. Migration 0082 merges same-name duplicate roots into the oldest one (subfolders, files,
  shares, stars and Trash batches move with it). A space handed over with "Assign all their
  spaces" keeps its own name and is left alone.

## 2026-11-09: Archive Trash, Notes editor, Plan drag between tiers

### Archive
- Deleting is now a move to the Trash. A folder goes with everything in it, in one batch
  (`archive_trash_batches`, `deleted_batch_id` on files and folders, migration 0080). A batch can be
  restored for 30 days (`GET /api/archive/trash`, `POST /api/archive/trash/:batchId/restore`) or
  deleted for good (`DELETE /api/archive/trash/:batchId`). `DELETE /api/archive/files/:id` no
  longer takes `permanent`, and `DELETE /api/archive/folders/:id` no longer refuses a folder that
  has content. Rows soft-deleted before the migration got a batch each, due in 30 days.
- New `jobs/trash-purge.ts` (03:30 daily) removes expired batches and their R2 objects, at most
  20 batches and 2000 objects per run, and logs to `sync_log` as `archive:trash-purge`. Files
  deleted before this release used to stay in R2 forever.
- `GET /api/archive/files` is paginated (`{ items, total, page, pageSize }`); the list used to
  stop at the first 50 files with no sign of it. Search covers folders, ignores diacritics and
  treats `%` and `_` literally.
- New routes: details with the inherited access list, stars (per person), recent files, bulk
  move / delete / put-back, folder `color`. Rename and move answer with the previous values so
  the client can undo them.
- Uploads over the storage limit answer `413 STORAGE_FULL`. The limit counts files in the Trash.
- UI: preview over the page with arrows, details panel, multi-select with drag to a folder,
  upload panel with progress and retry, Recent / Starred / Trash tabs, folder colors, undo
  after delete, move and rename.

### Notes and Plan
- Notes get a rich editor (headings, lists, checklists, `/` menu) stored as `body_json`;
  `body` stays the plain text, derived on the server (migration 0081). Old notes keep
  `body_format = 'plain'` until their first edit. Saves are continuous, with
  `expectedUpdatedAt` and `409 NOTE_CHANGED` on a conflict.
- Notes can be colored, labeled, archived and moved to a 30-day Trash. New routes cover
  archive / unarchive / restore, `DELETE /api/notes/trash`, labels, `POST /api/notes/bulk` and
  versions (`note_versions`, one per 10 minutes at most, 50 per note). The note title is optional;
  an empty note is `400 EMPTY_NOTE`. Notes appear in Ctrl K, the person's own only.
  `jobs/trash-purge.ts` also deletes notes that have been in the Trash for over 30 days.
- Plan: `PATCH /api/plan/:id/move` moves a goal to another tier and renumbers both.
  In the UI, goals are dragged between tiers and Enter adds a new goal under the current one.

### Tabs and filters
- `TabsList` has a `segmented` variant for views inside a page (Notes / Archive / Trash,
  Personal / Company, the Archive views, Media / Files in a conversation); page tabs keep the
  sliding line. The line now also follows a tab that grows after it was placed (web font swap).
- Wishlist: the two tab rows became one Filter menu with removable chips. `FilterChip` and
  `FilterMenuTrigger` moved to `shared/components/ui/filter-chip.tsx`.
- Notes: the "Create a note" bar sits under the views row and the grid is aligned left.

### Fixed
- Two copies of `prosemirror-model` were installed (`prosemirror-view` resolved its own since the
  2026-10-13 dependency update), so every keystroke read from the DOM threw "multiple versions of
  prosemirror-model" and the text was dropped. A `pnpm` override pins one version.
- Archive search results carry `updatedAt`, so the Modified column is no longer empty.
- Ctrl K no longer calls `/api/search` for people without `cautare.view` (it answered 403 and
  showed "Search failed"); it lists pages only.

## 2026-11-06: Email: Sent covers shared mailboxes, Sent by filter

### Changed
- Without `email.bulk`, the Sent folder lists the person's own sends plus everything that left
  from their mailboxes (`from_address` matched like the inbox), so a shared mailbox shows
  colleagues' and sequences' sends too.
- New `sentBy` filter on `/api/email/sends`, `/report` and `/export`: `me`, a user id, or `auto`
  (no author). Each row shows who sent it.

## 2026-11-06: Email: the Sent folder loads for everyone who sends

### Fixed
- The Sent folder was linked for every email reader but its routes (`GET /api/email/sends`,
  `/sends/report`, `/sends/export`) required `email.bulk`, so colleagues without it got a 403
  and an empty history. Reading those routes now falls under `email.trimitere`; without
  `email.bulk` the service narrows list, report and export to the person's own sends
  (`sent_by_user_id`). `/sends/recent-batches` and `/sequences` stay under `email.bulk`.
- The Sent link is shown only with `email.trimitere`, and the source and sequence filters only
  with `email.bulk`.

## 2026-11-04: Prospects: notes always visible, per-user archive

### Changed
- Archiving a prospect is per person (`prospect_archives`, migration 0079). Everyone shares the
  same prospects, but an archived one is hidden only for the person who archived it, in the list
  and in Ctrl K search. Existing archives move to the last person who edited the prospect, else
  its creator, else the platform admin. `prospects.archived_at` is dropped.
- The prospects table no longer hides the Notes column when it gets narrow (smaller window or
  larger zoom). Score sits under priority, owner under status, employees and turnover share a
  column; when the `lg` columns go, their values show under the company name
  (`.tbl-lg-fallback`), and on a phone the note and status move under the name too.

## 2026-11-04: Email: undoable send, drafts, personal settings

### Added
- Sending is delayed by 5 seconds for a new message, a reply, a forward and a draft, with an
  Undo toast that reopens the message as a draft. The send happens on the server (timer plus a
  per-minute job for restarts), once, with an idempotency key.
- Autosaved drafts, a floating compose window (minimize, two at most, full screen on a phone),
  replies written under the thread, recipient chips with Cc and Reply all, Ctrl+Enter to send. A
  second tab editing the same draft gets a conflict instead of overwriting it.
- Message rows on one line with a snippet, bold for unread, attachment chips, hover actions in
  place of the date, a selection bar instead of the toolbar on desktop.
- Threads newest first with older messages collapsed, a relative date in the header,
  previous and next arrows between emails, "Download all" as a zip (100 MB at most). A wide HTML
  email shrinks to fit the screen, with an "Actual size" switch.
- Search suggestions and filter chips (from, unread, attachment, starred, period).
- Recipient chips are checked as they are made: an unsubscribed address turns red before Send
  (`GET /api/email/recipients/check`).
- Sent: the totals are one strip whose numbers filter the list (opened, clicked, bounced, spam,
  unsubscribed); source, reaction, status and period are one Filters menu. New `engagement`
  values `opened` and `clicked` and a `status` filter on the sends list, report and export.
- Keyboard shortcuts in the list, the thread and the compose window, listed under `?`.
- My settings (`email.setari_proprii`): a signature per mailbox, an outreach cap below the
  company's, own labels and rules, and the unsubscribes and blocklist as read-only lists. Own
  rules apply only on mailboxes that belong to one person.
- API: see Email in `docs/API.md`. Migration `0078_email_ux.sql` adds `email_user_settings`, the
  scheduled-send columns on `email_sends` and the new draft fields.

### Changed
- On a phone the navigation is a drawer, the mailbox switcher is a sheet, and Reply / Forward sit
  at the bottom of a thread.
- Forwarding always includes the original attachments.

### Fixed
- A one-to-one send skipped the unsubscribe list and the outreach cap that bulk sends already
  checked. Every path now goes through one gate and an unsubscribed address answers
  `409 RECIPIENT_UNSUBSCRIBED`.
- A draft could reference any file in storage by path; only files already on the draft or on the
  source message are accepted.

## 2026-11-03: Messages: replies, reactions, sharing objects

### Added
- Reply to a message (quote in the bubble, click to jump to the original), six quick reactions,
  and the message actions on other people's messages too: hover bar, context menu with
  shortcuts (R, C, E, Del), bottom sheet on long press, swipe right to reply. Deleting offers a
  6 second undo instead of a confirm dialog.
- Sticky day chip that opens a jump-to-date menu, an "N new messages" line, a down button with a
  count of what arrived meanwhile, "typing" on a reserved line and in the list, keyboard
  navigation through messages, unread count in the tab title.
- Conversation panel: members, mute, photos and files, search inside the conversation
  (diacritics-insensitive).
- "Send to Messages" from a prospect, an emitted or received invoice, an email thread (or a
  selected passage of it), a calendar event, an Archive file and a note. `#` in the composer
  searches objects, a pasted app link becomes a card. Clients and invoices show live data to
  readers with access to the page; the other types show a snapshot and open the original only
  for people who already have access. "Ask for access" writes to whoever manages the team for
  clients and invoices (access comes with the role), and replies to the sender for the rest.
  Archive files are copied into the conversation (20 MB at most).
- File attachments show their type (PDF, document, spreadsheet, archive, media) with an icon.
- Deep links to the exact object: `/pricing?prospect=`, `/accounting?record=`,
  `/calendar?event=`, `/archive?file=`, `/notes?note=`.
- Profile, Display: motion (system, full, reduced, off) and hide amounts everywhere.
- API: see Messages in `docs/API.md`. Migration `0077_messages_share.sql` adds
  `users.motion_pref`, `users.hide_amounts`, `messages.reply_to_id`, `message_reactions` and
  `message_refs`.

### Changed
- On a phone the active tab in the bottom bar has a pill behind its icon.

## 2026-11-01: UX foundation

### Added
- Motion tokens on three levels (fast, standard, screen) plus glass and glow tokens in
  `index.css` / `tailwind.config.js`, described in `DESIGN.md`. With reduced motion the fades
  stay and the movement goes.
- Shared pieces used by the module work that follows: `useSelection` with `SelectionBar`,
  `undoToast`, `useHotkeys` with a `?` overlay, `useUrlState`, `SidePeek`, `Timeline`,
  `FileViewer` (replaces the Messages-only `MediaViewer`), `Highlight`, `Money`, `NumberRoll`,
  `ListSkeleton`, `PeriodSelect`, `Fab`, `ContextMenu`, `ResponsiveMenu` (bottom sheet on a
  phone), the touch hooks (swipe row, pull to refresh, swipe navigation) and haptics in the
  Android shell (new dependency `@capacitor/haptics`, so the APK needs a native rebuild to use it).
- Email uses them first: range selection with a floating bar, right-click menu, undo after
  archive / spam / delete, search kept in the URL, swipe to delete, attachments in the viewer.
- Nav items prefetch a page's code and its first query on hover or focus, gated by the feature
  the query needs (`shared/lib/prefetch.ts`, every page with a GET behind a feature).

### Changed
- The shell renders while the session loads and only the content waits for a page's code;
  pages cross-fade where View Transitions exist. The sidebar shows icons only on narrow screens
  and can be collapsed; "More" opens as a bottom sheet.
- Lists load as row skeletons instead of one grey block, and amounts render through `Money`.
- Empty lists use `EmptyState`, with a reset button when a filter hides everything (Notes,
  Tenders, the Alerts history filtered by a rule, the Investments market).
- The confirmation toast has a "View" action where the new object can land off screen: a new
  Archive folder, a new Calendar event, a prospect turned into a client.
- No cascading fades on list rows; toasts sit at the bottom on a phone.

### Fixed
- The Clients tab asked for the platform list without `platforme.view`, which logged a 403 for
  colleagues without it.

## 2026-10-30: Company settings instead of fixed values, Zod 4

### Changed
- Times, the outreach send window, the assistant's monthly quota and the calendar reminders use
  the company's time zone from the company sheet instead of a fixed `Europe/Bucharest`.
- Booking emails, the `.ics` invite (organizer, summary), the campaign email header, call names
  and the assistant's prompt take the company's name from the company sheet. The `.ics` has no
  `ORGANIZER` line when the company has no email.
- The Romanian county codes moved into the Romanian country pack (`countries/ro/counties.ts`).
- Zod 4.6.7 (security fix for memory exhaustion on oversized collections), with
  `fastify-type-provider-zod` 7 and `puppeteer-core` 25.16. PATCH bodies no longer fill in the
  create defaults for fields left out (`shared/lib/update-schema.ts`).
- The second `/ID` of the filled D301/D390 PDF is a truncated SHA-256 instead of an MD5.

### Removed
- The unused `SMTP_*` settings. Email goes through Resend only.

## 2026-10-30: Signature fields on generated contracts

### Added
- Contracts, annexes and addenda are generated with an empty digital signature field above every
  line that starts with "Semnătură", for signing in Adobe Reader with a qualified certificate.
  The lines are found in the rendered page, so templates edited from the UI get them too
  (`shared/lib/pdf-signature-fields.ts`, new dependency `pdf-lib`).

## 2026-10-30: Price calculator — bundles by percentage, setup by the hour

### Changed
- A bundle costs the sum of its add-ons minus its `discountPercent`, instead of a fixed `price`.
  Bundles saved with a fixed price read as 0% until edited.
- The setup fee is hours × `onboardingHourlyRate`, with `onboardingMarginPercent` on top. The
  calculator takes the estimated hours and margin; without them it uses the bundle's
  `onboardingHours` or `onboardingDefaultHours`. The per-component setup fees
  (`onboardingBase`, `onboardingOpRate`, `onboardingDeeeDelta`, `onboardingSiatdSetup`,
  `cantarSetupPrice`) are gone.
- Picking a bundle in the client form fills in its full monthly price in EUR.

### Added
- `discountPercent` on the price config: a campaign discount on the monthly price and the setup
  fee, not on equipment bought at cost.
- `GET /api/v1/integrations/vanagreen/pricing/bundles` keeps returning `price` and
  `onboardingPrice`, now computed per request.

## 2026-10-29: Company sheet as the single source

### Changed
- Invoices (UBL supplier), the D301/D390 declarations, contracts and payment confirmations read
  the company details from the company sheet (`tenants.profile`, Settings → Company details)
  through `shared/lib/company.ts`. `config.company` and `config.declarant` are gone.
- On the first start after the upgrade, the old `COMPANY_*` / `DECLARANT_*` variables are copied
  into the sheet once, over the previous settings sheet; the boot log names any field where the
  two differed. The variables are no longer in `.env.example`.
- Companies have a country, a time zone and a currency (migration 0076). `/api/auth/me` returns
  them; the frontend formats dates in the company's zone, and scheduled tasks and bookings keep
  their hours on it.

### Added
- `backend/src/countries/`: the country pack contract and the Romanian pack (seller address for
  e-invoices and declarations). A new company takes its time zone and currency from it.
- The company sheet edits VAT registration, the representative, the declarant, the postal code,
  the time zone and the currency.

## 2026-10-28: Email threading

### Fixed
- Two emails sent with the same subject to different people no longer end up in one thread.
  Threads are matched on the outside party, not on our own mailbox, which is on every thread.
  Threads already merged stay as they are.

## 2026-10-26: Calls pages and per-person checks

### Added
- Calls pages on top of the `/api/calls` backend: `/calls` (list, status filter in the URL, new
  call dialog that copies the link), `/calls/:id` (the room, in an iframe) and `/apel/:publicId`
  (the guest page, no account). Creating, joining and ending need `apeluri.manage`.

### Fixed
- Assistant conversations, their pending actions and Plan reordering are checked against the
  person asking; another person's id answers 404.
- `GET /api/email/recent-addresses` only lists addresses from the person's own mailboxes.
- `POST /api/push/test` only reaches the person's own browsers.
- A device token registered again moves to the person who registered it.
- Changing a member's role checks that a non-admin holds every feature of the new role, as the
  invitation already did.

## 2026-10-24: Alert for a declaration without a receipt

### Added
- `accounting.declaration_no_receipt`: a D301/D390 index entered more than 2 days ago with no SPV
  receipt raises one alert, checked by the daily accounting alerts job.

## 2026-10-24: Sorting the ANAF SPV emails

### Added
- `jobs/spv-notifications.ts`, every 10 minutes: reads the "Documente noi SPV" emails and the
  form 150 answers (there is no OAuth API for SPV messages; the SPV web service answers 403 to the
  e-Factura token). Routine documents are archived, receipts get the "ANAF" label and a D301/D390
  receipt sets `declaration_filings.confirmed_at`; anything else stays unread and raises the
  `accounting.spv_notice` alert. Handled emails are recorded in `spv_email_notices` (migration
  0075, with its RLS policy).

## 2026-10-24: SPV index on the declarations

### Added
- `declaration_filings` (migration 0074, with its RLS policy): the index ANAF gives after a
  D301/D390 upload, per month, set with `PUT /api/accounting/d301/filing` and `/d390/filing`.
  A filed month no longer raises the deadline alert.

## 2026-10-24: Full address on the declarations

### Fixed
- D301/D390 asked for county, locality, street and postal code in one field and got only the
  street. The address is now put together from `COMPANY_COUNTY_CODE`, `COMPANY_CITY`,
  `COMPANY_ADDRESS` and the new `COMPANY_POSTAL_CODE`.

## 2026-10-24: Declarations count invoices, not subscriptions

### Changed
- A line materialized from a recurring expense stays out of D301/D390 (and their totals and CSV)
  until it has an invoice number; it is listed as unconfirmed.

### Fixed
- D301 was filed on the company CUI; a person registered under art. 317 gets a separate VAT code
  and D301 now uses it (`COMPANY_VAT_INTRA_CODE`), the CUI only when there is none.

## 2026-10-24: Correcting declaration lines

### Added
- `PATCH /api/accounting/d301/lines/:id`: invoice number, date, amount and reverse-charge type of
  a purchase, from the Declarations tab. Recurring expenses are materialized without an invoice
  number; a missing one is now a warning instead of falling back to the record id.

### Fixed
- D390: the month went into the form padded (`08`), which matches no saved value of the month
  list, so the field showed up empty. Names, addresses and the bank now go in plain capitals.

## 2026-10-24: D301 and D390 as ANAF PDF forms

### Added
- `format=pdf` on `/api/accounting/d301/export` and `/api/accounting/d390/export`: the official
  ANAF "soft A" forms (`D301_XML_2017_260320.pdf`, `D390_XML_2020_300424.pdf`, kept in
  `connectors/anaf/declarations/templates/`) with the data written as an incremental update of
  the XFA `datasets` stream, so the Reader usage rights survive. Open in Adobe Acrobat Reader,
  press Validare, sign, upload to SPV.

### Fixed
- The D301 and D390 XML used child elements and no namespace, which ANAF does not accept. Both
  now follow the format of returns that passed validation: attributes, namespaces
  `mfp:anaf:dgti:d301:declaratie:v1` and `mfp:anaf:dgti:d390:declaratie:v3`.
- D301: EU services were only in section 4.1; they now also count in section 4 (S4 = S4.1 +
  S4.2). Reverse-charge VAT is computed from the unrounded RON base.
- D390: amounts in whole lei, one `operatie` per supplier (the form rejects duplicates), and
  `totalPlata_A` = number of suppliers + the bases.

## 2026-10-23: Local assistant provider and video calls (backend)

### Added
- A third assistant provider, `local`: any OpenAI-compatible server (llama.cpp's
  `llama-server`) reached over a private network, set with `LOCAL_AI_BASE_URL` or from
  Settings → Assistant. It is seeded switched off. Local models get a short system prompt and no
  tools, so no app data is sent to them; a refused connection or a timeout reads as "server
  offline" instead of "fetch failed".
- Video calls through Daily, backend only for now: the `calls` table (migration 0071),
  `/api/calls` for the team and `/api/public/calls/:publicId` for guests, which answers only the
  time window and, while the call is open, the room. A public booking gets its own room and the
  link in the confirmation email; a canceled booking closes it. A job closes expired rooms every
  30 minutes and keeps the duration. Requests to Daily go one at a time with a 10 s timeout, and
  a 401 or 429 stops the job and raises an alert. Without `DAILY_API_KEY` the feature does not
  exist and bookings work as before.
- The Android shell asks for camera and microphone, for the calls.

## 2026-10-19: Pull requests paused

### Changed
- Pull requests from outside the company are not accepted for now; issues still are. `CLA.md` is
  removed, along with its checkbox in the pull request template, until the terms for outside
  contributions are settled.

## 2026-10-19: Safer unsubscribe and platform URL check

### Fixed
- Unsubscribe links in emails no longer unsubscribe on open. Link scanners (Outlook Safe Links,
  antivirus gateways) open every link in a message, so `GET /api/email/unsubscribe/:token` now
  shows a confirm button and only the `POST` unsubscribes.
- One-click unsubscribe (RFC 8058) answered 415: the client posts a form body and the server had
  no parser for it. The route now accepts it, so Gmail's Unsubscribe chip works.
- A platform URL whose name resolves to a private or loopback address (`localtest.me` is
  127.0.0.1) is refused on create and edit, not only an address written as such.

## 2026-10-19: Message bubbles, read receipts and photo thumbnails

### Added
- Delivered and seen ticks: `conversation_members.delivered_up_to` (migration 0070), moved when
  the reader loads the conversation list or the thread, a `delivered` stream event and
  `receipts` on the thread. Seen comes from the existing last-read message.
- Message bubbles, with the time and the ticks inside.
- `?size=thumb` on chat image attachments: a 640px JPEG made with `vipsthumbnail` (vips-tools in
  the backend image) on first request and kept in R2. Attachments are cached as `immutable`.

### Fixed
- A thread now opens at the last message and stays there while photos load or the keyboard
  opens; sending a message always brings you down to it.
- The tender sync could insert one notice twice in a single upsert, which Postgres rejects; the
  rejection was unhandled and stopped the server. Rows are deduplicated, and an unhandled
  rejection from any job is now logged instead of ending the process.

## 2026-10-19: Prospect owners, booking language and small fixes

### Added
- Prospects have an owner (`assigned_user_id`, migration 0068): `GET /api/prospects/assignees`,
  `assignedUserId` on `PATCH /api/prospects/:id`, a "Mine" filter and a history entry on change.
- Bookings keep the language of the site page (`bookings.locale`, migration 0069). The emails
  are written in it and the cancel link uses `BOOKING_CANCEL_URL_<LANG>` when set.
- A guide for My profile. A guide may have no feature, meaning everyone sees it.
- `GET /api/assets/index-list` returns `priceKeyMissing`; the page explains the empty prices.

### Fixed
- On a 390px screen, Modules and Team were wider than the viewport: visually hidden labels in
  the table escaped its scroll container, which was not positioned.

## 2026-10-19: Blank contracts and the ANAF token alert

### Added
- `GET /api/contracts/templates/:key/blank` returns the contract, the price annex or the
  addendum as a PDF with the client's fields as dotted lines. Nothing is stored. Three buttons
  on the contract templates card call it.
- `POST /api/accounting/anaf/refresh` renews the ANAF tokens on demand, with a button on the
  ANAF card. A failure there does not mark the credentials as needing re-authorization.

### Fixed
- The `anaf_token_expiring` alert fired with under 7 days left while the nightly refresh only
  acts under 48 hours, so it warned for days about something that would fix itself. It now
  fires under 24 hours.

## 2026-10-13: Dependency and code scanning fixes

### Security
- Dependencies raised to patched releases, among them `fastify` 5.12.5, `@capacitor/android`
  8.5.3, `@tiptap/*` 3.31, `csv-parse` 7 and `react-router-dom` 7. Transitive packages that
  stayed pinned are forced through `overrides` in `pnpm-workspace.yaml`.
- `escapeHtml` in the email module also escapes double quotes, the BNR rate parser no longer
  builds a regular expression from the currency code, and `deploy.yml` runs with a read-only
  token.

## 2026-10-13: English interface and display currency

### Added
- The interface in English next to Romanian. Texts live in `frontend/src/locales` and
  `backend/src/locales`; a parity test keeps the two languages in step and a lint rule rejects
  a literal written in JSX. Each person picks a language in My profile.
- A display currency per person (RON, EUR, USD). Totals are converted in SQL at the BNR rate of
  each row's day and marked as converted; documents and declarations are not converted.
- System emails and push notifications are written in the recipient's language.
- `db:seed:demo [ro|en]`, with invented EUR and USD rates.
- `DEFAULT_LOCALE` and `DEFAULT_DISPLAY_CURRENCY` in `.env.example`.

## 2026-10-12 — Initial public release

The repository becomes public under the PolyForm Noncommercial License 1.0.0. Everything built
before this date is part of this entry; the earlier history is kept privately.

### Added
- `LICENSE.md`, `CLA.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`,
  `TRADEMARKS.md`, issue and pull request templates.
- `db:seed:demo`: invented clients, invoices, prospects, messages and metrics for a first local
  run. It refuses to run in production or on a database that already has clients.
- CI on pull requests: typecheck, lint, tests against PostgreSQL, build.
- An English `README.md`, `.env.example`, connector guide and metric key reference.
- The contract, price annex and addendum templates ship as short sample texts that say so on the
  page. An installation writes its own from the templates screen; what it saves is kept in the
  database and is not overwritten by later versions.

### Fixed
- Saving a contract template was refused when the body used the provider tokens
  (`{{prestator.nume}}` and the like), which every default body does.
- An empty database could not be migrated: migration 0065 raised an exception when no user
  existed yet. It now skips the backfill in that case.
