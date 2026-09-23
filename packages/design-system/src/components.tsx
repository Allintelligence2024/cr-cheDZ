import type { CSSProperties, ReactNode } from 'react';
import React from 'react';
import { tokens } from './tokens';

/* ============================================================================
 * Composants partagés — thème « Sérénité ».
 * Les couleurs proviennent de `tokens` (→ var(--c-*)), donc tout suit
 * automatiquement la bascule clair/sombre.
 * ========================================================================= */

const base: CSSProperties = {
  fontFamily: tokens.typography.fontFamily,
  borderRadius: tokens.radius.sm,
  border: '1px solid transparent',
  cursor: 'pointer',
  fontWeight: 650,
  fontSize: tokens.typography.body,
  transition: 'background .15s ease, border-color .15s ease, color .15s ease, box-shadow .15s ease',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  lineHeight: 1.2,
  /* Cible tactile : 44 px recommandés par les guides iOS/Android. */
  minHeight: 40,
};

const variants: Record<'primary' | 'danger' | 'ghost' | 'subtle', CSSProperties> = {
  primary: {
    background: tokens.colors.primary,
    color: tokens.colors.primaryContrast,
    padding: '10px 18px',
    boxShadow: tokens.shadows.sm,
  },
  danger: {
    background: tokens.colors.danger,
    color: '#fff',
    padding: '10px 18px',
    boxShadow: tokens.shadows.sm,
  },
  ghost: {
    background: tokens.colors.surface,
    color: tokens.colors.primary,
    padding: '9px 15px',
    borderColor: tokens.colors.border,
  },
  subtle: {
    background: tokens.colors.primarySoft,
    color: tokens.colors.primary,
    padding: '9px 15px',
    borderColor: tokens.colors.primaryBorder,
  },
};

export function Button(props: {
  children: ReactNode;
  onClick?: () => void;
  variant?: keyof typeof variants;
  type?: 'button' | 'submit';
  disabled?: boolean;
  style?: CSSProperties;
  title?: string;
  'aria-label'?: string;
}): React.JSX.Element {
  const { children, variant = 'primary', style, ...rest } = props;
  return (
    <button
      {...rest}
      className="ds-button"
      style={{
        ...base,
        ...variants[variant],
        opacity: props.disabled ? 0.55 : 1,
        cursor: props.disabled ? 'not-allowed' : 'pointer',
        ...style,
      }}
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
  disabled?: boolean;
  hint?: string;
}): React.JSX.Element {
  return (
    <label style={{ display: 'block', marginBottom: tokens.spacing.md }}>
      {/*
        L'astérisque « champ obligatoire » est dessinée en CSS (::after sur
        .ds-field-required, cf. base.css) et NON insérée dans le DOM.

        Raison : le texte d'un <label> est calculé par concaténation des
        nœuds de texte descendants. Un <span> « * », même en aria-hidden,
        reste un nœud de texte : le libellé devient « Prénom * » et toute
        recherche par libellé exact ne trouve plus le champ — y compris
        getByLabel(..., { exact: true }) côté Playwright, qui n'applique
        aucun filtre aria-hidden (vérifié dans son implémentation : seuls
        SCRIPT/NOSCRIPT/STYLE et <head> sont ignorés).

        Le contenu généré par ::after n'appartient pas au DOM : le libellé
        reste exactement « Prénom ». L'état obligatoire est porté par
        l'attribut `required` de l'<input>, source de vérité pour
        l'accessibilité comme pour la validation native.
      */}
      {props.label && (
        <span
          className={props.required ? 'ds-field-label ds-field-required' : 'ds-field-label'}
          style={{
            display: 'block',
            marginBottom: 6,
            fontSize: tokens.typography.small,
            color: tokens.colors.textMuted,
            fontWeight: 600,
          }}
        >
          {props.label}
        </span>
      )}
      <input
        type={props.type ?? 'text'}
        value={props.value}
        placeholder={props.placeholder}
        required={props.required}
        disabled={props.disabled}
        dir={props.dir}
        onChange={(e) => props.onChange(e.target.value)}
        style={{ width: '100%', boxSizing: 'border-box' }}
      />
      {props.hint && (
        <span style={{ display: 'block', marginTop: 5, fontSize: tokens.typography.small, color: tokens.colors.textFaint }}>
          {props.hint}
        </span>
      )}
    </label>
  );
}

export function Card(props: {
  title?: string;
  children: ReactNode;
  style?: CSSProperties;
  actions?: ReactNode;
}): React.JSX.Element {
  return (
    <section className="ds-card card-responsive" style={props.style}>
      {(props.title || props.actions) && (
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: tokens.spacing.md,
            flexWrap: 'wrap',
            marginBottom: tokens.spacing.md,
          }}
        >
          {props.title && (
            <h2 style={{ margin: 0, fontSize: tokens.typography.h2, fontWeight: 700, flex: 1, minWidth: 0 }}>
              {props.title}
            </h2>
          )}
          {props.actions}
        </header>
      )}
      {props.children}
    </section>
  );
}

/**
 * Table responsive.
 *
 * Au-dessus de 640 px : tableau classique.
 * En dessous : chaque ligne devient une carte empilée (CSS `.ds-table-cards`),
 * les en-têtes étant réinjectés via `data-label` — plus lisible qu'un scroll
 * horizontal sur téléphone.
 */
export function Table(props: {
  headers: string[];
  rows: Array<Array<ReactNode>>;
  onRowClick?: (rowIndex: number) => void;
  empty?: string;
}): React.JSX.Element {
  if (props.rows.length === 0 && props.empty) {
    return (
      <p
        style={{
          color: tokens.colors.textMuted,
          textAlign: 'center',
          padding: `${tokens.spacing.lg}px 0`,
          margin: 0,
        }}
      >
        {props.empty}
      </p>
    );
  }

  return (
    <div className="table-scroll">
      <table className="ds-table ds-table-cards">
        <thead>
          <tr>
            {props.headers.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row, i) => (
            <tr
              key={i}
              style={{ cursor: props.onRowClick ? 'pointer' : 'default' }}
              onClick={props.onRowClick ? () => props.onRowClick?.(i) : undefined}
            >
              {row.map((cell, j) => (
                <td key={j} data-label={props.headers[j] ?? ''}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Pastille d'état — couleur + texte (jamais la couleur seule). */
export function Badge(props: {
  children: ReactNode;
  tone?: 'success' | 'warning' | 'danger' | 'info' | 'neutral';
}): React.JSX.Element {
  return <span className={`ds-badge ds-badge-${props.tone ?? 'neutral'}`}>{props.children}</span>;
}
