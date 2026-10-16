import React, { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useManagerPopulation } from "@/hooks/useManagerPopulation";
import {
  DoorOpen, Plus, Search, Calendar, CheckCircle2, Clock,
  X, Eye, Download, Filter, RotateCcw, Users, FileDown,
  AlertTriangle, UserCheck, ChevronDown, Bell, TrendingUp,
  Ban, Pencil, CheckCheck, CalendarClock, CircleDot, CalendarDays,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useNavigate } from "react-router-dom";
import { toast } from "@/hooks/use-toast";
import { format, parseISO, differenceInDays } from "date-fns";
import { fr } from "date-fns/locale";
import DepartForm from "@/components/depart/DepartForm";
import SuiviDemandeWorkflow from "@/pages/espaces/SuiviDemandeWorkflow";
import * as XLSX from "xlsx";

// ─── Types ───────────────────────────────────────────────────────────────────
interface Depart {
  id: string;
  collaborateur_id: string;
  date_depart: string;
  motif_depart: string;
  commentaire: string | null;
  reference_decision: string | null;
  statut: string;
  traite_le: string | null;
  created_at: string;
  collaborateur?: {
    nom: string; prenom: string; matricule: string;
    statut_collaborateur: string; photo_path?: string;
  };
}

// ─── Config statuts ──────────────────────────────────────────────────────────
const STATUT_CFG: Record<string, { label: string; bg: string; color: string; border: string; icon: React.ReactNode }> = {
  EN_COURS:   { label: "En cours",   bg: "hsl(210 90% 55% / 0.12)", color: "hsl(210 90% 40%)", border: "hsl(210 90% 55% / 0.3)",  icon: <CircleDot size={12} /> },
  PLANIFIE: { label: "Planifié",  bg: "hsl(45 100% 50% / 0.12)",  color: "hsl(45 100% 28%)",  border: "hsl(45 100% 50% / 0.3)",  icon: <Clock size={12} /> },
  TRAITE:   { label: "Traité",    bg: "hsl(142 55% 45% / 0.12)", color: "hsl(142 55% 28%)", border: "hsl(142 55% 45% / 0.3)", icon: <CheckCircle2 size={12} /> },
  ENREGISTRE: { label: "Enregistré", bg: "hsl(265 60% 55% / 0.12)", color: "hsl(265 60% 45%)", border: "hsl(265 60% 55% / 0.3)", icon: <UserCheck size={12} /> },
  ANNULE:   { label: "Annulé",    bg: "hsl(0 70% 50% / 0.10)",   color: "hsl(0 70% 38%)",   border: "hsl(0 70% 50% / 0.25)",  icon: <X size={12} /> },
};

