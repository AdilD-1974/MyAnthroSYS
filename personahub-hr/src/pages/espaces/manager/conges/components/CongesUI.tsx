import React from 'react'
import type { DemiJournee, LienHierarchique, StatutDemande } from '../types'

// ─── Avatar ───────────────────────────────────────────────────────────────────
const AVATAR_COLORS: Record<string, string> = {
  teal:   'bg-[#9FE1CB] text-[#085041]',
  blue:   'bg-[#B5D4F4] text-[#0C447C]',
  coral:  'bg-[#F5C4B3] text-[#712B13]',
  purple: 'bg-[#CECBF6] text-[#3C3489]',
  green:  'bg-[#C0DD97] text-[#27500A]',
}

export function Avatar({ initiales, color }: { initiales: string; color: string }) {
  return (
    <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[9px] font-medium flex-shrink-0 ${AVATAR_COLORS[color] || AVATAR_COLORS.blue}`}>
      {initiales}
    </span>
  )
}

// ─── Badge statut ─────────────────────────────────────────────────────────────
const STATUT_CONFIG: Record<StatutDemande, { cls: string; dot: string; label: string }> = {
  EN_ATTENTE: { cls: 'bg-[#FAEEDA] text-[#854F0B]', dot: '#854F0B', label: 'En attente'  },
  APPROUVEE:  { cls: 'bg-[#EAF3DE] text-[#3B6D11]', dot: '#3B6D11', label: 'Approuvée'   },
  REFUSEE:    { cls: 'bg-[#FCEBEB] text-[#A32D2D]', dot: '#A32D2D', label: 'Refusée'     },
}

export function StatutBadge({ statut, label }: { statut: StatutDemande; label?: string }) {
  const cfg = STATUT_CONFIG[statut]
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap ${cfg.cls}`}>
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: cfg.dot }} />
      {label ?? cfg.label}
    </span>
  )
}

// ─── Type de congé ────────────────────────────────────────────────────────────
export function TypeCongeCell({ code, libelle }: { code: string; libelle: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[12px] font-medium text-gray-900 dark:text-gray-100">{libelle}</span>
      <span className="text-[10px] text-gray-400">{code}</span>
    </div>
  )
}

// ─── Demi-journée pill ────────────────────────────────────────────────────────
const DJ_CONFIG: Record<DemiJournee, string> = {
  'Matin':           'bg-[#FAEEDA] text-[#854F0B]',
  'Après-midi':      'bg-[#EEEDFE] text-[#3C3489]',
  'Journée entière': 'bg-[#EAF3DE] text-[#3B6D11]',
}

export function DjPill({ dj }: { dj: DemiJournee }) {
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium inline-block ${DJ_CONFIG[dj] || ''}`}>
      {dj}
    </span>
  )
}

// ─── Cellule date + demi-journée ──────────────────────────────────────────────
export function DateDjCell({ date, dj }: { date: string; dj: DemiJournee }) {
  const formatted = new Date(date).toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[12px] font-medium text-gray-900 dark:text-gray-100">{formatted}</span>
      <DjPill dj={dj} />
    </div>
  )
}

// ─── Lien hiérarchique ────────────────────────────────────────────────────────
export function HierPill({ lien }: { lien: LienHierarchique }) {
  if (lien === 'N1') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-[#E6F1FB] text-[#185FA5]">
        <i className="ti ti-user text-[11px]" />
        N+1 direct
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-[#F1EFE8] text-[#5F5E5A]">
      <i className="ti ti-sitemap text-[11px]" />
      Org.
    </span>
  )
}

// ─── Matricule tag ────────────────────────────────────────────────────────────
export function MatriculeTag({ value }: { value: string }) {
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-500">
      {value}
    </span>
  )
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────
export function KpiCard({
  label, value, sub, valueColor,
}: {
  label: string; value: string | number; sub?: string; valueColor?: string
}) {
  return (
    <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 border border-gray-100 dark:border-gray-700">
      <div className="text-[11px] text-gray-500 mb-1">{label}</div>
      <div className={`text-[22px] font-medium leading-none ${valueColor || 'text-gray-900 dark:text-gray-100'}`}>
        {value}
      </div>
      {sub && <div className="text-[10px] text-gray-400 mt-1">{sub}</div>}
    </div>
  )
}

// ─── Barre de progression ─────────────────────────────────────────────────────
export function ProgressBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden w-16 inline-block align-middle ml-1.5">
      <div className="h-full rounded-full" style={{ width: `${Math.min(pct, 100)}%`, background: color }} />
    </div>
  )
}

// ─── Table wrapper ────────────────────────────────────────────────────────────
export function TableWrap({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-700 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-[12px] border-collapse">{children}</table>
      </div>
    </div>
  )
}

export function Th({ children, style }: { children?: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <th className="px-2.5 py-2 text-left text-[10px] font-medium text-gray-400 border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 whitespace-nowrap"
      style={style}>
      {children}
    </th>
  )
}

export function Td({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <td className={`px-2.5 py-2 border-b border-gray-50 dark:border-gray-800 align-middle ${className || ''}`}>
      {children}
    </td>
  )
}
