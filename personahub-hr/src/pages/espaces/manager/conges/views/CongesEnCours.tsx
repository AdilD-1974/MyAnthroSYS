import React, { useState, useMemo } from 'react'
import type { DemandeEnrichie, Collaborateur } from '../types'
import {
  Avatar, TypeCongeCell, DateDjCell, HierPill,
  MatriculeTag, KpiCard, TableWrap, Th, Td,
} from '../components/CongesUI'
import { MultiSelect, DateRangeFilter, UOTreeFilter, expandUO, type UONode } from '../components/CongesFilters'

interface Props {
  enCours: DemandeEnrichie[]
  collaborateurs: Collaborateur[]
  uoTree: UONode[]
}

const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
type Periode = 'AVENIR' | 'ENCOURS' | 'TERMINE'
function periodeOf(dateDebut: string, dateFin: string): Periode {
  const today = startOfDay(new Date())
  const d = startOfDay(new Date(dateDebut))
  const f = startOfDay(new Date(dateFin))
  if (today < d) return 'AVENIR'
  if (today > f) return 'TERMINE'
  return 'ENCOURS'
}
const PERIODE_CFG: Record<Periode, { label: string; cls: string; dot: string }> = {
  AVENIR:  { label: 'À venir',  cls: 'bg-[#E6F1FB] text-[#185FA5]',                dot: '#185FA5' },
  ENCOURS: { label: 'En cours', cls: 'bg-[#EAF3DE] text-[#3B6D11]',                dot: '#3B6D11' },
  TERMINE: { label: 'Terminé',  cls: 'bg-gray-100 dark:bg-gray-800 text-gray-500', dot: '#9CA3AF' },
}
const ORDER: Record<Periode, number> = { ENCOURS: 0, AVENIR: 1, TERMINE: 2 }

