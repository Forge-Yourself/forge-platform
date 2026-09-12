import type { CSSProperties } from 'react';

/**
 * Small shared style objects for the admin surface, built on the CSS custom
 * properties generated into `app/globals.css`. There is no component library
 * on the web side yet (mirrors `app/page.tsx`'s existing inline-style
 * convention) — this file just avoids repeating the same literals across
 * `/login`, `/admin`, and `/admin/users/[id]`.
 */

export const page: CSSProperties = {
  minHeight: '100dvh',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--s-6)',
  padding: 'var(--s-7)',
  maxWidth: '960px',
  margin: '0 auto',
};

export const kicker: CSSProperties = {
  fontSize: 'var(--type-label-size)',
  fontWeight: 'var(--type-label-weight)',
  letterSpacing: 'var(--type-label-tracking)',
  textTransform: 'uppercase',
  color: 'var(--accent-text)',
  margin: 0,
};

export const h1: CSSProperties = {
  fontSize: 'var(--type-h-1-size)',
  fontWeight: 'var(--type-h-1-weight)',
  letterSpacing: 'var(--type-h-1-tracking)',
  margin: 0,
};

export const h2: CSSProperties = {
  fontSize: 'var(--type-h-2-size)',
  fontWeight: 'var(--type-h-2-weight)',
  margin: 0,
};

export const label: CSSProperties = {
  fontSize: 'var(--type-caption-size)',
  fontWeight: 700,
  color: 'var(--text-secondary)',
  display: 'block',
  marginBottom: 'var(--s-1)',
};

export const input: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: 'var(--s-3)',
  borderRadius: 'var(--r-md)',
  border: '1px solid var(--border)',
  background: 'var(--surface-raised)',
  color: 'var(--text-primary)',
  fontSize: 'var(--type-body-size)',
  fontFamily: 'var(--font-sans)',
};

export const button: CSSProperties = {
  padding: 'var(--s-3) var(--s-5)',
  borderRadius: 'var(--r-md)',
  border: 'none',
  background: 'var(--primary)',
  color: 'var(--on-primary)',
  fontSize: 'var(--type-body-bold-size)',
  fontWeight: 'var(--type-body-bold-weight)',
  cursor: 'pointer',
};

export const buttonSecondary: CSSProperties = {
  ...button,
  background: 'var(--surface-raised)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border)',
};

export const card: CSSProperties = {
  background: 'var(--surface-raised)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--r-lg)',
  padding: 'var(--s-6)',
};

export const errorText: CSSProperties = {
  color: 'var(--danger-accent)',
  background: 'var(--danger-surface)',
  padding: 'var(--s-3)',
  borderRadius: 'var(--r-md)',
  fontSize: 'var(--type-caption-size)',
  margin: 0,
};

export const table: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 'var(--type-body-size)',
};

export const th: CSSProperties = {
  textAlign: 'left',
  padding: 'var(--s-2) var(--s-3)',
  borderBottom: '1px solid var(--border)',
  color: 'var(--text-secondary)',
  fontSize: 'var(--type-caption-size)',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
};

export const td: CSSProperties = {
  padding: 'var(--s-2) var(--s-3)',
  borderBottom: '1px solid var(--border)',
};

export const badge: CSSProperties = {
  display: 'inline-block',
  padding: '2px var(--s-2)',
  borderRadius: 'var(--r-pill)',
  fontSize: 'var(--type-caption-size)',
  fontWeight: 700,
};

export const dangerBadge: CSSProperties = {
  ...badge,
  background: 'var(--danger-surface)',
  color: 'var(--on-danger-surface)',
};

export const neutralBadge: CSSProperties = {
  ...badge,
  background: 'var(--accent-surface-soft)',
  color: 'var(--on-accent-surface-soft)',
};

export const link: CSSProperties = {
  color: 'var(--accent-text)',
  textDecoration: 'none',
};

export const muted: CSSProperties = {
  color: 'var(--text-muted)',
  fontSize: 'var(--type-caption-size)',
};

export const fieldRow: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(160px, 220px) 1fr',
  gap: 'var(--s-3)',
  padding: 'var(--s-2) 0',
  borderBottom: '1px solid var(--border)',
};
