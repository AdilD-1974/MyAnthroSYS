import React, { useEffect, useState, useMemo } from "react";
import { db, api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  KeyRound, Users, Package, CalendarClock, RefreshCw, AlertTriangle,
  Save, Building2, Mail, Infinity as InfinityIcon, TrendingUp,
} from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip as RTooltip, ReferenceLine, Legend,
} from "recharts";

interface Licence {
  id: string;
  client_nom: string | null;
  plan: string | null;
  type_licence: "ON_PREMISE" | "ABONNEMENT";
  periodicite: string | null;
  grace_jours: number | null;
  max_collaborateurs: number | null;
  date_debut: string | null;
  date_fin: string | null;
  statut: string | null;
  contact_email: string | null;
}

interface ModuleLic {
  id: string;
  module_code: string;
  libelle: string | null;
  actif: boolean;
}

interface UsageCourant {
  collaborateurs_geres: number;
  modules_actifs: number;
  max_collaborateurs: number | null;
  depassement: boolean;
  type_licence: string | null;
  statut: string | null;
  date_fin: string | null;
  grace_jours: number;
  jours_restants: number | null;
  etat_echeance: "active" | "grace" | "expiree" | null;
}

// Périodicités d'abonnement (libellés non ambigus) → nombre de mois
const PERIODICITES: { code: string; label: string; mois: number }[] = [
  { code: "MENSUEL",     label: "Mensuelle (1 mois)",   mois: 1 },
  { code: "TRIMESTRIEL", label: "Trimestrielle (3 mois)", mois: 3 },
  { code: "SEMESTRIEL",  label: "Semestrielle (6 mois)",  mois: 6 },
  { code: "ANNUEL",      label: "Annuelle (1 an)",        mois: 12 },
  { code: "BIENNAL",     label: "Tous les 2 ans",         mois: 24 },
  { code: "TRIENNAL",    label: "Tous les 3 ans",         mois: 36 },
];
const moisDePeriodicite = (code?: string | null) => PERIODICITES.find(p => p.code === code)?.mois ?? null;
// Ajoute N mois à une date ISO (yyyy-mm-dd) → ISO
const ajouterMois = (iso: string, mois: number): string => {
  const d = new Date(iso + "T00:00:00");
  d.setMonth(d.getMonth() + mois);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

interface Snapshot {
  id: string;
  date_snapshot: string;
  collaborateurs_geres: number;
  modules_actifs: number;
  created_at: string;
}

interface Evolution {
  points: { date: string; collaborateurs: number; modules: number }[];
  max_collaborateurs: number | null;
  type_licence: string | null;
  date_debut: string | null;
  date_fin: string | null;
  jours_restants: number | null;
}

const STATUTS = ["active", "suspendue", "expiree"];

// État de la licence signée (.lic vérifié cryptographiquement) — source de vérité
interface EtatSignature {
  valide: boolean;
  raison: string | null;
  etat_echeance: "active" | "grace" | "expiree" | null;
  jours_restants: number | null;
  bloquee: boolean;
  modules: string[] | null;
  max_collaborateurs: number | null;
  client_nom: string | null;
  type_licence: string | null;
  date_fin: string | null;
  full?: boolean | null;
}

// Une ligne d'historique des licences activées sur cette installation
interface HistoLigne {
  client_nom: string | null;
  type_licence: string | null;
  periodicite: string | null;
  max_collaborateurs: number | null;
  full: boolean;
  nb_modules: number;
  date_debut: string | null;
  date_fin: string | null;
  detectee_le: string | null;
}

export default function LicencePage() {
  const { role, activeRole } = useAuth();
  const estAdmin = (activeRole || role) === "administrateur";

  const [licence, setLicence] = useState<Licence | null>(null);
  const [modules, setModules] = useState<ModuleLic[]>([]);
  const [usage, setUsage] = useState<UsageCourant | null>(null);
  const [dernierSnapshot, setDernierSnapshot] = useState<Snapshot | null>(null);
  const [evolution, setEvolution] = useState<Evolution | null>(null);
  const [etatSignature, setEtatSignature] = useState<EtatSignature | null>(null);
  const [historique, setHistorique] = useState<HistoLigne[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [snapshotEnCours, setSnapshotEnCours] = useState(false);

  // Brouillon d'édition de la licence
  const [draft, setDraft] = useState<Partial<Licence>>({});

  const charger = async () => {
    setLoading(true);
    try {
      const [lics, mods] = await Promise.all([
        db.list<Licence>("licence", { order: "created_at", limit: 1 }),
        db.list<ModuleLic>("licence_module", { order: "libelle" }),
      ]);
      const lic = lics[0] ?? null;
      setLicence(lic);
      setDraft(lic ?? {});
      setModules(mods);

      // Usage temps réel (route dédiée) + dernier snapshot + évolution
      const [u, snaps, evo] = await Promise.all([
        api.get<UsageCourant>("/licence/usage-courant").catch(() => null),
        db.list<Snapshot>("licence_usage_snapshot", { order: "-date_snapshot", limit: 1 }).catch(() => []),
        api.get<Evolution>("/licence/evolution?jours=90").catch(() => null),
      ]);
      setUsage(u);
      setDernierSnapshot(snaps[0] ?? null);
      setEvolution(evo);

      // Licence signée (.lic) — source de vérité.
      // Cet appel enregistre aussi la licence courante dans l'historique si nouvelle.
      const sig = await api.get<EtatSignature>("/licence/etat-signature").catch(() => null);
      setEtatSignature(sig);

      // Historique des licences (chargé après etat-signature qui vient de l'alimenter)
      const histo = await api.get<HistoLigne[]>("/licence/historique").catch(() => []);
      setHistorique(Array.isArray(histo) ? histo : []);
    } catch (e: any) {
      toast({ title: "Erreur de chargement", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { charger(); }, []);

  const onPremise = draft.type_licence === "ON_PREMISE";
  // Si une licence signée valide est présente, elle fait foi → écran en lecture seule
  const lectureSeule = !!(etatSignature && etatSignature.valide);

  // Recalcule la date d'échéance = date_debut + périodicité (NULL si on-premise)
  const recalcEcheance = (d: Partial<Licence>): Partial<Licence> => {
    if (d.type_licence === "ON_PREMISE") return { ...d, date_fin: null };
    const mois = moisDePeriodicite(d.periodicite);
    if (d.date_debut && mois != null) return { ...d, date_fin: ajouterMois(d.date_debut, mois) };
    return d;
  };

  // Mise à jour d'un champ du brouillon ; applique les règles dérivées
  const setField = (k: keyof Licence, v: any) => {
    setDraft(d => {
      let next: Partial<Licence> = { ...d, [k]: v };
      // ON_PREMISE = perpétuel → pas de périodicité ni d'échéance
      if (k === "type_licence" && v === "ON_PREMISE") { next.periodicite = null; next.date_fin = null; }
      // Recalcul de l'échéance si type / périodicité / date de début changent
      if (k === "type_licence" || k === "periodicite" || k === "date_debut") next = recalcEcheance(next);
      return next;
    });
  };

  const enregistrer = async () => {
    if (!licence) return;
    // Validation : un abonnement doit avoir une périodicité
    if (draft.type_licence === "ABONNEMENT" && !draft.periodicite) {
      toast({ title: "Périodicité requise", description: "Un abonnement doit avoir une périodicité (mensuelle, annuelle…).", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const patch = {
        client_nom: draft.client_nom ?? null,
        plan: draft.plan ?? null,
        type_licence: draft.type_licence,
        periodicite: onPremise ? null : (draft.periodicite ?? null),
        grace_jours: draft.grace_jours != null ? Number(draft.grace_jours) : 15,
        max_collaborateurs: draft.max_collaborateurs != null ? Number(draft.max_collaborateurs) : null,
        date_debut: draft.date_debut || null,
        date_fin: onPremise ? null : (draft.date_fin || null),
        statut: draft.statut ?? null,
        contact_email: draft.contact_email ?? null,
      };
      await db.update("licence", { id: licence.id }, patch);
      toast({ title: "Licence enregistrée", description: "Les modifications ont été appliquées." });
      await charger();
    } catch (e: any) {
      toast({ title: "Échec de l'enregistrement", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const toggleModule = async (m: ModuleLic) => {
    try {
      await db.update("licence_module", { id: m.id }, { actif: !m.actif });
      setModules(ms => ms.map(x => x.id === m.id ? { ...x, actif: !x.actif } : x));
    } catch (e: any) {
      toast({ title: "Erreur", description: e?.message ?? String(e), variant: "destructive" });
    }
  };

  const prendreReleve = async () => {
    setSnapshotEnCours(true);
    try {
      const snap = await api.post<any>("/licence/snapshot", {});
      toast({ title: "Relevé effectué", description: `${snap.collaborateurs_geres} collaborateurs · ${snap.modules_actifs} modules actifs.` });
      await charger();
    } catch (e: any) {
      toast({ title: "Échec du relevé", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setSnapshotEnCours(false);
    }
  };

  // Usage : préférer la route temps réel, sinon le dernier snapshot
  const collabsGeres = usage?.collaborateurs_geres ?? dernierSnapshot?.collaborateurs_geres ?? 0;
  const maxCollabs = usage?.max_collaborateurs ?? licence?.max_collaborateurs ?? null;
  const depassement = maxCollabs != null && collabsGeres > maxCollabs;
  const tauxUsage = maxCollabs ? Math.min(100, Math.round((collabsGeres / maxCollabs) * 100)) : 0;
  const modulesActifs = useMemo(() => modules.filter(m => m.actif).length, [modules]);

  if (!estAdmin) {
    return (
      <div className="p-6">
        <div className="rounded-xl p-4 text-sm flex items-center gap-2"
          style={{ background: "hsl(var(--warning) / 0.1)", border: "1px solid hsl(var(--warning) / 0.3)", color: "hsl(var(--warning))" }}>
          <AlertTriangle size={16} /> Cette page est réservée à l'administrateur.
        </div>
      </div>
    );
  }

  if (loading) {
    return <div className="p-6 text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>Chargement…</div>;
  }

  return (
    <div className="max-w-5xl mx-auto">
      {/* Fil d'Ariane */}
      <div className="flex items-center gap-1.5 px-6 pt-4 pb-2 text-[13px]" style={{ color: "hsl(var(--muted-foreground))" }}>
        <span>Configuration</span>
        <span style={{ opacity: 0.5 }}>/</span>
        <span className="font-semibold" style={{ color: "hsl(var(--foreground))" }}>Licences & Utilisation</span>
      </div>
      <div style={{ borderBottom: "1px solid hsl(var(--border))" }} />

      <div className="p-6 space-y-6">
      {/* En-tête */}
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: "hsl(var(--primary) / 0.12)" }}>
          <KeyRound size={22} style={{ color: "hsl(var(--primary))" }} />
        </div>
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "hsl(var(--foreground))" }}>Licences & Utilisation</h1>
          <p className="text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>Gestion de la licence de cette installation et suivi de l'usage.</p>
        </div>
      </div>

      {/* Bandeau licence signée — SOURCE DE VÉRITÉ (.lic vérifié cryptographiquement) */}
      {etatSignature && (
        <div className="rounded-xl p-4" style={
          etatSignature.bloquee
            ? { background: "hsl(var(--destructive) / 0.08)", border: "1px solid hsl(var(--destructive) / 0.35)" }
            : etatSignature.etat_echeance === "grace"
            ? { background: "hsl(var(--warning) / 0.08)", border: "1px solid hsl(var(--warning) / 0.35)" }
            : { background: "hsl(var(--success) / 0.08)", border: "1px solid hsl(var(--success) / 0.35)" }
        }>
          <div className="flex items-start gap-3">
            {etatSignature.bloquee
              ? <AlertTriangle size={20} style={{ color: "hsl(var(--destructive))", flexShrink: 0, marginTop: 2 }} />
              : <KeyRound size={20} style={{ color: "hsl(var(--success))", flexShrink: 0, marginTop: 2 }} />}
            <div className="flex-1">
              <div className="font-semibold" style={{
                color: etatSignature.bloquee ? "hsl(var(--destructive))" : etatSignature.etat_echeance === "grace" ? "hsl(var(--warning))" : "hsl(var(--success))"
              }}>
                {!etatSignature.valide
                  ? (etatSignature.raison === "absente" ? "Aucune licence signée installée"
                    : etatSignature.raison === "falsifiee" ? "Licence falsifiée ou altérée"
                    : "Licence illisible")
                  : etatSignature.etat_echeance === "expiree" ? "Licence signée expirée"
                  : etatSignature.etat_echeance === "grace" ? "Licence signée en période de grâce"
                  : "Licence signée valide"}
              </div>
              {etatSignature.valide ? (
                <div className="text-sm mt-1 flex flex-wrap gap-x-4 gap-y-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>
                  <span><strong style={{ color: "hsl(var(--foreground))" }}>{etatSignature.client_nom}</strong></span>
                  <span>{etatSignature.type_licence === "ON_PREMISE" ? "On-premise" : "Abonnement"}</span>
                  <span>Limite : {etatSignature.max_collaborateurs ?? "—"} collaborateurs</span>
                  {etatSignature.full
                    ? <span style={{ color: "hsl(var(--primary))", fontWeight: 600 }}>FULL · tous les modules</span>
                    : <span>{(etatSignature.modules?.length ?? 0)} module(s) licencié(s)</span>}
                  {etatSignature.date_fin && <span>Échéance : {new Date(etatSignature.date_fin).toLocaleDateString("fr-FR")}</span>}
                  {etatSignature.jours_restants != null && <span>{etatSignature.jours_restants > 0 ? `${etatSignature.jours_restants} j restants` : "échéance dépassée"}</span>}
                </div>
              ) : (
                <div className="text-sm mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>
                  {etatSignature.raison === "absente"
                    ? "Déposez le fichier licence.lic signé dans storage/ pour activer la licence."
                    : "Cette installation doit être réactivée par l'éditeur avec une licence signée valide."}
                </div>
              )}
              <div className="text-[11px] mt-1.5" style={{ color: "hsl(var(--muted-foreground))" }}>
                Cette licence signée fait foi. Les informations ci-dessous reflètent l'installation et ne sont pas modifiables.
              </div>
            </div>
          </div>
        </div>
      )}
      <style>{`
        .kpi-card {
          position: relative; border-radius: 1rem; padding: 1.25rem; overflow: hidden;
          transition: transform .25s ease, box-shadow .25s ease;
          border: 1px solid hsl(var(--border));
        }
        .kpi-card:hover { transform: translateY(-4px); }
        .kpi-pastille {
          width: 2.75rem; height: 2.75rem; border-radius: 0.85rem;
          display: flex; align-items: center; justify-content: center; flex-shrink: 0;
          box-shadow: 0 4px 12px rgba(0,0,0,0.12);
        }
        .kpi-glow {
          position: absolute; top: -40%; right: -20%; width: 60%; height: 160%;
          border-radius: 50%; opacity: 0.12; filter: blur(30px); pointer-events: none;
        }
      `}</style>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

        {/* Collaborateurs gérés */}
        {(() => {
          const c = depassement ? "var(--destructive)" : "var(--primary)";
          return (
            <div className="kpi-card" style={{
              background: `linear-gradient(135deg, hsl(${c} / 0.08), hsl(var(--card)) 60%)`,
              boxShadow: `0 8px 24px hsl(${c} / 0.18), 0 2px 6px rgba(0,0,0,0.06)`,
              borderColor: `hsl(${c} / 0.25)`,
            }}>
              <div className="kpi-glow" style={{ background: `hsl(${c})` }} />
              <div className="flex items-start gap-3 relative">
                <div className="kpi-pastille" style={{ background: `linear-gradient(135deg, hsl(${c}), hsl(${c} / 0.7))` }}>
                  <Users size={22} color="white" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: "hsl(var(--muted-foreground))" }}>Collaborateurs gérés</div>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-4xl font-extrabold leading-tight" style={{ color: `hsl(${c})` }}>{collabsGeres}</span>
                    <span className="text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>/ {maxCollabs ?? "∞"}</span>
                  </div>
                </div>
              </div>
              <div className="h-2 rounded-full overflow-hidden mt-3 relative" style={{ background: "hsl(var(--muted))" }}>
                <div className="h-full rounded-full transition-all" style={{ width: `${tauxUsage}%`, background: `linear-gradient(90deg, hsl(${c} / 0.7), hsl(${c}))` }} />
              </div>
              {depassement && (
                <div className="flex items-center gap-1.5 text-[11px] font-semibold mt-2 relative" style={{ color: "hsl(var(--destructive))" }}>
                  <AlertTriangle size={12} /> Limite dépassée de {collabsGeres - (maxCollabs ?? 0)} collaborateur(s)
                </div>
              )}
            </div>
          );
        })()}

        {/* Modules actifs */}
        <div className="kpi-card" style={{
          background: "linear-gradient(135deg, hsl(var(--accent) / 0.08), hsl(var(--card)) 60%)",
          boxShadow: "0 8px 24px hsl(var(--accent) / 0.18), 0 2px 6px rgba(0,0,0,0.06)",
          borderColor: "hsl(var(--accent) / 0.25)",
        }}>
          <div className="kpi-glow" style={{ background: "hsl(var(--accent))" }} />
          <div className="flex items-start gap-3 relative">
            <div className="kpi-pastille" style={{ background: "linear-gradient(135deg, hsl(var(--accent)), hsl(var(--accent) / 0.7))" }}>
              <Package size={22} color="white" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: "hsl(var(--muted-foreground))" }}>Modules actifs</div>
              <div className="flex items-baseline gap-1.5">
                <span className="text-4xl font-extrabold leading-tight" style={{ color: "hsl(var(--accent))" }}>{modulesActifs}</span>
                <span className="text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>/ {modules.length}</span>
              </div>
            </div>
          </div>
          <div className="h-2 rounded-full overflow-hidden mt-3 relative" style={{ background: "hsl(var(--muted))" }}>
            <div className="h-full rounded-full transition-all" style={{ width: `${modules.length ? Math.round((modulesActifs / modules.length) * 100) : 0}%`, background: "linear-gradient(90deg, hsl(var(--accent) / 0.7), hsl(var(--accent)))" }} />
          </div>
        </div>

        {/* Échéance */}
        {(() => {
          const etat = usage?.etat_echeance;
          const c = onPremise ? "var(--success)" : etat === "expiree" ? "var(--destructive)" : etat === "grace" ? "var(--warning)" : "var(--success)";
          return (
            <div className="kpi-card" style={{
              background: `linear-gradient(135deg, hsl(${c} / 0.08), hsl(var(--card)) 60%)`,
              boxShadow: `0 8px 24px hsl(${c} / 0.18), 0 2px 6px rgba(0,0,0,0.06)`,
              borderColor: `hsl(${c} / 0.25)`,
            }}>
              <div className="kpi-glow" style={{ background: `hsl(${c})` }} />
              <div className="flex items-start gap-3 relative">
                <div className="kpi-pastille" style={{ background: `linear-gradient(135deg, hsl(${c}), hsl(${c} / 0.7))` }}>
                  <CalendarClock size={22} color="white" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: "hsl(var(--muted-foreground))" }}>Échéance</div>
                  {onPremise || !draft.date_fin ? (
                    <span className="text-xl font-extrabold flex items-center gap-1.5" style={{ color: `hsl(${c})` }}><InfinityIcon size={20} /> Perpétuelle</span>
                  ) : (
                    <span className="text-2xl font-extrabold" style={{ color: `hsl(${c})` }}>{new Date(draft.date_fin).toLocaleDateString("fr-FR")}</span>
                  )}
                </div>
              </div>
              <div className="mt-2 relative">
                {etat === "grace" ? (
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md inline-flex items-center gap-1" style={{ background: "hsl(var(--warning) / 0.18)", color: "hsl(var(--warning))" }}>
                    <AlertTriangle size={11} /> En période de grâce ({usage?.grace_jours} j tolérés)
                  </span>
                ) : etat === "expiree" ? (
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md inline-flex items-center gap-1" style={{ background: "hsl(var(--destructive) / 0.18)", color: "hsl(var(--destructive))" }}>
                    <AlertTriangle size={11} /> Expirée
                  </span>
                ) : (
                  <span className="text-[11px] font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>{draft.type_licence === "ON_PREMISE" ? "On-premise" : "Abonnement"}</span>
                )}
              </div>
            </div>
          );
        })()}
      </div>

      {/* Section 1 : la licence (édition) */}
      <div className="rounded-xl p-5 space-y-4" style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}>
        <h2 className="font-bold text-lg flex items-center gap-2" style={{ color: "hsl(var(--foreground))" }}><KeyRound size={18} style={{ color: "hsl(var(--primary))" }} /> Détails de la licence</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Type de licence</Label>
            <Select value={draft.type_licence} onValueChange={v => setField("type_licence", v)} disabled={lectureSeule}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ON_PREMISE">On-premise (perpétuelle)</SelectItem>
                <SelectItem value="ABONNEMENT">Abonnement (échéance)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Statut</Label>
            <Select value={draft.statut ?? undefined} onValueChange={v => setField("statut", v)} disabled={lectureSeule}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>{STATUTS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5"><Building2 size={13} /> Client</Label>
            <Input disabled={lectureSeule} value={draft.client_nom ?? ""} onChange={e => setField("client_nom", e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label>Plan / formule</Label>
            <Input disabled={lectureSeule} value={draft.plan ?? ""} onChange={e => setField("plan", e.target.value)} placeholder="ex. Pro" />
          </div>

          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5"><Mail size={13} /> Email de contact</Label>
            <Input disabled={lectureSeule} type="email" value={draft.contact_email ?? ""} onChange={e => setField("contact_email", e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label className="flex items-center gap-1.5"><Users size={13} /> Nombre de collaborateurs (limite globale)</Label>
            <Input disabled={lectureSeule} type="number" min={0} value={draft.max_collaborateurs ?? ""} onChange={e => setField("max_collaborateurs", e.target.value === "" ? null : Number(e.target.value))} />
          </div>

          <div className="space-y-1.5">
            <Label>Date de début</Label>
            <Input disabled={lectureSeule} type="date" value={draft.date_debut ?? ""} onChange={e => setField("date_debut", e.target.value)} />
          </div>

          {/* Périodicité (abonnement seulement) */}
          {!onPremise && (
            <div className="space-y-1.5">
              <Label>Périodicité d'abonnement</Label>
              <Select value={draft.periodicite ?? undefined} onValueChange={v => setField("periodicite", v)} disabled={lectureSeule}>
                <SelectTrigger><SelectValue placeholder="Choisir…" /></SelectTrigger>
                <SelectContent>
                  {PERIODICITES.map(p => <SelectItem key={p.code} value={p.code}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Date d'échéance {!onPremise && <span className="text-[11px]" style={{ color: "hsl(var(--muted-foreground))" }}>(calculée automatiquement)</span>}</Label>
            {onPremise ? (
              <Input value="Perpétuelle (on-premise)" disabled style={{ opacity: 0.6 }} />
            ) : (
              <Input type="date" value={draft.date_fin ?? ""} disabled style={{ opacity: 0.7, background: "hsl(var(--muted))" }} />
            )}
          </div>

          {/* Période de grâce (abonnement seulement) */}
          {!onPremise && (
            <div className="space-y-1.5">
              <Label>Période de grâce après échéance (jours)</Label>
              <Input disabled={lectureSeule} type="number" min={0} value={draft.grace_jours ?? 15}
                onChange={e => setField("grace_jours", e.target.value === "" ? 0 : Number(e.target.value))} />
              <span className="text-[11px]" style={{ color: "hsl(var(--muted-foreground))" }}>
                Après l'échéance, l'application reste utilisable pendant ce délai (avec avertissement), puis se bloque.
              </span>
            </div>
          )}
        </div>

        <div className="flex justify-end">
          {lectureSeule ? (
            <span className="text-[12px] flex items-center gap-1.5" style={{ color: "hsl(var(--muted-foreground))" }}>
              <KeyRound size={13} /> Licence protégée par signature — modification réservée à l'éditeur
            </span>
          ) : (
            <Button onClick={enregistrer} disabled={saving} className="text-white" style={{ background: "hsl(var(--primary))" }}>
              <Save size={15} className="mr-1.5" /> {saving ? "Enregistrement…" : "Enregistrer"}
            </Button>
          )}
        </div>
      </div>

      {/* Section 2 : modules souscrits */}
      <div className="rounded-xl p-5 space-y-4" style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}>
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-lg flex items-center gap-2" style={{ color: "hsl(var(--foreground))" }}><Package size={18} style={{ color: "hsl(var(--primary))" }} /> Modules souscrits</h2>
          <span className="text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>{modulesActifs} / {modules.length} actifs</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {modules.map(m => (
            <div key={m.id} className="flex items-center justify-between px-3 py-2.5 rounded-lg" style={{ background: "hsl(var(--background))", border: "1px solid hsl(var(--border))" }}>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full" style={{ background: m.actif ? "hsl(var(--success))" : "hsl(var(--muted-foreground))" }} />
                <span className="text-sm font-medium" style={{ color: "hsl(var(--foreground))" }}>{m.libelle || m.module_code}</span>
                <span className="text-[10px] font-mono" style={{ color: "hsl(var(--muted-foreground))" }}>{m.module_code}</span>
              </div>
              <Switch checked={m.actif} onCheckedChange={() => toggleModule(m)} disabled={lectureSeule} />
            </div>
          ))}
        </div>
      </div>

      {/* Section : évolution (Phase 2) */}
      <div className="rounded-xl p-5 space-y-4" style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h2 className="font-bold text-lg flex items-center gap-2" style={{ color: "hsl(var(--foreground))" }}>
            <TrendingUp size={18} style={{ color: "hsl(var(--primary))" }} /> Évolution de l'usage
          </h2>
          {/* Échéance */}
          {evolution?.jours_restants != null && (
            <div className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg"
              style={evolution.jours_restants < 30
                ? { background: "hsl(var(--destructive) / 0.1)", color: "hsl(var(--destructive))" }
                : evolution.jours_restants < 90
                ? { background: "hsl(var(--warning) / 0.1)", color: "hsl(var(--warning))" }
                : { background: "hsl(var(--success) / 0.1)", color: "hsl(var(--success))" }}>
              <CalendarClock size={14} />
              {evolution.jours_restants > 0
                ? `Échéance dans ${evolution.jours_restants} jour(s)`
                : `Licence expirée depuis ${Math.abs(evolution.jours_restants)} jour(s)`}
            </div>
          )}
        </div>

        {!evolution || evolution.points.length === 0 ? (
          <div className="text-sm py-8 text-center" style={{ color: "hsl(var(--muted-foreground))" }}>
            Aucune donnée d'évolution pour l'instant. Les relevés quotidiens alimenteront ce graphique.
          </div>
        ) : evolution.points.length === 1 ? (
          <div className="text-sm py-6 text-center" style={{ color: "hsl(var(--muted-foreground))" }}>
            Un seul relevé disponible ({new Date(evolution.points[0].date).toLocaleDateString("fr-FR")} : {evolution.points[0].collaborateurs} collaborateurs).
            <br />Le graphique se construira au fil des relevés quotidiens.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={evolution.points} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="date" tick={{ fontSize: "calc(11px * var(--font-scale))", fill: "hsl(var(--muted-foreground))" }}
                tickFormatter={(d: string) => new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })} />
              <YAxis tick={{ fontSize: "calc(11px * var(--font-scale))", fill: "hsl(var(--muted-foreground))" }} allowDecimals={false} />
              <RTooltip
                labelFormatter={(d: string) => new Date(d).toLocaleDateString("fr-FR")}
                formatter={(val: any, name: string) => [val, name === "collaborateurs" ? "Collaborateurs" : "Modules actifs"]} />
              <Legend formatter={(v) => v === "collaborateurs" ? "Collaborateurs gérés" : "Modules actifs"} />
              {evolution.max_collaborateurs != null && (
                <ReferenceLine y={evolution.max_collaborateurs} stroke="hsl(var(--destructive))" strokeDasharray="5 4"
                  label={{ value: `Limite (${evolution.max_collaborateurs})`, position: "insideTopRight", fill: "hsl(var(--destructive))", fontSize: "calc(11px * var(--font-scale))" }} />
              )}
              <Line type="monotone" dataKey="collaborateurs" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="modules" stroke="hsl(var(--accent))" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Section : relevé d'usage */}
      <div className="rounded-xl p-5 space-y-3" style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="font-bold text-lg flex items-center gap-2" style={{ color: "hsl(var(--foreground))" }}><RefreshCw size={18} style={{ color: "hsl(var(--primary))" }} /> Relevé d'usage</h2>
            {dernierSnapshot ? (
              <p className="text-sm mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>
                Dernier relevé : <strong>{new Date(dernierSnapshot.date_snapshot).toLocaleDateString("fr-FR")}</strong> — {dernierSnapshot.collaborateurs_geres} collaborateurs, {dernierSnapshot.modules_actifs} modules.
              </p>
            ) : (
              <p className="text-sm mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>Aucun relevé pour l'instant.</p>
            )}
          </div>
          <Button onClick={prendreReleve} disabled={snapshotEnCours} variant="outline">
            <RefreshCw size={15} className={"mr-1.5" + (snapshotEnCours ? " animate-spin" : "")} /> {snapshotEnCours ? "Relevé…" : "Prendre un relevé"}
          </Button>
        </div>
      </div>

      {/* Section : historique des licences activées sur cette installation */}
      <div className="rounded-xl p-5 space-y-3" style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}>
        <h2 className="font-bold text-lg flex items-center gap-2" style={{ color: "hsl(var(--foreground))" }}>
          <KeyRound size={18} style={{ color: "hsl(var(--primary))" }} /> Historique des licences
        </h2>
        {historique.length === 0 ? (
          <p className="text-sm py-4 text-center" style={{ color: "hsl(var(--muted-foreground))" }}>
            Aucune licence enregistrée pour l'instant. Chaque licence signée détectée s'ajoute ici automatiquement.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid hsl(var(--border))" }}>
                  {["Date d'activation", "Client", "Type", "Limite", "Modules", "Échéance"].map(h => (
                    <th key={h} className="text-left font-semibold py-2 px-2 text-xs uppercase tracking-wider" style={{ color: "hsl(var(--muted-foreground))" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {historique.map((h, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid hsl(var(--border))" }}>
                    <td className="py-2.5 px-2" style={{ color: "hsl(var(--foreground))" }}>
                      {h.detectee_le ? new Date(h.detectee_le).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—"}
                      {i === 0 && <span className="ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ background: "hsl(var(--success) / 0.15)", color: "hsl(var(--success))" }}>actuelle</span>}
                    </td>
                    <td className="py-2.5 px-2" style={{ color: "hsl(var(--foreground))" }}>{h.client_nom ?? "—"}</td>
                    <td className="py-2.5 px-2" style={{ color: "hsl(var(--muted-foreground))" }}>
                      {h.type_licence === "ON_PREMISE" ? "On-premise" : "Abonnement"}
                      {h.periodicite ? ` · ${PERIODICITES.find(p => p.code === h.periodicite)?.label ?? h.periodicite}` : ""}
                    </td>
                    <td className="py-2.5 px-2" style={{ color: "hsl(var(--muted-foreground))" }}>{h.max_collaborateurs ?? "—"}</td>
                    <td className="py-2.5 px-2" style={{ color: "hsl(var(--muted-foreground))" }}>
                      {h.full ? <span style={{ color: "hsl(var(--primary))", fontWeight: 600 }}>FULL</span> : `${h.nb_modules} module(s)`}
                    </td>
                    <td className="py-2.5 px-2" style={{ color: "hsl(var(--muted-foreground))" }}>
                      {h.date_fin ? new Date(h.date_fin).toLocaleDateString("fr-FR") : "Perpétuelle"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[11px]" style={{ color: "hsl(var(--muted-foreground))" }}>
          Chaque licence signée déposée sur cette installation est enregistrée automatiquement (sans doublon).
        </p>
      </div>
      </div>
    </div>
  );
}
