import type { LucideIcon } from "lucide-react";

export function PageIntro({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description: string; actions?: React.ReactNode }) {
  return <div className="page-intro"><div>{eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}<h2>{title}</h2><p>{description}</p></div>{actions ? <div className="page-actions">{actions}</div> : null}</div>;
}

export function StatusBadge({ status, label }: { status: string; label: string }) {
  return <span className={`status-badge status-${status.toLowerCase().replaceAll("_", "-")}`}><i />{label}</span>;
}

export function Metric({ label, value, detail, icon: Icon, tone = "green" }: { label: string; value: string | number; detail: string; icon: LucideIcon; tone?: string }) {
  return <div className="metric"><div className={`metric-icon tone-${tone}`}><Icon size={19} /></div><div className="metric-value">{value}</div><div className="metric-label">{label}</div><div className="metric-detail">{detail}</div></div>;
}

export function Score({ value, label }: { value: number; label: string }) {
  return <div className="score"><strong>{value}</strong><span>{label}</span></div>;
}

export function EmptyState({ icon: Icon, title, description }: { icon: LucideIcon; title: string; description: string }) {
  return <div className="empty-state"><Icon size={28} /><strong>{title}</strong><p>{description}</p></div>;
}
