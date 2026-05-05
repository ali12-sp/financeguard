export default function StatCard({ title, value, note }: { title: string; value: string; note: string }) {
  return (
    <div className="card">
      <div style={{ color: 'var(--muted)', marginBottom: 8 }}>{title}</div>
      <div style={{ fontSize: 30, fontWeight: 700, marginBottom: 8 }}>{value}</div>
      <div style={{ color: 'var(--muted)' }}>{note}</div>
    </div>
  );
}
