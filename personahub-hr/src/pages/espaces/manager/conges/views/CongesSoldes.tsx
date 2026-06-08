import React, { useState, useMemo } from 'react'
import type { SoldeEnrichi, Collaborateur } from '../types'
import {
  Avatar, TypeCongeCell, HierPill, ProgressBar, TableWrap, Th, Td,
} from '../components/CongesUI'
import { MultiSelect, UOTreeFilter, expandUO, type UONode } from '../components/CongesFilters'

interface Props { soldes: SoldeEnrichi[]; collaborateurs: Collaborateur[]; uoTree: UONode[] }

function progressColor(pct: number) {
  if (pct >= 80) return '#c45e1a'
  if (pct >= 50) return '#3B6D11'
  return '#4B6FE4'
}
function formatDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function CongesSoldes({ soldes, collaborateurs, uoTree }: Props) {
  const [selUO, setSelUO]         = useState<string[]>([])
  const [selType, setSelType]     = useState<string[]>([])
  const [selCollab, setSelCollab] = useState<string[]>([])
  const [alerteOnly, setAlerteOnly] = useState(false)

  const alertes = soldes.filter(s => s.reliquatAlerte)

  const uoExpanded = useMemo(() => selUO.length ? expandUO(selUO, uoTree) : null, [selUO, uoTree])

  const optType = useMemo(() => {
    const m = new Map<string, string>()
    soldes.forEach(s => m.set(s.typeCode, s.type.libelle))
    return [...m].map(([value, label]) => ({ value, label }))
  }, [soldes])
  const optCollab = useMemo(
    () => collaborateurs.map(c => ({ value: String(c.id), label: c.nom })),
    [collaborateurs])

  const filtered = useMemo(() => soldes.filter(s => {
    if (uoExpanded && !uoExpanded.has((s.collaborateur as any)?.uoId)) return false
    if (selType.length && !selType.includes(s.typeCode)) return false
    if (selCollab.length && !selCollab.includes(String(s.collaborateurId))) return false
    if (alerteOnly && !s.reliquatAlerte) return false
    return true
  }), [soldes, uoExpanded, selType, selCollab, alerteOnly])

  const nbFiltres = selUO.length + selType.length + selCollab.length + (alerteOnly ? 1 : 0)

  return (
    <div className="flex flex-col gap-3">
      {alertes.length > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#FAEEDA] border border-[#FAC775] text-[12px] text-[#854F0B]">
          <i className="ti ti-alert-triangle text-[15px] flex-shrink-0" />
          <span><strong>{alertes.length} reliquat(s)</strong> N-1 expirant dans moins de 30 jours — pensez à relancer les collaborateurs concernés.</span>
        </div>
      )}

      {/* Filtres multi-sélection (libellés uniquement) */}
      <div className="flex gap-2 flex-wrap items-center">
        <UOTreeFilter tree={uoTree} selected={selUO} onApply={setSelUO} />
        <MultiSelect label="Type de congé"  options={optType}   selected={selType}   onChange={setSelType} />
        <MultiSelect label="Collaborateur"   options={optCollab} selected={selCollab} onChange={setSelCollab} />
        <button type="button" onClick={() => setAlerteOnly(v => !v)}
          className={`text-[12px] px-2.5 py-1.5 rounded-lg border flex items-center gap-1.5 transition-colors ${
            alerteOnly ? 'border-[#A32D2D] text-[#A32D2D] bg-[#A32D2D]/5'
                       : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300'
          }`}>
          <i className="ti ti-alert-triangle text-[13px]" /> Reliquats en alerte
        </button>
        {nbFiltres > 0 && (
          <button type="button" onClick={() => { setSelUO([]); setSelType([]); setSelCollab([]); setAlerteOnly(false) }}
            className="text-[12px] px-2 py-1.5 rounded-lg text-[#A32D2D] hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center gap-1">
            <i className="ti ti-x text-[13px]" /> Réinitialiser ({nbFiltres})
          </button>
        )}
      </div>

      <TableWrap>
        <thead>
          <tr>
            <Th style={{ minWidth: 140 }}>Collaborateur</Th>
            <Th style={{ width: 72 }}>Lien hiér.</Th>
            <Th style={{ minWidth: 175 }}>Type de congé</Th>
            <Th style={{ width: 55 }}>Acquis</Th>
            <Th style={{ width: 90 }}>Reliquat N-1</Th>
            <Th style={{ width: 48 }}>Pris</Th>
            <Th style={{ minWidth: 155 }}>Solde disponible</Th>
            <Th style={{ minWidth: 120 }}>Expiration reliquat</Th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((s, i) => (
            <tr key={i} className={`hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors ${s.reliquatAlerte ? 'bg-[#FAEEDA]/20' : ''}`}>
              <Td>
                <div className="flex items-center gap-1.5">
                  <Avatar initiales={s.collaborateur.initiales} color={s.collaborateur.color} />
                  <span className="text-gray-800 dark:text-gray-200">{s.collaborateur.nom}</span>
                </div>
              </Td>
              <Td><HierPill lien={s.collaborateur.lien} /></Td>
              <Td><TypeCongeCell code={s.type.code} libelle={s.type.libelle} /></Td>
              <Td className="text-gray-700 dark:text-gray-300">{s.acquis}j</Td>
              <Td>
                <span className={`font-medium flex items-center gap-1 ${s.reliquatAlerte ? 'text-[#A32D2D]' : s.reliquat > 0 ? 'text-[#854F0B]' : 'text-gray-400'}`}>
                  {s.reliquat}j
                  {s.reliquatAlerte && <i className="ti ti-alert-triangle text-[10px]" />}
                </span>
              </Td>
              <Td className="text-gray-700 dark:text-gray-300">{s.pris}j</Td>
              <Td>
                <div className="flex items-center">
                  <strong className="text-gray-800 dark:text-gray-200">{s.disponible}j</strong>
                  <ProgressBar pct={s.tauxConsommation} color={progressColor(s.tauxConsommation)} />
                </div>
              </Td>
              <Td>
                {s.expiration ? (
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${s.reliquatAlerte ? 'bg-[#FCEBEB] text-[#A32D2D]' : 'bg-[#FAEEDA] text-[#854F0B]'}`}>
                    {formatDate(s.expiration)}
                  </span>
                ) : <span className="text-gray-400">—</span>}
              </Td>
            </tr>
          ))}
          {filtered.length === 0 && (
            <tr><td colSpan={8} className="py-8 text-center text-gray-400">
              <i className="ti ti-wallet-off text-2xl block mb-2" />
              Aucun solde ne correspond aux filtres
            </td></tr>
          )}
        </tbody>
      </TableWrap>

      <div className="flex gap-4 text-[11px] text-gray-400 flex-wrap">
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#854F0B] inline-block" /> Reliquat non urgent</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#A32D2D] inline-block" /> Expiration &lt; 30 jours</span>
      </div>
    </div>
  )
}
