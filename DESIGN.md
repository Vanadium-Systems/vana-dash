# DESIGN.md: the UI system of VanaDash

What is fixed here applies to every new screen and every screen you touch. It changes in this
file, not in a page. The interface is in Romanian for now, so the labels quoted below are the
Romanian ones the app shows.

Since 2026-11 VanaDash follows the **Vanadium style**, shared with the other Vanadium products: the
work screens are the *instrument* (warm stone white by day, deep blue at night, Onest, the V blue on
everything you can press, turquoise on what is lit right now, radii 4 / 6 / 10, 50px rows), and
Home is the *landscape* (a window with a photo that follows the time of day, the resin light on
"what you have to do"). The source of the values is `stil-tokens.css` in the
`saas-design-arhitect` skill; the token names below are the ones this repo already had, with the
style's names added as aliases so the products speak the same language.

## Who it is for

One technical person who is in the app all day, mostly on the dark theme, on the phone in the
morning, and colleagues with different roles who are not all technical. **One density for
everyone** (decided 2026-11-15): row 50, control 36 (40 under 600px), gaps 20, page margins
28 / 20. The dense step (32) and `data-density="comfortable"` are gone as a second system. If the
daily screens feel too sparse, the one place to change is `--row-h`, not the screens.

**The target screen is 1280×624** (a 1920×1080 laptop at 150%); everything works down to
960×468 and up to 1920×936. The page header scrolls away; sticky areas take at most a third of
the height; the main action of a screen is visible without scrolling at 1280×624.

| Screen | Archetype |
|---|---|
| Home | personal start page, the expressive layer (window, resin, figures, widgets) |
| Email, Invoices, Reconciliation, Alerts, Calendar | triage / console |
| Financials, Investments | analytics |
| Clients and the client sheet, Team, Modules, Notes, Archive | admin / CRUD |
| Settings, My profile | settings |

## Two layers

| | Work screens (lists, forms, reports) | Moments (Home, the peak success, popups) |
|---|---|---|
| Background | `--background`, flat | the **window** (Home only) |
| Material | opaque surfaces, fine lines | the **resin** (`.rasina`) |
| Motion | feedback, 150 / 300ms | slow breathing (18s), the horizon drawn under the toast |
| Colour | ~90% neutral, ~5% states, ~5% action | the window's light on the resin |

The resin is allowed in four places only: the active item in the sidebar, popups (menus, Ctrl K,
toasts), the "Următorul pas" card and the button on the Home window. Anywhere else it stops
meaning anything (`grep -rn "rasina" frontend/src` is part of review). The window exists only on
Home.

## Tokens (`frontend/src/index.css`, `tailwind.config.js`)

Existing names are not renamed: they get the style's values. HSL triplets, as shadcn expects.

| Style token | Repo token | Light | Dark |
|---|---|---|---|
| `--bg` | `--background` | `#f2efe9` stone white | `#070d1c` deep blue, not black |
| `--surface` | `--card`, `--popover` | `#fbfaf7` | `#0c1528` |
| `--surface-2` | `--surface-raised`, `--surface-overlay` | `#fff` | `#111c33` |
| `--sunken` | `--muted`, `--secondary` | `#ebe7df` | `#081022` |
| `--text` | `--foreground` | `#16191e` | `#e6ecf7` |
| `--text-2` | `--muted-foreground` | `#545961` | `#9ba8c1` |
| `--text-3` | `--text-3` (new) | `#666b72` | `#8490ab` |
| `--line` / `--line-ctl` | `--border` / `--input` | 10% ink / `#817e78` (3.9:1) | 9% / `#546899` (3.1:1) |
| `--act` | `--primary`, `--ring` | `#0a5fd8` | `#4f95ff` |
| `--glow` | `--glow` | `#088c95` turquoise | `#46e0de` |
| `--glow-ink` | `--glow-ink` (new) | `#07757c` | `#46e0de` |
| `--ok / --warn / --err` | `--success-text / --warning-text / --destructive-text` | `#287245` / `#955706` / `#bf3528` | `#5cc28a` / `#e2a640` / `#ff6f62` |
| `--brand` | `--brand` (new, `data-product="dash"` on `<html>`) | `#4d8fe6` | same |
| `--s0..--s3`, `--hatch` | same names, read by `chart-colors.ts` | | |
| `--r-s/--r-m/--r-l` | `rounded-sm` 4 / `rounded-md` 6 / `rounded-lg` 10 | | |
| `--ctl-h` | `--control-md` = 36 (40 under 600px); `--control-sm` = 32, row actions only; `--control-lg` = 40 | | |
| `--row-h` | `--row-h` = 50 (new) | | |
| `--dur` / `--dur-l` | `--duration-fast` 150 / `--duration-screen` 300; `--duration-standard` 200 stays for the tab line | | |
| `--ease` / `--ease-long` | `--ease-out` `cubic-bezier(.22,1,.36,1)` / `--ease-mercury` `(.16,1,.3,1)` | | |
| `--glass` | `.glass`: 70% material, 18px blur (minimum 40% and 8px) | | |

