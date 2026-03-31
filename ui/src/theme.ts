import type { CSSProperties } from 'react';

// ── Color palette ──────────────────────────────────────────────────────
export const colors = {
  red: '#dc2626',
  redText: '#fca5a5',
  redBorder: 'rgba(185,28,28,0.15)',
  redGlow: 'rgba(185,28,28,0.1)',
  green: '#16a34a',
  greenText: '#4ade80',
  greenBorder: 'rgba(22,163,106,0.15)',
  greenGlow: 'rgba(22,163,106,0.06)',
  amber: '#d97706',
  amberText: '#fbbf24',
  amberBorder: 'rgba(217,119,6,0.15)',
  amberGlow: 'rgba(217,119,6,0.06)',
  blue: '#60a5fa',
  blueText: '#93c5fd',
  blueBorder: 'rgba(96,165,250,0.12)',
  blueGlow: 'rgba(96,165,250,0.06)',
  purple: '#7c3aed',
  purpleText: '#a78bfa',
  textPrimary: '#FFFFFF',
  textSecondary: 'rgba(255,255,255,0.55)',
  textMuted: 'rgba(255,255,255,0.3)',
  textDim: 'rgba(255,255,255,0.15)',
};

// ── Shared box-shadow strings ──────────────────────────────────────────
export const shadows = {
  card: '0 4px 24px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.1), inset 0 -0.5px 0 rgba(255,255,255,0.03)',
  cardInner: 'inset 0 1px 0 rgba(255,255,255,0.06), inset 0 -0.5px 0 rgba(255,255,255,0.02)',
  btn: 'inset 0 1px 0 rgba(255,255,255,0.08)',
  btnRed: '0 2px 8px rgba(185,28,28,0.08), inset 0 1px 0 rgba(255,255,255,0.06)',
  btnGreen: '0 2px 8px rgba(22,163,106,0.06), inset 0 1px 0 rgba(255,255,255,0.06)',
  btnBlue: '0 2px 8px rgba(96,165,250,0.06), inset 0 1px 0 rgba(255,255,255,0.06)',
  primaryCta: '0 4px 16px rgba(220,38,38,0.35), 0 8px 32px rgba(185,28,28,0.15), inset 0 1px 0 rgba(255,255,255,0.12)',
  primaryCtaHover: '0 6px 24px rgba(220,38,38,0.45), 0 12px 40px rgba(185,28,28,0.2), inset 0 1px 0 rgba(255,255,255,0.15)',
  nav: '0 1px 0 rgba(255,255,255,0.03), 0 4px 20px rgba(0,0,0,0.3)',
  dotCritical: '0 0 10px rgba(220,38,38,0.5)',
  dotWarning: '0 0 8px rgba(217,119,6,0.4)',
  dotHealthy: '0 0 6px rgba(22,163,106,0.5)',
  dotInfo: '0 0 6px rgba(96,165,250,0.4)',
  alertCritical: '0 2px 12px rgba(185,28,28,0.08), inset 0 1px 0 rgba(255,255,255,0.05)',
};

// ── Reusable style objects ─────────────────────────────────────────────

/** Glass card — the base surface for every panel/card/container */
export const glassCard: CSSProperties = {
  background: 'linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02))',
  backdropFilter: 'blur(24px) saturate(1.5)',
  WebkitBackdropFilter: 'blur(24px) saturate(1.5)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 16,
  boxShadow: shadows.card,
};

/** Inner glass panel — nested inside a glass card (lighter treatment) */
export const glassCardInner: CSSProperties = {
  background: 'linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.015))',
  border: '1px solid rgba(255,255,255,0.06)',
  borderRadius: 10,
  boxShadow: shadows.cardInner,
};

/** Section / stat label — tiny mono uppercase */
export const sectionLabel: CSSProperties = {
  fontFamily: "'IBM Plex Mono', monospace",
  fontSize: 8,
  color: 'rgba(255,255,255,0.2)',
  textTransform: 'uppercase',
  letterSpacing: 1.5,
};

/** Table header cell style */
export const thStyle: CSSProperties = {
  textAlign: 'left',
  padding: '10px 16px',
  fontSize: 9,
  fontFamily: "'IBM Plex Mono', monospace",
  color: 'rgba(255,255,255,0.2)',
  textTransform: 'uppercase',
  letterSpacing: 1.5,
  fontWeight: 500,
};

/** Table data cell style */
export const tdStyle: CSSProperties = {
  padding: '9px 16px',
  color: 'rgba(255,255,255,0.55)',
};

/** Gradient separator — replaces solid border dividers */
export const gradientSeparator: CSSProperties = {
  height: 1,
  background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.06), transparent)',
  border: 'none',
  margin: '12px 0',
};

