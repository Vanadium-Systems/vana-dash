# Public booking: your website → VanaDash

Visitors of the company website book a 30-minute call. The website only ever sees free slots,
computed here from the booking hours, the blocked intervals and the calendar in VanaDash.

Booking belongs to one person: the platform admin. Slots are computed from that person's
calendar only, and the event a booking creates goes into it.

## How it works

1. The admin turns booking on in Calendar → the "Programări de pe site" panel: the switch that
   shows free hours on the website, the schedule per weekday (Bucharest time), the duration (30
   minutes), the buffer between calls, the minimum notice and how far ahead one can book.
2. The website asks for `GET /api/v1/public/booking/slots` through a server-side function of
   its own and shows only the free hours. Nothing from the calendar reaches the website apart
   from "busy" or "free".
3. The visitor picks an hour and submits the form. The website's function checks Turnstile, then
   calls `POST /api/v1/public/booking`. VanaDash recomputes the slots and, in the same
   transaction, creates the calendar event (`Apel · <name>, <company>`, with the phone icon) and
   the row in `bookings`. A partial unique index on `start_at` stops two simultaneous bookings
   of the same hour.
4. After the commit, the confirmation email goes out from the contact address (with an `.ics`
   and the cancel link), and a push "Programare nouă · <day, hour>" goes to the admin. If the
   email or the push fails, the booking stays.
5. The visitor can cancel from the link in the email. The cancel page on the website asks for a
   confirmation with a button and only then calls `POST /api/v1/public/booking/cancel`. A GET
   cancels nothing, so the link scanners in email clients cannot cancel a booking by themselves.
6. The admin can cancel from the calendar (click on the call), with or without an email to the
   visitor. "Without" is for bookings that are obviously fake.
7. 90 days after the call, `jobs/booking-purge.ts` (daily, 04:30 UTC) empties the visitor's data.

Intervals with no booking can be blocked from the panel ("Blochează"), from the new event
dialog ("Doar blochează pentru programări") or from Ctrl K ("Blochează interval pentru
programări").

There is a cap on new bookings per day, on top of Turnstile and the rate limit, so that an
attack that gets through cannot fill the calendar.

## Wiring the website

The three public routes are called server to server, never from a browser, with the header
`X-Booking-Token`. Its value is `BOOKING_TOKEN` in the app's `.env`; the same value goes into
the website's server-side secrets, together with the URL of the app. With `BOOKING_TOKEN`
empty, the routes reject every request.

The website's function is a proxy: GET → `/slots`, POST → Turnstile + validation + `/booking`,
POST with a `token` → `/cancel`. Error answers carry stable codes (`slot_taken`, `daily_cap`,
`validation`, `not_found`, `too_late`) for the website to translate.

A manual test, one request at a time:

```bash
T=<BOOKING_TOKEN>
APP=https://dash.example.com

# free slots for the next 3 days
curl -s -H "X-Booking-Token: $T" "$APP/api/v1/public/booking/slots?days=3"

# a booking on the first slot of the list above
curl -s -H "X-Booking-Token: $T" -H 'content-type: application/json' \
  -d '{"start":"<ISO from slots>","name":"Test Booking","email":"you@example.com","topic":"Integration test","consent":true}' \
  "$APP/api/v1/public/booking"

# cancelling, with the token from the link in the email (the t parameter)
curl -s -H "X-Booking-Token: $T" -H 'content-type: application/json' \
  -d '{"token":"<t from the email>"}' "$APP/api/v1/public/booking/cancel"
```

Booking starts turned off (`enabled=false`): until it is turned on from the Calendar, `slots`
is empty and every `POST` gets `slot_taken`.

## Legal

This is the reasoning the feature was built on, read from the text of the GDPR and the EDPB
guidelines. It is not legal advice. If you run this for your own company, check it against your
own privacy policy.

### What data, from whom

The form asks for a name, an email, a company (optional) and the topic of the call, plus the
hour chosen. The IP address ends up in the logs of the CDN and of the server, as for any
request. No phone number is asked for: the call happens on a link sent by email.

### The legal basis

**Article 6(1)(b) GDPR, second limb**: processing that is necessary "in order to take steps at
the request of the data subject prior to entering into a contract".

EDPB Guidelines 2/2019 on Article 6(1)(b) (version 2.0, adopted on 8 October 2019):

- §46: the basis also applies when it is not clear whether a contract will follow, "as long as
  the data subject makes the request in the context of potentially entering into a contract".
  A visitor asking about the controller's services is the example given.
- §47: it does not cover processing started on the controller's initiative (unsolicited
  marketing).