**Colour has roles, not hues.** `--primary` (the V blue) is what you can press: the main button,
a link, a tick, focus. `--glow` (turquoise) is what is lit *now*: the selected row
(`--glow-soft`), a synced state, the loading trail, what just changed. `--brand` is identity only:
the mark, the icon of the active page, the main series of a chart; never a button. Green, amber
and red are states only, each with its text pair. Attention is said with `--warning` /
`--destructive`, not with light: `.glow-attention` uses them.

**Type.** Onest (variable, OFL, self-hosted in `public/fonts/`, latin + latin-ext), weights
400-700, `font-display: swap`. Body 14, table row 13.5, labels 12, page title 24 / 600 with
`-0.02em`. **Mono only on codes** (CUI, IBAN, invoice and declaration numbers, API keys), not on
every number. **Tabular figures only where numbers are compared vertically** (amounts and
quantities in a column, KPI figures); on dates and document numbers Onest's `tnum` spaces the
digits apart. Icons: lucide, 16px, stroke 1.6, filled on the active page in the nav.

There is no `text-2xs`: the minimum is `text-xs` (12px), and only for labels.

## Components (`frontend/src/shared/components/ui/`)

One family, one primitive. A domain component is built on top of it and adds data, not looks.

| Family | Primitive | Allowed variants |
|---|---|---|
| Button | `Button` | `default` (V blue, one per screen), `outline` (secondary), `ghost` (icons, row actions), `destructive` (only in `ConfirmDialog`). Sizes: `md` 36 (default), `icon` 36; `sm` 32 and `icon-sm` 32 **only for row actions**. Text never wraps. At most 1 primary + 2 secondary in sight, the rest in `⋯` |
| Field | `Input`, `Textarea` | one; amounts with `inputMode="decimal"` + `parseRoDecimal` |
| Time | `TimeInput` | one; text `HH:MM`, always 24h |
| Pick from a list | `Select` | one list for the whole app: a button + a listbox of our own (no visible native `<select>`), the width of the field, max 320px tall with its own scroll, long options cut with `…`, opens downwards and flips up only with less than 200px below, a search field above 7 options, arrows / Home / End / Enter / Esc / type-ahead. The API is unchanged (`value`, `onChange` with `e.target.value`, `onValueChange`, `options` or `<option>` children), so the 130 call sites did not move. Written by hand on purpose: no Radix Popover in the repo, and `@radix-ui/react-select` would not take `<option>` children, so every call site would have changed. With 5 visible options or fewer, use segments |
| On/off with immediate effect | `Switch` | two states; `sm` 16px in table rows, `md` 20px |
| Checkbox | `Checkbox` | one; outline at 60% at rest, full on hover, focus and when checked; indeterminate state |
| The reason on a control | `Tooltip` | hover **and** focus; on touch the reason sits under the control |
| Label + error | `Field` | label above, "(opțional)", error under the field |
| Confirmation | `ConfirmDialog` | the title names the object, the body states the consequence, the button carries the verb, focus starts on "Anulează" |
| Empty state | `EmptyState` | `new` (nothing yet, one action, optionally a marked demo row) / `filtered` (another screen: the active filters and "Șterge filtrele") |
| State | `StatePill` | `neutral` / `success` / `warning` / `critical`; text is mandatory |
| Neutral label | `Badge` | labels and counts, never a state; no "Nou" / "Beta", no zero counters |
| Global search | `CommandPalette` | Ctrl K / ⌘K, no animation |
| Overlay | `Dialog`, `DropdownMenu` | a Dialog for a confirmation or a short form |
| Message in the page | `Alert` | tone `neutral` / `success` / `warning` / `critical` |
| Authentication | `AuthLayout` | one frame for login, reset and invitation |
| Toast | Sonner (`ui/sonner` setup in `App.tsx`) | one look: text (+ a second line), then **[action with outline] [× with `aria-label`]** on one row, centred; stays while the pointer is on it; sits above the selection bar; errors do not close by themselves. The peak moment (a payment received) draws its tick in 700ms and the horizon passes under it |
| Loading | the trail | a 2px turquoise line under the top bar, shown only after 300ms; old data stays on screen until the new data arrives |
| Table | `table.tsx` | row 50, no vertical borders, zebra at 2.5% of the text colour, the selected row lit with `--glow-soft`; who the row is + how much in `--foreground` / 500, the rest `--muted-foreground`, references (codes, numbers, times) `--text-3`; 30px of air after a numbers column. Column priority and `<TableDetails>` stay (no horizontal scroll, ever) |

