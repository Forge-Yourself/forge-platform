export default function Home() {
  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 'var(--s-4)',
        padding: 'var(--s-7)',
      }}
    >
      <p
        style={{
          fontSize: 'var(--type-label-size)',
          fontWeight: 'var(--type-label-weight)',
          letterSpacing: 'var(--type-label-tracking)',
          textTransform: 'uppercase',
          color: 'var(--accent-text)',
          margin: 0,
        }}
      >
        Forge
      </p>
      <h1
        style={{
          fontSize: 'var(--type-h1-size)',
          fontWeight: 'var(--type-h1-weight)',
          letterSpacing: 'var(--type-h1-tracking)',
          margin: 0,
        }}
      >
        Platform admin
      </h1>
      <p style={{ color: 'var(--text-secondary)', margin: 0, maxWidth: '60ch' }}>
        Internal only. Staff sign-in and user search arrive in M1.
      </p>
      <p style={{ color: 'var(--text-muted)', margin: 0, fontFamily: 'var(--font-mono)' }}>
        <a href="/api/health" style={{ color: 'var(--accent-text)' }}>
          /api/health
        </a>
      </p>
    </main>
  );
}
