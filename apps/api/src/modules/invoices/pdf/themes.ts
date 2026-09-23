/**
 * One theme per selectable invoice template (Phase 10's registry, by
 * id). A theme is pure data — colors, borders, fonts, a couple of layout
 * toggles — consumed by the single HTML layout in render-html.ts. Adding
 * template #6 to the PDF path is one new entry here, never a change to
 * how a PDF is generated or laid out.
 */
export interface PdfTheme {
  id: string;
  fontFamily: string;
  accent: string;
  headerBg: string;
  headerText: string;
  headerMuted: string;
  border: string;
  borderWidth: string;
  rounded: string;
  uppercaseLabels: boolean;
  tableHeaderBg: string;
}

export const PDF_THEMES: Record<string, PdfTheme> = {
  'classic-navy': {
    id: 'classic-navy',
    fontFamily: 'Georgia, "Times New Roman", serif',
    accent: '#1e3a5f',
    headerBg: '#ffffff',
    headerText: '#1e3a5f',
    headerMuted: '#64748b',
    border: '#1e3a5f',
    borderWidth: '2px',
    rounded: '0',
    uppercaseLabels: true,
    tableHeaderBg: '#ffffff',
  },
  'modern-curve': {
    id: 'modern-curve',
    fontFamily: '"Segoe UI", Helvetica, Arial, sans-serif',
    accent: '#7c3aed',
    headerBg: '#7c3aed',
    headerText: '#ffffff',
    headerMuted: '#ede9fe',
    border: '#ddd6fe',
    borderWidth: '1px',
    rounded: '16px',
    uppercaseLabels: true,
    tableHeaderBg: '#f5f3ff',
  },
  'minimal-clean': {
    id: 'minimal-clean',
    fontFamily: 'Helvetica, Arial, sans-serif',
    accent: '#0f172a',
    headerBg: '#ffffff',
    headerText: '#0f172a',
    headerMuted: '#94a3b8',
    border: '#0f172a',
    borderWidth: '1px',
    rounded: '0',
    uppercaseLabels: true,
    tableHeaderBg: '#ffffff',
  },
  'industrial-blue': {
    id: 'industrial-blue',
    fontFamily: 'Arial, Helvetica, sans-serif',
    accent: '#1d4ed8',
    headerBg: '#1d4ed8',
    headerText: '#ffffff',
    headerMuted: '#dbeafe',
    border: '#1d4ed8',
    borderWidth: '3px',
    rounded: '0',
    uppercaseLabels: true,
    tableHeaderBg: '#eff6ff',
  },
  'premium-modern': {
    id: 'premium-modern',
    fontFamily: '"Segoe UI", Helvetica, Arial, sans-serif',
    accent: '#0f172a',
    headerBg: '#0f172a',
    headerText: '#ffffff',
    headerMuted: '#fbbf24',
    border: '#0f172a',
    borderWidth: '1px',
    rounded: '0',
    uppercaseLabels: true,
    tableHeaderBg: '#ffffff',
  },
};

const DEFAULT_THEME_ID = 'classic-navy';

export function getPdfTheme(id: string | null | undefined): PdfTheme {
  return PDF_THEMES[id ?? ''] ?? PDF_THEMES[DEFAULT_THEME_ID];
}
