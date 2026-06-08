import { useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { db, api } from '@/lib/api'
import { useManagerPopulation } from '@/hooks/useManagerPopulation'
import type {
  Collaborateur, Demande, DemandeEnrichie, SoldeEnrichi, TauxUO,
} from '../types'
import { TYPES_CONGES } from '../types'

// ─── Hook principal — données réelles via le proxy (db.list) ──────────────────
// Population alignée sur la SOURCE UNIQUE useManagerPopulation
// (forçage N+1/N+2 + UO responsable + sous-UO récursives).
export function useConges() {
  const qc = useQueryClient()
  const {
    managerCollaborateurId: managerId,
    collaborateurIds: collabIds,
    uoByCollaborateur, uoLabels, uoParent, uoCode,
    loading: popLoading,
  } = useManagerPopulation()

  const inList = (ids: string[]) => `in.(${ids.join(',')})`

  // ── 1. Infos collaborateurs + lien hiérarchique (N1 forcé vs ORG) ─────────
  const { data: collabsRaw = [] } = useQuery({
    queryKey: ['mgr-conges-collabs', collabIds.join(',')],
    enabled: !popLoading && collabIds.length > 0,
    queryFn: async () => {
      const [cols, affs] = await Promise.all([
        db.list<any>('collaborateurs', { select: 'id,nom,prenom,matricule,statut_collaborateur', id: inList(collabIds) }),
        db.list<any>('collaborateur_affectations', { select: 'collaborateur_id,manager_n1_id,manager_n2_id', collaborateur_id: inList(collabIds), archive: false }),
      ])
      const forced = new Set<string>()
      ;(affs || []).forEach((a: any) => {
        if (a.manager_n1_id === managerId || a.manager_n2_id === managerId) forced.add(a.collaborateur_id)
      })
      return (cols || []).map((c: any) => ({ ...c, _lien: forced.has(c.id) ? 'N1' : 'ORG' }))
    },
  })

  // ── 2. Référentiel des types de congé (libellés) ──────────────────────────
  const { data: refTypes = {} as Record<string, string> } = useQuery({
    queryKey: ['ref-type-conge-map'],
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      const rows = await db.list<any>('ref_type_conge', { select: 'code,libelle' })
      const m: Record<string, string> = {}
      ;(rows || []).forEach((r: any) => { if (r.code) m[r.code] = r.libelle || r.code })
      return m
    },
  })

  const COLORS = ['teal', 'blue', 'coral', 'purple', 'green'] as const
  const collaborateurs: Collaborateur[] = useMemo(() =>
    collabsRaw.map((c: any, i: number) => ({
      id:        c.id,
      nom:       `${c.prenom} ${c.nom}`,
      initiales: `${c.prenom?.[0] || ''}${c.nom?.[0] || ''}`,
      matricule: c.matricule,
      uo:        uoLabels[uoByCollaborateur[c.id]] || 'UO',
      uoId:      uoByCollaborateur[c.id] || '',
      lien:      (c._lien || 'ORG') as 'N1' | 'ORG',
      color:     COLORS[i % COLORS.length],
    } as any)), [collabsRaw, uoByCollaborateur, uoLabels])

  // Arbre des UO du périmètre (pour le filtrage hiérarchique côté vues)
  const uoTree = useMemo(
    () => Object.keys(uoLabels).map(id => ({ id, libelle: uoLabels[id], code: uoCode[id] || '', parentId: uoParent[id] || null })),
    [uoLabels, uoParent, uoCode])

  // ── 3. Demandes de congés ─────────────────────────────────────────────────
  const { data: demandesRaw = [] } = useQuery({
    queryKey: ['mgr-conges-demandes', collabIds.join(',')],
    enabled: !popLoading && collabIds.length > 0,
    queryFn: async () => {
      const rows = await db.list<any>('cong_demandes', {
        select: 'id,collaborateur_id,code_type_conge,date_debut,date_fin_absence,debut_demi_journee,fin_demi_journee,nbr_jours_decomptes,statut,commentaire_collaborateur,motif_refus,created_at',
        collaborateur_id: inList(collabIds),
        archive: false,
      })
      return (rows || []).slice().sort((a: any, b: any) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
    },
  })

  const demandes: Demande[] = useMemo(() =>
    demandesRaw.map((d: any) => ({
      id:              d.id,
      collaborateurId: d.collaborateur_id,
      typeCode:        d.code_type_conge,
      statut:          mapStatut(d.statut),
      dateDebut:       d.date_debut,
      djDebut:         mapDJ(d.debut_demi_journee),
      dateFin:         d.date_fin_absence,
      djFin:           mapDJ(d.fin_demi_journee),
      duree:           d.nbr_jours_decomptes,
      motifRefus:      d.motif_refus || '',
    })), [demandesRaw])

  // ── 4. Soldes de congés ───────────────────────────────────────────────────
  const { data: soldesRaw = [] } = useQuery({
    queryKey: ['mgr-conges-soldes', collabIds.join(',')],
    enabled: !popLoading && collabIds.length > 0,
    queryFn: async () => {
      const rows = await db.list<any>('cong_solde', {
        select: 'collaborateur_id,code_type_conge,solde_acquis,solde_pris,solde_restant,reliquat_reporte,exercice',
        collaborateur_id: inList(collabIds),
        archive: false,
      })
      return rows || []
    },
  })

  // ── Type helper (libellé prioritaire depuis ref_type_conge) ───────────────
  const typeOf = (code: string) => {
    const base = TYPES_CONGES[code] || { code, libelle: code }
    return { ...base, libelle: refTypes[code] || base.libelle || code }
  }

  // ── Mutations (via api REST, statuts en minuscules conformes au backend) ──
  const approuverMut = useMutation({
    mutationFn: async (id: string) => {
      await api.patch(`/db/cong_demandes?id=eq.${id}`, { statut: 'approuvee', valideur_id: managerId, date_validation: new Date().toISOString() })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mgr-conges-demandes'] }),
  })

  const refuserMut = useMutation({
    mutationFn: async ({ id, motif }: { id: string; motif: string }) => {
      await api.patch(`/db/cong_demandes?id=eq.${id}`, { statut: 'refusee', motif_refus: motif, valideur_id: managerId, date_validation: new Date().toISOString() })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mgr-conges-demandes'] }),
  })

  const ajouterMut = useMutation({
    mutationFn: async (p: { collaborateurId: string; typeCode: string; dateDebut: string; djDebut: string; dateFin: string; djFin: string; duree: number }) => {
      await api.post('/db/cong_demandes', {
        collaborateur_id:    p.collaborateurId,
        code_type_conge:     p.typeCode,
        date_debut:          p.dateDebut,
        debut_demi_journee:  p.djDebut,
        date_fin_absence:    p.dateFin,
        fin_demi_journee:    p.djFin,
        date_retour:         p.dateFin,
        nbr_jours_decomptes: p.duree,
        statut:              'en_attente',
        date_soumission:     new Date().toISOString(),
      })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mgr-conges-demandes'] }),
  })

  // ── Enrichissements ───────────────────────────────────────────────────────
  const demandesEnrichies: DemandeEnrichie[] = useMemo(() =>
    demandes.map(d => ({
      ...d,
      collaborateur: collaborateurs.find(c => c.id === d.collaborateurId)!,
      type: typeOf(d.typeCode),
    })).filter(d => d.collaborateur), [demandes, collaborateurs, refTypes])

  const kpiDemandes = useMemo(() => ({
    enAttente:  demandes.filter(d => d.statut === 'EN_ATTENTE').length,
    approuvees: demandes.filter(d => d.statut === 'APPROUVEE').length,
    refusees:   demandes.filter(d => d.statut === 'REFUSEE').length,
    totalJours: demandes.reduce((s, d) => s + (d.duree || 0), 0),
  }), [demandes])

  const enCours = useMemo(() =>
    demandesEnrichies.filter(d => d.statut === 'APPROUVEE'), [demandesEnrichies])

  const soldesEnrichis: SoldeEnrichi[] = useMemo(() =>
    soldesRaw.map((s: any) => {
      const collab = collaborateurs.find(c => c.id === s.collaborateur_id)
      if (!collab) return null
      const reliquat   = s.reliquat_reporte || 0
      const disponible = s.solde_restant
      return {
        collaborateurId: s.collaborateur_id,
        typeCode:        s.code_type_conge,
        acquis:          s.solde_acquis,
        reliquat,
        pris:            s.solde_pris,
        disponible,
        expiration:      null,
        collaborateur:   collab,
        type:            typeOf(s.code_type_conge),
        tauxConsommation: Math.round((disponible / Math.max((s.solde_acquis || 0) + reliquat, 1)) * 100),
        reliquatAlerte:  false,
      } as SoldeEnrichi
    }).filter(Boolean) as SoldeEnrichi[], [soldesRaw, collaborateurs, refTypes])

  // ── Taux d'absence par UO (calculé sur le périmètre, faute de vue dédiée) ──
  const tauxUO: TauxUO[] = useMemo(() => {
    const byUo: Record<string, { uo: string; nbCollab: number; joursAbs: number }> = {}
    collaborateurs.forEach((c: any) => {
      const id = c.uoId || '—'
      byUo[id] = byUo[id] || { uo: c.uo || '—', nbCollab: 0, joursAbs: 0 }
      byUo[id].nbCollab++
    })
    enCours.forEach((d: any) => {
      const id = d.collaborateur?.uoId || '—'
      if (byUo[id]) byUo[id].joursAbs += d.duree || 0
    })
    return Object.entries(byUo).map(([uoId, v]) => ({
      uoId,
      uo: v.uo,
      nbCollab: v.nbCollab,
      joursOuvres: v.nbCollab * 22,
      joursAbs: v.joursAbs,
      historique: [] as number[],
    })) as any
  }, [collaborateurs, enCours])

  return {
    collaborateurs, demandes, demandesEnrichies, kpiDemandes, enCours,
    soldes: soldesEnrichis, tauxUO, uoTree,
    approuver: (id: string) => approuverMut.mutate(id),
    refuser:   (id: string, motif: string) => refuserMut.mutate({ id, motif }),
    ajouterDemande: ajouterMut.mutate,
    isLoading: popLoading || approuverMut.isPending || refuserMut.isPending || ajouterMut.isPending,
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function mapStatut(s: string): 'EN_ATTENTE' | 'APPROUVEE' | 'REFUSEE' {
  const u = String(s || '').toUpperCase()
  if (u === 'APPROUVEE') return 'APPROUVEE'
  if (u === 'REFUSEE')   return 'REFUSEE'
  return 'EN_ATTENTE'
}

function mapDJ(dj?: string): 'Matin' | 'Après-midi' | 'Journée entière' {
  const u = String(dj || '').toUpperCase()
  if (u === 'MATIN')                       return 'Matin'
  if (u === 'APRES_MIDI' || u === 'APRÈS-MIDI') return 'Après-midi'
  return 'Journée entière'
}
