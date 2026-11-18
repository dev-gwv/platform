# Mobile audit: what a phone cannot reach or use (18 Nov 2026)

**Asked by the owner after an Android phone could not scroll the "Pick a plan…" list.**
This is an audit only; nothing has been changed yet.

## How this was checked

- **App and viewport.** The app ran in preview mode (`VITE_MOCK=1`) in Chromium, emulating a 375 × 812 Android phone with touch.
- **Scrolling.** Lists were scrolled with a real wheel event and their `scrollTop` read back. Touch swipes take the same path in the scroll-lock code (`react-remove-scroll`): `wheel` and `touchmove` are blocked by one handler.
- **Code sweep.** The code was swept for every pattern in the brief:
  - hover-only and drag-only actions;
  - text sizes that make an iPhone zoom;
  - `vh` heights, fixed widths and file inputs;
  - pickers that put the keyboard up.
- **Not checked on a real device.** There was no real iPhone or Android phone. In particular, nothing here was seen in Safari (WebKit), with a real on-screen keyboard, with the camera, or as the installed app. Findings that rest on how iOS behaves are marked **(iPhone, from the code)**.

Screenshots are in `docs/audit-mobile-2026-11-18/`.

---

## Findings, worst first

### 1. Lists opened inside a dialog or drawer cannot be scrolled on a phone

The owner's case, and it is not only that list (`01-plan-dropdown-android.jpg`).

- **What can't be done.** Any dropdown or picker opened inside a dialog or the lead drawer can't be scrolled once its list is longer than its box. On a phone the rows below the fold can never be reached. Wheel scrolling on a computer is blocked too. Dragging the scrollbar and the keyboard arrows still work, which is why it went unnoticed on desktop.
- **Reproduced.**
  - Studio Access Manager → Assign / change plan → Pick a plan: wheel over the list, `scrollTop` stays 0.
  - Add lead → "What's the event?": the same, `scrollTop` stays 0.
- **Cause.** A Radix dialog and sheet lock the page's scroll with `react-remove-scroll`. That lock listens on the document and cancels every `wheel` and `touchmove` whose target is outside the dialog's own box. Both kinds of list are drawn outside that box:
  - `shared/ui/select.tsx` portals its list to `<body>` (so the lead drawer cannot clip it);
  - `shared/ui/popover.tsx` (Radix Popover) portals its content too.

  So the lock sees a swipe on the list as "outside the dialog" and cancels it.
- **Tested fix.** Adding `wheel`/`touchmove` listeners on the list that stop the event there brought the list back. The same plan list then scrolled 252 px.
- **Where it bites.** Every `Select` and every `PopoverContent` inside any `DialogContent`, `AlertDialog` or `Sheet` (the lead drawer, the deliverable drawer). For example:
  - the plan picker (14 plans);
  - the calendar's **month and year** dropdowns: a birthday in Add client means scrolling back decades;
  - event type, source and stage (`QuickSelect`);
  - labels (`LabelMenu`);
  - Given to (`AssigneeChip`);
  - `ProjectPicker`, `PersonPicker`, `LeadPicker`;
  - the time picker;
  - "Copied by" in the data dialog;
  - the designer's colour picker.
- **Files.** `shared/ui/select.tsx`, `shared/ui/popover.tsx` (23 users), `shared/ui/row-menu.tsx` (same portal; its menus are short today).

### 2. Every text box makes an iPhone zoom in, and the page stays zoomed (iPhone, from the code)

- **What happens.** Tapping almost any field zooms the page on an iPhone. The person then has to pinch back out after every field, and fixed bars and dialogs drift off screen while zoomed.
- **Cause.**
  - Safari zooms on focus when a field's text is under 16 px.
  - The app's root size is 14 px (`styles.css`, `html { font-size: 14px }`), so `text-base` on `Input`, `Textarea` and the `Select` trigger is 14 px. Measured in the Add lead dialog: input font 14 px, height 31.5 px.
  - Only the sign-in page is lifted to 16 px (`.auth-scale`).
- **Files.** `styles.css`, `shared/ui/input.tsx`. Two raw `<input class="text-sm">` in `routes/platform/support-calls.tsx`.
- Android does not zoom, but the same 31.5 px controls are small for a thumb.

### 3. Leads filter lists open off the left edge of a phone

- **What can't be done.** On Leads → Filter, "All stages" and "All partners" (the chips in the left column) open a list whose left half is off screen. The search box and the stage names can't be seen or reached, and the page can't scroll sideways to them. Measured: the panel runs from x = −143 to 136 px (`02-leads-filter-off-left-edge.jpg`).
- **Cause.** `shared/ui/multi-select-filter.tsx` anchors its 280 px panel with `absolute right-0` to the chip. A chip at the left of a 375 px screen pushes the panel off the left edge.
- **Where.** Every page using `MultiSelectFilter`: the Leads filters (`features/crm/BoardFilters.tsx`) and the Follow-ups board (`routes/follow-ups/board.tsx`).

