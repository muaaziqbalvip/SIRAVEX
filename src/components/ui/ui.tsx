import { useEffect, useState } from 'react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { AlertTriangle, Inbox } from 'lucide-react';

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2" aria-label="SIRAVEX">
      <svg width="34" height="34" viewBox="0 0 64 64" role="img" aria-hidden="true"><rect width="64" height="64" rx="14" fill="#0a1122"/><path d="M42 14c-10-4-22 2-22 12 0 7 6 9 11 11s9 4 9 8c0 5-7 8-14 5" fill="none" stroke="#38bdf8" strokeWidth="5" strokeLinecap="round"/><path d="M28 24l14 8-14 8z" fill="#22d3ee"/></svg>
      {!compact && <span className="leading-none"><span className="block font-extrabold tracking-[0.22em] text-silver">SIRAVEX</span><span className="mt-0.5 block text-[10px] tracking-[0.3em] text-muted">IPTV PLAYER</span></span>}
    </span>
  );
}
export function Button({ variant = 'primary', className = '', ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' | 'outline' }) {
  const base = 'inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx disabled:cursor-not-allowed disabled:opacity-50';
  const styles = variant === 'primary' ? 'bg-sky-500 text-white hover:bg-sky-400 shadow-glow' : variant === 'danger' ? 'bg-red-500/15 text-red-300 hover:bg-red-500/25 border border-red-500/40' : variant === 'outline' ? 'border border-border bg-card text-silver hover:border-sky-500/60' : 'text-silver hover:bg-card';
  return <button className={`${base} ${styles} ${className}`} {...p} />;
}
export function Input(p: InputHTMLAttributes<HTMLInputElement>) { return <input {...p} className={`min-h-[44px] w-full rounded-xl border border-border bg-ink px-3 text-sm text-silver placeholder:text-muted focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-500/40 ${p.className ?? ''}`} />; }
export function Select(p: React.SelectHTMLAttributes<HTMLSelectElement>) { return <select {...p} className={`min-h-[44px] rounded-xl border border-border bg-ink px-3 text-sm text-silver focus:border-sky-400 focus:outline-none ${p.className ?? ''}`} />; }
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) { return <div className={`rounded-2xl border border-border bg-card p-4 shadow-card sm:p-5 ${className}`}>{children}</div>; }
export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return <div className="grid place-items-center rounded-2xl border border-dashed border-border bg-panel px-6 py-14 text-center" role="status"><Inbox className="mb-3 text-sky-400" size={36} aria-hidden /><h2 className="text-lg font-bold text-silver">{title}</h2><p className="mt-2 max-w-md text-sm leading-6 text-muted">{body}</p>{action && <div className="mt-5">{action}</div>}</div>;
}
export function ErrorPanel({ title, body, onRetry }: { title: string; body: string; onRetry?: () => void }) {
  return <div className="rounded-2xl border border-red-500/40 bg-red-950/30 p-5" role="alert"><div className="flex gap-3"><AlertTriangle className="shrink-0 text-red-300" aria-hidden /><div><h2 className="font-bold text-red-100">{title}</h2><p className="mt-1 text-sm leading-6 text-red-200/90">{body}</p>{onRetry && <Button variant="danger" className="mt-3" onClick={onRetry}>Retry</Button>}</div></div></div>;
}
export function Skeleton({ className = '' }: { className?: string }) { return <div className={`animate-pulse rounded-xl bg-card ${className}`} aria-hidden />; }
export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} className={`relative h-7 w-12 shrink-0 rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyanx ${checked ? 'bg-sky-500' : 'bg-slate-700'}`}><span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`} /></button>;
}
export function ConfirmDialog({ open, title, body, confirmLabel, onCancel, onConfirm }: { open: boolean; title: string; body: string; confirmLabel: string; onCancel: () => void; onConfirm: () => void }) {
  if (!open) return null;
  return <div className="fixed inset-0 z-[70] grid place-items-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label={title} onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}>
    <div className="w-full max-w-md rounded-2xl border border-border bg-panel p-6 shadow-card"><h2 className="text-lg font-bold">{title}</h2><p className="mt-2 text-sm leading-6 text-muted">{body}</p><div className="mt-6 flex justify-end gap-2"><Button variant="ghost" onClick={onCancel} autoFocus>Cancel</Button><Button variant="danger" onClick={onConfirm}>{confirmLabel}</Button></div></div></div>;
}
export function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const h = Math.floor(sec / 3600); const m = Math.floor((sec % 3600) / 60); const s = Math.floor(sec % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
export function useDebounced<T>(value: T, delay = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), delay); return () => clearTimeout(t); }, [value, delay]);
  return v;
}
