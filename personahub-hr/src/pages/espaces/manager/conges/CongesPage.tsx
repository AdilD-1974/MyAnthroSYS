import React, { useState, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { SubView } from './types'
import { useConges } from './hooks/useConges'
import CongesEnCours   from './views/CongesEnCours'
import CongesPlanning  from './views/CongesPlanning'
import CongesSoldes    from './views/CongesSoldes'
import CongesTaux      from './views/CongesTaux'
import CongesFormModal from './components/CongesFormModal'

// ─── Map URL → SubView ────────────────────────────────────────────────────────
// NB : la vue « demandes » est désormais centralisée dans /gestion-demandes.
const URL_TO_VIEW: Record<string, SubView> = {
  '/espace-manager/conges':          'demandes',
  '/espace-manager/conges/encours':  'encours',
  '/espace-manager/conges/planning': 'planning',
  '/espace-manager/conges/soldes':   'soldes',
  '/espace-manager/conges/taux':     'taux',
}

const TITLES: Record<SubView, { title: string; sub: string }> = {
  demandes: { title: 'Demandes de congés',       sub: 'Gestion des demandes de vos collaborateurs directs' },
  encours:  { title: 'Collaborateurs en congés', sub: 'Absences en cours – collaborateurs directs (N+1 org. ou fiche)' },
  planning: { title: 'Planning des absences',    sub: 'Vue Gantt mensuelle de votre équipe' },
  soldes:   { title: 'Soldes & Reliquats',       sub: 'Compteurs de congés et gestion des reliquats N-1' },
  taux:     { title: "Taux d'absence par UO",    sub: 'Analyse et évolution mensuelle des absences' },
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function Toast({ msg, type }: { msg: string; type: 'success' | 'info' }) {
  const cls = type === 'success'
    ? 'bg-[#EAF3DE] text-[#3B6D11] border-[#C0DD97]'
    : 'bg-[#E6F1FB] text-[#185FA5] border-[#A8CCEE]'
  return (
    <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-xl border text-[13px] shadow-lg ${cls}`}>
      <i className={`ti ${type === 'success' ? 'ti-circle-check' : 'ti-info-circle'} text-[16px]`} />
      {msg}
    </div>
  )
}

// ─── Page principale ──────────────────────────────────────────────────────────
interface CongesPageProps { initialView?: SubView }

export default function CongesPage({ initialView }: CongesPageProps = {}) {
  const location = useLocation()
  const navigate = useNavigate()

  // Priorité : prop initialView (depuis ManagerSpace) > URL
  const activeView: SubView = initialView || URL_TO_VIEW[location.pathname] || 'demandes'

  // Les demandes sont centralisées dans « Gestion des demandes »
  useEffect(() => {
    if (activeView === 'demandes') navigate('/gestion-demandes', { replace: true })
  }, [activeView, navigate])

  const [showForm, setShowForm] = useState(false)
  const [toast, setToast]       = useState<{ msg: string; type: 'success' | 'info' } | null>(null)

  const {
    collaborateurs, demandesEnrichies, enCours,
    soldes, tauxUO, uoTree, ajouterDemande,
  } = useConges()

  function showToastMsg(msg: string, type: 'success' | 'info' = 'success') {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }

  function handleSubmitForm(payload: Parameters<typeof ajouterDemande>[0]) {
    ajouterDemande(payload)
    navigate('/gestion-demandes')
    showToastMsg('Demande soumise avec succès')
  }

  if (activeView === 'demandes') return null // redirection en cours

  const { title, sub } = TITLES[activeView]

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-950">

      {/* Topbar */}
      <div className="bg-white dark:bg-gray-900 px-5 py-3.5 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-[18px] font-medium text-gray-900 dark:text-gray-100">{title}</h1>
          <p className="text-[12px] text-gray-400 mt-0.5">{sub}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => showToastMsg('Export Excel en cours…', 'info')}
            className="text-[12px] px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-500 flex items-center gap-1.5 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors font-medium">
            <i className="ti ti-download text-[14px]" />
            Excel
          </button>
          <button
            onClick={() => setShowForm(true)}
            className="text-[12px] px-3 py-2 rounded-lg bg-[#4B6FE4] text-white flex items-center gap-1.5 hover:bg-[#3A5DD4] transition-colors font-medium">
            <i className="ti ti-plus text-[14px]" />
            Nouvelle demande
          </button>
        </div>
      </div>

      {/* Contenu (navigation assurée par les sous-menus de la sidebar) */}
      <div className="flex-1 overflow-y-auto p-5">
        {activeView === 'encours'  && <CongesEnCours enCours={enCours} collaborateurs={collaborateurs} uoTree={uoTree} />}
        {activeView === 'planning' && <CongesPlanning demandes={demandesEnrichies} collaborateurs={collaborateurs} uoTree={uoTree} />}
        {activeView === 'soldes'   && <CongesSoldes soldes={soldes} collaborateurs={collaborateurs} uoTree={uoTree} />}
        {activeView === 'taux'     && <CongesTaux tauxUO={tauxUO} uoTree={uoTree} />}
      </div>

      {/* Modal */}
      <CongesFormModal
        open={showForm}
        onClose={() => setShowForm(false)}
        onSubmit={handleSubmitForm}
        collaborateurs={collaborateurs}
        soldes={soldes}
      />

      {/* Toast */}
      {toast && <Toast msg={toast.msg} type={toast.type} />}
    </div>
  )
}