### 4. Opening a picker puts the keyboard over the list

- **What can't be done.** Tapping "What's the event?", a label, a project, a lead or a filter chip opens the list **and** focuses its search box. On a phone the keyboard rises at once and covers most of the list the person meant to tap. Inside a dialog it can't then be scrolled into view (see 1).
- **Cause.** Each of these focuses its search box on open (`onOpenAutoFocus` → `input.focus()`, or `autoFocus`):
  - `shared/ui/quick-select.tsx`
  - `features/projects/ProjectPicker.tsx`
  - `features/crm/LeadPicker.tsx`
  - `features/crm/LabelMenu.tsx`
  - `shared/ui/multi-select-filter.tsx`

### 5. Save / Next bars go under the Android keyboard (Android, from the code)

- **What happens.** In a long dialog or the lead drawer, with a field focused, the sticky Save / Cancel row sits behind the keyboard. The person has to close the keyboard to find the button.
- **Cause.** Since Chrome 108, Android shrinks only the *visual* viewport for the keyboard. The layout viewport, `dvh`, `fixed` and `sticky` do not move unless the page opts in with `interactive-widget=resizes-content` in the viewport meta, and `apps/web/index.html` does not.
- iPhone Safari ignores that setting. It scrolls the focused field into view but leaves the bar where it is; this was not seen on a real device.

### 6. Buttons that only appear on hover cannot be seen on a phone

They can still be tapped if you know where they are, which nobody does.

| Where | What is invisible | File |
| --- | --- | --- |
| Deliverable drawer → notes | **Edit note** and **Delete note** | `features/projects/DeliverableDrawer.tsx:484, 491` |
| Lead drawer → phone/email | the Copy icon | `features/crm/LeadDrawer.tsx:321` |
| Designer → Uploads, Templates | **Delete** on a photo or a template | `features/designer/SidePanel.tsx:209, 434` |
| Designer → a stat / item | the remove ✕ | `features/designer/DesignPageView.tsx:942` |
| Designer → a text | the violet move grip (shows once the text is picked, so only discoverability) | `features/designer/Movable.tsx:196` |
| Designs list | the "Use / Open" overlay on a card (the card itself still opens) | `routes/ai-designer.tsx:260, 434` |

(The tick boxes on cards were fixed on 17 Nov with `@media (hover: none)`. These were missed because they use `group-hover:opacity-100` without `role="checkbox"`.)

### 7. Two dialogs undo the phone-safe height

- **What happens.** On a phone their foot (Save) can sit under Safari's or Chrome's toolbar.
- **Cause.** `DialogContent` defaults to `max-h-[90dvh]`, but these pass `max-h-[90vh]`, and `vh` is the height with the toolbar hidden.
- **Files.**
  - `features/team/ManageAccessDialog.tsx:124`
  - `routes/billing/templates.tsx:250`
- Lower risk: inner boxes sized in `vh` inside dialogs, which only make the dialog scroll inside itself:
  - `QuoteBuilder`, `QuoteViewer` (75vh)
  - `EditMemberDialog` (70vh)
  - `TermsComposer` (80vh)
  - `BulkAddMembers` (60vh)
  - `features/board/StagesView.tsx:261` (`100vh-19rem`)

### 8. Dragging works only with a mouse on two boards

- **What can't be done.** Cards on the **Leads board** and the production board's **Tasks** view can't be dragged with a finger. Those boards use only `PointerSensor`, and a swipe on a phone becomes a page scroll.
- **Not blocking.** Every move has a tap way:
  - the lead drawer's stage picker and the bulk bar;
  - the task's own status.
- **Why fix it.** The Stages view already does this right (`TouchSensor` with a 220 ms hold), so the two boards behave differently from the rest.
- **Files.** `features/crm/tabs/BoardTabs.tsx:145`, `features/board/TaskBoard.tsx:126`.

### Checked and fine

