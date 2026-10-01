/**
 * Large-mode print fix: Large text (textSize.ts's 1.15x scale) grows
 * line-height on every row, so a normal short invoice's vertical
 * spacing — unchanged since it was tuned for Medium — pushed the
 * totals section past one A5 page onto a second. The fix is to shrink
 * vertical padding/margins specifically when Large is selected
 * (never font size, never horizontal spacing, which was already tuned
 * against overflow separately) so the extra line-height has room
 * without needing a second page for a normal 5-6 row invoice.
 *
 * `vs` (vertical spacing) just swaps a Tailwind class for a tighter
 * one when `compact` is true — never a CSS calc/variable, since the
 * amount of compaction a design can take without looking cramped
 * varies per element (a table row vs. a page margin), unlike font
 * size where one multiplier works everywhere.
 */
export function vs(compact: boolean | undefined, normal: string, tight: string): string {
  return compact ? tight : normal;
}
