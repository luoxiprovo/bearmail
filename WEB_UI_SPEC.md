# Stalwart Mail & Calendar Web UI Specification

Status: Draft v0.1
Date: 2026-08-04
Target server: Stalwart 0.16.16 and later compatible 0.16.x releases
Audience: Product, design, frontend, integration, QA, security, and release engineering

## 1. Product summary

Build a standalone, self-hosted web application that gives Stalwart users an integrated email and calendar experience comparable in workflow quality to Gmail and Google Calendar.

The application is a client of Stalwart, not part of the Stalwart server binary. It is distributed independently and installed with its own installer or container. On first use, a user enters the address of their Stalwart server and signs in. The application discovers the server's JMAP session and uses JMAP over HTTPS for mail, calendar, identity, submission, attachment, notification, and synchronization operations.

The first release must make calendar invitations especially easy to understand and act on from email. Invitations that are awaiting a response or have been declined remain visible in calendar views with reduced visual emphasis. Accepted invitations are shown normally.

Gmail and Google Calendar are interaction references only. The application must not depend on Google services or APIs and must not copy Google branding or protected visual assets.

## 2. Terminology and clarified invitation behavior

The phrase "didn't receive or reject the invite" is interpreted as "did not accept / has not responded to the invitation, or declined it."

The application can only display data that reached Stalwart or was imported by the user:

- If an invitation reached Stalwart and exists as a `CalendarEvent`, it can be shown in the calendar with an unanswered, tentative, accepted, or declined state.
- If the invitation exists only as an email attachment because Stalwart did not auto-add it, the email view can preview it and offer **Add to calendar**, **Accept**, **Maybe**, and **Decline**. It cannot appear in the server-backed calendar until the user imports it.
- If an invitation never reached Stalwart at all, the application has no data from which to display it.

"Half shown" means reduced visual emphasis, not clipping half of the event. Pending and declined events still occupy their real time range and remain readable and keyboard accessible.

## 3. Goals

### 3.1 Primary goals

1. Provide a fast, approachable webmail client for normal daily email use.
2. Provide day, week, month, and agenda calendar views with event management.
3. Connect email invitations to calendar events and make RSVP a one-step action.
4. Make invitation state immediately recognizable in all calendar views.
5. Install and upgrade independently from Stalwart.
6. Support a user-supplied Stalwart server URL and capability-based setup.
7. Use Stalwart's existing JMAP data and scheduling behavior without creating a second mailbox or calendar database.
8. Work well on desktop and mobile browsers and meet WCAG 2.2 AA accessibility requirements.

### 3.2 Success measures

- A new user can connect to a correctly configured server and reach their inbox in under two minutes.
- A user can accept, tentatively accept, or decline an invitation from the email view in one explicit action.
- An RSVP initiated in the web UI is visible in a second JMAP or CalDAV client without manual refresh.
- Pending and declined events are visually distinct from accepted events without relying on color alone.
- Initial inbox content is usable within 2 seconds on a typical broadband connection after authentication, excluding unusually slow server response time.
- A warm application load reaches an interactive shell within 1 second on a mid-range supported device.
- Installation does not modify the Stalwart executable, installation script, data stores, or source tree.

## 4. Non-goals for v1

- Hosting or operating a mail server.
- Direct browser connections to IMAP, SMTP, POP3, ManageSieve, or CalDAV. JMAP is the browser-facing integration protocol.
- Reimplementing spam filtering, mail delivery, recurrence expansion, scheduling delivery, or full-text indexing in the client.
- Server administration. Existing Stalwart administration remains separate.
- Contacts UI, file-drive UI, chat, video meetings, office documents, or Gmail-compatible extensions.
- Full offline mail and calendar mutation. The v1 service worker caches the application shell only.
- Importing arbitrary third-party mail providers that do not expose the required JMAP capabilities.
- Multi-account unified inbox. Multiple saved connection profiles may be added after v1.

## 5. Product principles