/** Glass button — default frosted glass */
export const glassBtn: CSSProperties = {
  padding: '5px 12px',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 8,
  fontSize: 10,
  fontFamily: "'IBM Plex Mono', monospace",
  background: 'linear-gradient(135deg, rgba(255,255,255,0.07), rgba(255,255,255,0.02))',
  color: 'rgba(255,255,255,0.5)',
  boxShadow: shadows.btn,
  cursor: 'pointer',
  transition: 'all 0.2s',
};

/** Glass button hover state */
export const glassBtnHover: CSSProperties = {
  background: 'linear-gradient(135deg, rgba(255,255,255,0.1), rgba(255,255,255,0.04))',
  borderColor: 'rgba(255,255,255,0.12)',
};

/** Red button variant */
export const glassBtnRed: CSSProperties = {
  ...glassBtn,
  borderColor: 'rgba(185,28,28,0.15)',
  background: 'linear-gradient(135deg, rgba(185,28,28,0.12), rgba(185,28,28,0.05))',
  color: colors.redText,
  boxShadow: shadows.btnRed,
};

/** Green button variant */
export const glassBtnGreen: CSSProperties = {
  ...glassBtn,
  borderColor: 'rgba(22,163,106,0.12)',
  background: 'linear-gradient(135deg, rgba(22,163,106,0.1), rgba(22,163,106,0.03))',
  color: colors.greenText,
  boxShadow: shadows.btnGreen,
};

/** Blue button variant */
export const glassBtnBlue: CSSProperties = {
  ...glassBtn,
  borderColor: 'rgba(96,165,250,0.12)',
  background: 'linear-gradient(135deg, rgba(96,165,250,0.1), rgba(96,165,250,0.03))',
  color: colors.blueText,
  boxShadow: shadows.btnBlue,
};

/** Filter button — toggle group style */
export const filterBtn: CSSProperties = {
  ...glassBtn,
  padding: '7px 16px',
  fontFamily: 'inherit',
  fontSize: 12,
};

/** Active filter button (red accent) */
export const filterBtnActive: CSSProperties = {
  ...filterBtn,
  borderColor: 'rgba(185,28,28,0.25)',
  color: colors.redText,
  background: 'linear-gradient(135deg, rgba(185,28,28,0.15), rgba(185,28,28,0.06))',
  boxShadow: '0 2px 10px rgba(185,28,28,0.1), inset 0 1px 0 rgba(255,255,255,0.08)',
};

/** Glass input field */
export const glassInput: CSSProperties = {
  padding: '7px 14px',
  borderRadius: 10,
  background: 'linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02))',
  border: '1px solid rgba(255,255,255,0.08)',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06)',
  color: 'rgba(255,255,255,0.7)',
  fontSize: 11,
  outline: 'none',
  transition: 'border-color 0.2s',
};

/** Glass select (same as input but with min-width) */
export const glassSelect: CSSProperties = {
  ...glassInput,
  minWidth: 120,
  fontFamily: 'inherit',
  fontSize: 12,
};

/** Code block styling */
export const codeBlock: CSSProperties = {
  background: 'linear-gradient(180deg, rgba(0,0,0,0.35), rgba(0,0,0,0.25))',
  border: '1px solid rgba(255,255,255,0.06)',
  borderRadius: 12,
  padding: 16,
  fontSize: 11,
  fontFamily: "'IBM Plex Mono', monospace",
  color: 'rgba(255,255,255,0.55)',
  lineHeight: 1.75,
  boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.2), inset 0 -1px 0 rgba(255,255,255,0.03)',
  overflow: 'auto',
  maxHeight: 300,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
};

/** Tooltip content style for Recharts */
export const chartTooltip: CSSProperties = {
  background: 'linear-gradient(135deg, rgba(15,15,15,0.95), rgba(5,5,5,0.9))',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 10,
  fontSize: 12,
  boxShadow: '0 4px 20px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.06)',
  backdropFilter: 'blur(16px)',
};

// ── Pill / badge helpers ───────────────────────────────────────────────

export function pillStyle(bg: string, text: string, border: string): CSSProperties {
  return {
    background: `linear-gradient(135deg, ${bg}, ${bg.replace(/[\d.]+\)$/, (m) => `${Math.max(0, parseFloat(m) * 0.4).toFixed(2)})}`)})`,
    color: text,
    border: `1px solid ${border}`,
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08)',
    padding: '2px 8px',
    borderRadius: 6,
    fontSize: 10,
    fontWeight: 600,
    fontFamily: "'IBM Plex Mono', monospace",
  };
}

// ── Row hover helper ───────────────────────────────────────────────────

export const rowHoverBg = 'linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))';
export const rowHoverShadow = 'inset 0 1px 0 rgba(255,255,255,0.04)';
