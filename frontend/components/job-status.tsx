"use client";

type StatusItem = {
  label: string;
  value: string;
};

type JobStatusProps = {
  title: string;
  tag: string;
  stats: StatusItem[];
  note: string;
  error?: string | null;
};

export function JobStatus({ title, tag, stats, note, error }: JobStatusProps) {
  return (
    <section className="panel span-8">
      <div className="panel-header">
        <div>
          <p className="panel-kicker">Job Status</p>
          <h2 className="panel-title">{title}</h2>
        </div>
        <span className="panel-tag">{tag}</span>
      </div>
      <div className="status-grid">
        {stats.map((item) => (
          <div key={item.label} className="status-card">
            <p className="status-label">{item.label}</p>
            <p className="status-value">{item.value}</p>
          </div>
        ))}
      </div>
      <p className="panel-meta">{error ? error : note}</p>
    </section>
  );
}