1. **Server state is canonical.** Client caches accelerate rendering but never become an independent source of mailbox or calendar truth.
2. **One action, one clear result.** Invitation actions update the event and send the scheduling response together when the server supports it.
3. **Progressive capability use.** The UI exposes only features advertised in the authenticated JMAP session.
4. **No invisible destructive actions.** Delete, discard draft, permanent delete, and meeting cancellation require clear semantics and appropriate confirmation.
5. **Private by default.** No third-party analytics, fonts, scripts, image proxies, or telemetry are enabled by default.
6. **Keyboard-first quality.** Every core flow is available without a pointer.

## 6. Users and key journeys

### 6.1 Mail user

The user connects their Stalwart account, reads and searches mail, organizes messages, downloads attachments, writes replies, saves drafts, and sends new messages.

### 6.2 Calendar user

The user switches between day, week, month, and agenda views; creates and edits events; manages calendar visibility; and sees updates in real time.

### 6.3 Invitation recipient

The user opens an invitation email, reviews the organizer, time, recurrence, location, conferencing link, attendees, description, and conflicts, then chooses Accept, Maybe, or Decline. The event immediately reflects the new state in the calendar.

### 6.4 Self-hosting administrator

The administrator installs the UI independently, configures its public URL and optional default Stalwart URL, upgrades it independently, and receives a setup diagnostic if Stalwart authentication, JMAP capabilities, TLS, or CORS are misconfigured.

## 7. Information architecture

Primary routes:

- `/connect` — server discovery and connection setup
- `/login` — authentication entry and callback state
- `/mail/:mailboxId?` — mailbox or search result list
- `/mail/message/:emailId` — message or thread detail
- `/mail/compose/:draftId?` — composer
- `/calendar` — calendar with the remembered view and date
- `/calendar/event/:eventId` — event detail/editor
- `/settings` — appearance, mail, calendar, privacy, connection, and session settings
- `/diagnostics` — non-secret connection and capability diagnostics

Desktop uses a persistent left navigation rail and a list/detail layout for mail. Mobile uses bottom-level Mail, Calendar, Compose, Search, and Settings navigation with full-screen detail views.

## 8. Connection and authentication

### 8.1 First-run inputs

The connection screen asks for:

1. Stalwart server URL, for example `https://mail.example.com`.
2. Email address or account name.
3. Authentication method selected from those the server supports.

An installer may provide a default server URL. If `allowCustomServers` is false, the field is displayed read-only or skipped. Credentials are never accepted as installer arguments.

### 8.2 Discovery

The client must:

1. Normalize the supplied URL and reject embedded credentials.
2. Require HTTPS except for `localhost`, `127.0.0.1`, and `[::1]` development connections.
3. Request `/.well-known/jmap` from the supplied origin.
4. Follow standards-compliant redirects, with a visible confirmation if the final origin differs from the supplied origin.
5. Fall back to `/jmap/session` only when well-known discovery returns `404`.
6. Fetch the authenticated JMAP Session resource.
7. Validate the API, upload, download, event-source, and WebSocket URLs returned by the session before using them.
8. Treat the session capability document as the source of truth instead of assuming every Stalwart feature is enabled for every account.

### 8.3 Required capabilities

Connection succeeds for the full v1 product only when the primary account advertises:

- JMAP Core
- JMAP Mail
- JMAP Submission
- JMAP Calendars

Blob upload/download and a compatible push mechanism are strongly expected. If mail is present but calendar is unavailable, the UI may enter a clearly labeled mail-only mode. If submission is absent, the UI must enter read-only mail mode rather than presenting a composer that cannot send.

### 8.4 Authentication policy

- Preferred: OAuth 2.0 Authorization Code flow with PKCE using `S256`.
- Supported fallback: Basic authentication with an application password when the administrator permits it.
- Never use the OAuth Implicit grant.
- Never persist a raw password.
- OAuth access tokens are held in memory. A refresh token may be persisted only when the user selects **Keep me signed in**, using the most secure browser storage available and with an explicit warning on shared devices.
- Basic credentials are session-only. Closing the browser session signs the user out.
- Logout clears tokens, credentials, cached message bodies, pending mutations, and push subscriptions owned by the session.

### 8.5 Setup diagnostics

Failures must identify the failing layer without exposing secrets:

