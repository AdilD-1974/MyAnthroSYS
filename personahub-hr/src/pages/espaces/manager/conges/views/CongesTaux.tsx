import React, { useEffect, useRef, useMemo, useState } from 'react'
import type { TauxUO } from '../types'
import { KpiCard, TableWrap, Th, Td } from '../components/CongesUI'
import { UOTreeFilter, expandUO, type UONode } from '../components/CongesFilters'

interface Props { tauxUO: TauxUO[]; uoTree: UONode[] }

const OBJECTIF = 5
const COLORS   = ['#A32D2D', '#E07B39', '#639922', '#4B6FE4', '#854F0B', '#185FA5', '#3B6D11', '#A32D8F']
const MOIS     = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai']

function tauxColor(t: number) {
  if (t > 7)        return '#A32D2D'
  if (t > OBJECTIF) return '#E07B39'
  return '#639922'
}
function alerteConfig(t: number): { cls: string; label: string } {
  if (t > 7)        return { cls: 'bg-[#FCEBEB] text-[#A32D2D]', label: 'Élevé'  }
  if (t > OBJECTIF) return { cls: 'bg-[#FAEEDA] text-[#854F0B]', label: 'Modéré' }
  return               { cls: 'bg-[#EAF3DE] text-[#3B6D11]',     label: 'Normal' }
}

