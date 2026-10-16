// =============================================================================
//  GESTION DES DEMANDES — Traitement des tâches de workflow (générique tous rôles)
//  Branché sur le MOTEUR DE WORKFLOW :
//    • Source = GET /workflow/inbox/{authUserId}  → tâches réellement assignées
//      (RH voit "Validation RH", N+1 voit "Validation N+1", DG voit "Validation DG"…)
//    • Détail = GET /workflow/instances/{id} (via le composant SuiviDemandeWorkflow)
//    • Décision = POST /workflow/decide { instance_etape_id, acteur_id, type_decision }
//  acteur_id  = collaborateur_id du décideur (useCurrentCollaborateur)
//  authUserId = user.id (useAuth) pour l'inbox (matche user_roles.user_id)
//  Statuts demande en minuscules : en_attente | approuvee | refusee | annulee
// =============================================================================
import React, { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrentCollaborateur } from "@/hooks/useCurrentCollaborateur";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import SuiviDemandeWorkflow from "@/pages/espaces/SuiviDemandeWorkflow";
import DeleguerButton from "@/components/DeleguerButton";
import CollaborateurPicker from "@/components/CollaborateurPicker";
import {
  ClipboardList, Check, X, Clock, Search, CalendarDays, Inbox,
  XCircle, MessageSquare, Loader2, CalendarRange, AlertCircle,
  Hourglass, ChevronDown, Workflow, CornerUpLeft, RotateCcw, Filter,
  Share2, CheckCheck, Eye, DoorOpen, Calculator, Shield, FileText,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { fr } from "date-fns/locale";

const STATUT_LABEL: Record<string, string> = {
  en_attente: "En attente", approuvee: "Approuvée", refusee: "Refusée", annulee: "Annulée",
};
const STATUT_COLOR: Record<string, { c: string; b: string }> = {
  en_attente: { c: "hsl(var(--warning))", b: "hsl(var(--warning) / 0.12)" },
  approuvee:  { c: "hsl(var(--success))", b: "hsl(var(--success) / 0.12)" },
  refusee:    { c: "hsl(var(--destructive))", b: "hsl(var(--destructive) / 0.10)" },
  annulee:    { c: "hsl(var(--muted-foreground))", b: "hsl(var(--muted))" },
};

// ── Helpers ──────────────────────────────────────────────────────────────────
const fmt = (d?: string | null, p = "dd MMM yyyy") => { try { return d ? format(new Date(d), p, { locale: fr }) : "—"; } catch { return "—"; } };
const initials = (p?: string, n?: string) => `${(p || "")[0] || ""}${(n || "")[0] || ""}`.toUpperCase();

let _typeCache: Record<string, string> | null = null;
async function loadTypesConge(): Promise<Record<string, string>> {
  if (_typeCache) return _typeCache;
  try {
    const rows: any[] = await api.get(`/db/ref_type_conge?select=code,libelle`) || [];
    const m: Record<string, string> = {};
    rows.forEach((r: any) => { if (r.code != null) m[String(r.code)] = r.libelle || String(r.code); });
    _typeCache = m;
    return m;
  } catch { return {}; }
}

interface InboxTask {
  ie_id: string;
  id_instance: string;
  id_etape_def: string;
  date_debut: string | null;
  date_echeance: string | null;
  etape_libelle: string;
  type_objet: string;
  id_objet: string;
  demandeur_id: string;
  demandeur_nom: string | null;
  demandeur_prenom: string | null;
  demandeur_matricule: string | null;
  workflow_code: string;
  workflow_libelle: string;
  table_source: string | null;
}

// ─── Modal : visualisation de la DEMANDE MÉTIER (objet réel, pas le processus) ──
const VAL_LABELS: Record<string, Record<string, string>> = {
  mode_traitement:  { PROCESSUS: "Processus (workflow)", SAISIE_DIRECTE: "Saisie directe", SAISIE: "Saisie directe" },
  statut:           { EN_COURS: "En cours", PLANIFIE: "Planifié", TRAITE: "Traité", ENREGISTRE: "Enregistré", ANNULE: "Annulé", SORTI: "Sorti" },
  decision_finale:  { ACCEPTE: "Accepté", REFUSE: "Refusé", EN_ATTENTE: "En attente" },
  preavis_categorie:{ EXECUTION: "Exécution", MAITRISE: "Maîtrise", CADRE: "Cadre" },
};

function DemandeMetierModal({ tableObjet, idObjet, titre, onClose }: {
  tableObjet: string; idObjet: string; titre: string; onClose: () => void;
}) {
  const { data, isLoading } = useQuery<any[]>({
    queryKey: ["demande-metier", tableObjet, idObjet],
    enabled: !!tableObjet && !!idObjet,
    queryFn: async () => (await api.get(`/db/${tableObjet}?id=eq.${idObjet}`)) || [],
  });
  const estDepart = tableObjet === "collaborateur_departs";
  const { data: motifs = [] } = useQuery<any[]>({
    queryKey: ["ref-motif-depart-modal"],
    enabled: estDepart,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => (await api.get(`/db/ref_motif_depart?select=code,libelle`)) || [],
  });
  const row = data?.[0];

  const isDateStr = (v: any) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v);
  const val = (k: string, v: any): string | null => {
    if (v === null || v === undefined || v === "") return null;
    if (typeof v === "boolean") return v ? "Oui" : "Non";
    if (VAL_LABELS[k] && VAL_LABELS[k][String(v)]) return VAL_LABELS[k][String(v)];
    if (k === "motif_depart") return (motifs as any[]).find(m => m.code === v)?.libelle || String(v);
    if ((k.startsWith("indemnite") || k === "base_calcul_salaire" || k === "preavis_dispense_indemnite") && !isNaN(Number(v))) return `${Number(v).toLocaleString("fr-MA")} MAD`;
    if (isDateStr(v)) { try { return format(parseISO(String(v)), "dd/MM/yyyy", { locale: fr }); } catch { return String(v); } }
    return String(v);
  };

  // Sections métier (mêmes libellés et découpage que DepartForm)
  const GROUPES: { titre: string; icon: React.ReactNode; masquerZero?: boolean; champs: { k: string; label: string }[] }[] = [
    { titre: "Départ", icon: <DoorOpen size={14} />, champs: [
      { k: "date_depart", label: "Date de départ" },
      { k: "motif_depart", label: "Motif de départ" },
      { k: "mode_traitement", label: "Mode de traitement" },
      { k: "statut", label: "Statut" },
      { k: "decision_finale", label: "Décision finale" },
      { k: "date_notification", label: "Date de notification" },
      { k: "date_entretien_prealable", label: "Date entretien préalable" },
      { k: "reference_decision", label: "Référence de la décision" },
      { k: "commentaire", label: "Commentaire" },
    ]},
    { titre: "Préavis", icon: <Clock size={14} />, champs: [
      { k: "preavis_categorie", label: "Catégorie professionnelle" },
      { k: "preavis_duree_jours", label: "Durée préavis (jours)" },
      { k: "preavis_date_debut", label: "Date début préavis" },
      { k: "preavis_date_fin", label: "Date fin préavis" },
      { k: "preavis_dispense", label: "Dispense de préavis" },
      { k: "preavis_effectue", label: "Préavis effectué intégralement" },
      { k: "preavis_dispense_indemnite", label: "Indemnité compensatrice de préavis (MAD)" },
    ]},
    { titre: "Indemnités", icon: <Calculator size={14} />, masquerZero: true, champs: [
      { k: "base_calcul_salaire", label: "Salaire mensuel brut (MAD)" },
      { k: "anciennete_retenue_ans", label: "Ancienneté retenue (ans)" },
      { k: "indemnite_perte_emploi", label: "Indemnité de perte d'emploi (MAD)" },
      { k: "indemnite_depart_retraite", label: "Indemnité de départ retraite (MAD)" },
      { k: "indemnite_conges_payes", label: "Indemnité de congés payés (MAD)" },
      { k: "solde_conges_jours", label: "Solde congés (jours)" },
      { k: "indemnite_compensatrice", label: "Indemnité compensatrice (MAD)" },
      { k: "indemnite_transactionnelle", label: "Indemnité transactionnelle (MAD)" },
      { k: "indemnite_anciennete", label: "Prime ancienneté proratisée (MAD)" },
      { k: "indemnite_13eme_mois", label: "Prorata 13ème mois (MAD)" },
    ]},
    { titre: "Administratif", icon: <Shield size={14} />, champs: [
      { k: "cnss_radiation_date", label: "Date radiation CNSS" },
      { k: "cnss_derniere_declaration", label: "Dernière déclaration CNSS" },
      { k: "amo_cloture_date", label: "Date clôture AMO" },
      { k: "amo_attestation_delivree", label: "Attestation AMO délivrée" },
      { k: "materiel_badge_restitue", label: "Badge / accès restitué" },
      { k: "materiel_ordinateur_restitue", label: "Ordinateur restitué" },
      { k: "materiel_vehicule_restitue", label: "Véhicule de fonction restitué" },
      { k: "materiel_telephone_restitue", label: "Téléphone professionnel restitué" },
      { k: "acces_si_desactive", label: "Accès SI désactivé" },
      { k: "acces_email_desactive", label: "Messagerie désactivée" },
    ]},
    { titre: "Documents", icon: <FileText size={14} />, champs: [
      { k: "doc_attestation_travail", label: "Attestation de travail" },
      { k: "doc_recu_stc", label: "Reçu solde de tout compte (STC)" },
      { k: "doc_radiation_cnss", label: "Attestation radiation CNSS" },
      { k: "doc_attestation_amo", label: "Clôture couverture AMO" },
      { k: "doc_certificat_conges", label: "Certificat solde de congés" },
      { k: "doc_lettre_notification", label: "Lettre de notification" },
      { k: "doc_accord_amiable", label: "Accord amiable / protocole transactionnel" },
      { k: "doc_pv_entretien", label: "PV entretien préalable (licenciement CDI)" },
      { k: "doc_recu_materiel", label: "Reçu restitution matériel" },
    ]},
  ];

  // Générique (autres types) : tout sauf technique
  const SKIP = new Set(["id", "created_at", "updated_at", "archive", "wf_instance_id", "created_by", "updated_by"]);
  const humanize = (k: string) => k.replace(/_/g, " ").replace(/^./, c => c.toUpperCase());
  const genericEntries = row
    ? Object.entries(row).filter(([k, v]) => !SKIP.has(k) && !k.endsWith("_id") && !k.endsWith("_by") && val(k, v) !== null)
    : [];

  const renderValeur = (v: string | null) => {
    if (v === "Oui") return <span style={{ color: "hsl(142 55% 38%)", fontWeight: 600 }}>Oui</span>;
    if (v === "Non") return <span style={{ color: "hsl(var(--muted-foreground))" }}>Non</span>;
    return v;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "hsl(0 0% 0% / 0.5)" }} onClick={onClose}>
      <div className="w-full max-w-3xl max-h-[88vh] overflow-hidden flex flex-col rounded-2xl shadow-2xl"
        style={{ background: "hsl(var(--background))" }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0" style={{ borderColor: "hsl(var(--border))" }}>
          <div className="flex items-center gap-2.5">
            <DoorOpen size={18} style={{ color: "hsl(var(--accent))" }} />
            <div>
              <h3 className="text-sm font-bold leading-tight" style={{ color: "hsl(var(--foreground))" }}>Demande métier</h3>
              <p className="text-[11px]" style={{ color: "hsl(var(--muted-foreground))" }}>{titre}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:opacity-70" style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-4" style={{ background: "hsl(var(--muted) / 0.08)" }}>
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>
              <Loader2 size={14} className="animate-spin" /> Chargement…
            </div>
          ) : !row ? (
            <p className="text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>Aucun détail trouvé pour cette demande.</p>
          ) : estDepart ? (
            GROUPES.map(g => {
              const items = g.champs
                .filter(c => (c.k in row) && row[c.k] !== null && row[c.k] !== "")
                .filter(c => !(g.masquerZero && Number(row[c.k]) === 0))
                .map(c => ({ label: c.label, value: val(c.k, row[c.k]) }))
                .filter(it => it.value !== null);
              if (items.length === 0) return null;
              return (
                <div key={g.titre} className="p-4 rounded-xl border space-y-3" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))" }}>
                  <p className="text-xs font-bold uppercase tracking-wider flex items-center gap-2" style={{ color: "hsl(var(--accent))" }}>
                    {g.icon} {g.titre}
                  </p>
                  <dl className="grid grid-cols-2 gap-x-6 gap-y-2.5">
                    {items.map((it, i) => (
                      <div key={i}>
                        <dt className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "hsl(var(--muted-foreground))" }}>{it.label}</dt>
                        <dd className="text-sm mt-0.5" style={{ color: "hsl(var(--foreground))" }}>{renderValeur(it.value)}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              );
            })
          ) : (
            <div className="p-4 rounded-xl border" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))" }}>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
                {genericEntries.map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "hsl(var(--muted-foreground))" }}>{humanize(k)}</dt>
                    <dd className="text-sm mt-0.5" style={{ color: "hsl(var(--foreground))" }}>{renderValeur(val(k, v))}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function GestionDemandesPage() {
  const qc = useQueryClient();
  const { user, activeRole, role } = useAuth() as any;
  const { collaborateurId, loading: collabLoading } = useCurrentCollaborateur();
  const authUserId: string | null = user?.id || null;
  const estAdmin = activeRole === "administrateur" || role === "administrateur";

  // Inbox : tâches assignées à l'utilisateur connecté
  const { data: tasks = [], isLoading: loadingInbox, refetch } = useQuery<InboxTask[]>({
    queryKey: ["wf-inbox", authUserId], enabled: !!authUserId, staleTime: 30 * 1000,
    queryFn: async () => await api.get(`/workflow/inbox/${authUserId}`) || [],
  });

  // Détails des demandes liées (id_objet → cong_demande)
  const objetIds = useMemo(() => [...new Set(tasks.map(t => t.id_objet).filter(Boolean))], [tasks]);

  // Regroupe les objets par table source (cong_demandes, cong_operation, …)
  const parTable = useMemo(() => {
    const m: Record<string, Set<string>> = {};
    tasks.forEach(t => {
      const tbl = t.table_source || "cong_demandes";
      if (!t.id_objet) return;
      (m[tbl] = m[tbl] || new Set()).add(t.id_objet);
    });
    return Object.entries(m).map(([tbl, ids]) => [tbl, [...ids]] as [string, string[]]);
  }, [tasks]);

  const { data: demandesMap = {}, isLoading: loadingDemandes } = useQuery<Record<string, any>>({
    queryKey: ["wf-inbox-demandes", parTable.map(([t, ids]) => `${t}:${ids.join(",")}`).join("|")],
    enabled: parTable.length > 0, staleTime: 30 * 1000,
    queryFn: async () => {
      const typeMap = await loadTypesConge();
      const m: Record<string, any> = {};
      for (const [tbl, ids] of parTable) {
        if (ids.length === 0) continue;
        // Le filtre archive n'existe que sur cong_demandes
        const archive = tbl === "cong_demandes" ? "&archive=eq.false" : "";
        try {
          const rows: any[] = await api.get(`/db/${tbl}?id=in.(${ids.join(",")})${archive}`) || [];
          rows.forEach((r: any) => {
            m[r.id] = {
              ...r,
              statut: (r.statut ?? "").toLowerCase(),
              libelle_type_conge: r.code_type_conge ? (typeMap[r.code_type_conge] || r.code_type_conge) : undefined,
            };
          });
        } catch { /* table sans ces colonnes : on garde l'affichage générique */ }
      }
      return m;
    },
  });

  const [recherche, setRecherche] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [refusModal, setRefusModal] = useState<InboxTask | null>(null);
  const [detailMetier, setDetailMetier] = useState<{ tableObjet: string; idObjet: string; titre: string } | null>(null);
  const [motifRefus, setMotifRefus] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filtreStatut, setFiltreStatut] = useState("TOUS");
  const [expandedPerimId, setExpandedPerimId] = useState<string | null>(null);
  const [retourModal, setRetourModal] = useState<any | null>(null);
  const [motifRetour, setMotifRetour] = useState("");

  // ── Traitement par lot ──
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<null | "REJETER" | "DELEGUER">(null);
  const [bulkMotif, setBulkMotif] = useState("");
  const [bulkCible, setBulkCible] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [retourBusy, setRetourBusy] = useState(false);
  // Filtres avancés (communs aux deux vues, appliqués selon les champs de chacune)
  const [showFiltres, setShowFiltres] = useState(false);
  const [fType, setFType] = useState<string>("");        // type de demande / type de congé
  const [fDemandeurs, setFDemandeurs] = useState<string[]>([]); // collaborateur_ids (multi)
  const [demSearch, setDemSearch] = useState("");        // recherche dans la liste des demandeurs
  const [fEtape, setFEtape] = useState<string>("");      // libellé d'étape courante
  const [fDebut, setFDebut] = useState<string>("");      // période : début
  const [fFin, setFFin] = useState<string>("");          // période : fin
  const [fRef, setFRef] = useState<string>("");          // référence DEM-...
  const nbFiltresActifs = [fType, fEtape, fDebut, fFin, fRef].filter(Boolean).length + (fDemandeurs.length > 0 ? 1 : 0);
  const resetFiltres = () => { setFType(""); setFDemandeurs([]); setDemSearch(""); setFEtape(""); setFDebut(""); setFFin(""); setFRef(""); };
  const toggleDemandeur = (id: string) => setFDemandeurs(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  // Raccourcis de période
  const setMois = (ym: string) => {
    // ym = "YYYY-MM" → bornes du mois
    if (!ym) { setFDebut(""); setFFin(""); return; }
    const [y, m] = ym.split("-").map(Number);
    const debut = new Date(y, m - 1, 1);
    const fin = new Date(y, m, 0); // dernier jour du mois
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    setFDebut(iso(debut)); setFFin(iso(fin));
  };
  const raccourciPeriode = (type: "ce_mois" | "mois_prochain" | "cette_annee") => {
    const now = new Date();
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (type === "ce_mois") { setFDebut(iso(new Date(now.getFullYear(), now.getMonth(), 1))); setFFin(iso(new Date(now.getFullYear(), now.getMonth() + 1, 0))); }
    else if (type === "mois_prochain") { setFDebut(iso(new Date(now.getFullYear(), now.getMonth() + 1, 1))); setFFin(iso(new Date(now.getFullYear(), now.getMonth() + 2, 0))); }
    else { setFDebut(iso(new Date(now.getFullYear(), 0, 1))); setFFin(iso(new Date(now.getFullYear(), 11, 31))); }
  };
  // Valeur du sélecteur de mois déduite de fDebut/fFin si c'est un mois plein
  const moisValue = useMemo(() => {
    if (!fDebut || !fFin) return "";
    const d = new Date(fDebut), f = new Date(fFin);
    const dernierJour = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    if (d.getDate() === 1 && f.getDate() === dernierJour && d.getMonth() === f.getMonth() && d.getFullYear() === f.getFullYear())
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    return "";
  }, [fDebut, fFin]);

  // Tout mon périmètre : toutes les demandes (tous statuts) que je suis habilité à voir
  const { data: perimetre = [], isLoading: loadingPerim } = useQuery<any[]>({
    queryKey: ["wf-perimetre", authUserId], enabled: !!authUserId, staleTime: 60 * 1000,
    queryFn: async () => await api.get(`/demandes/perimetre/${authUserId}`) || [],
  });
  // Chevauchement entre [dDebut,dFin] et la période filtre [fDebut,fFin] (bornes optionnelles)
  const periodeMatch = (dDebut?: string | null, dFin?: string | null) => {
    if (!fDebut && !fFin) return true;
    const dd = dDebut ? new Date(dDebut) : null;
    const df = dFin ? new Date(dFin) : dd;
    if (!dd) return false;
    if (fDebut && df && df < new Date(fDebut)) return false;
    if (fFin && dd > new Date(fFin)) return false;
    return true;
  };

  const perimFiltre = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    let list = filtreStatut === "TOUS" ? perimetre : perimetre.filter((d: any) => d.statut === filtreStatut);
    if (q) list = list.filter((d: any) => `${d.demandeur_prenom || ""} ${d.demandeur_nom || ""} ${d.reference || ""} ${d.type_libelle || ""}`.toLowerCase().includes(q));
    if (fType) list = list.filter((d: any) => d.type_demande === fType);
    if (fDemandeurs.length) list = list.filter((d: any) => fDemandeurs.includes(d.demandeur_id));
    if (fEtape) list = list.filter((d: any) => (d.resume?.etape_courante_libelle || d.etape_libelle) === fEtape);
    if (fDebut || fFin) list = list.filter((d: any) => periodeMatch(d.resume?.date_debut, d.resume?.date_fin_absence));
    if (fRef) list = list.filter((d: any) => (d.reference || "").toLowerCase().includes(fRef.trim().toLowerCase()));
    return list;
  }, [perimetre, filtreStatut, recherche, fType, fDemandeurs, fEtape, fDebut, fFin, fRef]);

  // Chevauchement entre [d1,f1] et la période filtre [fDebut,fFin] (bornes optionnelles)
  // Options dynamiques selon la vue active (champs différents entre inbox et périmètre)
  const optionsFiltres = useMemo(() => {
    const types = new Map<string, string>();   // valeur → libellé
    const demandeurs = new Map<string, { nom: string; matricule: string }>();
    const etapes = new Set<string>();
    // Vue fusionnée : on agrège les deux sources (tâches à traiter + périmètre)
    tasks.forEach(t => {
      const dem = demandesMap[t.id_objet] || {};
      if (dem.code_type_conge) types.set(dem.code_type_conge, dem.libelle_type_conge || dem.code_type_conge);
      if (t.demandeur_id) demandeurs.set(t.demandeur_id, { nom: `${t.demandeur_prenom || ""} ${t.demandeur_nom || ""}`.trim() || "—", matricule: t.demandeur_matricule || "" });
      if (t.etape_libelle) etapes.add(t.etape_libelle);
    });
    perimetre.forEach((d: any) => {
      if (d.type_demande) types.set(d.type_demande, d.type_libelle || d.type_demande);
      if (d.demandeur_id) demandeurs.set(d.demandeur_id, { nom: `${d.demandeur_prenom || ""} ${d.demandeur_nom || ""}`.trim() || "—", matricule: d.demandeur_matricule || "" });
      const et = d.resume?.etape_courante_libelle || d.etape_libelle;
      if (et) etapes.add(et);
    });
    return {
      types: [...types.entries()].sort((a, b) => a[1].localeCompare(b[1], "fr")),
      demandeurs: [...demandeurs.entries()].map(([id, v]) => ({ id, ...v })).sort((a, b) => a.nom.localeCompare(b.nom, "fr")),
      etapes: [...etapes].sort((a, b) => a.localeCompare(b, "fr")),
    };
  }, [tasks, demandesMap, perimetre]);

  // Demandeurs filtrés par la recherche textuelle (nom ou matricule)
  const demandeursAffiches = useMemo(() => {
    const q = demSearch.trim().toLowerCase();
    if (!q) return optionsFiltres.demandeurs;
    return optionsFiltres.demandeurs.filter(d => d.nom.toLowerCase().includes(q) || d.matricule.toLowerCase().includes(q));
  }, [optionsFiltres.demandeurs, demSearch]);

  const faireRetour = async () => {
    if (!retourModal?.wf_instance_id || !motifRetour.trim()) return;
    setRetourBusy(true);
    try {
      await api.post(`/workflow/admin/retour/${retourModal.wf_instance_id}`, { motif: motifRetour.trim() });
      toast({ title: "Workflow renvoyé à l'étape précédente" });
      setRetourModal(null); setMotifRetour("");
      qc.invalidateQueries({ queryKey: ["wf-perimetre", authUserId] });
    } catch (e: any) {
      const msg = e?.response?.data?.detail || e?.message || "Échec du retour";
      toast({ title: "Retour impossible", description: msg, variant: "destructive" });
    } finally { setRetourBusy(false); }
  };

  const filtrees = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    return tasks.filter(t => {
      const dem = demandesMap[t.id_objet] || {};
      if (q) {
        const txt = `${t.demandeur_prenom || ""} ${t.demandeur_nom || ""} ${t.demandeur_matricule || ""} ${t.etape_libelle || ""} ${dem.libelle_type_conge || ""}`.toLowerCase();
        if (!txt.includes(q)) return false;
      }
      if (fType && dem.code_type_conge !== fType) return false;
      if (fDemandeurs.length && !fDemandeurs.includes(t.demandeur_id)) return false;
      if (fEtape && t.etape_libelle !== fEtape) return false;
      if ((fDebut || fFin) && !periodeMatch(dem.date_debut, dem.date_fin_absence)) return false;
      return true;
    });
  }, [tasks, recherche, demandesMap, fType, fDemandeurs, fEtape, fDebut, fFin]);

  const groupes = useMemo(() => {
    const by: Record<string, InboxTask[]> = {};
    filtrees.forEach(t => { (by[t.etape_libelle] = by[t.etape_libelle] || []).push(t); });
    return Object.entries(by).sort((a, b) => a[0].localeCompare(b[0], "fr"));
  }, [filtrees]);

  // ── VUE FUSIONNÉE : pavés repliables par étape (À traiter + Tout mon périmètre) ──
  // État de repli des pavés (par libellé d'étape)
  const [collapsedEtapes, setCollapsedEtapes] = useState<Set<string>>(new Set());
  const toggleEtape = (e: string) => setCollapsedEtapes(prev => {
    const n = new Set(prev); n.has(e) ? n.delete(e) : n.add(e); return n;
  });

  // id_objet des demandes pour lesquelles JE suis acteur (déjà affichées en « à traiter »)
  const inboxObjetIds = useMemo(() => new Set(filtrees.map(t => t.id_objet).filter(Boolean)), [filtrees]);

  // Statuts terminaux (demande clôturée) — pas d'étape courante
  const STATUTS_TERMINAUX = ["approuvee", "refusee", "annulee", "traite", "enregistre"];

  // Pavés : pour chaque étape courante, mes tâches actionnables + le suivi (lecture seule)
  const pavesFusion = useMemo(() => {
    const map = new Map<string, { actions: InboxTask[]; suivi: any[] }>();
    const ensure = (etape: string) => {
      if (!map.has(etape)) map.set(etape, { actions: [], suivi: [] });
      return map.get(etape)!;
    };
    // Mes tâches actionnables (déjà groupées et filtrées)
    groupes.forEach(([etape, items]) => { ensure(etape).actions.push(...items); });
    // Suivi (périmètre filtré) : hors terminales et hors demandes déjà dans mon inbox
    const terminaux: any[] = [];
    perimFiltre.forEach((d: any) => {
      const st = (d.statut || "").toLowerCase();
      if (STATUTS_TERMINAUX.includes(st)) { terminaux.push(d); return; }
      if (inboxObjetIds.has(d.id_objet)) return; // déjà présent en « à traiter »
      const etape = d.resume?.etape_courante_libelle || d.etape_libelle || "En cours";
      ensure(etape).suivi.push(d);
    });
    const paves = [...map.entries()]
      .map(([etape, v]) => ({ etape, actions: v.actions, suivi: v.suivi, total: v.actions.length + v.suivi.length }))
      .filter(p => p.total > 0)
      .sort((a, b) => a.etape.localeCompare(b.etape, "fr"));
    return { paves, terminaux };
  }, [groupes, perimFiltre, inboxObjetIds]);

  // Rendu d'une demande en SUIVI (lecture seule) — réutilisé dans les pavés et « Clôturées »
  const renderSuivi = (d: any) => {
    const r = d.resume || {};
    const stcol = STATUT_COLOR[d.statut] || { c: "hsl(var(--muted-foreground))", b: "hsl(var(--muted))" };
    return (
      <div key={d.id} className="rounded-xl overflow-hidden" style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}>
        <div className="flex items-start gap-3 p-3 cursor-pointer transition-colors hover:bg-[hsl(var(--muted)/0.4)]"
             onClick={() => setExpandedPerimId(id => id === d.id ? null : d.id)}>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold" style={{ color: "hsl(var(--foreground))" }}>{`${d.demandeur_prenom || ""} ${d.demandeur_nom || ""}`.trim() || "—"}</span>
              <span className="text-[11px] font-medium px-2 py-0.5 rounded-full" style={{ background: stcol.b, color: stcol.c }}>{STATUT_LABEL[d.statut] ?? d.statut}</span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>{d.reference}</span>
            </div>
            <p className="text-[11px] mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>
              {d.type_libelle || d.type_demande}
              {r.date_debut ? ` · ${format(new Date(r.date_debut), "dd MMM yyyy", { locale: fr })} → ${r.date_fin_absence ? format(new Date(r.date_fin_absence), "dd MMM yyyy", { locale: fr }) : ""}` : ""}
              {r.nbr_jours_decomptes != null ? ` · ${r.nbr_jours_decomptes}j` : ""}
            </p>
          </div>
          <ChevronDown size={16} style={{ color: "hsl(var(--muted-foreground))", transform: expandedPerimId === d.id ? "rotate(180deg)" : "none", transition: "transform .2s", flexShrink: 0 }} />
        </div>
        {expandedPerimId === d.id && (
          <div className="px-4 pb-4 pt-2 border-t" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.2)" }}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "hsl(var(--muted-foreground))" }}>Suivi du processus</span>
              <Button size="sm" variant="outline" className="gap-1.5 text-[12px]"
                onClick={() => setDetailMetier({ tableObjet: d.table_objet, idObjet: d.id_objet, titre: `${d.type_libelle || d.type_demande || "Demande"}${d.reference ? " · " + d.reference : ""}` })}>
                <Eye size={13} /> Visualiser la demande métier
              </Button>
            </div>
            <SuiviDemandeWorkflow tableSource={d.table_objet} demandeId={d.id_objet} statutDemande={d.statut} />
            {estAdmin && d.wf_instance_id && d.statut === "en_attente" && (
              <div className="mt-3 pt-3 border-t flex items-center justify-between gap-3 flex-wrap" style={{ borderColor: "hsl(var(--border))" }}>
                <span className="text-[11px]" style={{ color: "hsl(var(--muted-foreground))" }}>
                  Action d'administration : ramener le workflow à l'étape précédemment franchie.
                </span>
                <button onClick={() => { setRetourModal(d); setMotifRetour(""); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors"
                  style={{ color: "hsl(var(--warning))", borderColor: "hsl(var(--warning) / 0.4)" }}>
                  <RotateCcw size={13} /> Retour à l'étape précédente
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const decider = async (task: InboxTask, type_decision: "VALIDER" | "REJETER" | "RENVOYER", commentaire?: string) => {
    if (!collaborateurId) {
      toast({ title: "Compte non rattaché", description: "Votre compte n'est pas lié à une fiche collaborateur.", variant: "destructive" as any });
      return;
    }
    setBusyId(task.ie_id);
    try {
      await api.post(`/workflow/decide`, {
        instance_etape_id: task.ie_id,
        acteur_id: collaborateurId,
        type_decision,
        commentaire: commentaire || null,
      });
      const label = type_decision === "VALIDER" ? "Demande approuvée" : type_decision === "REJETER" ? "Demande refusée" : "Demande renvoyée au collaborateur";
      toast({ title: label });
      setRefusModal(null); setMotifRefus("");
      await refetch();
      qc.invalidateQueries({ queryKey: ["wf-inbox"] });
      qc.invalidateQueries({ queryKey: ["wf-instance-full"] });
      qc.invalidateQueries({ queryKey: ["mes-demandes"] });
    } catch (e: any) {
      toast({ title: "Erreur", description: e?.message || "L'action n'a pas pu être enregistrée.", variant: "destructive" as any });
    } finally { setBusyId(null); }
  };

  // Lire l'inbox ne nécessite que l'ID utilisateur (authUserId).
  // Seules les DÉCISIONS (valider/refuser/renvoyer) requièrent une fiche
  // collaborateur, car elles sont enregistrées au nom d'un acteur (acteur_id).
  // On n'empêche donc PLUS l'affichage des demandes : on désactive seulement les actions.
  const notAttached = !collabLoading && !collaborateurId;

  // ── Sélection multiple ──
  const toggleSel = (ie: string) =>
    setSelection(prev => { const n = new Set(prev); n.has(ie) ? n.delete(ie) : n.add(ie); return n; });

  const groupAllSelected = (items: InboxTask[]) => items.length > 0 && items.every(t => selection.has(t.ie_id));

  const toggleGroup = (items: InboxTask[]) =>
    setSelection(prev => {
      const n = new Set(prev);
      const all = items.every(t => n.has(t.ie_id));
      items.forEach(t => all ? n.delete(t.ie_id) : n.add(t.ie_id));
      return n;
    });

  const clearSel = () => setSelection(new Set());

  const runBatch = async (type: "VALIDER" | "REJETER" | "RENVOYER" | "DELEGUER",
                          commentaire?: string, cible_id?: string) => {
    if (!collaborateurId) {
      toast({ title: "Compte non rattaché", description: "Votre compte n'est pas lié à une fiche collaborateur.", variant: "destructive" as any });
      return;
    }
    const ids = [...selection];
    if (ids.length === 0) return;
    setBulkBusy(true);
    try {
      const res: any = await api.post(`/workflow/decide-batch`, {
        instance_etape_ids: ids,
        acteur_id: collaborateurId,
        type_decision: type,
        commentaire: commentaire || null,
        cible_id: cible_id || null,
      });
      const ok = res?.traitees ?? 0, ko = res?.echecs ?? 0;
      toast({
        title: `${ok} demande(s) traitée(s)`,
        description: ko > 0 ? `${ko} échec(s) — vérifiez les tâches restantes.` : undefined,
        variant: ko > 0 ? ("destructive" as any) : undefined,
      });
      setBulkAction(null); setBulkMotif(""); setBulkCible("");
      clearSel();
      await refetch();
      qc.invalidateQueries({ queryKey: ["wf-inbox"] });
      qc.invalidateQueries({ queryKey: ["wf-instance-full"] });
      qc.invalidateQueries({ queryKey: ["mes-demandes"] });
    } catch (e: any) {
      toast({ title: "Erreur", description: e?.message || "Le traitement par lot a échoué.", variant: "destructive" as any });
    } finally { setBulkBusy(false); }
  };

  const loading = collabLoading || loadingInbox || (objetIds.length > 0 && loadingDemandes);

  const renderTask = (t: InboxTask) => {
    const dem = demandesMap[t.id_objet] || {};
    const jours = dem.nbr_jours_decomptes ?? dem.nbr_jours_calendaires;
    const fin = dem.date_fin_absence || dem.date_fin;
    const busy = busyId === t.ie_id;
    const expanded = expandedId === t.ie_id;
    const enRetard = t.date_echeance && new Date(t.date_echeance) < new Date();
    const sel = selection.has(t.ie_id);

    return (
      <div key={t.ie_id} className="rounded-2xl overflow-hidden transition-all" style={{ background: sel ? "hsl(var(--primary) / 0.05)" : "hsl(var(--card))", border: sel ? "1px solid hsl(var(--primary))" : "1px solid hsl(var(--border))" }}>
        <div className="p-4 cursor-pointer hover:bg-[hsl(var(--muted)/0.3)] transition-colors" onClick={() => setExpandedId(id => id === t.ie_id ? null : t.ie_id)}>
          <div className="flex items-start gap-3 flex-wrap">
            <input
              type="checkbox"
              checked={sel}
              onClick={(e) => e.stopPropagation()}
              onChange={() => toggleSel(t.ie_id)}
              className="mt-3.5 h-4 w-4 cursor-pointer flex-shrink-0"
              style={{ accentColor: "hsl(var(--primary))" }}
              title="Sélectionner pour un traitement groupé"
            />
            <div className="w-11 h-11 rounded-2xl flex items-center justify-center text-sm font-bold flex-shrink-0" style={{ background: "hsl(var(--primary) / 0.1)", color: "hsl(var(--primary))" }}>
              {initials(t.demandeur_prenom || undefined, t.demandeur_nom || undefined) || "?"}
            </div>
            <div className="flex-1 min-w-[180px]">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-sm" style={{ color: "hsl(var(--foreground))" }}>{`${t.demandeur_prenom || ""} ${t.demandeur_nom || ""}`.trim() || "Collaborateur"}</span>
                {t.demandeur_matricule && <span className="text-[11px] px-1.5 py-0.5 rounded" style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>#{t.demandeur_matricule}</span>}
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: "hsl(var(--info) / 0.12)", color: "hsl(var(--info))" }}>
                  <Workflow size={10} /> {t.etape_libelle}
                </span>
              </div>
              <div className="flex items-center gap-3 mt-1.5 text-[13px] flex-wrap" style={{ color: "hsl(var(--muted-foreground))" }}>
                {(dem.date_debut || fin) && <span className="inline-flex items-center gap-1"><CalendarRange size={13} />{fmt(dem.date_debut, "dd/MM/yyyy")} → {fmt(fin, "dd/MM/yyyy")}</span>}
                {jours != null && <span className="inline-flex items-center gap-1"><Clock size={13} />{jours} j</span>}
                {dem.libelle_type_conge
                  ? <span className="inline-flex items-center gap-1"><CalendarDays size={13} />{dem.libelle_type_conge}</span>
                  : <span className="inline-flex items-center gap-1"><Workflow size={13} />{t.workflow_libelle}</span>}
              </div>
              {dem.commentaire_collaborateur && (
                <p className="text-[13px] mt-2 flex items-start gap-1.5 p-2 rounded-lg" style={{ background: "hsl(var(--muted) / 0.4)", color: "hsl(var(--foreground))" }}>
                  <MessageSquare size={13} className="mt-0.5 flex-shrink-0" style={{ color: "hsl(var(--muted-foreground))" }} />{dem.commentaire_collaborateur}
                </p>
              )}
              {t.date_echeance && (
                <p className="text-[11px] mt-1.5 inline-flex items-center gap-1" style={{ color: enRetard ? "hsl(var(--destructive))" : "hsl(var(--muted-foreground))" }}>
                  <Hourglass size={11} /> {enRetard ? "En retard · " : ""}Échéance : {fmt(t.date_echeance)}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Button size="sm" disabled={busy || notAttached} title={notAttached ? "Compte non rattaché à une fiche collaborateur" : undefined} onClick={(e) => { e.stopPropagation(); decider(t, "VALIDER"); }} className="gap-1.5 text-white" style={{ background: "hsl(var(--success))" }}>
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Approuver
              </Button>
              <Button size="sm" variant="outline" disabled={busy || notAttached} title={notAttached ? "Compte non rattaché à une fiche collaborateur" : undefined} onClick={(e) => { e.stopPropagation(); setRefusModal(t); setMotifRefus(""); }} className="gap-1.5" style={{ color: "hsl(var(--destructive))", borderColor: "hsl(var(--destructive) / 0.4)" }}>
                <X size={14} /> Refuser
              </Button>
              {collaborateurId && (
                <span onClick={(e) => e.stopPropagation()}>
                  <DeleguerButton
                    instanceEtapeId={t.ie_id}
                    acteurId={collaborateurId}
                    onDone={() => { refetch(); qc.invalidateQueries({ queryKey: ["wf-inbox"] }); }}
                  />
                </span>
              )}
              <ChevronDown size={16} style={{ color: "hsl(var(--muted-foreground))", transform: expanded ? "rotate(180deg)" : "none", transition: "transform .2s" }} />
            </div>
          </div>
        </div>

        {expanded && (
          <div className="px-4 pb-4 pt-1 border-t" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.15)" }}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "hsl(var(--muted-foreground))" }}>Suivi du processus</span>
              <Button size="sm" variant="outline" className="gap-1.5 text-[12px]"
                onClick={(e) => { e.stopPropagation(); setDetailMetier({ tableObjet: t.table_source || "cong_demandes", idObjet: t.id_objet, titre: `${dem.type_libelle || dem.type_demande || "Demande"}${dem.reference ? " · " + dem.reference : ""}` }); }}>
                <Eye size={13} /> Visualiser la demande métier
              </Button>
            </div>
            <SuiviDemandeWorkflow tableSource={t.table_source || "cong_demandes"} demandeId={t.id_objet} statutDemande={dem.statut} />
            <div className="flex justify-end mt-2">
              <Button size="sm" variant="ghost" disabled={busy || notAttached} title={notAttached ? "Compte non rattaché à une fiche collaborateur" : undefined} onClick={(e) => { e.stopPropagation(); decider(t, "RENVOYER", "Renvoyée pour modification"); }} className="gap-1.5 text-[12px]" style={{ color: "hsl(var(--warning))" }}>
                <CornerUpLeft size={13} /> Renvoyer au collaborateur
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="max-w-5xl mx-auto">
      {/* Fil d'Ariane */}
      <div className="flex items-center gap-1.5 px-4 pt-4 pb-2 text-[13px]" style={{ color: "hsl(var(--muted-foreground))" }}>
        <span>Mon équipe</span>
        <span style={{ opacity: 0.5 }}>/</span>
        <span className="font-semibold" style={{ color: "hsl(var(--foreground))" }}>Gestion des demandes</span>
        {tasks.length > 0 && (
          <span className="ml-1 text-[11px] px-2 py-0.5 rounded-full font-semibold" style={{ background: "hsl(var(--warning) / 0.12)", color: "hsl(var(--warning))" }}>
            {tasks.length} en attente
          </span>
        )}
      </div>

      {/* Barre d'outils */}
      <div className="flex items-center gap-2 px-4 py-2.5 flex-wrap" style={{ borderBottom: "1px solid hsl(var(--border))", background: "hsl(var(--card))" }}>
        <div className="flex items-center flex-1 min-w-[220px] h-8 px-2.5" style={{ border: "1px solid hsl(var(--border))", borderRadius: "var(--radius)", background: "hsl(var(--background))" }}>
          <Search size={13} style={{ color: "hsl(var(--muted-foreground))" }} className="flex-shrink-0 mr-1.5" />
          <input value={recherche} onChange={e => setRecherche(e.target.value)} placeholder="Rechercher un collaborateur, une étape, un type de congé…"
            className="flex-1 text-[13px] outline-none bg-transparent" style={{ color: "hsl(var(--foreground))" }} />
        </div>
        <button onClick={() => setShowFiltres(true)}
          className="flex items-center gap-1.5 h-8 px-2.5 text-[13px] font-medium transition-colors"
          style={{ color: nbFiltresActifs > 0 ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))" }}>
          <Filter size={14} /> Filtres avancés
          {nbFiltresActifs > 0 && (
            <span className="inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 text-[10px] font-bold rounded" style={{ background: "hsl(var(--primary) / 0.15)", color: "hsl(var(--primary))" }}>{nbFiltresActifs}</span>
          )}
        </button>
        <div className="flex-1" />
        <button onClick={() => refetch()} className="flex items-center gap-1.5 h-8 px-2.5 text-[13px] font-medium transition-colors" style={{ color: "hsl(var(--muted-foreground))" }}>
          <Loader2 size={14} className={loadingInbox ? "animate-spin" : "hidden"} /> Actualiser
        </button>
      </div>

      <div className="px-4 py-6 space-y-6">

      {notAttached && (
        estAdmin ? (
          <div className="flex items-center gap-3 p-4 rounded-2xl text-sm" style={{ background: "hsl(var(--info) / 0.08)", border: "1px solid hsl(var(--info) / 0.2)", color: "hsl(var(--info))" }}>
            <AlertCircle size={18} className="flex-shrink-0" />
            Mode consultation : en tant qu'administrateur, vous visualisez l'ensemble des demandes. Les décisions (approuver, refuser, renvoyer) sont prises par les acteurs désignés dans chaque workflow.
          </div>
        ) : (
          <div className="flex items-center gap-3 p-4 rounded-2xl text-sm" style={{ background: "hsl(var(--warning) / 0.1)", border: "1px solid hsl(var(--warning) / 0.25)", color: "hsl(var(--warning))" }}>
            <AlertCircle size={18} className="flex-shrink-0" />
            Votre compte n'est pas rattaché à une fiche collaborateur : vous pouvez consulter les demandes, mais les actions de décision (approuver, refuser, renvoyer) sont désactivées. Contactez le service RH pour rattacher votre compte.
          </div>
        )
      )}

      {/* Filtre par statut (s'applique au suivi et aux demandes clôturées) */}
      <div className="flex gap-1.5 flex-wrap">
        {["TOUS", "en_attente", "approuvee", "refusee", "annulee"].map(s => {
          const actif = filtreStatut === s;
          const sc = STATUT_COLOR[s];
          const col = s === "TOUS" ? "hsl(var(--primary))" : (sc?.c ?? "hsl(var(--primary))");
          const bgInactif = s === "TOUS" ? "transparent" : (sc?.b ?? "transparent");
          return (
            <button key={s} onClick={() => setFiltreStatut(s)} className="px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-all"
              style={{
                background: actif ? col : bgInactif,
                borderColor: actif ? col : (s === "TOUS" ? "hsl(var(--border))" : col),
                color: actif ? "white" : col,
              }}>
              {s === "TOUS" ? "Toutes" : (STATUT_LABEL[s] ?? s)} {s !== "TOUS" && `(${perimetre.filter((d: any) => d.statut === s).length})`}
            </button>
          );
        })}
      </div>

      {loading || loadingPerim ? (
        <div className="flex items-center justify-center py-16" style={{ color: "hsl(var(--muted-foreground))" }}>
          <Loader2 size={22} className="animate-spin mr-2" /> Chargement des demandes…
        </div>
      ) : pavesFusion.paves.length === 0 && pavesFusion.terminaux.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Inbox size={36} style={{ color: "hsl(var(--muted-foreground))" }} />
          <p className="mt-3 font-medium" style={{ color: "hsl(var(--foreground))" }}>Aucune demande</p>
          <p className="text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>Aucune demande dans votre périmètre pour ce filtre.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {pavesFusion.paves.map(({ etape, actions, suivi, total }) => {
            const collapsed = collapsedEtapes.has(etape);
            return (
              <div key={etape} className="rounded-2xl overflow-hidden" style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}>
                {/* En-tête de pavé (repliable) */}
                <div className="flex items-center gap-2 p-3 cursor-pointer hover:bg-[hsl(var(--muted)/0.3)] transition-colors"
                     onClick={() => toggleEtape(etape)} style={{ borderBottom: collapsed ? "none" : "1px solid hsl(var(--border))" }}>
                  {actions.length > 0 && (
                    <input
                      type="checkbox"
                      checked={groupAllSelected(actions)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => toggleGroup(actions)}
                      className="h-4 w-4 cursor-pointer flex-shrink-0"
                      style={{ accentColor: "hsl(var(--primary))" }}
                      title="Tout sélectionner dans ce groupe"
                    />
                  )}
                  <span className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "hsl(var(--info) / 0.12)", color: "hsl(var(--info))" }}><Workflow size={15} /></span>
                  <h2 className="font-bold text-[15px] flex-1" style={{ color: "hsl(var(--foreground))" }}>{etape}</h2>
                  {actions.length > 0 && (
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full text-white" style={{ background: "hsl(var(--primary))" }} title="Tâches à traiter">{actions.length} à traiter</span>
                  )}
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>{total}</span>
                  <ChevronDown size={18} style={{ color: "hsl(var(--muted-foreground))", transform: collapsed ? "none" : "rotate(180deg)", transition: "transform .2s", flexShrink: 0 }} />
                </div>
                {!collapsed && (
                  <div className="p-3 space-y-2">
                    {actions.map(renderTask)}
                    {suivi.map(renderSuivi)}
                  </div>
                )}
              </div>
            );
          })}

          {/* Pavé des demandes clôturées (approuvées / refusées / annulées) */}
          {pavesFusion.terminaux.length > 0 && (
            <div className="rounded-2xl overflow-hidden" style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}>
              <div className="flex items-center gap-2 p-3 cursor-pointer hover:bg-[hsl(var(--muted)/0.3)] transition-colors"
                   onClick={() => toggleEtape("__cloturees__")} style={{ borderBottom: collapsedEtapes.has("__cloturees__") ? "none" : "1px solid hsl(var(--border))" }}>
                <span className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}><ClipboardList size={15} /></span>
                <h2 className="font-bold text-[15px] flex-1" style={{ color: "hsl(var(--foreground))" }}>Clôturées</h2>
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>{pavesFusion.terminaux.length}</span>
                <ChevronDown size={18} style={{ color: "hsl(var(--muted-foreground))", transform: collapsedEtapes.has("__cloturees__") ? "none" : "rotate(180deg)", transition: "transform .2s", flexShrink: 0 }} />
              </div>
              {!collapsedEtapes.has("__cloturees__") && (
                <div className="p-3 space-y-2">{pavesFusion.terminaux.map(renderSuivi)}</div>
              )}
            </div>
          )}
        </div>
      )}

      {detailMetier && (
        <DemandeMetierModal
          tableObjet={detailMetier.tableObjet}
          idObjet={detailMetier.idObjet}
          titre={detailMetier.titre}
          onClose={() => setDetailMetier(null)}
        />
      )}

      {refusModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.4)" }} onClick={() => setRefusModal(null)}>
          <div className="w-full max-w-md rounded-2xl p-5" style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-lg flex items-center gap-2" style={{ color: "hsl(var(--foreground))" }}><XCircle size={18} style={{ color: "hsl(var(--destructive))" }} /> Refuser la demande</h3>
            <p className="text-sm mt-1 mb-3" style={{ color: "hsl(var(--muted-foreground))" }}>
              {`${refusModal.demandeur_prenom || ""} ${refusModal.demandeur_nom || ""}`.trim()} · {refusModal.etape_libelle}
            </p>
            <label className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: "hsl(var(--muted-foreground))" }}>Motif du refus</label>
            <textarea value={motifRefus} onChange={e => setMotifRefus(e.target.value)} rows={3}
              placeholder="Expliquez la raison du refus (visible par le collaborateur)…"
              className="w-full mt-1.5 p-2.5 rounded-xl text-sm resize-none outline-none"
              style={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }} />
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="outline" size="sm" onClick={() => setRefusModal(null)}>Annuler</Button>
              <Button size="sm" disabled={busyId === refusModal.ie_id} onClick={() => decider(refusModal, "REJETER", motifRefus.trim() || undefined)}
                className="gap-1.5 text-white" style={{ background: "hsl(var(--destructive))" }}>
                {busyId === refusModal.ie_id ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />} Confirmer le refus
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ════ Traitement par lot ════ */}
      {selection.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 px-4 py-3 rounded-2xl shadow-xl"
          style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}>
          <span className="text-sm font-semibold pr-1" style={{ color: "hsl(var(--foreground))" }}>
            {selection.size} sélectionnée(s)
          </span>
          <Button size="sm" disabled={bulkBusy || notAttached} onClick={() => runBatch("VALIDER")}
            className="gap-1.5 text-white" style={{ background: "hsl(var(--success))" }}>
            {bulkBusy ? <Loader2 size={14} className="animate-spin" /> : <CheckCheck size={14} />} Approuver
          </Button>
          <Button size="sm" variant="outline" disabled={bulkBusy || notAttached} onClick={() => { setBulkMotif(""); setBulkAction("REJETER"); }}
            className="gap-1.5" style={{ color: "hsl(var(--destructive))", borderColor: "hsl(var(--destructive) / 0.4)" }}>
            <X size={14} /> Refuser
          </Button>
          <Button size="sm" variant="outline" disabled={bulkBusy || notAttached} onClick={() => { setBulkCible(""); setBulkAction("DELEGUER"); }}
            className="gap-1.5">
            <Share2 size={14} /> Déléguer
          </Button>
          <Button size="sm" variant="ghost" disabled={bulkBusy} onClick={clearSel} className="gap-1.5 text-[12px]"
            style={{ color: "hsl(var(--muted-foreground))" }}>
            Désélectionner
          </Button>
        </div>
      )}

      {/* Modale : refus par lot */}
      {bulkAction === "REJETER" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.4)" }} onClick={() => setBulkAction(null)}>
          <div className="w-full max-w-md rounded-2xl p-5" style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-lg flex items-center gap-2" style={{ color: "hsl(var(--foreground))" }}><XCircle size={18} style={{ color: "hsl(var(--destructive))" }} /> Refuser {selection.size} demande(s)</h3>
            <p className="text-sm mt-1 mb-3" style={{ color: "hsl(var(--muted-foreground))" }}>Le même motif sera appliqué à toutes les demandes sélectionnées.</p>
            <label className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: "hsl(var(--muted-foreground))" }}>Motif du refus</label>
            <textarea value={bulkMotif} onChange={e => setBulkMotif(e.target.value)} rows={3}
              placeholder="Expliquez la raison du refus (visible par les collaborateurs)…"
              className="w-full mt-1.5 p-2.5 rounded-xl text-sm resize-none outline-none"
              style={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }} />
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="outline" size="sm" onClick={() => setBulkAction(null)}>Annuler</Button>
              <Button size="sm" disabled={bulkBusy} onClick={() => runBatch("REJETER", bulkMotif.trim() || undefined)}
                className="gap-1.5 text-white" style={{ background: "hsl(var(--destructive))" }}>
                {bulkBusy ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />} Confirmer le refus
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Modale : délégation par lot */}
      {bulkAction === "DELEGUER" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.4)" }} onClick={() => setBulkAction(null)}>
          <div className="w-full max-w-md rounded-2xl p-5" style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-lg flex items-center gap-2" style={{ color: "hsl(var(--foreground))" }}><Share2 size={18} style={{ color: "hsl(var(--primary))" }} /> Déléguer {selection.size} demande(s)</h3>
            <p className="text-sm mt-1 mb-3" style={{ color: "hsl(var(--muted-foreground))" }}>Le collaborateur choisi recevra toutes les tâches sélectionnées.</p>
            <label className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: "hsl(var(--muted-foreground))" }}>Déléguer à</label>
            <div className="mt-1.5">
              <CollaborateurPicker value={bulkCible} onChange={setBulkCible} excludeId={collaborateurId || undefined} />
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="outline" size="sm" onClick={() => setBulkAction(null)}>Annuler</Button>
              <Button size="sm" disabled={bulkBusy || !bulkCible} onClick={() => runBatch("DELEGUER", undefined, bulkCible)}
                className="gap-1.5">
                {bulkBusy ? <Loader2 size={14} className="animate-spin" /> : <Share2 size={14} />} Déléguer
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Modale retour admin à l'étape précédente (motif obligatoire) */}
      {retourModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.4)" }} onClick={() => setRetourModal(null)}>
          <div className="w-full max-w-md rounded-2xl p-5" style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-lg flex items-center gap-2" style={{ color: "hsl(var(--foreground))" }}><RotateCcw size={18} style={{ color: "hsl(var(--warning))" }} /> Retour à l'étape précédente</h3>
            <p className="text-sm mt-1 mb-3" style={{ color: "hsl(var(--muted-foreground))" }}>
              {`${retourModal.demandeur_prenom || ""} ${retourModal.demandeur_nom || ""}`.trim()} · {retourModal.reference}
            </p>
            <p className="text-[12px] mb-2" style={{ color: "hsl(var(--muted-foreground))" }}>
              Le workflow sera ramené à la dernière étape franchie. Cette action d'administration est tracée.
            </p>
            <label className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: "hsl(var(--muted-foreground))" }}>Motif du retour (obligatoire)</label>
            <textarea value={motifRetour} onChange={e => setMotifRetour(e.target.value)} rows={3}
              placeholder="Expliquez la raison du retour en arrière…"
              className="w-full mt-1.5 p-2.5 rounded-xl text-sm resize-none outline-none"
              style={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }} />
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="outline" size="sm" onClick={() => setRetourModal(null)}>Annuler</Button>
              <Button size="sm" disabled={retourBusy || !motifRetour.trim()} onClick={faireRetour}
                className="gap-1.5 text-white" style={{ background: "hsl(var(--warning))" }}>
                {retourBusy ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />} Confirmer le retour
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Panneau latéral : Filtres avancés (style maison) */}
      {showFiltres && (
        <div className="fixed inset-0 z-50 flex justify-end" style={{ background: "rgba(0,0,0,0.4)" }} onClick={() => setShowFiltres(false)}>
          <div className="w-full max-w-md h-full flex flex-col" style={{ background: "hsl(var(--card))" }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: "hsl(var(--border))" }}>
              <h3 className="font-bold text-lg flex items-center gap-2" style={{ color: "hsl(var(--foreground))" }}>
                <Filter size={18} style={{ color: "hsl(var(--primary))" }} /> Filtres avancés
              </h3>
              <button onClick={() => setShowFiltres(false)} className="p-1 rounded-lg" style={{ color: "hsl(var(--muted-foreground))" }}><X size={18} /></button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
              {/* Type de demande */}
              <div>
                <label className="text-[12px] font-semibold uppercase tracking-wider block mb-2" style={{ color: "hsl(var(--muted-foreground))" }}>Type de demande</label>
                <div className="flex flex-wrap gap-1.5">
                  {optionsFiltres.types.length === 0 && <span className="text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>Aucun</span>}
                  {optionsFiltres.types.map(([val, lib]) => (
                    <button key={val} onClick={() => setFType(fType === val ? "" : val)}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-all"
                      style={{ background: fType === val ? "hsl(var(--primary))" : "transparent", borderColor: fType === val ? "hsl(var(--primary))" : "hsl(var(--border))", color: fType === val ? "white" : "hsl(var(--foreground))" }}>
                      {lib}
                    </button>
                  ))}
                </div>
              </div>

              {/* Demandeur : recherche matricule/nom + multi-choix */}
              <div>
                <label className="text-[12px] font-semibold uppercase tracking-wider block mb-2" style={{ color: "hsl(var(--muted-foreground))" }}>
                  Demandeur{fDemandeurs.length > 0 ? ` (${fDemandeurs.length})` : ""}
                </label>
                <div className="relative mb-2">
                  <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: "hsl(var(--muted-foreground))" }} />
                  <input value={demSearch} onChange={e => setDemSearch(e.target.value)} placeholder="Rechercher par nom ou matricule…"
                    className="w-full h-9 pl-8 pr-2.5 rounded-xl text-sm outline-none"
                    style={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }} />
                </div>
                {fDemandeurs.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {fDemandeurs.map(id => {
                      const d = optionsFiltres.demandeurs.find(x => x.id === id);
                      return (
                        <span key={id} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium" style={{ background: "hsl(var(--primary) / 0.12)", color: "hsl(var(--primary))" }}>
                          {d?.nom || "—"}{d?.matricule ? ` · ${d.matricule}` : ""}
                          <button onClick={() => toggleDemandeur(id)} className="ml-0.5"><X size={11} /></button>
                        </span>
                      );
                    })}
                  </div>
                )}
                <div className="max-h-44 overflow-y-auto rounded-xl border" style={{ borderColor: "hsl(var(--border))" }}>
                  {demandeursAffiches.length === 0 ? (
                    <p className="text-sm px-3 py-2" style={{ color: "hsl(var(--muted-foreground))" }}>Aucun demandeur</p>
                  ) : demandeursAffiches.map(d => {
                    const checked = fDemandeurs.includes(d.id);
                    return (
                      <button key={d.id} onClick={() => toggleDemandeur(d.id)}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors"
                        style={{ background: checked ? "hsl(var(--primary) / 0.08)" : "transparent", color: "hsl(var(--foreground))" }}>
                        <span className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0 border"
                          style={{ background: checked ? "hsl(var(--primary))" : "transparent", borderColor: checked ? "hsl(var(--primary))" : "hsl(var(--border))" }}>
                          {checked && <Check size={11} className="text-white" />}
                        </span>
                        <span className="flex-1 truncate">{d.nom}</span>
                        {d.matricule && <span className="text-[11px]" style={{ color: "hsl(var(--muted-foreground))" }}>{d.matricule}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Étape courante */}
              <div>
                <label className="text-[12px] font-semibold uppercase tracking-wider block mb-2" style={{ color: "hsl(var(--muted-foreground))" }}>Étape courante</label>
                <div className="flex flex-wrap gap-1.5">
                  {optionsFiltres.etapes.length === 0 && <span className="text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>Aucune</span>}
                  {optionsFiltres.etapes.map(et => (
                    <button key={et} onClick={() => setFEtape(fEtape === et ? "" : et)}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-all"
                      style={{ background: fEtape === et ? "hsl(var(--primary))" : "transparent", borderColor: fEtape === et ? "hsl(var(--primary))" : "hsl(var(--border))", color: fEtape === et ? "white" : "hsl(var(--foreground))" }}>
                      {et}
                    </button>
                  ))}
                </div>
              </div>

              {/* Période */}
              <div>
                <label className="text-[12px] font-semibold uppercase tracking-wider block mb-2" style={{ color: "hsl(var(--muted-foreground))" }}>Période de la demande</label>
                {/* Raccourcis rapides */}
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {([["ce_mois", "Ce mois"], ["mois_prochain", "Mois prochain"], ["cette_annee", "Cette année"]] as const).map(([k, lib]) => (
                    <button key={k} onClick={() => raccourciPeriode(k)}
                      className="px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-all"
                      style={{ background: "transparent", borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" }}>
                      {lib}
                    </button>
                  ))}
                </div>
                {/* Sélecteur de mois */}
                <div className="mb-2">
                  <span className="text-[11px]" style={{ color: "hsl(var(--muted-foreground))" }}>Mois</span>
                  <input type="month" value={moisValue} onChange={e => setMois(e.target.value)}
                    className="w-full h-9 px-2.5 rounded-xl text-sm outline-none mt-0.5"
                    style={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }} />
                </div>
                {/* Bornes manuelles */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-[11px]" style={{ color: "hsl(var(--muted-foreground))" }}>Du</span>
                    <input type="date" value={fDebut} onChange={e => setFDebut(e.target.value)}
                      className="w-full h-9 px-2.5 rounded-xl text-sm outline-none mt-0.5"
                      style={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }} />
                  </div>
                  <div>
                    <span className="text-[11px]" style={{ color: "hsl(var(--muted-foreground))" }}>Au</span>
                    <input type="date" value={fFin} onChange={e => setFFin(e.target.value)}
                      className="w-full h-9 px-2.5 rounded-xl text-sm outline-none mt-0.5"
                      style={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }} />
                  </div>
                </div>
              </div>

              {/* Référence */}
              <div>
                <label className="text-[12px] font-semibold uppercase tracking-wider block mb-2" style={{ color: "hsl(var(--muted-foreground))" }}>Référence</label>
                <input value={fRef} onChange={e => setFRef(e.target.value)} placeholder="DEM-2026-…"
                  className="w-full h-9 px-2.5 rounded-xl text-sm outline-none"
                  style={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))", color: "hsl(var(--foreground))" }} />
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 px-5 py-4 border-t" style={{ borderColor: "hsl(var(--border))" }}>
              <button onClick={resetFiltres} className="flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-xl" style={{ color: "hsl(var(--muted-foreground))" }}>
                <RotateCcw size={14} /> Réinitialiser
              </button>
              <Button size="sm" onClick={() => setShowFiltres(false)} className="text-white" style={{ background: "hsl(var(--primary))" }}>
                Appliquer{nbFiltresActifs > 0 ? ` (${nbFiltresActifs})` : ""}
              </Button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