Any `h-*`, `text-*`, `rounded-*` or `px-*` put on a control inside a page is an undeclared
variant: it either goes into `ui/` with the reason written down, or it is deleted. The same
holds for a native `<select>`, `<input>` or `<button>` outside `ui/`, apart from the exceptions
that carry a comment (the cells of the calendar grid, the favourite star).

## Navigation

`NAV_ITEMS` in `shared/lib/nav-items.ts` is the only source (sidebar, bottom nav, the editor in
My profile, Ctrl K). Routes do not change: they are in push notifications, in the Android app
and in the saved `nav.layout`. The `feature` field is the page's gate (the catalog in the
backend's `shared/lib/features.ts`): without it the item is gone from the nav, from Ctrl K and
from the bottom nav. It is missing only on pages with no feature of their own: Today, Team
(any active person has to be able to write to a colleague) and Settings.

| Group | Items |
|---|---|
| Azi | Azi, Asistent |
| Bani | Facturi, Financiar, Reconciliere, Clienți, Licitații, Investiții |
| Lucru | Email, Mesaje, Calendar, Arhivă, Notițe |
| Sistem | Echipă, Module, Istoric, Alerte, Platforme, Server, Setări |

Group labels are `text-xs text-muted-foreground`, without `uppercase`. Merged pages: Reports is
a tab in Financials (`?tab=rapoarte`), Plan and Wishlist are tabs in Notes, Crypto and Stocks
sit under one "Investiții" item with a switch in the header. The old routes redirect. The hosts
are in `shared/components/layout/PageSection.tsx`: they give the section title and the tabs
through `PageHeader`, and the modules do not import one another.

**Tabs have two looks, one component.** The page's own tabs use the sliding line
(`<TabsList>`); views of the same list inside a page use `<TabsList variant="segmented">`
(Notes / Archive / Trash, Personal / Company, the Archive views), so two rows of tabs never look
alike. Choices that only narrow a list (Personal / Company, Needs / Wants in Wishlist) are not
tabs at all: they go in the "Filtru" menu with removable chips (`ui/filter-chip.tsx`).

