import React, { useState, useMemo } from 'react'
import type { DemandeEnrichie, Collaborateur } from '../types'
import { Avatar } from '../components/CongesUI'
import { UOTreeFilter, expandUO, type UONode } from '../components/CongesFilters'

interface Props {
  demandes: DemandeEnrichie[]
  collaborateurs: Collaborateur[]
  uoTree: UONode[]
}

// Palette de couleurs assignée dynamiquement par type de congé présent
const PALETTE = ['#B5D4F4', '#CECBF6', '#F5C4B3', '#9FE1CB', '#F7C1C1', '#FCE1A8', '#C9E4B0', '#E0C3F0']
const TEXTPAL = ['#0C447C', '#3C3489', '#712B13', '#085041', '#791F1F', '#6B4E00', '#33571A', '#5A2E73']

const JOURS = ['D', 'L', 'M', 'M', 'J', 'V', 'S']
function getDaysInMonth(year: number, month: number) {
  const count = new Date(year, month + 1, 0).getDate()
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(year, month, i + 1)
    return { d: i + 1, we: d.getDay() === 0 || d.getDay() === 6, letter: JOURS[d.getDay()] }
  })
}

export default function CongesPlanning({ demandes, collaborateurs, uoTree }: Props) {
  const [moisOffset, setMoisOffset] = useState(0)
  const [selUO, setSelUO] = useState<string[]>([])

  const now = new Date()
  const BASE = { annee: now.getFullYear(), mois: now.getMonth() }
  const annee = BASE.annee + Math.floor((BASE.mois + moisOffset) / 12)
  const mois  = (BASE.mois + moisOffset + 12) % 12

  const moisLabel = new Date(annee, mois, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
  const jours     = useMemo(() => getDaysInMonth(annee, mois), [annee, mois])
  const nbJours   = jours.length

  const uoExpanded = useMemo(() => selUO.length ? expandUO(selUO, uoTree) : null, [selUO, uoTree])

  // Couleur + libellé par type de congé (assignation stable par ordre d'apparition)
  const typeStyle = useMemo(() => {
    const map: Record<string, { bg: string; text: string; libelle: string }> = {}
    let i = 0
    demandes.forEach(d => {
      if (!map[d.typeCode]) {
        map[d.typeCode] = { bg: PALETTE[i % PALETTE.length], text: TEXTPAL[i % TEXTPAL.length], libelle: d.type.libelle }
        i++
      }
    })
    return map
  }, [demandes])

  function barsFor(collabId: string) {
    const moisDebut = new Date(annee, mois, 1)
    const moisFin   = new Date(annee, mois + 1, 0)
    return demandes
      .filter(d => d.collaborateurId === collabId && d.statut === 'APPROUVEE')
      .map(d => {
        const debut = new Date(d.dateDebut)
        const fin   = new Date(d.dateFin)
        if (debut > moisFin || fin < moisDebut) return null
        const start = Math.max(debut.getMonth() === mois && debut.getFullYear() === annee ? debut.getDate() : 1, 1)
        const end   = Math.min(fin.getMonth() === mois && fin.getFullYear() === annee ? fin.getDate() : nbJours, nbJours)
        const left  = (start - 1) / nbJours * 100
        const width = (end - start + 1) / nbJours * 100
        const cfg   = typeStyle[d.typeCode] || { bg: PALETTE[0], text: TEXTPAL[0], libelle: d.type.libelle }
        return { id: d.id, left, width, cfg, libelle: d.type.libelle, duree: d.duree }
      })
      .filter(Boolean) as { id: string; left: number; width: number; cfg: { bg: string; text: string }; libelle: string; duree: number }[]
  }

  const legende = useMemo(() => Object.values(typeStyle).map(t => ({ libelle: t.libelle, bg: t.bg })), [typeStyle])

  // Uniquement les collaborateurs ayant au moins un congé approuvé ce mois (filtre UO hiérarchique)
  const lignes = collaborateurs
    .filter(c => !uoExpanded || uoExpanded.has((c as any).uoId))
    .map(c => ({ collab: c, bars: barsFor(String(c.id)) }))
    .filter(x => x.bars.length > 0)

  return (
    <div className="flex flex-col gap-3">
      {/* Contrôles */}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => setMoisOffset(o => o - 1)}
          className="w-7 h-7 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-500 flex items-center justify-center hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
          <i className="ti ti-chevron-left text-[14px]" />
        </button>
        <span className="text-[13px] font-medium text-gray-800 dark:text-gray-200 min-w-[130px] text-center capitalize">{moisLabel}</span>
        <button onClick={() => setMoisOffset(o => o + 1)}
          className="w-7 h-7 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-500 flex items-center justify-center hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
          <i className="ti ti-chevron-right text-[14px]" />
        </button>
        <div className="ml-3"><UOTreeFilter tree={uoTree} selected={selUO} onApply={setSelUO} /></div>
        <div className="ml-auto flex items-center gap-3 flex-wrap">
          {legende.map(l => (
            <span key={l.libelle} className="flex items-center gap-1.5 text-[11px] text-gray-500">
              <span className="w-3 h-2 rounded-[3px] inline-block" style={{ background: l.bg }} />
              {l.libelle}
            </span>
          ))}
        </div>
      </div>

      {/* Gantt */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-700 overflow-hidden">
        <div className="flex border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
          <div className="w-32 flex-shrink-0 px-2.5 py-1.5 border-r border-gray-100 dark:border-gray-700 text-[10px] text-gray-400 font-medium">Collaborateur</div>
          <div className="flex flex-1">
            {jours.map((day, idx) => (
              <div key={idx} className={`flex-1 text-center py-1.5 border-r border-gray-100 dark:border-gray-700 last:border-r-0 ${day.we ? 'bg-gray-100 dark:bg-gray-700' : ''}`}>
                <div className="text-[9px] font-medium text-gray-700 dark:text-gray-300">{day.d}</div>
                <div className="text-[8px] text-gray-400">{day.letter}</div>
              </div>
            ))}
          </div>
        </div>

        {lignes.map(({ collab, bars }) => {
          const parts = (collab.nom || '').trim().split(/\s+/)
          const nomCourt = parts.length > 1 ? `${parts[0][0]}. ${parts.slice(1).join(' ')}` : (collab.nom || '—')
          return (
            <div key={collab.id} className="flex border-b border-gray-50 dark:border-gray-800 last:border-b-0">
              <div className="w-32 flex-shrink-0 px-2.5 py-2 border-r border-gray-100 dark:border-gray-700 flex items-center gap-1.5">
                <Avatar initiales={collab.initiales} color={collab.color} />
                <span className="text-[11px] text-gray-700 dark:text-gray-300 truncate">{nomCourt}</span>
              </div>
              <div className="flex flex-1 relative h-10 items-center">
                {jours.map((day, idx) => (
                  <div key={idx} className={`flex-1 h-full border-r border-gray-50 dark:border-gray-800 last:border-r-0 ${day.we ? 'bg-gray-50 dark:bg-gray-800' : ''}`} />
                ))}
                {bars.map(bar => (
                  <div key={bar.id}
                    className="absolute h-5 rounded-full flex items-center px-2 text-[9px] font-medium overflow-hidden whitespace-nowrap"
                    style={{ left: `${bar.left}%`, width: `${bar.width}%`, background: bar.cfg.bg, color: (bar.cfg as any).text }}
                    title={`${bar.libelle} · ${bar.duree}j`}>
                    {bar.libelle}
                  </div>
                ))}
              </div>
            </div>
          )
        })}

        {lignes.length === 0 && (
          <div className="py-8 text-center text-gray-400 text-[13px]">
            <i className="ti ti-calendar-off text-2xl block mb-2" />
            Aucun collaborateur en congé sur cette période
          </div>
        )}
      </div>
    </div>
  )
}
