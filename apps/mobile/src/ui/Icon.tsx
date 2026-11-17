import type { LucideIcon } from 'lucide-react-native';
import { useTheme } from './theme';
import type { TextTone } from './Text';

export interface IconProps {
  icon: LucideIcon;
  size?: number;
  tone?: TextTone;
  color?: string;
  strokeWidth?: number;
}

/** One icon set (Lucide), one stroke weight, colours from the theme. */
export function Icon({ icon: Glyph, size = 20, tone = 'secondary', color, strokeWidth = 1.75 }: IconProps) {
  const { colors } = useTheme();
  const toneColor = {
    primary: colors.text,
    secondary: colors.textSecondary,
    tertiary: colors.textTertiary,
    accent: colors.accent,
    success: colors.success,
    warning: colors.warning,
    danger: colors.danger,
    onAccent: colors.onAccent,
  }[tone];
  return <Glyph size={size} color={color ?? toneColor} strokeWidth={strokeWidth} />;
}