- DNS or connection failure
- invalid or untrusted TLS certificate
- JMAP discovery unavailable
- browser blocked by CORS
- authentication rejected or MFA required
- missing Mail, Submission, or Calendars capability
- account lacks a required permission
- server version or wire-format incompatibility

For a CORS failure, diagnostics explain that the UI and Stalwart are on different origins and show the administrator which UI origin must be permitted. The standalone installer does not silently modify Stalwart configuration.

## 9. Email requirements

### 9.1 Mailbox navigation

- List all accessible mailboxes with hierarchy, unread count, and total count.
- Recognize Inbox, Drafts, Sent, Junk, Trash, and Archive behavior from mailbox roles rather than English names.
- Support custom folders and shared mailboxes exposed by the account.
- Allow collapsing mailbox groups and hiding empty system sections.

### 9.2 Message list

- Threaded list by default, with sender, subject, snippet, date, unread state, star state, attachment marker, and invitation marker.
- Server-side pagination or incremental windowing; do not fetch the full mailbox to render its first screen.
- Virtualize long lists.
- Multi-select actions: read/unread, star/unstar, archive, move, spam/not spam, trash, and permanent delete where permitted.
- Preserve list position and selection when returning from a message.

### 9.3 Reading mail

- Thread view with collapsed older messages and clear sender authentication details.
- Prefer safe HTML when present, with a plain-text option.
- Sanitize HTML, block active content, and isolate rendered mail from application styles and scripts.
- Block remote images by default and allow one-time or sender-specific loading.
- Render quoted content in a collapsible section.
- Preview supported image and PDF attachments; download every attachment through the JMAP download URL.
- Detect calendar MIME parts and render the invitation card defined in section 11.

### 9.4 Search

- Search subject, sender, recipient, body text, date ranges, attachment presence, unread state, flagged state, and mailbox.
- Translate search chips into `Email/query` filters.
- Display which filters are active and allow removing any filter with keyboard or pointer.
- Debounce requests and cancel superseded searches.

### 9.5 Compose, drafts, and sending

- Compose new mail and support reply, reply all, and forward.
- Support To, Cc, Bcc, subject, plain/rich body, inline images, and attachments.
- Resolve sending identities through `Identity/get` and require a permitted identity.
- Upload attachment blobs before draft import.
- Autosave by importing a replacement MIME draft, and destroy the previous draft only after the replacement succeeds; show saved/saving/error state.
- Send through `EmailSubmission/set`; never send through SMTP from the browser.
- Prevent accidental double submission.
- Keep a failed submission as a recoverable draft with the server error translated into user language.
- Warn before closing a composer with unsaved local changes.

### 9.6 Mail state synchronization

- Use JMAP state tokens and `Email/changes`, `Mailbox/changes`, and relevant `/get` calls.
- Subscribe to server push through WebSocket when advertised, otherwise EventSource, otherwise adaptive polling.
- Optimistically update reversible keyword and mailbox actions, then roll back and explain failures.
- On `stateMismatch`, refresh the affected objects, preserve the user's intent where safe, and retry at most once.

## 10. Calendar requirements

### 10.1 Views

- Month, week, day, and chronological agenda views.
- Today action, previous/next navigation, date picker, and remembered view.
- All-day area and timed grid in day/week views.
- Current-time indicator and local-time labels.
- Responsive mobile day and agenda layouts.
- User-selectable display time zone, defaulting to the browser time zone.

### 10.2 Calendar list

- Retrieve calendars with their name, color, sort order, visibility, sharing, and rights.
- Toggle a calendar without deleting or unsubscribing from it.
- Create, rename, recolor, and delete a calendar only when advertised rights allow it.
- Clearly distinguish read-only and shared calendars.

### 10.3 Event retrieval

- Query only the visible date window plus a small prefetch margin.
- Use the server's expanded occurrence/query support; do not implement an independent recurrence engine for server-backed rendering.
- Batch `CalendarEvent/query` and `CalendarEvent/get` calls where doing so remains within advertised request limits.
- Cache event summaries by account, state, and date window; invalidate them with `CalendarEvent/changes`.

### 10.4 Event creation and editing

