import React, { useState } from 'react'
import type { DemandeEnrichie } from '../types'
import { TYPES_CONGES } from '../types'
import {
  Avatar, StatutBadge, TypeCongeCell, DateDjCell, HierPill,
  KpiCard, TableWrap, Th, Td,
} from '../components/CongesUI'

interface Props {
  demandes: DemandeEnrichie[]
  collaborateurs: { id: number; nom: string }[]
  kpi: { enAttente: number; approuvees: number; refusees: number; totalJours: number }
  onApprouver: (id: number) => void
  onRefuser: (id: number, motif: string) => void
}

export default function CongesDemandes({ demandes, collaborateurs, kpi, onApprouver, onRefuser }: Props) {
  const [filtreStatut, setFiltreStatut] = useState('')
  const [filtreType, setFiltreType]     = useState('')
  const [filtreCollab, setFiltreCollab] = useState('')
  const [motifs, setMotifs]             = useState<Record<number, string>>({})

  const filtered = demandes.filter(d => {
    if (filtreStatut && d.statut !== filtreStatut) return false
    if (filtreType   && d.typeCode !== filtreType)  return false
    if (filtreCollab && d.collaborateurId !== Number(filtreCollab)) return false
    return true
  })

  const handleMotif = (id: number, val: string) =>
    setMotifs(prev => ({ ...prev, [id]: val }))

  const handleApprouver = (id: number) => {
    onApprouver(id)
    setMotifs(prev => { const n = { ...prev }; delete n[id]; return n })
  }

  const handleRefuser = (id: number) => {
    onRefuser(id, motifs[id] || '')
    setMotifs(prev => { const n = { ...prev }; delete n[id]; return n })
  }

  return (
    <div className="flex flex-col gap-3">
      {/* KPIs */}
      <div className="grid grid-cols-4 gap-2">
        <KpiCard label="En attente"  value={kpi.enAttente}  sub="à traiter"    valueColor="text-[#854F0B]" />
        <KpiCard label="Approuvées"  value={kpi.approuvees} sub="ce mois"      valueColor="text-[#3B6D11]" />
        <KpiCard label="Refusées"    value={kpi.refusees}   sub="historique"   valueColor="text-[#A32D2D]" />
        <KpiCard label="Jours posés" value={`${kpi.totalJours}j`} sub="cumul équipe" />
      </div>

      {/* Filtres */}
      <div className="flex gap-2 flex-wrap">
        <select value={filtreStatut} onChange={e => setFiltreStatut(e.target.value)}
          className="text-[12px] px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 cursor-pointer">
          <option value="">Tous statuts</option>
          <option value="EN_ATTENTE">En attente</option>
          <option value="APPROUVEE">Approuvées</option>
          <option value="REFUSEE">Refusées</option>
        </select>
        <select value={filtreType} onChange={e => setFiltreType(e.target.value)}
          className="text-[12px] px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 cursor-pointer">
          <option value="">Tous types</option>
          {Object.entries(TYPES_CONGES).map(([k, t]) => (
            <option key={k} value={k}>{t.code} — {t.libelle}</option>
          ))}
        </select>
        <select value={filtreCollab} onChange={e => setFiltreCollab(e.target.value)}
          className="text-[12px] px-2 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 cursor-pointer">
          <option value="">Tous les collaborateurs</option>
          {collaborateurs.map(c => <option key={c.id} value={c.id}>{c.nom}</option>)}
        </select>
      </div>

      {/* Tableau */}
      <TableWrap>
        <thead>
          <tr>
            <Th style={{ minWidth: 130 }}>Collaborateur</Th>
            <Th style={{ minWidth: 170 }}>Type de congé</Th>
            <Th style={{ minWidth: 130 }}>Départ</Th>
            <Th style={{ minWidth: 130 }}>Retour</Th>
            <Th style={{ width: 50 }}>Durée</Th>
            <Th style={{ width: 80 }}>Lien hiér.</Th>
            <Th style={{ minWidth: 220 }}>Statut / Action</Th>
          </tr>
        </thead>
        <tbody>
          {filtered.map(d => (
            <tr key={d.id} className="hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
              <Td>
                <div className="flex items-center gap-1.5">
                  <Avatar initiales={d.collaborateur.initiales} color={d.collaborateur.color} />
                  <span className="text-gray-800 dark:text-gray-200">{d.collaborateur.nom}</span>
                </div>
              </Td>
              <Td><TypeCongeCell code={d.type.code} libelle={d.type.libelle} /></Td>
              <Td><DateDjCell date={d.dateDebut} dj={d.djDebut} /></Td>
              <Td><DateDjCell date={d.dateFin}   dj={d.djFin}   /></Td>
              <Td><strong>{d.duree}j</strong></Td>
              <Td><HierPill lien={d.collaborateur.lien} /></Td>
              <Td>
                {d.statut === 'EN_ATTENTE' ? (
                  <div className="flex flex-col gap-1.5">
                    <StatutBadge statut="EN_ATTENTE" />
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={motifs[d.id] || ''}
                        onChange={e => handleMotif(d.id, e.target.value)}
                        placeholder="Motif de refus (optionnel)"
                        className="flex-1 min-w-0 text-[11px] px-2 py-1 rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300"
                      />
                      <button onClick={() => handleApprouver(d.id)}
                        className="w-7 h-7 rounded-md bg-[#EAF3DE] text-[#3B6D11] border border-[#C0DD97] flex items-center justify-center hover:bg-[#C0DD97] transition-colors flex-shrink-0"
                        title="Approuver">
                        <i className="ti ti-check text-[13px]" />
                      </button>
                      <button onClick={() => handleRefuser(d.id)}
                        className="w-7 h-7 rounded-md bg-[#FCEBEB] text-[#A32D2D] border border-[#F7C1C1] flex items-center justify-center hover:bg-[#F7C1C1] transition-colors flex-shrink-0"
                        title="Refuser">
                        <i className="ti ti-x text-[13px]" />
                      </button>
                    </div>
                  </div>
                ) : d.statut === 'APPROUVEE' ? (
                  <StatutBadge statut="APPROUVEE" />
                ) : (
                  <div className="flex flex-col gap-1">
                    <StatutBadge statut="REFUSEE" />
                    {d.motifRefus && <span className="text-[10px] text-gray-400">Motif : {d.motifRefus}</span>}
                  </div>
                )}
              </Td>
            </tr>
          ))}
          {filtered.length === 0 && (
            <tr><td colSpan={7} className="py-8 text-center text-gray-400">
              <i className="ti ti-calendar-off text-2xl block mb-2" />
              Aucune demande ne correspond aux filtres
            </td></tr>
          )}
        </tbody>
      </TableWrap>
    </div>
  )
}
