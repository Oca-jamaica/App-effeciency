/**
 * ASCEND design tokens. Every colour, size and duration used by the UI comes from here.
 *
 * Restraint is the point: one accent, neutral surfaces separated by hairline borders rather than
 * shadows, three type weights, and a 4-pt spacing scale.
 */
export type ColorScheme = 'light' | 'dark';

export interface Palette {
  background: string;
  surface: string;
  surfaceSecondary: string;
  surfacePressed: string;
  border: string;
  borderStrong: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  accent: string;
  accentPressed: string;
  accentSoft: string;
  onAccent: string;
  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  danger: string;
  dangerSoft: string;
  overlay: string;
  tabBar: string;
}

export const palettes: Record<ColorScheme, Palette> = {
  dark: {
    background: '#101318',
    surface: '#161B22',
    surfaceSecondary: '#1C2430',
    surfacePressed: '#222C3A',
    border: '#232C38',
    borderStrong: '#313D4D',
    text: '#E9EDF3',
    textSecondary: '#9AA5B5',
    textTertiary: '#677385',
    accent: '#739BEA',
    accentPressed: '#8AAEF2',
    accentSoft: 'rgba(115, 155, 234, 0.14)',
    onAccent: '#0D1420',
    success: '#7BC4A0',
    successSoft: 'rgba(123, 196, 160, 0.14)',
    warning: '#D9AD66',
    warningSoft: 'rgba(217, 173, 102, 0.14)',
    danger: '#E48079',
    dangerSoft: 'rgba(228, 128, 121, 0.14)',
    overlay: 'rgba(5, 7, 10, 0.6)',
    tabBar: '#12161C',
  },
  light: {
    background: '#F6F6F3',
    surface: '#FFFFFF',
    surfaceSecondary: '#EEEEEA',
    surfacePressed: '#E6E6E1',
    border: '#E4E4DF',
    borderStrong: '#D2D2CC',
    text: '#14171C',
    textSecondary: '#5B6470',
    textTertiary: '#8B929B',
    accent: '#3A63BF',
    accentPressed: '#2F53A6',
    accentSoft: 'rgba(58, 99, 191, 0.10)',
    onAccent: '#FFFFFF',
    success: '#2E8B60',
    successSoft: 'rgba(46, 139, 96, 0.10)',
    warning: '#A36A12',
    warningSoft: 'rgba(163, 106, 18, 0.10)',
    danger: '#C0453D',
    dangerSoft: 'rgba(192, 69, 61, 0.10)',
    overlay: 'rgba(20, 23, 28, 0.35)',
    tabBar: '#FBFBF9',
  },
};

/** Category colours: muted, distinguishable in both themes, never the dominant element. */
export const categoryColors: Record<string, { dark: string; light: string }> = {
  blue: { dark: '#739BEA', light: '#3A63BF' },
  green: { dark: '#7BC4A0', light: '#2E8B60' },
  teal: { dark: '#6CC2C2', light: '#22807F' },
  violet: { dark: '#A898E8', light: '#6A55C2' },
  amber: { dark: '#D9AD66', light: '#A36A12' },
  indigo: { dark: '#8C93E6', light: '#4A50B5' },
  rose: { dark: '#E3899E', light: '#B4466A' },
  slate: { dark: '#9AA5B5', light: '#5B6470' },
};

export const space = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 40,
} as const;

/** Screen gutter. */
export const gutter = 16;

export const radius = {
  sm: 8,
  md: 12,
  lg: 14,
  xl: 18,
  pill: 999,
} as const;

export const fonts = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
} as const;

export type TextVariant =
  | 'title'
  | 'heading'
  | 'subheading'
  | 'body'
  | 'bodyStrong'
  | 'callout'
  | 'caption'
  | 'captionStrong'
  | 'label'
  | 'numeric';

export const typography: Record<TextVariant, { fontFamily: string; fontSize: number; lineHeight: number; letterSpacing?: number }> = {
  /** Screen titles. Deliberately modest: no giant headings. */
  title: { fontFamily: fonts.semibold, fontSize: 24, lineHeight: 30, letterSpacing: -0.4 },
  /** Section headings. */
  heading: { fontFamily: fonts.semibold, fontSize: 17, lineHeight: 22, letterSpacing: -0.2 },
  subheading: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 20, letterSpacing: -0.1 },
  body: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 21 },
  bodyStrong: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 21 },
  callout: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 19 },
  /** Compact metadata. */
  caption: { fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 16 },
  captionStrong: { fontFamily: fonts.medium, fontSize: 12.5, lineHeight: 16 },
  /** Small uppercase section labels; used sparingly. */
  label: { fontFamily: fonts.semibold, fontSize: 11, lineHeight: 14, letterSpacing: 0.6 },
  numeric: { fontFamily: fonts.semibold, fontSize: 20, lineHeight: 24, letterSpacing: -0.3 },
};

export const motion = {
  fast: 120,
  base: 200,
  slow: 280,
} as const;

/** Minimum touch target (Apple HIG 44pt, Material 48dp → use 44 with hitSlop where needed). */
export const touchTarget = 44;