- Create timed and all-day events.
- Edit title, calendar, start, duration/end, time zone, location, description, visibility, participants, recurrence, and alerts.
- The event form includes a **Guests** field that accepts one or more email addresses separated by commas, semicolons, or line breaks. Invalid addresses block saving with an inline error; duplicate and case-variant addresses are collapsed.
- When guests are present, create the current default `ParticipantIdentity` as the accepted chair, create each guest as an individual participant with `needs-action`, set `organizerCalendarAddress`, and call `CalendarEvent/set` with `sendSchedulingMessages: true`.
- Only the organizer may edit the guest list. Preserve participant IDs and existing RSVP states for unchanged guests; adding, removing, or changing guests sends the corresponding scheduling update or cancellation.
- Support drag-to-create, drag-to-move, and resize on desktop, with an accessible form alternative.
- Editing a recurring event must offer this occurrence, this and following occurrences when supported, or the whole series. Unsupported scopes must not be simulated silently.
- Respect calendar ACLs and the `mayRSVP`, write, share, and delete rights advertised by the server.
- Use `ifInState` for updates and show a conflict dialog when another client changed the event.
- Set `sendSchedulingMessages: true` for organizer or attendee changes that require iTIP delivery.

### 10.5 Event details

- Show title, time in event and local zones, recurrence, organizer, attendees and statuses, location, conferencing links, description, attachments, reminders, and source calendar.
- Link email-originated events back to the related message when the relationship can be determined reliably.
- Link invitation messages to **View in calendar** when a stored event is found.

## 11. Invitation and RSVP specification

This section is release-blocking.

### 11.1 Invitation detection

An email is treated as a calendar invitation when it contains a supported `text/calendar` MIME part with an iTIP method or when a related `CalendarEventNotification` identifies a created or updated event.

The client must not trust or parse calendar HTML as authoritative. It must use the calendar blob and `CalendarEvent/parse` when available. The invitation card must display the organizer and sender separately when they differ and warn about the mismatch.

### 11.2 Resolving the stored event

The client resolves an invitation in this order:

1. Use a related `CalendarEventNotification.calendarEventId` when available.
2. Otherwise parse the calendar blob and query the account for an existing event with the same iCalendar UID.
3. If exactly one event matches, link to it.
4. If none matches, present an unimported invitation preview.
5. If multiple events match, do not guess; show a conflict and let the user open calendar search results.

Duplicate UID checks are mandatory before creating an event from an email attachment.

### 11.3 Email invitation card

The card contains:

- title and invitation/update/cancellation label
- organizer identity and sender mismatch warning
- start, end, time zone, recurrence, and all-day state
- location and safe conferencing links
- description preview
- attendee summary
- conflict indicator against visible calendars when availability data is accessible
- selected destination calendar for an unimported invitation
- current RSVP state
- **Accept**, **Maybe**, **Decline**, and overflow actions

For an unimported invitation, the overflow menu also offers **Add to calendar without responding**. For an imported invitation, it offers **View in calendar**.

### 11.4 RSVP state model

The UI derives the current user's RSVP state by matching a `ParticipantIdentity.calendarAddress` to the event participant's calendar address. Matching is case-insensitive for email addresses after safe normalization.

Canonical UI states:

| UI state | Calendar participation status | Meaning |
| --- | --- | --- |
| Awaiting response | `needs-action` or absent where a reply is expected | User has not answered |
| Accepted | `accepted` | User plans to attend |
| Maybe | `tentative` | User may attend |
| Declined | `declined` | User does not plan to attend |
| Delegated | `delegated` | Another participant is responsible |
| Informational | no matching participant or reply not requested | No RSVP action is expected |

Unknown future participation values must be displayed as **Unknown response** and preserved on unrelated edits.

### 11.5 RSVP actions for an existing event

On Accept, Maybe, or Decline:

1. Read the latest event state if the cached state is stale.
2. Patch only the current participant's `participationStatus`.
3. Call `CalendarEvent/set` with `sendSchedulingMessages: true` and `ifInState`.
4. Update the invitation card and calendar optimistically while showing an in-progress state.
5. On success, reconcile with `CalendarEvent/get` and dismiss or remove the processed `CalendarEventNotification`.
6. On failure, restore the prior state and display a retryable, non-destructive error.

