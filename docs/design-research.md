# Frost refinement: research and decisions

Reviewed 18 November 2026. This applies native design principles to a browser app; it does not reproduce Apple's native rendering engine.

## Primary references

| Source | Finding | Application |
| --- | --- | --- |
| [Apple: Materials](https://developer.apple.com/design/human-interface-guidelines/materials) | Glass creates a distinct control/navigation layer. Text-heavy content needs a stable background, and regular glass prioritizes legibility. | Keep the task canvas opaque. Restrict translucency to the sidebar, floating navigation, and popovers. |
| [Apple: Typography](https://developer.apple.com/design/human-interface-guidelines/typography) | Establish hierarchy with size and weight, support larger text, and avoid overly light weights. iOS's default body size is 17 pt. | Use Apple's system font on Apple devices, with 17 CSS px mobile task titles, calmer weights, and relative units. CSS pixels are not a promise of native point-size or Dynamic Type equivalence. |
| [Apple: Get to know the new design system](https://developer.apple.com/videos/play/wwdc2025/356/) | Interface structure should adapt across devices and input modes. Controls occupy a functional layer over content. | Keep a sidebar on larger screens; use a complete list picker and reachable bottom controls on phones. |
| [Things: product screenshots](https://culturedcode.com/things/) and [iPhone release notes](https://culturedcode.com/things/support/articles/2409121/) | The product examples use quiet lists, aligned completion controls, restrained inline indicators, and a reachable add action. The September 2025 release describes a restrained glass sidebar and controls. | Keep each short task on one line; place priority and waiting indicators beside the title. Preserve an obvious Add action without permanently showing the desktop composer on phones. |
| [Structured: Liquid Glass redesign](https://feedback.structured.app/changelog/structured-43-new-task-editor-liquid-glass-and-more) | The developer describes a floating tab bar and a simpler task editor. | Use a floating phone dock, dedicated list sheet, and focused task/review sheets. |
| [Todoist: 2026 changelog](https://www.todoist.com/help/todoist/product-updates/2026-changelog-HD3jJAtLd) | Its changes emphasize readable task surfaces, grouped controls, and refinements to quick capture and glass navigation. | Avoid ornamental glass on text entry; keep customer metadata and status cues compact. |

These are design references, not copied product assets or layouts. Original screenshots remain on their respective publishers' sites.

## Typography

San Francisco is the selected direction after comparing SF Pro and DM Sans. The production font stack starts with `-apple-system` and `BlinkMacSystemFont`, so Apple devices use their installed system font. [Inter Variable](https://rsms.me/inter/) is a self-hosted fallback for other systems; its SIL Open Font License is included in `public/fonts/OFL.txt`. No external font service is required, and San Francisco is not redistributed. Task text uses a regular intermediate weight; headings use restrained semibold and less aggressive tracking. Preview screenshots use locally installed SF Pro fonts in the isolated rendering environment.

## Changes

- Frost becomes the default appearance. Other appearances move into an Appearance menu.
- Priority is an inline flag; waiting status is an inline hourglass, both beside the title with accessible names. Neither creates a metadata-only line.
- Customer names stay inline when needed and disappear from rows already grouped by customer. Group headers omit the input-only `@` prefix and use tighter spacing.
- Review supports Back for skipped tasks and Undo for assignments, preserving metadata edits. Customer, priority, and type are editable in the sheet, and weekly choices display their exact Friday dates.
- A row menu, left swipe, long press, or context menu opens the same quick scheduling sheet. Scheduling offers Undo without opening the full task editor.
- Mobile list navigation is a full sheet; every section is visible and reachable.
- The phone dock provides Lists, Today, Review, and a separate Add button.
- Search expands on demand. Mobile forms use larger inputs, viewport-aware sheets, and 44 px minimum targets for primary actions.
- The list reserves space beneath the final row so floating controls do not cover it.

## Verification

Automated Chromium checks cover existing task workflows plus the system font stack, compact row geometry, inline priority alignment, mobile list selection, mobile creation, search dismissal, touch-target sizes, long titles, 200% text scaling, viewport widths from 320 px, reduced transparency, and content clearance above the floating dock. They also cover Review metadata, rapid assignment/undo/reassignment, failed saves and undo retries, retained drafts, and touch gestures without opening the editor. Native Safari, physical-device safe areas, and the actual iOS keyboard still require on-device checks.
