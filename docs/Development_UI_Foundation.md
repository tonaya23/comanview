# ComanView UI foundation

This lightweight UI foundation was consolidated during Phase 1U. Shared color, spacing, radius,
elevation, focus, disabled and reduced-motion tokens live in `@comanview/ui/tokens.css`. It is a
pragmatic visual contract, not a complete Design System and not a source of domain behavior.

All operational clients use the same ComanView brand and semantic colors while preserving their
context:

- POS prioritizes stable, touch-oriented sale and payment controls.
- Waiter prioritizes tablet navigation and fast table/order actions.
- KDS keeps its dark, high-contrast kitchen surface and long-distance readability.
- Local Administration uses moderate density, contextual errors and progressive technical detail.
- Super Admin uses higher information density and separates commercial state from technical state.

Primary, secondary and destructive actions remain visually distinct. Statuses always include human
text and never rely only on color. Forms keep labels and contextual feedback close to their fields;
global errors remain reserved for global conditions. Interactive controls share visible keyboard
focus, disabled behavior and reduced-motion handling.

Super Admin presents the assigned Plan separately from the Cloud-authorized License snapshot.
Device limits and capabilities come from that License assignment rather than being inferred from
the Plan editor. Feature flags are not represented as purchased capabilities. Technical IDs and
revisions use progressive disclosure; credentials, signed envelopes and key material are never UI
content.

This foundation does not change Order, Payment, Cash, Device, Pairing, RBAC, Licensing, Sync or
Offline-First invariants. Broader component extraction and formal visual-regression infrastructure
remain optional future work.