Changing a response later follows the same flow. A successful response must be observable from another standards-compatible client.

### 11.6 Actions for an unimported invitation

- **Add to calendar without responding** creates the event in the selected calendar with the user's status left as `needs-action`. It then appears with pending styling.
- **Accept** imports the event, sets the user's status to `accepted`, and sends the scheduling response in the same user flow.
- **Maybe** imports the event, sets `tentative`, and sends the response.
- **Decline** imports the event, sets `declined`, and sends the response so the declined event remains lightly visible as required.
- If the server cannot atomically import and respond, the client imports first, then responds, and clearly reports partial completion. It must never send a response for an event it failed to persist.
- A cancellation must not offer Accept. It shows the cancellation and updates or removes the live event according to server state.

### 11.7 Calendar rendering by invitation state

Do not apply CSS opacity to the entire event because that can make text fail contrast requirements. Use muted fills, borders, patterns, and labels while keeping text at accessible contrast.

| State | Default calendar appearance | Interaction |
| --- | --- | --- |
| Accepted or organizer-owned | Solid calendar color, normal border, full emphasis | Normal event actions |
| Awaiting response | Approximately 50% visual emphasis using a pale/hatched fill and dashed leading border; `Awaiting response` icon/label | Opens RSVP controls first |
| Maybe | Approximately 70% visual emphasis with a dotted border and `Maybe` icon/label | Opens event details and RSVP controls |
| Declined | Approximately 35–50% visual emphasis with a neutral tinted fill, dashed outline, and `Declined` label; title may be struck through when legible | Opens event details; response can be changed |
| Cancelled | Neutral muted fill, strike-through title, and `Cancelled` label | No positive RSVP action; link to source update |
| Informational | Normal calendar styling with no RSVP affordance | Normal event actions subject to rights |

Pending and declined events:

- occupy their full date/time slot;
- are shown by default;
- count as a visible conflict, but pending/declined status is disclosed in conflict details;
- can be hidden with separate **Show declined events** and **Show pending invitations** settings;
- remain distinguishable in high-contrast mode and monochrome output.

### 11.8 Notification behavior

- New and changed invitation notifications produce an in-app notification and update both mail and calendar views.
- Do not create duplicate browser notifications for the invitation email and the event notification.
- A notification click opens the invitation card or event, not a generic inbox.
- Browser notification permission is requested only after the user enables notifications in settings.

## 12. JMAP integration map

The exact wire shapes must follow the capabilities returned by the target Stalwart server. The client maintains a compatibility adapter for the supported Stalwart 0.16.x calendar draft behavior rather than blindly assuming the newest Internet-Draft revision.

| Product area | JMAP methods/resources |
| --- | --- |
| Session and limits | Session resource, Core capability |
| Mailboxes | `Mailbox/get`, `Mailbox/query`, `Mailbox/changes`, `Mailbox/set` |
| Message lists and reading | `Email/query`, `Email/get`, `Email/changes`, `Thread/get`, `SearchSnippet/get` |
| Message actions | `Email/set`, mailbox ids, keywords |
| Drafts | Blob upload, `Email/import`, supported draft updates |
| Sending | `Identity/get`, `EmailSubmission/set`, `EmailSubmission/get` |
| Attachments | upload URL, download URL, Blob methods where advertised |
| Calendars | `Calendar/get`, `Calendar/query`, `Calendar/changes`, `Calendar/set` |
| Events | `CalendarEvent/query`, `CalendarEvent/get`, `CalendarEvent/set`, `CalendarEvent/changes`, `CalendarEvent/parse` |
| Invitation identity | `ParticipantIdentity/get` |
| Scheduling changes | `CalendarEventNotification/query/get/changes/set` |
| Availability | `Principal/getAvailability` where permitted |
| Live synchronization | JMAP WebSocket, EventSource, or polling fallback |

Requests must honor the advertised maximum request size, calls per request, objects per get/set, upload size, and concurrent request limits.

## 13. Client architecture

### 13.1 Deployment shape

The v1 application is a static TypeScript single-page application and installable PWA. It connects directly from the browser to the configured Stalwart HTTPS endpoint.

