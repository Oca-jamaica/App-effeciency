/* Shared preview UI: hooks, contexts and primitives. React is a page global (UMD). */
import { addDays } from '../../../packages/domain/src/index.ts';
import { store } from './store.ts';
import { dateLabel } from './logic.ts';

declare const React: typeof import('react');
declare const ReactDOM: { createRoot(el: Element): { render(node: import('react').ReactNode): void } };
const { useState, useEffect, useMemo, useRef, useSyncExternalStore, createContext, useContext } = React;
export type Node = import('react').ReactNode;

// ───────────────────────────── hooks & shared state ─────────────────────────────

export function useData() {
  useSyncExternalStore((cb) => store.subscribe(cb), () => store.getVersion());
}
export function useNow() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export type ToastFn = (msg: string, undo?: () => void) => void;
export const ToastCtx = createContext<ToastFn>(() => undefined);
export const useToast = () => useContext(ToastCtx);

export type Route = { type: 'goal' | 'habit' | 'task' | 'project' | 'workout' | 'coll' | 'skill'; id: string } | null;
export const NavCtx = createContext<{ open: (r: Route) => void; capture: () => void; go: (tab: string, sub?: string) => void }>({ open: () => undefined, capture: () => undefined, go: () => undefined });
export const useNav = () => useContext(NavCtx);

// ───────────────────────────── primitives ─────────────────────────────

export function Btn({ children, onClick, kind = 'primary', small, disabled, full }: { children: Node; onClick: () => void; kind?: 'primary' | 'secondary' | 'ghost' | 'danger'; small?: boolean; disabled?: boolean; full?: boolean }) {
  return (
    <button type="button" className={`btn btn-${kind}${small ? ' btn-sm' : ''}${full ? ' btn-full' : ''}`} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}
export function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: Node }) {
  return (
    <button type="button" className="icon-btn" aria-label={label} title={label} onClick={onClick}>
      {children}
    </button>
  );
}
export function Check({ checked, onChange, label, square, partial }: { checked: boolean; onChange: () => void; label: string; square?: boolean; partial?: boolean }) {
  return (
    <button type="button" role="checkbox" aria-checked={partial ? 'mixed' : checked} aria-label={label} className={`check${square ? ' check-sq' : ''}${checked ? ' on' : ''}${partial ? ' part' : ''}`} onClick={(e) => { e.stopPropagation(); onChange(); }}>
      {checked ? <svg viewBox="0 0 16 16" width="12" height="12"><path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg> : null}
    </button>
  );
}
export function Seg<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="seg" role="tablist">
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={o.value === value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
export function Chips<T extends string | number>({ value, onChange, options }: { value: T | T[] | null; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  const sel = (v: T) => (Array.isArray(value) ? value.includes(v) : value === v);
  return (
    <div className="chips">
      {options.map((o) => (
        <button key={String(o.value)} type="button" aria-pressed={sel(o.value)} className={`chip${sel(o.value) ? ' on' : ''}`} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
export function Field({ label, children, hint, error }: { label: string; children: Node; hint?: string; error?: string | null }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {error ? <span className="field-error">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}
export function Section({ title, action, onAction, children, hint }: { title: string; action?: string; onAction?: () => void; children: Node; hint?: string }) {
  return (
    <section className="section">
      <div className="section-head">
        <h2>{title}</h2>
        {action && onAction ? <button type="button" className="link-btn" onClick={onAction}>{action}</button> : null}
      </div>
      {hint ? <p className="muted small">{hint}</p> : null}
      {children}
    </section>
  );
}
export function Row({ title, sub, lead, trail, onClick, muted }: { title: Node; sub?: Node; lead?: Node; trail?: Node; onClick?: () => void; muted?: boolean }) {
  const inner = (
    <>
      {lead}
      <div className="row-main">
        <div className={`row-title${muted ? ' done' : ''}`}>{title}</div>
        {sub ? <div className="row-sub">{sub}</div> : null}
      </div>
      {trail}
      {onClick ? <span className="chev" aria-hidden="true">›</span> : null}
    </>
  );
  return onClick ? (
    <div className="row row-btn" role="button" tabIndex={0} onClick={onClick} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onClick()}>{inner}</div>
  ) : (
    <div className="row">{inner}</div>
  );
}
export function Empty({ title, body, action, onAction }: { title: string; body: string; action?: string; onAction?: () => void }) {
  return (
    <div className="empty">
      <div className="empty-title">{title}</div>
      <p className="muted">{body}</p>
      {action && onAction ? <Btn kind="secondary" small onClick={onAction}>{action}</Btn> : null}
    </div>
  );
}
export function Bar({ value }: { value: number | null }) {
  return (
    <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((value ?? 0) * 100)}>
      <div style={{ width: `${Math.max(0, Math.min(1, value ?? 0)) * 100}%` }} />
    </div>
  );
}
export function Sheet({ title, onClose, children, footer }: { title: string; onClose: () => void; children: Node; footer?: Node }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h3>{title}</h3>
          <IconBtn label="Close" onClick={onClose}>✕</IconBtn>
        </div>
        <div className="sheet-body">{children}</div>
        {footer ? <div className="sheet-foot">{footer}</div> : null}
      </div>
    </div>
  );
}
export function ConfirmButton({ label, confirmLabel, onConfirm }: { label: string; confirmLabel: string; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  return armed ? (
    <div className="confirm">
      <span className="muted small">Are you sure?</span>
      <Btn kind="danger" small onClick={onConfirm}>{confirmLabel}</Btn>
      <Btn kind="ghost" small onClick={() => setArmed(false)}>Cancel</Btn>
    </div>
  ) : (
    <Btn kind="danger" small onClick={() => setArmed(true)}>{label}</Btn>
  );
}
export function Badge({ children, tone = 'neutral' }: { children: Node; tone?: 'neutral' | 'accent' | 'warn' | 'good' | 'bad' }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
export function Stepper({ value, onChange, min, max, step = 5, fmt }: { value: number; onChange: (v: number) => void; min: number; max: number; step?: number; fmt?: (v: number) => string }) {
  return (
    <div className="stepper">
      <button type="button" aria-label="Decrease" disabled={value <= min} onClick={() => onChange(Math.max(min, value - step))}>−</button>
      <span className="num">{fmt ? fmt(value) : value}</span>
      <button type="button" aria-label="Increase" disabled={value >= max} onClick={() => onChange(Math.min(max, value + step))}>+</button>
    </div>
  );
}
export const mins = (v: number) => (v >= 60 ? `${Math.floor(v / 60)}h${v % 60 ? ` ${v % 60}m` : ''}` : `${v} min`);
export const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export function DueBadge({ date, today }: { date: string; today: string }) {
  if (date < today) return <Badge tone="bad">Overdue</Badge>;
  if (date === today) return <Badge tone="warn">Today</Badge>;
  if (date === addDays(today, 1)) return <Badge tone="accent">Tomorrow</Badge>;
  return <Badge>{dateLabel(date)}</Badge>;
}

export const DAYS = [1, 2, 3, 4, 5, 6, 0].map((d) => ({ value: d, label: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]! }));

