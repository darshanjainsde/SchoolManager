export default function DashboardPage() {
  return (
    <>
      <div className="lbx-pagehead">
        <div>
          <h2>Today at the library</h2>
          <p>Signed in. The desk and catalogue screens land next.</p>
        </div>
      </div>
      <p style={{ color: 'var(--lb-ink-2)', fontSize: '.9rem', maxWidth: '38rem' }}>
        This is the shell and the design system, wired to the real API — the login you
        just used hit <code>POST /auth/login</code> on the library service and stored a
        genuine token. Catalogue, circulation desk, holds, overdue and fines fill in
        from here.
      </p>
    </>
  );
}
