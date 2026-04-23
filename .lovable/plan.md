

# Make every Settings section a collapsible dropdown

## What changes

Each top-level section card on `/settings` becomes a Radix `Collapsible` whose header (icon + title) is the trigger and whose body is the content. **All sections start collapsed** every time the user opens the Settings tab — no persistence, no remembered state.

A small `ChevronDown` rotates 180° when open. Clicking anywhere on the header row toggles the section. Keyboard accessible (button-based trigger, Enter/Space toggles).

## Sections affected (all 9)

1. Appearance
2. Agent Identity (when connected) / fallback notice (when not)
3. Behavior
4. Notifications
5. Permissions (`PermissionsPanel`)
6. Capabilities (`CapabilitiesPanel`)
7. Sessions & history
8. Updates
9. Danger Zone

## Implementation

### New helper `SettingsSection` (inside `src/pages/SettingsPage.tsx`)
A small wrapper that takes `icon`, `title`, and `children`, renders a `GlassCard` with:
- `Collapsible` (uncontrolled, `defaultOpen={false}`)
- `CollapsibleTrigger` rendered as a full-width button: icon + title on the left, rotating chevron on the right, hover highlight
- `CollapsibleContent` containing the existing section body, with the same padding/spacing the cards use today

This keeps the existing visual language (GlassCard, icon color, heading size) intact — only the body becomes hideable.

### `src/pages/SettingsPage.tsx`
- Import `Collapsible`, `CollapsibleTrigger`, `CollapsibleContent` from `@/components/ui/collapsible` and `ChevronDown` from `lucide-react`.
- Replace each section's outer `GlassCard` markup with `<SettingsSection icon={...} title="...">…</SettingsSection>`.
- For `PermissionsPanel` and `CapabilitiesPanel` (which render their own GlassCard internally), wrap them in a `SettingsSection` whose body simply renders the panel — accept the slight nested-card look, OR (preferred) pass a `bare` prop variant that skips the inner GlassCard wrapping just for those two so the panel's own card remains the only frame. Simplest path: render them inside `SettingsSection` with no extra padding and let their internal GlassCard be the visible surface; the outer collapsible just provides the toggleable header.
- Confirmation `AlertDialog`s and the hidden `Database` icon stay outside the sections (unchanged).

### Files

**Edited**
- `src/pages/SettingsPage.tsx` — add `SettingsSection` helper, wrap all 9 sections, add chevron + collapse animation.

**Untouched**
- `PermissionsPanel`, `CapabilitiesPanel`, `SettingsContext`, all behavior and dialog logic.
- `src/components/ui/collapsible.tsx` already exists and is used as-is.

## Outcome

Opening Settings shows a clean stack of 9 collapsed rows — each a single-line header with an icon, title, and chevron. Clicking any row expands just that row. State resets to all-closed every time the user navigates away and back.

