import type { CSSProperties, ReactNode } from 'react';
import React from 'react';
import { tokens } from './tokens';

const base: CSSProperties = {
  fontFamily: tokens.typography.fontFamily,
  borderRadius: tokens.radius.sm,
  border: 'none',
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: tokens.typography.body,
  transition: 'background 0.15s ease',
};

const variants: Record<'primary' | 'danger' | 'ghost', CSSProperties> = {
  primary: { background: tokens.colors.primary, color: '#fff', padding: '10px 18px' },
  danger: { background: tokens.colors.danger, color: '#fff', padding: '10px 18px' },
  ghost: {
    background: 'transparent',
    color: tokens.colors.primary,
    padding: '8px 12px',
    border: `1px solid ${tokens.colors.border}`,
  },
};

export function Button(props: {
  children: ReactNode;
  onClick?: () => void;
  variant?: keyof typeof variants;
  type?: 'button' | 'submit';
  disabled?: boolean;
  style?: CSSProperties;
}): React.JSX.Element {
  const { children, variant = 'primary', ...rest } = props;
  return (
    <button
      {...rest}
      style={{ ...base, ...variants[variant], opacity: props.disabled ? 0.5 : 1, ...props.style }}
    >
      {children}
    </button>
  );
}

export function TextField(props: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  required?: boolean;
  dir?: 'ltr' | 'rtl' | 'auto';
}): React.JSX.Element {
  return (
    <label style={{ display: 'block', marginBottom: tokens.spacing.md }}>
      {props.label && (
        <span style={{ display: 'block', marginBottom: 4, fontSize: tokens.typography.small, color: tokens.colors.textMuted }}>
          {props.label}
        </span>
      )}
      <input
        type={props.type ?? 'text'}
        value={props.value}
        placeholder={props.placeholder}
        required={props.required}
        dir={props.dir}
        onChange={(e) => props.onChange(e.target.value)}
        style={{
          width: '100%',
          padding: '10px 12px',
          borderRadius: tokens.radius.sm,
          border: `1px solid ${tokens.colors.border}`,
          fontSize: tokens.typography.body,
          fontFamily: tokens.typography.fontFamily,
          boxSizing: 'border-box',
        }}
      />
    </label>
  );
}

export function Card(props: { title?: string; children: ReactNode; style?: CSSProperties }): React.JSX.Element {
  return (
    <div
      style={{
        background: tokens.colors.surface,
        border: `1px solid ${tokens.colors.border}`,
        borderRadius: tokens.radius.md,
        padding: tokens.spacing.lg,
        ...props.style,
      }}
    >
      {props.title && (
        <h2 style={{ marginTop: 0, marginBottom: tokens.spacing.md, fontSize: tokens.typography.h2 }}>{props.title}</h2>
      )}
      {props.children}
    </div>
  );
}

export function Table(props: {
  headers: string[];
  rows: Array<Array<ReactNode>>;
  onRowClick?: (rowIndex: number) => void;
}): React.JSX.Element {
  return (
    <div className="table-scroll">
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: tokens.typography.body }}>
      <thead>
        <tr>
          {props.headers.map((h) => (
            <th key={h} style={{ textAlign: 'left', padding: '10px 12px', borderBottom: `2px solid ${tokens.colors.border}`, color: tokens.colors.textMuted, fontSize: tokens.typography.small }}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {props.rows.map((row, i) => (
          <tr
            key={i}
            style={{
              borderBottom: `1px solid ${tokens.colors.border}`,
              cursor: props.onRowClick ? 'pointer' : 'default',
            }}
            onClick={props.onRowClick ? () => props.onRowClick?.(i) : undefined}
          >
            {row.map((cell, j) => (
              <td key={j} style={{ padding: '10px 12px' }}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  );
}
