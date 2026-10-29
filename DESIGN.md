# DESIGN.md: the UI system of VanaDash

What is fixed here applies to every new screen and every screen you touch. It changes in this
file, not in a page. The interface is in Romanian for now, so the labels quoted below are the
Romanian ones the app shows.

## Who it is for

One technical person who is in the app all day, and colleagues with different roles who are not
all technical and do not open every screen daily. So **the pages colleagues use get
`data-density="comfortable"`** on their container: the control tokens go up one step by
themselves, actions are in plain sight (not only on hover) and labels are written in full. The
daily work screens stay dense. The comfortable pages are Modules, Team, History, Messages, My
profile and the authentication steps.

| Screen | Archetype | Density |
|---|---|---|
| Today, Email, Calendar, Invoices, Alerts, Reconciliation | triage, console | dense: control 32, row 32–36, text 13–14 |
| Financials, Investments | analytics | medium |
| Settings | settings | control 36, full labels |

## Tokens (`frontend/src/index.css`, `tailwind.config.js`)

Existing names are not renamed.

| Token | Value | Used by |
|---|---|---|
| `--control-sm` / `h-control-sm` | 28px | dense table rows and row actions only |
| `--control-md` / `h-control-md` | 32px | the default: `Button`, `Input`, `Select`, nav item |
| `--control-lg` / `h-control-lg` | 36px | Settings, dialogs, forms seen rarely |
| `--success-text`, `--warning-text`, `--destructive-text` | HSL per theme, ≥4.5:1 on `--background` and `--card` | semantic text (gain or loss, states) |
| `--surface-raised`, `--surface-overlay` | dark: 9% / 12% L | elevation through the surface; the overlay is the lightest |

Primary stays near-black / near-white. Blue and the other hues live only in `chart-colors.ts`
(charts) and in the colours a person picks for categories (calendar events, prospect statuses).
There is no `text-2xs`: the minimum is `text-xs` (12px), and only for labels.

## Components (`frontend/src/shared/components/ui/`)

One family, one primitive. A domain component is built on top of it and adds data, not looks.

| Family | Primitive | Allowed variants |
|---|---|---|
| Button | `Button` | `default` (primary, one per screen), `outline` (secondary), `ghost` (icons, row actions), `destructive` (only in `ConfirmDialog`). Sizes: `sm` 28, `md` 32 (default), `lg` 36, `icon` 32, `icon-sm` 28 (toolbars, dense rows) |
| Field | `Input`, `Textarea` | one; amounts with `inputMode="decimal"` + `parseRoDecimal` |
| Time | `TimeInput` | one; text `HH:MM`, always 24h (`type="time"` takes AM/PM from the browser's language) |
| Pick from a list | `Select` (styled native) | one; with 5 visible options or fewer, use segments, not a dropdown |
| On/off with immediate effect | `Switch` | two states (`role="switch"`, no "partial"); `sm` 16px in table rows, `md` 20px |
| Checkbox | `Checkbox` | one, with an **indeterminate state** (`aria-checked="mixed"`) on the page row in Modules |
| The reason on a control | `Tooltip` | hover **and** focus; on a disabled control the wrapper takes the focus, because the control cannot. On touch the reason sits under the control (`.tooltip-bubble`, index.css) |
| Label + error | `Field` | label above, "(opțional)", error under the field |
| Confirmation | `ConfirmDialog` | the title names the object, the body states the consequence, the button carries the verb, focus starts on "Anulează" |
| Empty state | `EmptyState` | `new` (nothing yet, one action) / `filtered` (which filter to drop, with a reset) |
| State | `StatePill` | `neutral` / `success` / `warning` / `critical`; text is mandatory, outline, no solid fill |
| Neutral label | `Badge` | labels and counts, not states |
| Global search | `CommandPalette` | Ctrl K / ⌘K, no animation; on mobile from "Caută" in the "Mai mult" menu |
| Overlay | `Dialog`, `DropdownMenu` | a Dialog for a confirmation or a short form |
| Message in the page | `Alert` | tone `neutral` / `success` / `warning` / `critical`, title + line + action; next to what caused it, not a toast |
| Authentication | `AuthLayout` | one frame for login, reset and invitation: brand panel on a wide screen, form on the right |
| Toast | Sonner | actions over several objects, undo; errors do not close by themselves |

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

**Help** (Support, Guides, What's new) has no nav items. They are pages opened rarely, so they
live in the account menu at the bottom of the sidebar, each with its unread count and with a
dot on the avatar. The "?" next to a page title shows only where there are guides for the
features the person has, and opens `/help` filtered to that page. All three carry
`data-density="comfortable"`.

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
is instant on enter. Dialogs and popovers use `--ease-out`, under 300ms, from `scale(.96)`. Only
`transform` and `opacity`, with named properties, never `transition-all`.
`prefers-reduced-motion` keeps the fades and drops the movement.

**Mobile (the Android app).** Hover only under `(hover: hover) and (pointer: fine)`; `:active`
for feedback; inputs at 16px on `pointer: coarse` so they do not zoom; `100dvh`; safe areas on
fixed bars.

**Charts.** One hue for the main series; the comparison is the same hue, dotted. The palette in
`chart-colors.ts` is not used for UI.

## The screens colleagues use

All with `data-density="comfortable"` and with actions in plain sight, not on hover.

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

- No `window.confirm`, no `type="number"`, no raw colour primitive (`gray-400`) in a page:
  `grep -rnE 'window\.confirm|type="number"|(text|bg|border)-(gray|slate|zinc)-[0-9]' frontend/src/modules`
- No control height set in a page: `grep -rnE '\bh-(7|8|9|10)\b' frontend/src/modules` and
  read each hit.
- Screenshots at 1440 and 390px, dark and light.
- The screen with real data, not ideal data: long names, zero, negative values, large numbers,
  0 / 1 / 1000 items, keyboard only.