**Help** (Support, Guides, What's new) has no nav items. They are pages opened rarely, so they
live in the account menu at the bottom of the sidebar, each with its unread count and with a
dot on the avatar. The "?" next to a page title shows only where there are guides for the
features the person has, and opens `/help` filtered to that page.

## Access (the feature catalog)

`useMe()` (from `/api/auth/me`) is the only source: `can('facturi.emitere')` hides what the
person cannot do, and the server remains the one that refuses. Three places are mandatory: the
nav (through `feature` in `NAV_ITEMS`), the tabs (`PageSection`) and the action buttons. A route
opened directly goes through `RequireFeature` (`shared/components/AccessDenied.tsx`) and shows
"Nu ai acces la X. Cere-l de la <admin>", not a 404. On a 403 `FEATURE_FORBIDDEN`, `api.ts`
reloads `/me` by itself, so a role change shows without reloading the page.

## Conventions

**Forms.** The label goes above, with no placeholder standing in for it, and "(opțional)"
instead of an asterisk. Validation happens on submit, the values are kept, and the message
under the field says what to do ("Introdu suma în lei"), never "invalid". Amounts use
`inputMode="decimal"` and accept both `1.234,50` and `1234.5`.

**Deleting.** No `window.confirm`. What can be undone gets a toast with "Anulează". What
cannot gets a `ConfirmDialog`: "Șterge clientul Acme SRL" / "Clientul și cele 12 facturi legate
se șterg." / a button that says "Șterge clientul".

**Language and formatting.** Texts come from `src/locales` through `t()`, never from a literal
in a component. Numbers, money and dates go through `shared/lib/format.ts`, which formats in
the language of the interface (`ro-RO` or `en-GB`) and always in the company's time zone (from
the company sheet, `companyTimeZone()`), wherever the reader is. The
plural with "20 de …" comes from the plural forms in the Romanian files. An amount shows the
currency the server sent; one converted to the person's display currency has "≈" in front and
a line under the group saying so, not just a different color. Search ignores diacritics,
including the cedilla forms ş/ţ. English labels are checked at 390px: they run longer.

**Settings.** They belong to the company (profile, AI providers, jobs, exchanges, the Android
app). What belongs to the person (name, password, notifications, push on this device, menu) is
in **My profile** (`/me`), from the account menu.

**States.** A skeleton with the proportions of the content, not a spinner that shifts the
layout. Two kinds of empty (`EmptyState`). An error says what comes next and, where it makes
sense, "Încearcă din nou". Synced areas show "actualizat acum X".

**Motion.** What starts from the keyboard is not animated (Ctrl K, moving through lists). Hover
is instant on enter. Only `transform` and `opacity`, with named properties, never `transition-all`.

