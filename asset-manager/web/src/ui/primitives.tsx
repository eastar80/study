import type { ReactNode } from 'react'

export function Card({
  title,
  action,
  children,
  className = '',
}: {
  title?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section
      className={`rounded-2xl border bg-[var(--card)] ${className}`}
      style={{ borderColor: 'var(--line)' }}
    >
      {(title || action) && (
        <header
          className="flex items-center justify-between gap-3 border-b px-5 py-3.5"
          style={{ borderColor: 'var(--line)' }}
        >
          <h2 className="text-[15px] font-semibold">{title}</h2>
          {action}
        </header>
      )}
      <div className="px-5 py-4">{children}</div>
    </section>
  )
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  disabled,
  type = 'button',
}: {
  children: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'ghost' | 'danger'
  disabled?: boolean
  type?: 'button' | 'submit'
}) {
  const styles = {
    primary: 'bg-brand-600 text-white hover:bg-brand-700',
    ghost: 'border bg-transparent hover:bg-[var(--surface)]',
    danger: 'border border-rose-300 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30',
  }[variant]

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={variant === 'ghost' ? { borderColor: 'var(--line)' } : undefined}
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${styles}`}
    >
      {children}
    </button>
  )
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode
  tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'brand'
}) {
  const tones = {
    neutral: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
    good: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
    warn: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
    bad: 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300',
    brand: 'bg-brand-100 text-brand-700 dark:bg-brand-700/25 dark:text-brand-200',
  }[tone]

  return (
    <span className={`inline-flex shrink-0 rounded-md px-2 py-0.5 text-xs font-medium ${tones}`}>
      {children}
    </span>
  )
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: ReactNode
  children: ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      {children}
      {hint && (
        <span className="mt-1.5 block text-xs leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
          {hint}
        </span>
      )}
    </label>
  )
}

export function TextInput({
  value,
  onChange,
  placeholder,
  mono,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  mono?: boolean
}) {
  return (
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      spellCheck={false}
      autoComplete="off"
      className={`w-full rounded-xl border bg-transparent px-3 py-2 text-sm outline-none focus:border-brand-500 ${mono ? 'font-mono text-xs' : ''}`}
      style={{ borderColor: 'var(--line)' }}
    />
  )
}

export function Muted({ children }: { children: ReactNode }) {
  return (
    <p className="text-sm leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
      {children}
    </p>
  )
}

export function Alert({ tone, children }: { tone: 'info' | 'warn' | 'error'; children: ReactNode }) {
  const tones = {
    info: 'border-brand-200 bg-brand-50 text-brand-700 dark:border-brand-700/40 dark:bg-brand-700/10 dark:text-brand-200',
    warn: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700/40 dark:bg-amber-950/40 dark:text-amber-200',
    error: 'border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-800/50 dark:bg-rose-950/40 dark:text-rose-200',
  }[tone]

  return <div className={`rounded-xl border px-4 py-3 text-sm leading-relaxed ${tones}`}>{children}</div>
}