export default function CongesTaux({ tauxUO, uoTree }: Props) {
  const chartRef = useRef<HTMLCanvasElement>(null)
  const chartInst = useRef<unknown>(null)
  const [selUO, setSelUO] = useState<string[]>([])

  const uoExpanded = useMemo(() => selUO.length ? expandUO(selUO, uoTree) : null, [selUO, uoTree])

  const rows = useMemo(() =>
    tauxUO
      .filter((r: any) => !uoExpanded || uoExpanded.has(r.uoId))
      .map(r => {
        const taux = r.joursOuvres > 0 ? parseFloat((r.joursAbs / r.joursOuvres * 100).toFixed(1)) : 0
        const hist = r.historique || []
        const delta = hist.length >= 2 ? parseFloat((hist[hist.length - 1] - hist[hist.length - 2]).toFixed(1)) : 0
        return { ...r, taux, delta }
      }),
    [tauxUO, uoExpanded])

  const tauxMoyen  = rows.length ? (rows.reduce((s, r) => s + r.taux, 0) / rows.length).toFixed(1) : '0'
  const uoMax      = rows.reduce((m, r) => r.taux > m.taux ? r : m, { uo: '—', taux: 0 } as { uo: string; taux: number })
  const totalJours = rows.reduce((s, r) => s + r.joursAbs, 0)
  const horsSeuil  = rows.filter(r => r.taux > OBJECTIF).length
  const hasHistorique = tauxUO.some(r => (r.historique || []).length >= 2)

  useEffect(() => {
    if (!chartRef.current || !hasHistorique) return
    import('https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.js' as string).then((mod: unknown) => {
      const Chart = (mod as { default: unknown }).default as {
        register: (...args: unknown[]) => void
        new (ctx: unknown, config: unknown): { destroy: () => void }
      }
      if ((chartInst.current as { destroy?: () => void })?.destroy) (chartInst.current as { destroy: () => void }).destroy()
      chartInst.current = new Chart(chartRef.current!, {
        type: 'line',
        data: {
          labels: MOIS,
          datasets: tauxUO.map((r, i) => ({
            label: r.uo, data: r.historique || [],
            borderColor: COLORS[i % COLORS.length], backgroundColor: 'transparent',
            borderWidth: 2, pointRadius: 3, pointBackgroundColor: COLORS[i % COLORS.length], tension: 0.3,
          })),
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: (c: { dataset: { label: string }; parsed: { y: number } }) => `${c.dataset.label} : ${c.parsed.y.toFixed(1)}%` } },
          },
          scales: {
            y: { min: 0, max: 12, ticks: { callback: (v: unknown) => v + '%', font: { size: 10 } }, grid: { color: 'rgba(128,128,128,0.1)' } },
            x: { ticks: { font: { size: 10 } }, grid: { display: false } },
          },
        },
      })
    }).catch(() => {})
    return () => { if ((chartInst.current as { destroy?: () => void })?.destroy) (chartInst.current as { destroy: () => void }).destroy() }
  }, [tauxUO, hasHistorique])

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-4 gap-2">
        <KpiCard label="Taux moyen équipe"   value={`${tauxMoyen}%`}  sub={`objectif ${OBJECTIF}%`} valueColor="text-[#854F0B]" />
        <KpiCard label="UO la plus impactée" value={uoMax.uo}         sub={`${uoMax.taux}% ce mois`} />
        <KpiCard label="Jours cumulés"       value={`${totalJours}j`} sub={`${rows.reduce((s, r) => s + r.nbCollab, 0)} collaborateurs`} />
        <KpiCard label="UO hors seuil"       value={horsSeuil}        sub={`taux > ${OBJECTIF}%`} valueColor="text-[#A32D2D]" />
      </div>

      <div className="flex gap-2 flex-wrap items-center">
        <UOTreeFilter tree={uoTree} selected={selUO} onApply={setSelUO} />
        <span className="flex items-center gap-1.5 text-[11px] text-gray-400 ml-auto">
          <span className="w-4 border-t-2 border-dashed border-gray-400 inline-block" /> Objectif {OBJECTIF}%
        </span>
      </div>

      <TableWrap>
        <thead>
          <tr>
            <Th style={{ width: 110 }}>UO</Th>
            <Th style={{ width: 70 }}>Collab.</Th>
            <Th style={{ width: 90 }}>Jours ouvrés</Th>
            <Th style={{ width: 75 }}>Jours abs.</Th>
            <Th style={{ minWidth: 160 }}>Taux</Th>
            <Th style={{ width: 100 }}>Tendance</Th>
            <Th>Alerte</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => {
            const cfg = alerteConfig(row.taux)
            return (
              <tr key={row.uo} className="hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                <Td><span className="font-medium text-gray-800 dark:text-gray-200">{row.uo}</span></Td>
                <Td className="text-gray-600 dark:text-gray-400">{row.nbCollab}</Td>
                <Td className="text-gray-600 dark:text-gray-400">{row.joursOuvres.toLocaleString('fr-FR')}j</Td>
                <Td className="text-gray-600 dark:text-gray-400">{row.joursAbs}j</Td>
                <Td>
                  <div className="flex items-center gap-2">
                    <span className="font-medium" style={{ color: tauxColor(row.taux) }}>{row.taux}%</span>
                    <div className="h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden w-20">
                      <div className="h-full rounded-full" style={{ width: `${Math.min(row.taux / 10 * 100, 100)}%`, background: tauxColor(row.taux) }} />
                    </div>
                  </div>
                </Td>
                <Td>
                  {row.delta === 0 ? (
                    <span className="text-[12px] text-gray-400">—</span>
                  ) : (
                    <span className="flex items-center gap-1 text-[12px]" style={{ color: row.delta > 0 ? '#A32D2D' : '#3B6D11' }}>
                      <i className={`ti ${row.delta > 0 ? 'ti-trending-up' : 'ti-trending-down'} text-[13px]`} />
                      {row.delta > 0 ? '+' : ''}{row.delta} pts
                    </span>
                  )}
                </Td>
                <Td><span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${cfg.cls}`}>{cfg.label}</span></Td>
              </tr>
            )
          })}
          {rows.length === 0 && (
            <tr><td colSpan={7} className="py-8 text-center text-gray-400">
              <i className="ti ti-chart-bar-off text-2xl block mb-2" />
              Aucune donnée pour cette sélection
            </td></tr>
          )}
        </tbody>
      </TableWrap>

      {hasHistorique && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-700 p-4">
          <div className="text-[12px] font-medium text-gray-400 mb-3">Évolution mensuelle du taux d'absence</div>
          <div style={{ height: 200, position: 'relative' }}>
            <canvas ref={chartRef} aria-label="Graphique évolution mensuelle taux d'absence" />
          </div>
        </div>
      )}
    </div>
  )
}