| Level | Token | For |
|---|---|---|
| fast | `--duration-fast` 150ms, `--ease-out` `(.22,1,.36,1)` | menus (`.menu-pop`, from `scale(.96)` at the trigger's corner), tooltips, presses, the checkbox tick, side peek |
| standard | `--duration-standard` 200ms | the line under the active tab (slides), toasts |
| screen | `--duration-screen` 300ms, `--ease-drawer` | bottom sheet, the "Mai mult" drawer, page cross-fade, progress bars (`scaleX`) |
| expression | 18s breathing, 700ms tick, 1400ms horizon | the resin, the peak toast; Home only, and only at `motion=full` |

Rows of a list never fade in. The person's motion setting (My profile) has three levels: `full`
(everything above), `reduced` (no movement or breathing, the fades that explain a change stay),
`off` (nothing moves). `prefers-reduced-motion` maps to `reduced` until the person picks.

**Glass and light.** What floats over content (menus, toasts, Ctrl K, the selection bar, the
bottom sheet) is `.glass`: 70% material with an 18px blur, solid where `backdrop-filter` is
missing; at most two blurred surfaces visible at once, and the blur is the first thing to go if a
phone stutters. Light is a signal: turquoise `--glow` on what is lit now; attention
(`.glow-attention`, a critical alert, a server down) uses `--warning` / `--destructive`.

**Charts.** Neutral, with only today / what matters lit in the V blue; horizontal fine grid; bars
with 4px rounded ends; the annotation on the chart itself. The comparison with the previous period
is the same hue, dotted. Estimates and forecasts are hatched (`--hatch`); hatching is for data,
never for disabled buttons. Categories use `--s1..--s3` and `--s0` (grey for "the rest"); on the
light theme `--s3` and `--s0` are under 3:1, so their series always carry a written label. The
shape follows the question: columns per day with today and the peak lit ("how much today"), a line
against last month ("are we doing better"), cumulative towards the month's end with the hatched
forecast ("will we get there"), one 28px split bar with percentages ("what the month is made of"),
horizontal ranked bars ("who brings the most"). Not used: pie, funnel, stacked columns, the gauge.

**Figures and money.** An amount: tabular, right-aligned, the decimals at 0.73 of the size and in
`--muted-foreground` (`<Money>`); incoming coloured, outgoing with a minus, not red. Colour says
good / bad, not up / down. A delta is written in percent **and** in value, with the period
("+12% · +4.820 lei față de octombrie"). A figure you can inspect has a dotted underline; clicking
it opens "where it comes from" under the band of figures. An estimate has `~`.

## Where VanaDash differs from the style, and why

- **Navigation** keeps its 21 destinations in the groups Azi / Bani / Lucru / Sistem; regrouping
  would move people away from what they are used to and is left for a later decision.
- **The phone** keeps the existing bottom bar and "Mai mult" drawer (the style's 4-section bar is
  the same idea).
- **The small moments** of the style (the lamp, the evening band, the empty list in penumbra) are
  not in this sprint; the demo row of an empty list is.
- **Category colours** a person picks (calendar, folders, prospect statuses) keep the `--tag-1..8`
  palette: they are the person's own labels, not the product's states.
- **Sound**: the payment chime is synthesised with WebAudio, not a sound file, so there is no
  licence to track; it is off by default (`users.sound_on`).

## The screens colleagues use

Actions in plain sight, not on hover. Since 2026-11 every screen uses the same airy density, so these pages no longer carry a density attribute of their own.

- **Modules** (`/modules`): a role × feature matrix, grouped by page. Each `Switch` saves on
  the spot, with "Salvat" on its row; turning one off has no dialog, because it can be turned
  back on. The page row has a `Checkbox` with an indeterminate state. With "Vede pagina" off,
  the rest of the page stays saved but greyed out, with the reason written on the row
  ("Pornește întâi «Vede pagina»"). The Admin role is not editable.
- **Team**: a table with the person, the role, a state `StatePill`, the last activity, "Scrie"
  in plain sight and a `⋯` menu with the rest (role and mailboxes, invitation, password reset,
  deactivation with "Anulează" in the toast, "Atribuie folderele lui" on a deactivated person).
- **History** (`/team/history`): the "who did what" list, with its filters in the URL, so a
  link you send shows the same thing. `actor: null` is shown as "Sistem".
- **Messages**: on desktop, the conversation list on the left and the thread on the right; on
  mobile, two screens (`/messages/:id`) with a back button. Presence is text ("Activ acum",
  "Văzut acum 5 min"), not only a coloured dot.
- **My profile** (`/me`): name, password, notifications, push on this device, your own menu.
- **Sharing** (Archive and Calendar): one dialog, `shared/components/AccessShareDialog.tsx`.
  It lists who has access, with the level changeable on the row (Vede / Editează) and "Scoate",
  then the form "Om + Nivel + Dă acces". Only the owner and the admin see it. In the Archive,
  the tabs "Spațiul meu / Partajate cu mine / Toate spațiile" appear only when something is
  shared or the person administers spaces; on a read-only folder the write buttons and drag
  and drop are gone, and the header says "al lui X, doar citire". In the Calendar, shared
  calendars are layers you tick (only your own by default), and on the grid someone else's
  event carries the person's name in its title, since colour alone would not tell them apart.

## Checks before calling a screen done

- `python3 ~/.claude/skills/saas-design-arhitect/scripts/audit_consistency.py frontend/src --ui frontend/src/shared/components/ui`:
  no new native control outside `ui/` without a comment, no geometry override on a control, no hex.
- No `window.confirm`, no `type="number"`, no raw colour primitive in a page:
  `grep -rnE 'window\.confirm|type="number"|(text|bg|border)-(gray|slate|zinc)-[0-9]' frontend/src/modules`
- No resin and no window outside Home, the active nav item and popups: `grep -rn "rasina" frontend/src`.
- Screenshots at 1280×624 and 360×780, both themes; the main action visible at 1280×624.
- `audit_fit.sh` at 360 / 768 / 1024 / 1280: no horizontal scroll anywhere.
- Text contrast on both themes (`--text-3` ≥ 4.5:1, also on the selected row).
- The screen with real data, not ideal data: long names, zero, negative values, large numbers,
  0 / 1 / 1000 items, keyboard only.