Reasons for this shape:

- installation remains independent and lightweight;
- no second database contains mail or calendar data;
- no general-purpose server-side proxy introduces SSRF or credential-relay risk;
- JMAP is designed for web and mobile clients;
- Stalwart already supports JMAP discovery, OAuth with PKCE, and configurable CORS response headers.

The distribution must not load executable JavaScript, fonts, or CSS from public CDNs at runtime.

### 13.2 Recommended implementation modules

- `app-shell` — routing, navigation, error boundaries, responsive layout
- `connection` — URL validation, discovery, capability negotiation, diagnostics
- `auth` — OAuth PKCE, Basic fallback, token lifecycle, logout
- `jmap-client` — typed method calls, batching, references, limits, errors, state tokens
- `sync` — WebSocket/EventSource/polling, change reconciliation, optimistic mutations
- `mail` — mailbox, query, thread, reader, composer, MIME, attachment handling
- `calendar` — views, range query, event editor, recurrence presentation, time zones
- `invitations` — MIME detection, parsing, event resolution, RSVP state machine, styling
- `storage` — non-authoritative IndexedDB caches and settings
- `security` — HTML sanitizer, URL policy, CSP integration, secret redaction
- `ui` — accessible components, design tokens, icons, keyboard commands

### 13.3 Client persistence

Allowed persisted data:

- normalized server URL and non-secret session metadata
- account id and display preferences
- mailbox and calendar metadata
- bounded message/event summary cache
- application shell assets
- OAuth refresh token only after explicit **Keep me signed in** consent

Not persisted by default:

- raw password or app password
- full message bodies
- downloaded attachments
- composed content after successful send
- authentication headers in logs or diagnostics

Every cache key is namespaced by normalized server origin and account id. Signing out deletes the namespace.

## 14. Security and privacy requirements

- HTTPS is mandatory outside local development.
- Enforce a strict Content Security Policy with no `unsafe-eval` and no third-party script origins.
- Sanitize message HTML with an audited allowlist sanitizer and render it in an isolated context.
- Remove scripts, forms, embedded objects, event handlers, dangerous URLs, refresh redirects, and CSS capable of escaping the message container.
- External images are blocked by default to reduce tracking.
- Validate all links and clearly mark links whose displayed host differs from the destination host.
- Protect OAuth redirect state and use PKCE `S256`.
- Never include tokens, passwords, message content, email addresses, or attachment names in client logs.
- Apply Trusted Types where supported.
- Keep dependencies pinned, produce an SBOM, and run dependency and container scanning in CI.
- Installer downloads must be checksummed and release artifacts signed.
- No telemetry leaves the installation unless an administrator and user explicitly opt in.
- Custom server URLs must reject non-HTTP schemes, embedded credentials, malformed hosts, and HTTPS-to-HTTP redirect downgrades.

## 15. Accessibility and localization

- Meet WCAG 2.2 AA for contrast, focus, labels, semantic structure, and reflow.
- Core mail and calendar flows must be keyboard operable.
- Calendar events expose title, start/end, calendar, RSVP status, and conflict state to assistive technology.
- Invitation state must never be communicated by color or transparency alone.
- Respect reduced motion, high contrast, system font scaling, and 200% zoom.
- Use locale-aware date, time, list, and plural formatting.
- Store timestamps with explicit zones and present the event zone and user zone when they differ.
- Support left-to-right and right-to-left layout at the component-system level, even if the initial translation ships only in English.

## 16. Performance and reliability

- Initial views fetch summaries first and bodies/details on demand.
- Use request batching without exceeding server-advertised limits.
- Abort queries when the route, search, or date window changes.
- Virtualize lists and large agenda views.
- Avoid parsing or sanitizing off-screen message bodies.
- Calendar range queries include a bounded prefetch margin, not an unbounded history.
- A failed push channel falls back to polling with exponential backoff and reconnect jitter.
- Offline state must be explicit. Cached data may remain readable, but mutation controls are disabled or queued only when the operation has a defined conflict-safe retry model.
- All optimistic updates have a rollback path.

## 17. Standalone installation and upgrades

### 17.1 Distribution

