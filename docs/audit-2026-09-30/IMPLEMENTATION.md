# Product refinements implemented

This follow-up addresses the actionable findings in the [original audit](README.md). The original report and screenshots describe commit `32c842a`; they are retained as the before-state.

## Behavior and recovery

- File publication commits the title, expiry, and availability shown in the editor together. Pausing sharing does not save unfinished edits.
- A durable address registry keeps old URLs attached to their original resource. Renames keep an alias by default, with an explicit option to retire the previous address. Deletion and permanent content removal never release addresses.
- Links can be paused and resumed. File and paste automatic addresses have twelve random characters; short links retain four. Published content remains unlisted, accessible to anyone with its address.
- Trash exposes recovery deadlines and permanent deletion. Restored resources return paused. Restoration and cleanup use revision checks and atomic claims to prevent irreversible deletion from racing recovery.
- Editors, search, and upload controls wait for their change handlers before accepting input. A delayed-JavaScript test reproduces and guards against startup overwriting an edit.
- Editors preserve newer typing during saves. Revision conflicts offer draft copying/downloading and a deliberate comparison before replacing edits with the saved version.
- Search, status filters, and cursor history survive editor navigation. Closing returns focus to the selected row, or to search when a recent-first sort has moved the item away.
- Upload retries and cancellation act on the actual transfer state. Uploads continue through file selection and collection changes; leaving the page still warns about unfinished transfers.

## Interface

Sharing controls now appear beside availability and the address. Live rows have direct copy actions, copying provides visible feedback, native sharing is available where supported, and QR generation is an expandable option with descriptive download names.

Paste creation puts content in the initial phone viewport, focuses the body, and exposes language only for code. Preview keeps editor undo history. Mobile detail views provide a clear return action; the action bar moves into document flow while typing so it cannot cover the caret.

Card editing groups identity, contact details, and links, with a desktop preview and mobile Edit/Preview tabs. Portraits can be cropped before upload. Public pages have descriptive titles, consistent unavailable responses, bounded plain-text file previews, and code presentation with line numbers and wrapping.

The visual changes use quieter surfaces, clearer text hierarchy, restrained borders, compact controls, and consistent spacing. Success feedback belongs beside the action that caused it.

## Operations

Settings separates everyday identity and appearance from advanced controls. Storage distinguishes active, uploading, retained, and available bytes. Metadata export is explicitly separate from a full backup. Cleanup health reports observed runs, failures, overdue work, and reclaimed storage. Read-only mode is visible throughout administration.

The backup format restores table data before installing triggers, preserving the address registry without conflicts. A complete isolated local backup/restore rehearsal passed; see [operations](../operations.md) for its scope and limitations.

Migrations `0004` and `0005` add address ownership, retention/cleanup coordination, and maintenance history. Existing current owners win historical address collisions. Addresses lost through older renames cannot be reconstructed.

## Verification

- ESLint, TypeScript, and the production OpenNext Worker build pass.
- All 71 integration tests across eight files pass. The Drizzle schema check reports no missing migration changes.
- All 34 browser scenarios pass in one complete run: 17 each on desktop and mobile Chromium. They cover authentication, publication and immediate revocation, permanent address ownership, Trash, revision conflicts, draft preservation, filtered pagination, Back/Forward navigation, upload failure/cancellation, portrait cropping, and delayed JavaScript startup.
- Accessibility scans cover all seven administration routes at desktop and mobile sizes. Browser checks also cover 320 px layouts, focus restoration, QR decoding, a 25 MiB upload and download with range/hash verification, sanitized previews, and exact paste line endings.
- A separate local backup/restore rehearsal restored four objects (196,676 bytes), checked binary integrity, retained resources and aliases, session invalidation, read-only enforcement, cleanup, and refusal to restore into nonempty resources.

The browser suite uses fresh pages for each scenario, visible accessible controls, and explicit navigation completion. It does not skip the remaining scenarios after a failure. Verification uses synthetic local fixtures.

No deployment is included in this change. Apply migrations `0004` and `0005` before releasing the new Worker. Real device keyboards, assistive technology, hosted Cron delivery, TLS cookies, Cloudflare CPU limits, and actual contact-app import still require staging/device validation. A formative usability study remains useful; code and browser checks do not establish user delight.

## Updated screens

- [Desktop links workspace](../workspace.png)
- [Mobile paste creation](refined-paste-mobile.png)