Booking a call about a project falls under §46: the request comes from the visitor, and the
data serves only to make the call happen. What follows from that:

- **No consent is needed, and there is no consent checkbox.** A box saying "I agree to the
  processing" would suggest the basis is consent (Article 6(1)(a)), which can be withdrawn at
  any time and complicates things for no reason. What is mandatory is the **information**
  (Article 13): one line under the button.
- **The confirmation email address is not reused for a newsletter or for email sequences.**
  That would be §47, with another basis and a separate agreement. In the code, `bookings` is
  not linked to `email_sequences` or to prospects.
- When a visitor books on behalf of their company, the person booking is still the one making
  the request, so 6(1)(b) holds for their data.

### Minimisation (Article 5(1)(c))

- The company is optional. The topic is capped at 1,000 characters.
- **The push notification does not contain the visitor's name.** Native notifications go
  through Firebase Cloud Messaging (Google), which sees the notification text. The text is
  "Programare nouă · Mar 29.09, 10:30"; the name is visible in the app.
- The title of the calendar event (`Apel · <name>, <company>`) stays: it lives on your own
  server, and the purge anonymises it.
- The website never receives titles or details from the calendar, only free intervals.

### Retention (Article 5(1)(e))

**90 days after the hour of the call**, `name`, `email`, `company`, `topic` and
`cancel_token_hash` become `null`, and the event title becomes "Apel (anonimizat)". Why 90 and
not less: a call is usually followed by an offer and a few emails, and context is needed for
those. If the call leads to an offer, the relevant data moves into the client records, which
have their own rules; the booking itself is no longer needed.

Cancelled bookings (by the visitor or by the admin) are purged on the same term, counted from
the hour that was booked.

### Recipients and transfers

| Who | What they see | Note |
|---|---|---|
| The CDN in front of the website (function + Turnstile) | the request passes through the function and is not stored there | list it in the website's privacy policy |
| The hosting provider of the app | the database where the booking lives | list it as a processor |
| Resend | the visitor's name and email, for the confirmation and the cancellation | list it as a processor |
| Google (Firebase Cloud Messaging) | only "Programare nouă" and the hour | it receives no visitor data, so it is not a recipient of it |

### The line next to the form (on the website)

> We use your name and email only to schedule the call and send you the link. We delete them 90
> days after the call. Details in the privacy policy.

### What the privacy policy has to say

Under the data collected: booking a call (name, email address, company name if given, the topic
and the hour chosen), what it is used for (scheduling the call, sending the confirmation with
the cancel link, preparing for the conversation), the basis (Article 6(1)(b) GDPR), where it is
stored and that it is deleted 90 days after the date of the call. Under storage periods: "Call
bookings: 90 days from the date of the call."

### The `consent` field

`consent` in `POST /api/v1/public/booking` is not an agreement. It confirms that the form
displayed the information line. The website's function always sends `consent: true`, the
`consent_at` column keeps the moment the information was shown, and the website shows **no
checkbox**.

### Sources

- Regulation (EU) 2016/679 on EUR-Lex: Articles 5(1)(c), 5(1)(e), 6(1)(b), 13 and recital 44.
  https://eur-lex.europa.eu/eli/reg/2016/679/oj
- EDPB, Guidelines 2/2019 on the processing of personal data under Article 6(1)(b) GDPR, v2.0,
  §45–47.
  https://www.edpb.europa.eu/sites/default/files/files/file1/edpb_guidelines-art_6-1-b-adopted_after_public_consultation_en.pdf