Publish independently versioned artifacts:

- OCI image for Docker/Podman deployment
- signed static bundle archive
- Linux installation script, separate from Stalwart's `install.sh`

The UI version is independent from the Stalwart version. A compatibility matrix lists supported Stalwart releases.

### 17.2 Runtime configuration

The installer writes a non-secret runtime `config.json` next to the immutable application assets:

```json
{
  "publicUrl": "https://webmail.example.com",
  "basePath": "/",
  "defaultServerUrl": "https://mail.example.com",
  "allowCustomServers": true,
  "allowedServerHosts": [],
  "productName": "Stalwart Mail",
  "supportUrl": null
}
```

Rules:

- `defaultServerUrl` is a convenience, not a credential.
- An empty `allowedServerHosts` means any valid HTTPS host when `allowCustomServers` is true.
- If `allowedServerHosts` is non-empty, the entered server must match the allowlist.
- Runtime configuration is fetched with `no-store` so an administrator can change it without rebuilding assets.

### 17.3 Installer behavior

The installer must:

- support non-interactive flags and an interactive mode;
- detect x86_64 and arm64;
- install only within an explicit web UI directory;
- create or update only the web UI service and configuration;
- never edit Stalwart databases or binaries;
- validate the public URL and optional default server URL;
- print the required DNS, TLS, reverse-proxy, OAuth redirect, and CORS follow-up configuration;
- perform a local health check before reporting success;
- retain the previous release for rollback;
- support `--upgrade`, `--rollback`, and `--uninstall` with confirmation for deletion of local configuration.

### 17.4 Container behavior

- Run as a non-root user with a read-only root filesystem.
- Expose a single unprivileged HTTP port; TLS may terminate at the administrator's reverse proxy.
- Include `/healthz/live` and `/healthz/ready` for the static service.
- Mount runtime configuration as read-only.
- Do not require access to Stalwart's filesystem or data network beyond ordinary HTTPS access from the user's browser.

## 18. Error handling

User-facing errors have:

- a plain-language summary;
- whether data was saved or a response was sent;
- a safe retry action when applicable;
- a copyable correlation id when Stalwart supplies one;
- an expandable technical section with secrets redacted.

Important partial-failure messages include:

- event imported but RSVP not sent;
- RSVP sent but refreshed event state is delayed;
- draft saved but attachment upload failed;
- message submitted but Sent mailbox synchronization is pending;
- push disconnected and polling active;
- event changed on another device.

## 19. Testing strategy

### 19.1 Unit tests

- URL normalization and redirect policy
- capability negotiation and compatibility adapters
- JMAP batching, references, limits, and error translation
- RSVP identity matching and state transitions
- invite duplicate UID resolution
- invitation visual-state mapping
- MIME construction and safe reply recipient selection
- time-zone and all-day display boundaries
- HTML sanitization attack corpus

### 19.2 Integration tests

Run against a real Stalwart 0.16.16 test instance with seeded accounts:

- OAuth PKCE and Basic app-password login
- mailbox and thread synchronization
- compose, draft, attachment, submit, and Sent state
- event create/update/delete and recurrence
- organizer creates an invitation from the event editor by entering one or more guest email addresses
- invitation from local organizer
- invitation from authenticated external organizer with auto-add enabled
- invitation from unknown external organizer with auto-add disabled
- accept, tentative, decline, and response change
- organizer update and cancellation
- `CalendarEventNotification` processing
- cross-client verification through a second JMAP session
- permission, quota, state mismatch, and request-limit failures

### 19.3 End-to-end acceptance tests

1. User enters a server URL, authenticates, and sees Inbox and Calendar.
2. User opens a normal message, safely loads remote images, replies, and sees the sent reply in the thread.
3. User opens an imported invitation and accepts it with one click; the event becomes full emphasis and the organizer receives the reply.
4. User opens an unimported invitation, selects a calendar, and clicks Maybe; the event is imported, the response is sent, and the event appears with tentative styling.
5. User declines an invitation; it remains visible at reduced emphasis and can be changed to Accepted.
6. An unanswered invitation appears at reduced emphasis with an awaiting-response label.
7. User disables **Show declined events** and only declined events disappear.
8. Organizer changes the time; mail and calendar update without duplicating the event.
9. Organizer cancels; the event is marked cancelled or removed according to server state and no Accept action remains.
10. A second client changes the event while the editor is open; the web UI reports a conflict and does not silently overwrite it.

