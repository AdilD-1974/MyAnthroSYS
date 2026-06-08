// ─── Types de congés ──────────────────────────────────────────────────────────
export interface TypeConge {
  code: string
  libelle: string
}

export const TYPES_CONGES: Record<string, TypeConge> = {
  CP:          { code: 'CP',          libelle: 'Congé payé annuel' },
  RTT:         { code: 'RTT',         libelle: 'Réduction du temps de travail' },
  CIF:         { code: 'CIF',         libelle: 'Congé individuel de formation' },
  CNG_MAR_SAL: { code: 'CNG_MAR_SAL', libelle: 'Congé mariage salarié' },
  MAL:         { code: 'MAL',         libelle: 'Congé maladie' },
  PATER:       { code: 'PATER',       libelle: 'Congé paternité' },
}

export const DEMI_JOURNEES = ['Matin', 'Après-midi', 'Journée entière'] as const
export type DemiJournee = typeof DEMI_JOURNEES[number]

export type StatutDemande = 'EN_ATTENTE' | 'APPROUVEE' | 'REFUSEE'
export type LienHierarchique = 'ORG' | 'N1'

// ─── Collaborateur ────────────────────────────────────────────────────────────
export interface Collaborateur {
  id: number
  nom: string
  initiales: string
  matricule: string
  uo: string
  lien: LienHierarchique
  color: 'teal' | 'blue' | 'coral' | 'purple' | 'green'
}

// ─── Demande de congé ─────────────────────────────────────────────────────────
export interface Demande {
  id: number
  collaborateurId: number
  typeCode: string
  statut: StatutDemande
  dateDebut: string
  djDebut: DemiJournee
  dateFin: string
  djFin: DemiJournee
  duree: number
  motifRefus: string
}

export interface DemandeEnrichie extends Demande {
  collaborateur: Collaborateur
  type: TypeConge
}

// ─── Solde ────────────────────────────────────────────────────────────────────
export interface Solde {
  collaborateurId: number
  typeCode: string
  acquis: number
  reliquat: number
  pris: number
  expiration: string | null
}

export interface SoldeEnrichi extends Solde {
  collaborateur: Collaborateur
  type: TypeConge
  disponible: number
  tauxConsommation: number
  reliquatAlerte: boolean
}

// ─── Taux UO ──────────────────────────────────────────────────────────────────
export interface TauxUO {
  uo: string
  nbCollab: number
  joursOuvres: number
  joursAbs: number
  historique: number[]
}

// ─── Formulaire nouvelle demande ──────────────────────────────────────────────
export interface FormDemande {
  collaborateurId: number | ''
  typeCode: string
  dateDebut: string
  djDebut: DemiJournee
  dateFin: string
  djFin: DemiJournee
  commentaire: string
}

export type SubView = 'demandes' | 'encours' | 'planning' | 'soldes' | 'taux'
