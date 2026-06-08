import React, { useState, useEffect, useMemo } from 'react'
import type { Collaborateur, FormDemande, SoldeEnrichi } from '../types'
import { TYPES_CONGES, DEMI_JOURNEES } from '../types'

interface Props {
  open: boolean
  onClose: () => void
  onSubmit: (form: Omit<FormDemande, 'commentaire'> & { duree: number }) => void
  collaborateurs: Collaborateur[]
  soldes: SoldeEnrichi[]
}

function joursOuvres(debut: string, fin: string, djDebut: string, djFin: string): number {
  if (!debut || !fin) return 0
  const d = new Date(debut)
  const f = new Date(fin)
  if (f < d) return 0
  let jours = 0
  const cur = new Date(d)
  while (cur <= f) {
    const dw = cur.getDay()
    if (dw !== 0 && dw !== 6) jours++
    cur.setDate(cur.getDate() + 1)
  }
  if (djDebut === 'Après-midi') jours -= 0.5
  if (djFin   === 'Matin')      jours -= 0.5
  return Math.max(0, jours)
}

const EMPTY: FormDemande = {
  collaborateurId: '', typeCode: '', dateDebut: '', djDebut: 'Matin',
  dateFin: '', djFin: 'Journée entière', commentaire: '',
}

export default function CongesFormModal({ open, onClose, onSubmit, collaborateurs, soldes }: Props) {
  const [form, setForm]     = useState<FormDemande>(EMPTY)
  const [errors, setErrors] = useState<Partial<Record<keyof FormDemande, string>>>({})
  const [loading, setLoading] = useState(false)

  useEffect(() => { if (open) { setForm(EMPTY); setErrors({}) } }, [open])

  const set = (k: keyof FormDemande, v: string | number) =>
    setForm(prev => ({ ...prev, [k]: v }))

  const duree = useMemo(() =>
    joursOuvres(form.dateDebut, form.dateFin, form.djDebut, form.djFin), [form])

  const soldeDisponible = useMemo(() => {
    if (!form.collaborateurId || !form.typeCode) return null
    return soldes.find(s => s.collaborateurId === form.collaborateurId && s.typeCode === form.typeCode)?.disponible ?? null
  }, [form.collaborateurId, form.typeCode, soldes])

  function validate() {
    const e: Partial<Record<keyof FormDemande, string>> = {}
    if (!form.collaborateurId) e.collaborateurId = 'Sélectionnez un collaborateur'
    if (!form.typeCode)         e.typeCode        = 'Sélectionnez un type de congé'
    if (!form.dateDebut)        e.dateDebut       = 'Date de départ requise'
    if (!form.dateFin)          e.dateFin         = 'Date de retour requise'
    if (form.dateFin < form.dateDebut) e.dateFin  = 'Le retour doit être après le départ'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function handleSubmit() {
    if (!validate()) return
    setLoading(true)
    await new Promise(r => setTimeout(r, 400))
    onSubmit({ ...form, collaborateurId: Number(form.collaborateurId), duree: Math.ceil(duree) })
    setLoading(false)
    onClose()
  }

  if (!open) return null

  const sel = 'text-[12px] px-2.5 py-2 rounded-lg border bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-200 focus:outline-none focus:border-blue-400 transition-colors w-full'
  const inp = (err?: string) => `${sel} ${err ? 'border-red-400' : 'border-gray-200 dark:border-gray-700'}`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-100 dark:border-gray-700 w-full max-w-lg max-h-[90vh] flex flex-col shadow-xl">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
          <h2 className="text-[15px] font-medium text-gray-900 dark:text-gray-100">Nouvelle demande de congé</h2>
          <button onClick={onClose} className="w-7 h-7 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-400 flex items-center justify-center hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
            <i className="ti ti-x text-[14px]" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-3">

          {/* Collaborateur */}
          <div>
            <label className="block text-[12px] text-gray-500 font-medium mb-1">Collaborateur <span className="text-red-400">*</span></label>
            <select value={form.collaborateurId} onChange={e => set('collaborateurId', e.target.value)} className={inp(errors.collaborateurId)}>
              <option value="">Sélectionner un collaborateur</option>
              {collaborateurs.map(c => <option key={c.id} value={c.id}>{c.nom} — {c.matricule} ({c.uo})</option>)}
            </select>
            {errors.collaborateurId && <span className="text-[11px] text-red-400">{errors.collaborateurId}</span>}
          </div>

          {/* Type */}
          <div>
            <label className="block text-[12px] text-gray-500 font-medium mb-1">Type de congé <span className="text-red-400">*</span></label>
            <select value={form.typeCode} onChange={e => set('typeCode', e.target.value)} className={inp(errors.typeCode)}>
              <option value="">Sélectionner un type</option>
              {Object.entries(TYPES_CONGES).map(([k, t]) => <option key={k} value={k}>{t.code} — {t.libelle}</option>)}
            </select>
            {errors.typeCode && <span className="text-[11px] text-red-400">{errors.typeCode}</span>}
          </div>

          {/* Départ */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[12px] text-gray-500 font-medium mb-1">Date de départ <span className="text-red-400">*</span></label>
              <input type="date" value={form.dateDebut} onChange={e => set('dateDebut', e.target.value)} className={inp(errors.dateDebut)} />
              {errors.dateDebut && <span className="text-[11px] text-red-400">{errors.dateDebut}</span>}
            </div>
            <div>
              <label className="block text-[12px] text-gray-500 font-medium mb-1">Départ</label>
              <select value={form.djDebut} onChange={e => set('djDebut', e.target.value as FormDemande['djDebut'])} className={sel}>
                {DEMI_JOURNEES.map(dj => <option key={dj} value={dj}>{dj}</option>)}
              </select>
            </div>
          </div>

          {/* Retour */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[12px] text-gray-500 font-medium mb-1">Date de retour <span className="text-red-400">*</span></label>
              <input type="date" value={form.dateFin} min={form.dateDebut} onChange={e => set('dateFin', e.target.value)} className={inp(errors.dateFin)} />
              {errors.dateFin && <span className="text-[11px] text-red-400">{errors.dateFin}</span>}
            </div>
            <div>
              <label className="block text-[12px] text-gray-500 font-medium mb-1">Retour</label>
              <select value={form.djFin} onChange={e => set('djFin', e.target.value as FormDemande['djFin'])} className={sel}>
                {DEMI_JOURNEES.map(dj => <option key={dj} value={dj}>{dj}</option>)}
              </select>
            </div>
          </div>

          {/* Calcul durée + solde */}
          {duree > 0 && (
            <div className="bg-gray-50 dark:bg-gray-800 rounded-lg px-3 py-2.5 border border-gray-100 dark:border-gray-700 flex flex-col gap-1.5">
              <div className="flex items-center gap-2 text-[12px] text-gray-500">
                <i className="ti ti-calculator text-[13px]" />
                Durée calculée : <strong className="text-gray-800 dark:text-gray-200">{duree} jours ouvrés</strong>
              </div>
              {soldeDisponible !== null && (
                <div className={`flex items-center gap-2 text-[12px] ${soldeDisponible < duree ? 'text-[#A32D2D]' : 'text-gray-500'}`}>
                  <i className="ti ti-wallet text-[13px]" />
                  Solde {form.typeCode} disponible :
                  <strong style={{ color: soldeDisponible < duree ? '#A32D2D' : '#3B6D11' }}>{soldeDisponible}j</strong>
                  {soldeDisponible < duree && <span className="font-medium">— Solde insuffisant</span>}
                </div>
              )}
            </div>
          )}

          {/* Commentaire */}
          <div>
            <label className="block text-[12px] text-gray-500 font-medium mb-1">Commentaire (optionnel)</label>
            <input type="text" value={form.commentaire} onChange={e => set('commentaire', e.target.value)}
              placeholder="Précision ou contexte..." className={`${sel} border-gray-200 dark:border-gray-700`} />
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-2 justify-end px-5 py-4 border-t border-gray-100 dark:border-gray-700">
          <button onClick={onClose}
            className="text-[12px] px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors font-medium">
            Annuler
          </button>
          <button onClick={handleSubmit} disabled={loading}
            className="text-[12px] px-4 py-2 rounded-lg bg-[#4B6FE4] text-white font-medium flex items-center gap-2 hover:bg-[#3A5DD4] disabled:opacity-60 disabled:cursor-not-allowed transition-colors">
            <i className="ti ti-send text-[13px]" />
            {loading ? 'Envoi…' : 'Soumettre la demande'}
          </button>
        </div>
      </div>
    </div>
  )
}