export default function CongesEnCours({ enCours, collaborateurs, uoTree }: Props) {
  const [selUO, setSelUO]           = useState<string[]>([])
  const [selType, setSelType]       = useState<string[]>([])
  const [selPeriode, setSelPeriode] = useState<string[]>([])
  const [dateFrom, setDateFrom]     = useState('')
  const [dateTo, setDateTo]         = useState('')

  const uoExpanded = useMemo(() => selUO.length ? expandUO(selUO, uoTree) : null, [selUO, uoTree])
  const optType = useMemo(() => {
    const m = new Map<string, string>()
    enCours.forEach(d => m.set(d.typeCode, d.type.libelle))
    return [...m].map(([value, label]) => ({ value, label }))
  }, [enCours])
  const optPeriode = [
    { value: 'ENCOURS', label: 'En cours' },
    { value: 'AVENIR',  label: 'À venir'  },
    { value: 'TERMINE', label: 'Terminé'  },
  ]

  const withPeriode = useMemo(
    () => enCours.map(d => ({ d, p: periodeOf(d.dateDebut, d.dateFin) })),
    [enCours])

  const filtered = useMemo(() => withPeriode
    .filter(({ d, p }) => {
      if (uoExpanded && !uoExpanded.has((d.collaborateur as any)?.uoId)) return false
      if (selType.length && !selType.includes(d.typeCode)) return false
      if (selPeriode.length && !selPeriode.includes(p)) return false
      if (dateFrom && d.dateFin < dateFrom) return false   // chevauchement
      if (dateTo && d.dateDebut > dateTo) return false
      return true
    })
    .sort((a, b) => ORDER[a.p] - ORDER[b.p] || a.d.dateDebut.localeCompare(b.d.dateDebut)),
    [withPeriode, uoExpanded, selType, selPeriode, dateFrom, dateTo])

  // ── KPI réels ──────────────────────────────────────────────────────────────
  const today = startOfDay(new Date())
  const in7 = new Date(today); in7.setDate(in7.getDate() + 7)
  const moisStart = new Date(today.getFullYear(), today.getMonth(), 1)
  const moisEnd   = new Date(today.getFullYear(), today.getMonth() + 1, 0)

  const absentsAuj     = withPeriode.filter(({ p }) => p === 'ENCOURS').length
  const retoursSemaine = enCours.filter(d => { const f = startOfDay(new Date(d.dateFin)); return f >= today && f <= in7 }).length
  const congesMois     = enCours.filter(d => new Date(d.dateDebut) <= moisEnd && new Date(d.dateFin) >= moisStart).length
  const taux           = collaborateurs.length ? ((absentsAuj / collaborateurs.length) * 100).toFixed(1) : '0.0'
  const nbFiltres      = selUO.length + selType.length + selPeriode.length + (dateFrom || dateTo ? 1 : 0)

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-4 gap-2">
        <KpiCard label="Absents aujourd'hui"   value={absentsAuj}     sub={`sur ${collaborateurs.length} collaborateurs`} valueColor="text-[#854F0B]" />
        <KpiCard label="Retours cette semaine" value={retoursSemaine} sub="prévus" />
        <KpiCard label="Congés ce mois"        value={congesMois}     sub="planifiés" valueColor="text-[#3B6D11]" />
        <KpiCard label="Taux d'absence"        value={`${taux}%`}     sub="aujourd'hui" valueColor="text-[#854F0B]" />
      </div>

      {/* Filtres multi-sélection + plage de dates (libellés uniquement) */}
      <div className="flex gap-2 flex-wrap items-center">
        <UOTreeFilter tree={uoTree} selected={selUO} onApply={setSelUO} />
        <MultiSelect label="Type de congé" options={optType}    selected={selType}    onChange={setSelType} />
        <MultiSelect label="Statut"        options={optPeriode} selected={selPeriode} onChange={setSelPeriode} width="w-44" />
        <DateRangeFilter from={dateFrom} to={dateTo} onChange={(f, t) => { setDateFrom(f); setDateTo(t) }} />
        {nbFiltres > 0 && (
          <button type="button" onClick={() => { setSelUO([]); setSelType([]); setSelPeriode([]); setDateFrom(''); setDateTo('') }}
            className="text-[12px] px-2 py-1.5 rounded-lg text-[#A32D2D] hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center gap-1">
            <i className="ti ti-x text-[13px]" /> Réinitialiser ({nbFiltres})
          </button>
        )}
        <span className="text-[11px] text-gray-400 flex items-center gap-1 ml-auto">
          <i className="ti ti-info-circle text-[13px]" />
          Périmètre manager (forçage N+1/N+2 + UO responsable)
        </span>
      </div>

      <TableWrap>
        <thead>
          <tr>
            <Th style={{ minWidth: 140 }}>Collaborateur</Th>
            <Th style={{ width: 80 }}>Matricule</Th>
            <Th style={{ minWidth: 175 }}>Type de congé</Th>
            <Th style={{ minWidth: 130 }}>Départ</Th>
            <Th style={{ minWidth: 130 }}>Retour</Th>
            <Th style={{ width: 50 }}>Durée</Th>
            <Th style={{ width: 80 }}>Lien hiér.</Th>
            <Th>Statut</Th>
          </tr>
        </thead>
        <tbody>
          {filtered.map(({ d, p }) => {
            const cfg = PERIODE_CFG[p]
            return (
              <tr key={d.id} className="hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                <Td>
                  <div className="flex items-center gap-1.5">
                    <Avatar initiales={d.collaborateur.initiales} color={d.collaborateur.color} />
                    <span className="text-gray-800 dark:text-gray-200">{d.collaborateur.nom}</span>
                  </div>
                </Td>
                <Td><MatriculeTag value={d.collaborateur.matricule} /></Td>
                <Td><TypeCongeCell code={d.type.code} libelle={d.type.libelle} /></Td>
                <Td><DateDjCell date={d.dateDebut} dj={d.djDebut} /></Td>
                <Td><DateDjCell date={d.dateFin}   dj={d.djFin}   /></Td>
                <Td><strong>{d.duree}j</strong></Td>
                <Td><HierPill lien={d.collaborateur.lien} /></Td>
                <Td>
                  <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium ${cfg.cls}`}>
                    <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: cfg.dot }} />
                    {cfg.label}
                  </span>
                </Td>
              </tr>
            )
          })}
          {filtered.length === 0 && (
            <tr><td colSpan={8} className="py-8 text-center text-gray-400">
              <i className="ti ti-beach text-2xl block mb-2" />
              Aucun congé ne correspond aux filtres
            </td></tr>
          )}
        </tbody>
      </TableWrap>
    </div>
  )
}