### 19.4 Installation tests

- clean native install, repeat install, upgrade, rollback, and uninstall
- container startup as non-root with read-only filesystem
- runtime config changes without rebuilding assets
- default server locked and custom server allowed modes
- missing CORS, bad TLS, missing capability, and unreachable server diagnostics

## 20. Release plan

### Milestone 1: Foundation

- standalone build, runtime config, installer/container
- responsive shell and design tokens
- discovery, OAuth PKCE, Basic fallback, capability diagnostics
- typed JMAP client and push synchronization

### Milestone 2: Mail

- mailboxes, message list, thread reader, search, actions
- safe HTML, attachments, compose, drafts, and submission

### Milestone 3: Calendar

- calendar list and month/week/day/agenda views
- range synchronization and event CRUD
- recurrence, time zones, alerts, rights, and conflict handling

### Milestone 4: Invitations

- MIME invitation card and CalendarEvent parsing
- event/notification resolution and duplicate detection
- RSVP state machine and scheduling messages
- pending, tentative, declined, and cancelled rendering
- mail-to-calendar deep links and notification deduplication

### Milestone 5: Hardening and release

- accessibility audit
- security review and sanitizer corpus
- performance budgets
- cross-browser and mobile QA
- signed releases, SBOM, upgrade/rollback validation, and operator documentation

## 21. Release acceptance criteria

The v1 release is complete only when:

- all release-blocking flows in sections 9–11 work against a configured supported Stalwart server without source changes;
- invitation RSVP changes generate correct server-side scheduling behavior;
- pending and declined events are lightly shown by default and remain accessible;
- an unimported invitation can be added and answered from its email card;
- the UI survives push disconnects and state mismatches without losing confirmed data;
- no raw password, bearer token, message body, or attachment appears in logs;
- WCAG 2.2 AA checks pass for the core flows;
- installation, independent upgrade, rollback, and uninstall are documented and tested;
- the compatibility matrix and known limitations are published.

## 22. Known constraints and follow-up decisions

1. Stalwart's `autoAddInvitations` setting defaults to false. Unknown external invitations may remain email-only until the user imports them. Administrators who want every authenticated invitation to appear pending in the calendar should enable auto-add after evaluating spam/calendar-abuse tradeoffs.
2. JMAP for Calendars is still evolving. Stalwart 0.16.16 implements its supported draft behavior; the client needs a compatibility layer and fixtures captured from supported server versions.
3. Stalwart can emit permissive CORS headers, but a production deployment should prefer the narrowest origin policy its configuration supports. The setup guide must document this explicitly.
4. Persistent browser tokens increase exposure to malicious JavaScript. The first release should default **Keep me signed in** to off and ship with no third-party runtime code.
5. A future backend-for-frontend deployment mode may keep tokens in `HttpOnly` cookies and proxy JMAP, but it is not part of the static v1 architecture and requires a separate SSRF and session-security design.

## 23. References

- [Stalwart JMAP overview](https://stalw.art/docs/http/jmap/)
- [RFC 8620: JMAP Core](https://www.rfc-editor.org/rfc/rfc8620.html)
- [RFC 8621: JMAP for Mail](https://www.rfc-editor.org/rfc/rfc8621.html)
- [JMAP for Calendars, current working-group draft](https://datatracker.ietf.org/doc/draft-ietf-jmap-calendars/)
- [RFC 10017: OAuth 2.0 for Browser-Based Applications](https://www.rfc-editor.org/rfc/rfc10017.html)
- [RFC 7636: Proof Key for Code Exchange](https://www.rfc-editor.org/rfc/rfc7636.html)
- Stalwart integration points: `crates/http/src/request.rs`, `crates/jmap/src/calendar_event`, `crates/jmap/src/calendar_event_notification`, `crates/groupware/src/scheduling`, and `crates/groupware/src/calendar/itip.rs`