- **Hover cards.** `HoverPopover` (a person's day, crew notes, the team note chip, selfies) opens on a tap.
- **Date and time.** These are the app's own fields (`DateField`, `TimeField`), not native ones. The calendar does not put up the keyboard; its month and year lists are covered by finding 1.
- **File inputs.**
  - They open through a button or a label, which both phones allow.
  - The attendance selfie uses `capture="user"`.
  - Photo inputs take `image/*` or name JPEG, so an iPhone converts its HEIC photos to JPEG. This was not tried on a device.
- **Wide pages.** Wide tables and calendars (`min-w-[…]`) sit in sideways-scrolling boxes. The login card and the referral card use `max-w`, so nothing wider than 375 px is forced.
- **Full-height pages.** `min-h-screen` is only on public pages, where a taller minimum does no harm.

---

## Fixed (18 Nov, same day)

The owner said "fix them all", and all eight are done.

| # | Fix | Checked |
| --- | --- | --- |
| 1 | `shared/ui/scroll-inside.ts` stops `wheel` and `touchmove` at the list. It is used by `select.tsx`, `popover.tsx` (all 23 pickers) and `row-menu.tsx`. Lists also get `overscroll-contain`. The ⋯ row menu now opens upwards when low on the screen and scrolls when long. | At 375 px touch: Pick a plan scrolled 253 px; the calendar's year list scrolled inside Add lead; event type scrolled 300 px and stayed open; Studio Access Manager's ⋯ opened upwards with all 8 actions on screen. |
| 2 | `styles.css`, `@media (pointer: coarse)`: inputs, textareas and selects are 16 px, and `h-9` fields and Select triggers are 2.5rem. | 16 px with touch; still 14 px at 768 and 1280 px with a mouse. |
| 3 | `multi-select-filter.tsx` places the panel inside the screen (8 px margin) and caps its width at the screen less 16 px. | 375 px: All stages / All sources at 8–288 px (was −143). 768 and 1280 px: unchanged, right-aligned to the chip. |
| 4 | `shared/ui/touch.ts` (`isTouchScreen`). `QuickSelect`, `ProjectPicker`, `LeadPicker`, `LabelMenu`, `AssigneeChip` and `MultiSelectFilter` don't focus their search box on a touch screen. | Touch: nothing focused on open. Mouse: the search box is focused as before. |
| 5 | `index.html`: `interactive-widget=resizes-content`. | Needs a real Android keyboard. |
| 6 | `[@media(hover:none)]:opacity-100` on note edit and delete, the lead drawer's copy icon, and the designer's delete and remove buttons. The designer's card overlay and the text grip are left as they are, since the card opens and a picked text shows its grip. | Code. |
| 7 | `90vh` → `90dvh` in `ManageAccessDialog` and the invoice designs dialog; `StagesView` column `100dvh-19rem`. | Code. |
| 8 | Leads board and Tasks board get `TouchSensor` (220 ms hold), like the production board's Stages. | Code; needs a real phone. |

`shared/ui/mobile.test.ts` guards 1–4. Typecheck and lint pass, and the full test suite passes.

**Still to try on a real Android phone and an iPhone:**
- Pick a plan;
- Add lead → event type;
- Leads → Filter;
- typing in a long dialog with the keyboard up;
- dragging a lead card.

## Fix plan (as proposed)

**Shared** fixes are one change that covers every place that uses the part. **Page** fixes are one place each.

1. **Lists scroll inside dialogs and drawers (shared, fixes finding 1).**
   - In `select.tsx`, `popover.tsx` and `row-menu.tsx`, stop `wheel` and `touchmove` at the list's own box (native listeners, so the dialog's lock never sees them).
   - Add `overscroll-contain`, so reaching the end does not scroll the page behind.
   - Add a test that a Select inside a Dialog scrolls.
   - This one change covers every dropdown and picker in every dialog, the lead drawer and the deliverable drawer, including the plan picker.
2. **No zoom on iPhone (shared, fixes finding 2).**
   - On touch screens only (`@media (pointer: coarse)`), make text in `input`, `textarea` and the Select trigger 16 px, and controls about 40 px tall.
   - Desktop keeps its dense 14 px.
   - **Not** done by adding `maximum-scale=1` to the viewport, because that also stops a person pinching to zoom on purpose.
3. **Filter lists stay on screen (shared, fixes finding 3).** In `multi-select-filter.tsx`, open the panel towards the side with room and cap its width at the screen less 16 px.
4. **No keyboard over a list on a phone (shared, fixes finding 4).** On touch screens, open `QuickSelect`, `ProjectPicker`, `LeadPicker`, `LabelMenu` and `MultiSelectFilter` with the list in view and the search box unfocused. A tap on the search box brings the keyboard. Desktop still types straight away.
5. **Save stays above the Android keyboard (shared, fixes finding 5).**
   - Add `interactive-widget=resizes-content` to the viewport meta in `index.html`.
   - Check the lead drawer, a long dialog and the wizard's Next bar at 375 px after the change, because every `dvh`/`fixed` height will now shrink with the keyboard.
6. **Hover-only buttons show on a phone (page by page, fixes finding 6).** Add `[@media(hover:none)]:opacity-100` to each button in the table. The designer card overlay stays as it is, since the card itself opens.
7. **`90vh` → `90dvh` (page by page, fixes finding 7).** `ManageAccessDialog` and the invoice designs dialog.
8. **Touch drag on the Leads board and Tasks board (page by page, fixes finding 8).** Add the same `TouchSensor` with a 220 ms hold as `StagesView`. Low priority, because tap alternatives exist.

**Order.** Fixes 1–4 first: together they cover most of what a phone cannot reach. Then 5, then 6–8.

**After the fixes.**
- Check each at 375 px (Android emulation) and 768 px.
- Run typecheck, lint and tests.
- Ask the owner to try the plan picker, Add lead → event type and Leads → Filter on their own Android phone and on an iPhone.

**What can't be confirmed from here:** Safari's zoom, the on-screen keyboard, and the camera.