const StatutBadge: React.FC<{ statut: string }> = ({ statut }) => {
  const cfg = STATUT_CFG[statut] ?? { label: statut, bg: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))", border: "hsl(var(--border))", icon: null };
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold"
      style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}` }}>
      {cfg.icon}{cfg.label}
    </span>
  );
};

// ─── MultiSelect ─────────────────────────────────────────────────────────────
const MultiSelect: React.FC<{
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (v: string[]) => void;
  allLabel?: string;
}> = ({ options, selected, onChange, allLabel = "Tous" }) => {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h);
  }, []);
  const toggle = (v: string) => { if (v === "ALL") { onChange([]); return; } onChange(selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v]); };
  const label = selected.length === 0 ? allLabel : selected.length === 1 ? options.find(o => o.value === selected[0])?.label || selected[0] : `${selected.length} sélectionnés`;
  return (
    <div ref={ref} className="relative" style={{ minWidth: 150 }}>
      <button onClick={() => setOpen(o => !o)} className="flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium"
        style={{ border: `1px solid ${selected.length > 0 ? "hsl(var(--primary)/0.3)" : "hsl(var(--border))"}`, background: selected.length > 0 ? "hsl(var(--primary)/0.06)" : "hsl(var(--background))", color: selected.length > 0 ? "hsl(var(--primary))" : "hsl(var(--foreground))" }}>
        {label}<ChevronDown size={11} style={{ opacity: 0.6, marginLeft: "auto" }} />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 rounded-xl border shadow-xl py-1 min-w-[180px]"
          style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>
          <button onClick={() => toggle("ALL")} className="w-full text-left px-3 py-1.5 text-xs hover:opacity-70"
            style={{ color: selected.length === 0 ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))" }}>
            {allLabel}
          </button>
          {options.map(o => (
            <button key={o.value} onClick={() => toggle(o.value)} className="w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:opacity-70"
              style={{ color: "hsl(var(--foreground))" }}>
              <span className="w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0"
                style={{ borderColor: selected.includes(o.value) ? "hsl(var(--primary))" : "hsl(var(--border))", background: selected.includes(o.value) ? "hsl(var(--primary))" : "transparent" }}>
                {selected.includes(o.value) && <CheckCircle2 size={9} style={{ color: "white" }} />}
              </span>
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// ─── Popup détail départ ──────────────────────────────────────────────────────
const DetailDepartModal: React.FC<{ dep: Depart; onClose: () => void; onNavigate: () => void; onAnnuler?: () => void; isReadOnly: boolean }> = ({ dep, onClose, onNavigate, onAnnuler, isReadOnly }) => {
  const collab = dep.collaborateur;
  const photoRaw = collab?.photo_path || null;
  const photoUrl = photoRaw ? (photoRaw.startsWith("http") || photoRaw.startsWith("/") ? photoRaw : `/api/v1/storage/${photoRaw}`) : null;
  const initiales = `${collab?.prenom?.[0] || ""}${collab?.nom?.[0] || ""}`;
  const isPast = new Date(dep.date_depart) <= new Date();
  const joursRestants = dep.statut === "PLANIFIE" && !isPast
    ? Math.ceil((new Date(dep.date_depart).getTime() - Date.now()) / 86400000)
    : null;
  const d = dep as any;

  const totalIndemnites = [
    d.indemnite_perte_emploi, d.indemnite_depart_retraite,
    d.indemnite_conges_payes, d.indemnite_compensatrice,
    d.indemnite_transactionnelle, d.indemnite_anciennete, d.indemnite_13eme_mois,
  ].reduce((acc: number, v: any) => acc + (parseFloat(v) || 0), 0);

  const DOCS_LABELS: Record<string, string> = {
    doc_attestation_travail: "Attestation de travail",
    doc_recu_stc: "Reçu STC",
    doc_radiation_cnss: "Radiation CNSS",
    doc_attestation_amo: "Clôture AMO",
    doc_certificat_conges: "Certificat congés",
    doc_lettre_notification: "Lettre notification",
    doc_accord_amiable: "Accord amiable",
    doc_pv_entretien: "PV entretien",
    doc_recu_materiel: "Reçu matériel",
  };
  const MATERIEL_LABELS: Record<string, string> = {
    materiel_badge_restitue: "Badge",
    materiel_ordinateur_restitue: "Ordinateur",
    materiel_vehicule_restitue: "Véhicule",
    materiel_telephone_restitue: "Téléphone",
  };

  const SectionTitle = ({ title }: { title: string }) => (
    <div className="px-4 py-2 border-b" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.4)" }}>
      <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: "hsl(var(--foreground))" }}>{title}</p>
    </div>
  );

  const InfoRow = ({ label, value }: { label: string; value?: string | null }) => value ? (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider mb-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>{label}</p>
      <p className="text-xs" style={{ color: "hsl(var(--foreground))" }}>{value}</p>
    </div>
  ) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "hsl(var(--background) / 0.82)", backdropFilter: "blur(4px)" }}>
      <div className="w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", maxHeight: "90vh" }}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0"
          style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.35)" }}>
          <div className="flex items-center gap-2">
            <DoorOpen size={17} style={{ color: "hsl(var(--accent))" }} />
            <h2 className="text-base font-bold" style={{ color: "hsl(var(--foreground))" }}>Détail du départ</h2>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onNavigate}
              className="text-xs px-3 py-1.5 rounded-lg border font-medium hover:opacity-80"
              style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--accent))" }}>
              Voir la fiche
            </button>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:opacity-70"
              style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>
              <X size={15} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">

          {/* ── Collaborateur ── */}
          <div className="flex items-center gap-4 p-4 rounded-xl border"
            style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.25)" }}>
            {photoUrl ? (
              <img src={photoUrl} alt="" className="w-12 h-12 rounded-full object-cover flex-shrink-0"
                style={{ border: "2px solid hsl(var(--border))" }}
                onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
            ) : (
              <div className="w-12 h-12 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
                style={{ background: "hsl(var(--primary) / 0.12)", color: "hsl(var(--primary))" }}>
                {initiales}
              </div>
            )}
            <div className="flex-1">
              <p className="text-base font-bold" style={{ color: "hsl(var(--foreground))" }}>{collab?.prenom} {collab?.nom}</p>
              <p className="text-xs mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>#{collab?.matricule}</p>
            </div>
            <StatutBadge statut={dep.statut} />
          </div>

          {/* ── Suivi du workflow (si mode Processus) ── */}
          {(dep as any).mode_traitement === "PROCESSUS" && (
            <div className="rounded-xl border overflow-hidden" style={{ borderColor: "hsl(var(--border))" }}>
              <SectionTitle title="Suivi de la validation" />
              <div className="p-4">
                <SuiviDemandeWorkflow tableSource="collaborateur_departs" demandeId={dep.id} statutDemande={dep.statut} />
              </div>
            </div>
          )}

          {/* ── Infos départ ── */}
          <div className="rounded-xl border overflow-hidden" style={{ borderColor: "hsl(var(--border))" }}>
            <SectionTitle title="Informations du départ" />
            <div className="grid grid-cols-2 gap-4 p-4">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>Date de départ</p>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold" style={{ color: "hsl(var(--foreground))" }}>
                    {format(parseISO(dep.date_depart), "dd MMMM yyyy", { locale: fr })}
                  </p>
                  {joursRestants !== null && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold"
                      style={{ background: "hsl(45 100% 50% / 0.15)", color: "hsl(45 100% 28%)" }}>
                      Dans {joursRestants}j
                    </span>
                  )}
                </div>
              </div>
              <InfoRow label="Motif" value={dep.motif_depart} />
              <InfoRow label="Référence décision" value={dep.reference_decision} />
              <InfoRow label="Date notification" value={d.date_notification ? format(parseISO(d.date_notification), "dd/MM/yyyy", { locale: fr }) : null} />
              <InfoRow label="Date entretien préalable" value={d.date_entretien_prealable ? format(parseISO(d.date_entretien_prealable), "dd/MM/yyyy", { locale: fr }) : null} />
              <InfoRow label="Décision finale" value={d.decision_finale} />
              <InfoRow label="Traité le" value={dep.traite_le ? format(parseISO(dep.traite_le), "dd/MM/yyyy", { locale: fr }) : null} />
              {dep.commentaire && (
                <div className="col-span-2 pt-2 border-t" style={{ borderColor: "hsl(var(--border))" }}>
                  <p className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>Commentaire</p>
                  <p className="text-xs leading-relaxed" style={{ color: "hsl(var(--foreground))" }}>{dep.commentaire}</p>
                </div>
              )}
            </div>
          </div>

          {/* ── Préavis ── */}
          {d.preavis_duree_jours && (
            <div className="rounded-xl border overflow-hidden" style={{ borderColor: "hsl(var(--border))" }}>
              <SectionTitle title="Préavis" />
              <div className="grid grid-cols-3 gap-4 p-4">
                <InfoRow label="Durée" value={`${d.preavis_duree_jours} jours`} />
                <InfoRow label="Catégorie" value={d.preavis_categorie} />
                <InfoRow label="Statut" value={d.preavis_dispense ? "Dispensé" : d.preavis_effectue ? "Effectué" : "En cours"} />
                <InfoRow label="Début" value={d.preavis_date_debut ? format(parseISO(d.preavis_date_debut), "dd/MM/yyyy", { locale: fr }) : null} />
                <InfoRow label="Fin" value={d.preavis_date_fin ? format(parseISO(d.preavis_date_fin), "dd/MM/yyyy", { locale: fr }) : null} />
                {d.preavis_dispense_indemnite && <InfoRow label="Indemnité compensatrice" value={`${parseFloat(d.preavis_dispense_indemnite).toLocaleString("fr-MA")} MAD`} />}
              </div>
            </div>
          )}

          {/* ── Indemnités ── */}
          {(d.indemnite_perte_emploi || d.indemnite_depart_retraite || d.indemnite_conges_payes || d.indemnite_transactionnelle) && (
            <div className="rounded-xl border overflow-hidden" style={{ borderColor: "hsl(var(--border))" }}>
              <SectionTitle title="Indemnités" />
              <div className="grid grid-cols-2 gap-3 p-4">
                {[
                  { label: "Perte d'emploi", k: "indemnite_perte_emploi" },
                  { label: "Départ retraite", k: "indemnite_depart_retraite" },
                  { label: "Congés payés", k: "indemnite_conges_payes" },
                  { label: "Compensatrice", k: "indemnite_compensatrice" },
                  { label: "Transactionnelle", k: "indemnite_transactionnelle" },
                  { label: "Ancienneté", k: "indemnite_anciennete" },
                  { label: "13ème mois", k: "indemnite_13eme_mois" },
                ].filter(i => d[i.k]).map(i => (
                  <InfoRow key={i.k} label={i.label} value={`${parseFloat(d[i.k]).toLocaleString("fr-MA", { minimumFractionDigits: 2 })} MAD`} />
                ))}
                <div className="col-span-2 pt-2 border-t flex justify-between items-center" style={{ borderColor: "hsl(var(--border))" }}>
                  <span className="text-xs font-bold" style={{ color: "hsl(var(--foreground))" }}>TOTAL</span>
                  <span className="text-sm font-bold" style={{ color: "hsl(var(--accent))" }}>
                    {totalIndemnites.toLocaleString("fr-MA", { minimumFractionDigits: 2 })} MAD
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* ── CNSS / AMO ── */}
          {(d.cnss_radiation_date || d.amo_cloture_date) && (
            <div className="rounded-xl border overflow-hidden" style={{ borderColor: "hsl(var(--border))" }}>
              <SectionTitle title="CNSS / AMO" />
              <div className="grid grid-cols-2 gap-3 p-4">
                <InfoRow label="Radiation CNSS" value={d.cnss_radiation_date ? format(parseISO(d.cnss_radiation_date), "dd/MM/yyyy", { locale: fr }) : null} />
                <InfoRow label="Dernière déclaration CNSS" value={d.cnss_derniere_declaration ? format(parseISO(d.cnss_derniere_declaration), "dd/MM/yyyy", { locale: fr }) : null} />
                <InfoRow label="Clôture AMO" value={d.amo_cloture_date ? format(parseISO(d.amo_cloture_date), "dd/MM/yyyy", { locale: fr }) : null} />
                {d.amo_attestation_delivree && <InfoRow label="Attestation AMO" value="Délivrée ✓" />}
              </div>
            </div>
          )}

          {/* ── Documents ── */}
          <div className="rounded-xl border overflow-hidden" style={{ borderColor: "hsl(var(--border))" }}>
            <SectionTitle title="Documents & Matériel" />
            <div className="p-4 space-y-3">
              {/* Docs */}
              <div className="flex flex-wrap gap-2">
                {Object.entries(DOCS_LABELS).map(([k, label]) => (
                  <span key={k} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium"
                    style={{
                      background: d[k] ? "hsl(142 55% 45% / 0.12)" : "hsl(var(--muted))",
                      color: d[k] ? "hsl(142 55% 28%)" : "hsl(var(--muted-foreground))",
                      border: `1px solid ${d[k] ? "hsl(142 55% 45% / 0.3)" : "hsl(var(--border))"}`,
                    }}>
                    {d[k] ? "✓" : "○"} {label}
                    {d[`${k}_path`] && <span style={{ color: "hsl(142 55% 28%)" }}>↗</span>}
                  </span>
                ))}
              </div>
              {/* Matériel */}
              <div className="flex flex-wrap gap-2 pt-2 border-t" style={{ borderColor: "hsl(var(--border))" }}>
                {Object.entries(MATERIEL_LABELS).map(([k, label]) => (
                  <span key={k} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium"
                    style={{
                      background: d[k] ? "hsl(142 55% 45% / 0.12)" : "hsl(var(--muted))",
                      color: d[k] ? "hsl(142 55% 28%)" : "hsl(var(--muted-foreground))",
                      border: `1px solid ${d[k] ? "hsl(142 55% 45% / 0.3)" : "hsl(var(--border))"}`,
                    }}>
                    {d[k] ? "✓" : "○"} {label}
                  </span>
                ))}
                {(d.acces_si_desactive || d.acces_email_desactive) && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium"
                    style={{ background: "hsl(0 70% 50% / 0.1)", color: "hsl(0 70% 38%)", border: "1px solid hsl(0 70% 50% / 0.2)" }}>
                    🔒 Accès désactivés
                  </span>
                )}
              </div>
            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t flex-shrink-0"
          style={{ borderColor: "hsl(var(--border))" }}>
          {!isReadOnly && dep.statut === "PLANIFIE" && onAnnuler ? (
            <button onClick={onAnnuler}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border font-medium hover:opacity-80"
              style={{ borderColor: "hsl(0 70% 50% / 0.3)", color: "hsl(0 70% 40%)", background: "hsl(0 70% 50% / 0.06)" }}>
              <X size={12} /> Annuler ce départ
            </button>
          ) : <div />}
          <Button variant="outline" onClick={onClose}>Fermer</Button>
        </div>
      </div>
    </div>
  );
};

// ─── Page principale ──────────────────────────────────────────────────────────
const GestionDepartsPage: React.FC = () => {
  const { role } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isManager = role === "manager";
  const isReadOnly = isManager;
  const { collaborateurIds: managerCollabIds, loading: popLoading } = useManagerPopulation();

  const [search, setSearch] = useState("");
  const [filterStatuts, setFilterStatuts] = useState<string[]>([]);
  const [filterMotifs, setFilterMotifs]   = useState<string[]>([]);
  const [showForm, setShowForm]             = useState(false);
  const [detailTarget, setDetailTarget]     = useState<Depart | null>(null);
  const [editTarget, setEditTarget]         = useState<Depart | null>(null);
  const [enregTarget, setEnregTarget]       = useState<Depart | null>(null);
  const [annulTarget, setAnnulTarget]       = useState<Depart | null>(null);
  const [annulMotif, setAnnulMotif]         = useState("");
  const [annulComment, setAnnulComment]     = useState("");
  const [traitTarget, setTraitTarget]       = useState<Depart | null>(null);
  const [traitDate, setTraitDate]           = useState("");
  const [filterPeriode, setFilterPeriode]   = useState<"TOUS"|"MOIS"|"3MOIS"|"ANNEE">("TOUS");
  const [filterDateDe, setFilterDateDe]     = useState("");
  const [filterDateA, setFilterDateA]       = useState("");

  // ── Query principale ──────────────────────────────────────────────────────
  const { data: departs = [], isLoading } = useQuery<Depart[]>({
    queryKey: ["departs", isManager, managerCollabIds],
    enabled: !isManager || !popLoading,
    queryFn: async () => {
      const params = new URLSearchParams({
        select: "*",
        order: "date_depart.desc",
      });
      if (isManager && managerCollabIds.length > 0)
        params.set("collaborateur_id", `in.(${managerCollabIds.join(",")})`);

      const deps: Depart[] = await api.get(`/db/collaborateur_departs?${params.toString()}`);
      if (!deps?.length) return [];

      const collabIds = [...new Set(deps.map(d => d.collaborateur_id))];
      const collabs: any[] = await api.get(
        `/db/collaborateurs?id=in.(${collabIds.join(",")})&select=id,nom,prenom,matricule,statut_collaborateur,photo_path`
      );
      const collabMap: Record<string, any> = {};
      (collabs || []).forEach(c => { collabMap[c.id] = c; });
      return deps.map(d => ({ ...d, collaborateur: collabMap[d.collaborateur_id] }));
    },
  });

  // ── Annulation ────────────────────────────────────────────────────────────
  const annulerMutation = useMutation({
    mutationFn: async (dep: Depart) => {
      await api.patch(`/db/collaborateur_departs?id=eq.${dep.id}`, {
        statut: "ANNULE", updated_at: new Date().toISOString(),
      });
      await api.patch(`/db/collaborateurs?id=eq.${dep.collaborateur_id}`, {
        statut_collaborateur: "ACTIF",
      });
    },
    onSuccess: () => {
      toast({ title: "Départ annulé avec succès" });
      queryClient.invalidateQueries({ queryKey: ["departs"] });
      setDetailTarget(null);
    },
    onError: (err: any) => toast({ title: "Erreur", description: err.message, variant: "destructive" }),
  });

  // ── Marquer traité ───────────────────────────────────────────────────────
  const [submittingAction, setSubmittingAction] = useState(false);

  const marquerTraite = async () => {
    if (!traitTarget) return;
    setSubmittingAction(true);
    try {
      await api.patch(`/db/collaborateur_departs?id=eq.${traitTarget.id}`, {
        statut: "TRAITE",
        traite_le: traitDate || new Date().toISOString().split("T")[0],
        updated_at: new Date().toISOString(),
      });
      // Mettre le collaborateur en SORTI
      await api.patch(`/db/collaborateurs?id=eq.${traitTarget.collaborateur_id}`, {
        statut_collaborateur: "SORTI",
      });
      toast({ title: "Départ traité", description: `${traitTarget.collaborateur?.prenom} ${traitTarget.collaborateur?.nom} est passé(e) en statut SORTI.` });
      queryClient.invalidateQueries({ queryKey: ["departs"] });
      setTraitTarget(null); setTraitDate("");
    } catch (err: any) {
      toast({ title: "Erreur", description: err.message, variant: "destructive" });
    } finally { setSubmittingAction(false); }
  };

  // ── #6-C : Enregistrer définitivement (TRAITE -> ENREGISTRE) ──────────────
  const marquerEnregistre = async () => {
    if (!enregTarget) return;
    setSubmittingAction(true);
    try {
      await api.patch(`/db/collaborateur_departs?id=eq.${enregTarget.id}`, {
        statut: "ENREGISTRE",
        updated_at: new Date().toISOString(),
      });
      toast({ title: "Départ enregistré", description: `Le dossier de ${enregTarget.collaborateur?.prenom} ${enregTarget.collaborateur?.nom} est définitivement enregistré.` });
      queryClient.invalidateQueries({ queryKey: ["departs"] });
      setEnregTarget(null);
    } catch (err: any) {
      toast({ title: "Erreur", description: err.message, variant: "destructive" });
    } finally { setSubmittingAction(false); }
  };

  const annulerAvecMotif = async () => {
    if (!annulTarget || !annulMotif) return;
    setSubmittingAction(true);
    try {
      await api.patch(`/db/collaborateur_departs?id=eq.${annulTarget.id}`, {
        statut: "ANNULE",
        commentaire: annulComment ? `[Annulation : ${annulMotif}] ${annulComment}` : `[Annulation : ${annulMotif}]`,
        updated_at: new Date().toISOString(),
      });
      await api.patch(`/db/collaborateurs?id=eq.${annulTarget.collaborateur_id}`, {
        statut_collaborateur: "ACTIF",
      });
      toast({ title: "Départ annulé" });
      queryClient.invalidateQueries({ queryKey: ["departs"] });
      setAnnulTarget(null); setAnnulMotif(""); setAnnulComment("");
    } catch (err: any) {
      toast({ title: "Erreur", description: err.message, variant: "destructive" });
    } finally { setSubmittingAction(false); }
  };

  // ── Filtres ───────────────────────────────────────────────────────────────
  const allMotifs = useMemo(() => [...new Set(departs.map(d => d.motif_depart))].sort(), [departs]);

  const filtered = useMemo(() => departs.filter(d => {
    const col = d.collaborateur;
    const t = search.toLowerCase();
    if (search && !col?.nom?.toLowerCase().includes(t) && !col?.prenom?.toLowerCase().includes(t) && !col?.matricule?.toLowerCase().includes(t) && !d.motif_depart.toLowerCase().includes(t)) return false;
    if (filterStatuts.length > 0 && !filterStatuts.includes(d.statut)) return false;
    if (filterMotifs.length > 0 && !filterMotifs.includes(d.motif_depart)) return false;
    // Filtre période
    if (d.date_depart) {
      const dd = new Date(d.date_depart);
      const now = new Date();
      // Raccourcis période
      if (filterPeriode !== "TOUS") {
        if (filterPeriode === "MOIS") { if (dd.getMonth() !== now.getMonth() || dd.getFullYear() !== now.getFullYear()) return false; }
        if (filterPeriode === "3MOIS") { const d3 = new Date(now); d3.setMonth(now.getMonth()-3); if (dd < d3) return false; }
        if (filterPeriode === "ANNEE") { if (dd.getFullYear() !== now.getFullYear()) return false; }
      }
      // Filtre date précis De / À (prioritaire sur raccourcis)
      if (filterDateDe && filterPeriode === "TOUS") { if (dd < new Date(filterDateDe)) return false; }
      if (filterDateA && filterPeriode === "TOUS") { if (dd > new Date(filterDateA + "T23:59:59")) return false; }
    }
    return true;
  }), [departs, search, filterStatuts, filterMotifs, filterPeriode, filterDateDe, filterDateA]);

  const hasFilters = !!search || filterStatuts.length > 0 || filterMotifs.length > 0 || filterPeriode !== "TOUS" || !!filterDateDe || !!filterDateA;
  const resetAll = () => { setSearch(""); setFilterStatuts([]); setFilterMotifs([]); setFilterPeriode("TOUS"); setFilterDateDe(""); setFilterDateA(""); };

  // ── Export Excel ──────────────────────────────────────────────────────────
  const handleExport = () => {
    const d2f = (v: any) => v ? format(parseISO(v), "dd/MM/yyyy") : "";
    const rows = filtered.map(d => {
      const dd = d as any;
      return {
        "Matricule":                   d.collaborateur?.matricule || "",
        "Nom":                         d.collaborateur?.nom || "",
        "Prénom":                      d.collaborateur?.prenom || "",
        "Date de départ":              d2f(d.date_depart),
        "Motif":                       d.motif_depart,
        "Référence":                   d.reference_decision || "",
        "Statut":                      STATUT_CFG[d.statut]?.label || d.statut,
        "Traité le":                   d2f(d.traite_le),
        "Date notification":           d2f(dd.date_notification),
        "Date entretien préalable":    d2f(dd.date_entretien_prealable),
        "Décision finale":             dd.decision_finale || "",
        // Préavis
        "Préavis catégorie":           dd.preavis_categorie || "",
        "Préavis durée (j)":           dd.preavis_duree_jours || "",
        "Préavis début":               d2f(dd.preavis_date_debut),
        "Préavis fin":                 d2f(dd.preavis_date_fin),
        "Préavis dispensé":            dd.preavis_dispense ? "Oui" : "Non",
        "Indemnité compensatrice préavis (MAD)": dd.preavis_dispense_indemnite || "",
        // Indemnités
        "Salaire base calcul (MAD)":   dd.base_calcul_salaire || "",
        "Ancienneté retenue (ans)":    dd.anciennete_retenue_ans || "",
        "Ind. perte emploi (MAD)":     dd.indemnite_perte_emploi || "",
        "Ind. départ retraite (MAD)":  dd.indemnite_depart_retraite || "",
        "Ind. congés payés (MAD)":     dd.indemnite_conges_payes || "",
        "Solde congés (jours)":        dd.solde_conges_jours || "",
        "Ind. compensatrice (MAD)":    dd.indemnite_compensatrice || "",
        "Ind. transactionnelle (MAD)": dd.indemnite_transactionnelle || "",
        "Ind. ancienneté (MAD)":       dd.indemnite_anciennete || "",
        "Ind. 13ème mois (MAD)":       dd.indemnite_13eme_mois || "",
        "TOTAL indemnités (MAD)":      dd.indemnite_total || "",
        // CNSS/AMO
        "Radiation CNSS":              d2f(dd.cnss_radiation_date),
        "Clôture AMO":                 d2f(dd.amo_cloture_date),
        "Attestation AMO":             dd.amo_attestation_delivree ? "Oui" : "Non",
        // Documents
        "Attestation travail":         dd.doc_attestation_travail ? "Remis" : "",
        "Reçu STC":                    dd.doc_recu_stc ? "Remis" : "",
        "Radiation CNSS doc":          dd.doc_radiation_cnss ? "Remis" : "",
        "Lettre notification":         dd.doc_lettre_notification ? "Remis" : "",
        "PV entretien":                dd.doc_pv_entretien ? "Remis" : "",
        // Matériel
        "Badge restitué":              dd.materiel_badge_restitue ? "Oui" : "Non",
        "Ordinateur restitué":         dd.materiel_ordinateur_restitue ? "Oui" : "Non",
        "Accès SI désactivé":          dd.acces_si_desactive ? "Oui" : "Non",
        "Commentaire":                 d.commentaire || "",
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = Object.keys(rows[0] || {}).map(() => ({ wch: 20 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Départs");
    XLSX.writeFile(wb, `departs_${format(new Date(), "yyyy-MM-dd")}.xlsx`);
    toast({ title: "Export réalisé", description: `${rows.length} ligne(s) exportée(s)` });
  };

  // ── KPIs enrichis ─────────────────────────────────────────────────────────
  const now = new Date();
  const enCours       = departs.filter(d => d.statut === "EN_COURS").length;
  const planifies     = departs.filter(d => d.statut === "PLANIFIE").length;
  const traites       = departs.filter(d => d.statut === "TRAITE").length;
  const enregistres   = departs.filter(d => d.statut === "ENREGISTRE").length;
  const annules       = departs.filter(d => d.statut === "ANNULE").length;
  const avenir30j     = departs.filter(d => {
    if (d.statut !== "PLANIFIE") return false;
    const j = differenceInDays(new Date(d.date_depart), now);
    return j >= 0 && j <= 30;
  }).length;
  const preavisEnCours = departs.filter(d => {
    const dd = d as any;
    return d.statut === "PLANIFIE" && dd.preavis_date_debut && dd.preavis_date_fin
      && new Date(dd.preavis_date_debut) <= now && new Date(dd.preavis_date_fin) >= now;
  }).length;
  const deCeMois = departs.filter(d =>
    d.statut === "TRAITE" && new Date(d.date_depart).getMonth() === now.getMonth() && new Date(d.date_depart).getFullYear() === now.getFullYear()
  ).length;

  return (
    <div className="max-w-7xl mx-auto">
      {/* Fil d'Ariane */}
      <div className="flex items-center gap-1.5 px-6 pt-4 pb-2 text-[13px]" style={{ color: "hsl(var(--muted-foreground))" }}>
        <span className="font-semibold" style={{ color: "hsl(var(--foreground))" }}>Gestion des Départs</span>
      </div>

      {/* Barre d'outils */}
      <div className="flex items-center gap-2 px-6 py-2.5 flex-wrap" style={{ borderBottom: "1px solid hsl(var(--border))", background: "hsl(var(--card))" }}>
        {!isReadOnly && (
          <button onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 text-[13px] font-medium h-8 px-3"
            style={{ background: "hsl(var(--primary))", color: "white", borderRadius: "var(--radius)" }}>
            <Plus size={14} /> Enregistrer un départ
          </button>
        )}
        <button onClick={handleExport}
          title="Exporter en Excel"
          className="flex items-center gap-1.5 h-8 px-2.5 text-[13px] font-medium transition-colors"
          style={{ color: "hsl(var(--muted-foreground))" }}>
          <FileDown size={14} /> Export Excel
        </button>
        <div className="flex-1" />
        <span className="text-[12px]" style={{ color: "hsl(var(--muted-foreground))" }}>
          {isManager ? "Suivi des départs de votre équipe" : "Enregistrement et suivi des départs de collaborateurs"}
        </span>
      </div>

      <div className="p-6 space-y-6">
      {/* ── KPIs enrichis ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
        {[
          { label: "En cours",        value: enCours,        icon: <CircleDot size={15} />,      token: "info" },
          { label: "Planifiés",       value: planifies,      icon: <Clock size={15} />,          token: "warning" },
          { label: "Traités",         value: traites,        icon: <CheckCircle2 size={15} />,   token: "success" },
          { label: "Enregistrés",     value: enregistres,    icon: <UserCheck size={15} />,      token: "accent" },
          { label: "Annulés",         value: annules,        icon: <X size={15} />,              token: "destructive" },
          { label: "≤ 30 jours",      value: avenir30j,      icon: <Bell size={15} />,           token: "warning" },
          { label: "Préavis en cours", value: preavisEnCours, icon: <CalendarClock size={15} />, token: "info" },
          { label: "Ce mois",         value: deCeMois,       icon: <TrendingUp size={15} />,     token: "primary" },
        ].map(k => (
          <div key={k.label} className="rounded-xl p-3 flex items-center gap-2.5"
            style={{ background: "hsl(var(--card))", border: `1px solid hsl(var(--${k.token}) / 0.25)` }}>
            <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: `hsl(var(--${k.token}) / 0.12)`, color: `hsl(var(--${k.token}))` }}>{k.icon}</div>
            <div>
              <p className="text-lg font-bold leading-none" style={{ color: "hsl(var(--foreground))" }}>{k.value}</p>
              <p className="text-[10px] mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>{k.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ── Alertes proactives : départs planifiés dans ≤ 7 jours ── */}
      {(() => {
        const urgents = departs.filter(d => {
          if (d.statut !== "PLANIFIE") return false;
          const j = differenceInDays(new Date(d.date_depart), now);
          return j >= 0 && j <= 7;
        }).sort((a, b) => a.date_depart.localeCompare(b.date_depart));
        if (!urgents.length) return null;
        return (
          <div className="rounded-xl border overflow-hidden"
            style={{ borderColor: "hsl(var(--warning) / 0.3)", background: "hsl(var(--warning) / 0.04)" }}>
            <div className="flex items-center gap-2 px-4 py-2.5 border-b"
              style={{ borderColor: "hsl(var(--warning) / 0.2)", background: "hsl(var(--warning) / 0.08)" }}>
              <Bell size={13} style={{ color: "hsl(38 92% 35%)" }} />
              <span className="text-xs font-bold uppercase tracking-wider" style={{ color: "hsl(38 92% 35%)" }}>
                {urgents.length} départ{urgents.length > 1 ? "s" : ""} dans les 7 prochains jours
              </span>
            </div>
            <div className="divide-y" style={{ borderColor: "hsl(var(--warning) / 0.1)" }}>
              {urgents.map(dep => {
                const j = differenceInDays(new Date(dep.date_depart), now);
                const col = dep.collaborateur;
                return (
                  <div key={dep.id} className="flex items-center gap-3 px-4 py-2.5">
                    <CircleDot size={13} style={{ color: j === 0 ? "hsl(0 70% 45%)" : "hsl(38 92% 40%)", flexShrink: 0 }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold" style={{ color: "hsl(var(--foreground))" }}>
                        {col?.prenom} {col?.nom}
                        <span className="font-normal ml-1.5 text-[11px]" style={{ color: "hsl(var(--muted-foreground))" }}>
                          — {dep.motif_depart}
                        </span>
                      </p>
                      <p className="text-[11px]" style={{ color: j === 0 ? "hsl(0 70% 45%)" : "hsl(38 92% 40%)" }}>
                        {j === 0 ? "Aujourd'hui" : `Dans ${j} jour${j > 1 ? "s" : ""}`}
                        {" · "}{format(new Date(dep.date_depart), "dd/MM/yyyy")}
                      </p>
                    </div>
                    {!isReadOnly && (
                      <button onClick={() => { setTraitTarget(dep); setTraitDate(dep.date_depart); }}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium hover:opacity-80"
                        style={{ background: "hsl(142 55% 45% / 0.12)", color: "hsl(142 55% 30%)", border: "1px solid hsl(142 55% 45% / 0.25)" }}>
                        <CheckCheck size={11} /> Marquer traité
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* ── Filtres ── */}
      <div className="rounded-xl border p-3 space-y-3"
        style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted)/0.15)" }}>
        {/* Ligne 1 : recherche + reset + compteur */}
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "hsl(var(--muted-foreground))" }} />
            <Input placeholder="Rechercher collaborateur, motif…" value={search} onChange={e => setSearch(e.target.value)} className="pl-8 h-8 text-xs" />
          </div>
          {hasFilters && (
            <button onClick={resetAll} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
              style={{ background: "hsl(0 70% 50% / 0.08)", color: "hsl(0 70% 40%)", border: "1px solid hsl(0 70% 50% / 0.2)" }}>
              <RotateCcw size={11} /> Réinitialiser
            </button>
          )}
          <div className="flex items-center gap-1 ml-auto">
            <Filter size={11} style={{ color: "hsl(var(--muted-foreground))" }} />
            <span className="text-[10px]" style={{ color: "hsl(var(--muted-foreground))" }}>
              {filtered.length} résultat{filtered.length > 1 ? "s" : ""}
            </span>
          </div>
        </div>
        {/* Ligne 2 : statut + motif + date */}
        <div className="flex flex-wrap gap-2 items-center">
          <MultiSelect
            options={Object.entries(STATUT_CFG).map(([v, c]) => ({ value: v, label: c.label }))}
            selected={filterStatuts} onChange={setFilterStatuts} allLabel="Tous les statuts" />
          <MultiSelect
            options={allMotifs.map(m => ({ value: m, label: m }))}
            selected={filterMotifs} onChange={setFilterMotifs} allLabel="Tous les motifs" />

          {/* Séparateur */}
          <div className="h-6 w-px self-center" style={{ background: "hsl(var(--border))" }} />

          {/* Raccourcis période */}
          <div className="flex gap-1">
            {([["TOUS","Toutes"],["MOIS","Ce mois"],["3MOIS","3 mois"],["ANNEE","Cette année"]] as const).map(([v, l]) => (
              <button key={v} onClick={() => { setFilterPeriode(v); setFilterDateDe(""); setFilterDateA(""); }}
                className="px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all"
                style={{
                  background: filterPeriode === v && !filterDateDe && !filterDateA ? "hsl(var(--primary))" : "hsl(var(--muted))",
                  color: filterPeriode === v && !filterDateDe && !filterDateA ? "white" : "hsl(var(--muted-foreground))",
                  border: filterPeriode === v && !filterDateDe && !filterDateA ? "1px solid hsl(var(--primary))" : "1px solid hsl(var(--border))",
                }}>{l}</button>
            ))}
          </div>

          {/* Séparateur */}
          <div className="h-6 w-px self-center" style={{ background: "hsl(var(--border))" }} />

          {/* Filtre date précis */}
          <div className="flex items-center gap-1.5">
            <CalendarDays size={12} style={{ color: "hsl(var(--muted-foreground))", flexShrink: 0 }} />
            <input type="date" value={filterDateDe} onChange={e => { setFilterDateDe(e.target.value); setFilterPeriode("TOUS"); }}
              className="h-8 rounded-lg border px-2 text-xs"
              style={{ background: "hsl(var(--background))", borderColor: filterDateDe ? "hsl(var(--primary))" : "hsl(var(--border))", color: "hsl(var(--foreground))", width: 130 }}
              title="Date de départ — à partir du" />
            <span className="text-[10px]" style={{ color: "hsl(var(--muted-foreground))" }}>→</span>
            <input type="date" value={filterDateA} onChange={e => { setFilterDateA(e.target.value); setFilterPeriode("TOUS"); }}
              min={filterDateDe || undefined}
              className="h-8 rounded-lg border px-2 text-xs"
              style={{ background: "hsl(var(--background))", borderColor: filterDateA ? "hsl(var(--primary))" : "hsl(var(--border))", color: "hsl(var(--foreground))", width: 130 }}
              title="Date de départ — jusqu'au" />
            {(filterDateDe || filterDateA) && (
              <button onClick={() => { setFilterDateDe(""); setFilterDateA(""); }}
                className="p-1 rounded-md hover:opacity-70"
                style={{ color: "hsl(var(--muted-foreground))" }} title="Effacer les dates">
                <X size={12} />
              </button>
            )}
          </div>
        </div>
        {/* Tags actifs */}
        {hasFilters && (
          <div className="flex flex-wrap gap-1.5 pt-1 border-t" style={{ borderColor: "hsl(var(--border))" }}>
            {filterStatuts.map(s => (
              <span key={s} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium"
                style={{ background: "hsl(var(--primary)/0.1)", color: "hsl(var(--primary))", border: "1px solid hsl(var(--primary)/0.2)" }}>
                {STATUT_CFG[s]?.label ?? s}
                <button onClick={() => setFilterStatuts(f => f.filter(x => x !== s))}><X size={9} /></button>
              </span>
            ))}
            {filterMotifs.map(m => (
              <span key={m} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium"
                style={{ background: "hsl(var(--primary)/0.1)", color: "hsl(var(--primary))", border: "1px solid hsl(var(--primary)/0.2)" }}>
                {m}
                <button onClick={() => setFilterMotifs(f => f.filter(x => x !== m))}><X size={9} /></button>
              </span>
            ))}
            {filterPeriode !== "TOUS" && !filterDateDe && !filterDateA && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium"
                style={{ background: "hsl(var(--accent)/0.12)", color: "hsl(var(--accent))", border: "1px solid hsl(var(--accent)/0.25)" }}>
                <CalendarDays size={9} />
                {filterPeriode === "MOIS" ? "Ce mois" : filterPeriode === "3MOIS" ? "3 derniers mois" : "Cette année"}
                <button onClick={() => setFilterPeriode("TOUS")}><X size={9} /></button>
              </span>
            )}
            {filterDateDe && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium"
                style={{ background: "hsl(var(--accent)/0.12)", color: "hsl(var(--accent))", border: "1px solid hsl(var(--accent)/0.25)" }}>
                <CalendarDays size={9} /> À partir du {format(new Date(filterDateDe), "dd/MM/yyyy")}
                <button onClick={() => setFilterDateDe("")}><X size={9} /></button>
              </span>
            )}
            {filterDateA && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium"
                style={{ background: "hsl(var(--accent)/0.12)", color: "hsl(var(--accent))", border: "1px solid hsl(var(--accent)/0.25)" }}>
                <CalendarDays size={9} /> Jusqu'au {format(new Date(filterDateA), "dd/MM/yyyy")}
                <button onClick={() => setFilterDateA("")}><X size={9} /></button>
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── Tableau ── */}
      <div className="rounded-xl border overflow-hidden" style={{ borderColor: "hsl(var(--border))" }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: "hsl(var(--muted) / 0.5)", borderBottom: "1px solid hsl(var(--border))" }}>
              {[
                { label: "Collaborateur",  w: "w-52" },
                { label: "Date de départ", w: "w-44" },
                { label: "Motif",          w: "" },
                { label: "Référence",      w: "w-36" },
                { label: "Statut",         w: "w-28" },
                { label: "Traité le",      w: "w-28" },
                { label: "",               w: "w-20" },
              ].map(h => (
                <th key={h.label} className={`text-left px-4 py-2.5 text-xs font-semibold ${h.w}`}
                  style={{ color: "hsl(var(--muted-foreground))" }}>{h.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={7} className="py-12 text-center text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>Chargement…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={7} className="py-12 text-center">
                <DoorOpen size={32} className="mx-auto mb-2 opacity-30" />
                <p className="text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>Aucun départ trouvé</p>
              </td></tr>
            ) : filtered.map((dep, i) => {
              const collab = dep.collaborateur;
              const isPast = new Date(dep.date_depart) <= new Date();
              const joursRestants = dep.statut === "PLANIFIE" && !isPast
                ? Math.ceil((new Date(dep.date_depart).getTime() - Date.now()) / 86400000)
                : null;
              const photoRaw = collab?.photo_path || null;
              const photoUrl = photoRaw ? (photoRaw.startsWith("http") || photoRaw.startsWith("/") ? photoRaw : `/api/v1/storage/${photoRaw}`) : null;

              return (
                <tr key={dep.id}
                  onClick={() => setDetailTarget(dep)}
                  className="cursor-pointer transition-colors"
                  style={{ background: i % 2 === 0 ? "hsl(var(--card))" : "hsl(var(--muted) / 0.15)", borderBottom: "1px solid hsl(var(--border) / 0.5)" }}
                  onMouseEnter={e => (e.currentTarget.style.background = "hsl(var(--accent) / 0.04)")}
                  onMouseLeave={e => (e.currentTarget.style.background = i % 2 === 0 ? "hsl(var(--card))" : "hsl(var(--muted) / 0.15)")}>

                  {/* Collaborateur */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      {photoUrl ? (
                        <img src={photoUrl} alt="" className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                          style={{ border: "1.5px solid hsl(var(--border))" }}
                          onError={e => {
                            (e.target as HTMLImageElement).style.display = "none";
                            const fb = (e.target as HTMLImageElement).nextElementSibling as HTMLElement;
                            if (fb) fb.style.display = "flex";
                          }} />
                      ) : null}
                      <div className={`w-8 h-8 rounded-full items-center justify-center text-[11px] font-bold flex-shrink-0 ${photoUrl ? "hidden" : "flex"}`}
                        style={{ background: "hsl(var(--primary) / 0.1)", color: "hsl(var(--primary))" }}>
                        {collab?.prenom?.[0]}{collab?.nom?.[0]}
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-xs truncate" style={{ color: "hsl(var(--foreground))" }}>{collab?.prenom} {collab?.nom}</p>
                        <p className="text-[11px]" style={{ color: "hsl(var(--muted-foreground))" }}>#{collab?.matricule}</p>
                      </div>
                    </div>
                  </td>

                  {/* Date */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <Calendar size={12} style={{ color: joursRestants !== null ? "hsl(45 100% 35%)" : "hsl(var(--muted-foreground))", flexShrink: 0 }} />
                      <span className="text-xs font-medium" style={{ color: "hsl(var(--foreground))" }}>
                        {format(parseISO(dep.date_depart), "dd/MM/yyyy")}
                      </span>
                      {joursRestants !== null && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold"
                          style={{ background: "hsl(45 100% 50% / 0.15)", color: "hsl(45 100% 28%)" }}>
                          Dans {joursRestants}j
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Motif */}
                  <td className="px-4 py-3">
                    <p className="text-xs font-medium" style={{ color: "hsl(var(--foreground))" }}>{dep.motif_depart}</p>
                  </td>

                  {/* Référence */}
                  <td className="px-4 py-3 text-xs font-mono" style={{ color: "hsl(var(--muted-foreground))" }}>
                    {dep.reference_decision || "—"}
                  </td>

                  {/* Statut */}
                  <td className="px-4 py-3"><StatutBadge statut={dep.statut} /></td>

                  {/* Préavis */}
                  <td className="px-4 py-3">
                    {(() => {
                      const dd = dep as any;
                      if (!dd.preavis_duree_jours) return <span className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>—</span>;
                      const dispense = dd.preavis_dispense;
                      const effectue = dd.preavis_effectue;
                      const enCours = dd.preavis_date_debut && dd.preavis_date_fin
                        && new Date(dd.preavis_date_debut) <= now && new Date(dd.preavis_date_fin) >= now;
                      const couleur = dispense ? "hsl(38 92% 35%)" : effectue ? "hsl(142 55% 28%)" : enCours ? "hsl(210 70% 35%)" : "hsl(var(--muted-foreground))";
                      const bg = dispense ? "hsl(var(--warning) / 0.1)" : effectue ? "hsl(var(--success) / 0.1)" : enCours ? "hsl(var(--info) / 0.1)" : "hsl(var(--muted))";
                      return (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium"
                          style={{ background: bg, color: couleur }}>
                          {dd.preavis_duree_jours}j {dispense ? "· Dispensé" : effectue ? "· Effectué" : enCours ? "· En cours" : ""}
                        </span>
                      );
                    })()}
                  </td>

                  {/* Traité le */}
                  <td className="px-4 py-3 text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
                    {dep.traite_le ? format(parseISO(dep.traite_le), "dd/MM/yyyy") : "—"}
                  </td>

                  {/* Actions */}
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center gap-1">
                      <button onClick={() => setDetailTarget(dep)}
                        className="p-1.5 rounded-lg hover:opacity-70 transition-opacity"
                        style={{ background: "hsl(var(--accent) / 0.1)", color: "hsl(var(--accent))" }}
                        title="Voir le détail">
                        <Eye size={13} />
                      </button>
                      {!isReadOnly && dep.statut === "TRAITE" && (
                        <button onClick={() => setEditTarget(dep)}
                          className="p-1.5 rounded-lg hover:opacity-70 transition-opacity"
                          style={{ background: "hsl(210 70% 50% / 0.1)", color: "hsl(210 70% 45%)" }}
                          title="Compléter / éditer le dossier">
                          <Pencil size={13} />
                        </button>
                      )}
                      {!isReadOnly && dep.statut === "TRAITE" && (
                        <button onClick={() => setEnregTarget(dep)}
                          className="p-1.5 rounded-lg hover:opacity-70 transition-opacity"
                          style={{ background: "hsl(265 60% 55% / 0.12)", color: "hsl(265 60% 45%)" }}
                          title="Enregistrer définitivement">
                          <UserCheck size={13} />
                        </button>
                      )}
                      {!isReadOnly && dep.statut === "PLANIFIE" && (
                        <>
                          <button onClick={() => { setTraitTarget(dep); setTraitDate(dep.date_depart); }}
                            className="p-1.5 rounded-lg hover:opacity-70 transition-opacity"
                            style={{ background: "hsl(142 55% 45% / 0.1)", color: "hsl(142 55% 30%)" }}
                            title="Marquer comme traité">
                            <CheckCheck size={13} />
                          </button>
                          <button onClick={() => { setAnnulTarget(dep); setAnnulMotif(""); setAnnulComment(""); }}
                            className="p-1.5 rounded-lg hover:opacity-70 transition-opacity"
                            style={{ background: "hsl(0 70% 50% / 0.08)", color: "hsl(0 70% 40%)" }}
                            title="Annuler le départ">
                            <Ban size={13} />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Popup détail ── */}
      {detailTarget && (
        <DetailDepartModal
          dep={detailTarget}
          isReadOnly={isReadOnly}
          onClose={() => setDetailTarget(null)}
          onNavigate={() => { navigate(`/collaborateurs/${detailTarget.collaborateur_id}`); setDetailTarget(null); }}
          onAnnuler={() => {
            if (confirm(`Annuler le départ de ${detailTarget.collaborateur?.prenom} ${detailTarget.collaborateur?.nom} ?`)) {
              annulerMutation.mutate(detailTarget);
            }
          }}
        />
      )}

      {/* ── Modal : Enregistrer définitivement (#6-C) ── */}
      {enregTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "hsl(var(--background) / 0.85)", backdropFilter: "blur(4px)" }}>
          <div className="w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden"
            style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}>
            <div className="flex items-center justify-between px-6 py-4 border-b"
              style={{ borderColor: "hsl(var(--border))", background: "hsl(265 60% 55% / 0.06)" }}>
              <div className="flex items-center gap-2">
                <UserCheck size={15} style={{ color: "hsl(265 60% 45%)" }} />
                <h2 className="text-base font-bold" style={{ color: "hsl(var(--foreground))" }}>Enregistrer définitivement</h2>
              </div>
              <button onClick={() => setEnregTarget(null)} className="p-1.5 rounded-lg hover:opacity-70"
                style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}><X size={15} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="flex items-center gap-3 p-3 rounded-xl"
                style={{ background: "hsl(265 60% 55% / 0.07)", border: "1px solid hsl(265 60% 55% / 0.2)" }}>
                <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                  style={{ background: "hsl(265 60% 55% / 0.15)", color: "hsl(265 60% 40%)" }}>
                  {enregTarget.collaborateur?.prenom?.[0]}{enregTarget.collaborateur?.nom?.[0]}
                </div>
                <div>
                  <p className="text-sm font-semibold">{enregTarget.collaborateur?.prenom} {enregTarget.collaborateur?.nom}</p>
                  <p className="text-[11px]" style={{ color: "hsl(var(--muted-foreground))" }}>{enregTarget.motif_depart}</p>
                </div>
              </div>
              <p className="text-[11px] p-2 rounded-lg" style={{ background: "hsl(var(--muted) / 0.5)", color: "hsl(var(--muted-foreground))" }}>
                Confirme que <strong>toutes les étapes du dossier sont complètes</strong>. Le départ passera au statut <strong>ENREGISTRÉ</strong> (définitif).
              </p>
            </div>
            <div className="flex justify-end gap-2 px-6 py-4 border-t" style={{ borderColor: "hsl(var(--border))" }}>
              <Button variant="outline" onClick={() => setEnregTarget(null)} disabled={submittingAction}>Annuler</Button>
              <Button onClick={marquerEnregistre} disabled={submittingAction}
                style={{ background: "hsl(265 60% 50%)", color: "white" }}>
                {submittingAction ? "Enregistrement…" : "Enregistrer définitivement"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal : Marquer traité ── */}
      {traitTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "hsl(var(--background) / 0.85)", backdropFilter: "blur(4px)" }}>
          <div className="w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden"
            style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}>
            <div className="flex items-center justify-between px-6 py-4 border-b"
              style={{ borderColor: "hsl(var(--border))", background: "hsl(142 55% 45% / 0.06)" }}>
              <div className="flex items-center gap-2">
                <CheckCheck size={15} style={{ color: "hsl(142 55% 40%)" }} />
                <h2 className="text-base font-bold" style={{ color: "hsl(var(--foreground))" }}>Confirmer le traitement</h2>
              </div>
              <button onClick={() => setTraitTarget(null)} className="p-1.5 rounded-lg hover:opacity-70"
                style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}><X size={15} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="flex items-center gap-3 p-3 rounded-xl"
                style={{ background: "hsl(142 55% 45% / 0.07)", border: "1px solid hsl(142 55% 45% / 0.2)" }}>
                <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                  style={{ background: "hsl(142 55% 45% / 0.15)", color: "hsl(142 55% 30%)" }}>
                  {traitTarget.collaborateur?.prenom?.[0]}{traitTarget.collaborateur?.nom?.[0]}
                </div>
                <div>
                  <p className="text-sm font-semibold">{traitTarget.collaborateur?.prenom} {traitTarget.collaborateur?.nom}</p>
                  <p className="text-[11px]" style={{ color: "hsl(var(--muted-foreground))" }}>{traitTarget.motif_depart}</p>
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold mb-1.5 block">Date effective de départ *</label>
                <input type="date" value={traitDate} onChange={e => setTraitDate(e.target.value)}
                  className="w-full h-9 rounded-lg border px-3 text-sm"
                  style={{ background: "hsl(var(--background))", borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" }} />
              </div>
              <p className="text-[11px] p-2 rounded-lg" style={{ background: "hsl(var(--muted) / 0.5)", color: "hsl(var(--muted-foreground))" }}>
                Le collaborateur passera en statut <strong>SORTI</strong>. Cette action est irréversible.
              </p>
            </div>
            <div className="flex justify-end gap-2 px-6 py-4 border-t" style={{ borderColor: "hsl(var(--border))" }}>
              <Button variant="outline" onClick={() => setTraitTarget(null)} disabled={submittingAction}>Annuler</Button>
              <Button onClick={marquerTraite} disabled={submittingAction || !traitDate}
                style={{ background: "hsl(142 55% 40%)", color: "white" }}>
                {submittingAction ? "…" : "Confirmer le traitement"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal : Annuler avec motif ── */}
      {annulTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "hsl(var(--background) / 0.85)", backdropFilter: "blur(4px)" }}>
          <div className="w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden"
            style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}>
            <div className="flex items-center justify-between px-6 py-4 border-b"
              style={{ borderColor: "hsl(var(--border))", background: "hsl(0 70% 50% / 0.05)" }}>
              <div className="flex items-center gap-2">
                <Ban size={15} style={{ color: "hsl(0 70% 45%)" }} />
                <h2 className="text-base font-bold" style={{ color: "hsl(var(--foreground))" }}>Annuler le départ</h2>
              </div>
              <button onClick={() => setAnnulTarget(null)} className="p-1.5 rounded-lg hover:opacity-70"
                style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}><X size={15} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="flex items-start gap-2 p-3 rounded-xl"
                style={{ background: "hsl(0 70% 50% / 0.06)", border: "1px solid hsl(0 70% 50% / 0.15)" }}>
                <AlertTriangle size={13} style={{ color: "hsl(0 70% 45%)", marginTop: 1, flexShrink: 0 }} />
                <p className="text-xs leading-relaxed" style={{ color: "hsl(0 70% 40%)" }}>
                  Le collaborateur sera remis en statut <strong>ACTIF</strong>. Action irréversible.
                </p>
              </div>
              <div>
                <label className="text-xs font-semibold mb-1.5 block">Motif d'annulation *</label>
                <select value={annulMotif} onChange={e => setAnnulMotif(e.target.value)}
                  className="w-full h-9 text-sm rounded-lg border px-3"
                  style={{ background: "hsl(var(--background))", borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" }}>
                  <option value="">— Sélectionner —</option>
                  <option value="ERREUR_SAISIE">Erreur de saisie</option>
                  <option value="ACCORD_PARTIES">Accord des parties</option>
                  <option value="DECISION_DIRECTION">Décision de la direction</option>
                  <option value="ABANDON_PROCEDURE">Abandon de procédure</option>
                  <option value="AUTRE">Autre</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold mb-1.5 block">Commentaire</label>
                <textarea value={annulComment} onChange={e => setAnnulComment(e.target.value)} rows={2}
                  className="w-full rounded-lg border px-3 py-2 text-sm resize-none"
                  style={{ background: "hsl(var(--background))", borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" }}
                  placeholder="Précisez la raison…" />
              </div>
            </div>
            <div className="flex justify-end gap-2 px-6 py-4 border-t" style={{ borderColor: "hsl(var(--border))" }}>
              <Button variant="outline" onClick={() => setAnnulTarget(null)} disabled={submittingAction}>Retour</Button>
              <Button onClick={annulerAvecMotif} disabled={submittingAction || !annulMotif}
                style={{ background: "hsl(0 70% 45%)", color: "white" }}>
                {submittingAction ? "…" : "Confirmer l'annulation"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal formulaire ── */}
      {showForm && (
        <DepartForm
          onClose={() => setShowForm(false)}
          onSuccess={() => {
            setShowForm(false);
            queryClient.invalidateQueries({ queryKey: ["departs"] });
          }}
        />
      )}

      {editTarget && (
        <DepartForm
          departExistant={editTarget}
          onClose={() => setEditTarget(null)}
          onSuccess={() => {
            setEditTarget(null);
            queryClient.invalidateQueries({ queryKey: ["departs"] });
          }}
        />
      )}
      </div>
    </div>
  );
};

export default GestionDepartsPage;
