// src/pages/espaces/manager/PretsDashboardPage.tsx
//
// Page d'accueil du menu "Gestion des prêts" — KPI avancés, avec un focus
// particulier sur les prêts internes et les avances sur salaire (demande
// explicite), plus des raccourcis vers la Liste et le Paramétrage.
import React, { useEffect, useMemo, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  Banknote, Building2, Wallet, TrendingUp, AlertTriangle, ArrowRight,
  ListChecks, Settings, Plus, ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import {
  pretsApi, Pret, PretStats, Alerte, TypePretAdmin,
  PRET_STATUT_LABELS, formatMontant,
} from "@/lib/pretsApi";
import CreationDirectePretDialog from "@/components/prets/CreationDirectePretDialog";

const STATUTS_ACTIFS = ["debloque", "en_cours"];

const KpiCard: React.FC<{
  icon: React.ReactNode; label: string; value: string; sousLigne?: string; accent?: string;
}> = ({ icon, label, value, sousLigne, accent }) => (
  <div className="rounded-2xl border border-border p-4 flex items-start gap-3">
    <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: (accent ?? "hsl(var(--primary))") + "1F", color: accent ?? "hsl(var(--primary))" }}>
      {icon}
    </div>
    <div className="min-w-0">
      <p className="text-[11px] text-muted-foreground truncate">{label}</p>
      <p className="text-lg font-semibold leading-tight">{value}</p>
      {sousLigne && <p className="text-[11px] text-muted-foreground mt-0.5">{sousLigne}</p>}
    </div>
  </div>
);

const SegmentCard: React.FC<{
  titre: string; icon: React.ReactNode; accent: string;
  nbActifs: number; montantTotal: number; capitalRestant: number;
  partPct?: number; partLabel?: string; lienFiltre: string;
}> = ({ titre, icon, accent, nbActifs, montantTotal, capitalRestant, partPct, partLabel, lienFiltre }) => (
  <div className="rounded-2xl border border-border p-4 space-y-3">
    <div className="flex items-center gap-2">
      <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: accent + "1F", color: accent }}>{icon}</div>
      <p className="font-semibold text-sm">{titre}</p>
      <Link to={lienFiltre} className="ml-auto text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-0.5">
        Voir <ArrowRight size={11} />
      </Link>
    </div>
    <div className="grid grid-cols-3 gap-2">
      <div>
        <p className="text-[10px] text-muted-foreground">Dossiers actifs</p>
        <p className="text-base font-semibold">{nbActifs}</p>
      </div>
      <div>
        <p className="text-[10px] text-muted-foreground">Montant total</p>
        <p className="text-base font-semibold">{formatMontant(montantTotal)}</p>
      </div>
      <div>
        <p className="text-[10px] text-muted-foreground">Capital restant</p>
        <p className="text-base font-semibold">{formatMontant(capitalRestant)}</p>
      </div>
    </div>
    {partPct !== undefined && (
      <div>
        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
          <div className="h-full rounded-full" style={{ width: `${Math.min(100, partPct)}%`, background: accent }} />
        </div>
        <p className="text-[10px] text-muted-foreground mt-1">{partLabel}</p>
      </div>
    )}
  </div>
);

const PretsDashboardPage: React.FC = () => {
  const { profile, activeRole } = useAuth();
  const sl: number = activeRole === "administrateur" ? 999 : ((profile as any)?.security_level ?? 0);

  const [prets, setPrets] = useState<Pret[]>([]);
  const [stats, setStats] = useState<PretStats | null>(null);
  const [alertes, setAlertes] = useState<Alerte[]>([]);
  const [types, setTypes] = useState<TypePretAdmin[]>([]);
  const [loading, setLoading] = useState(true);
  const [creationDirecte, setCreationDirecte] = useState(false);

  const charger = useCallback(async () => {
    setLoading(true);
    try {
      const [p, s, t, a] = await Promise.all([
        pretsApi.listePrets({}),
        pretsApi.stats(),
        pretsApi.listerTypesAdmin(),
        sl >= 50 ? pretsApi.alertes() : Promise.resolve([]),
      ]);
      setPrets(p); setStats(s); setTypes(t); setAlertes(a);
    } finally {
      setLoading(false);
    }
  }, [sl]);

  useEffect(() => { charger(); }, [charger]);

  const avanceParType = useMemo(() => {
    const m = new Map<string, boolean>();
    types.forEach(t => m.set(t.code, t.avance_sur_salaire));
    return m;
  }, [types]);

  const { internes, avances, externes } = useMemo(() => {
    const internes: Pret[] = [], avances: Pret[] = [], externes: Pret[] = [];
    prets.forEach(p => {
      if (!p.pret_interne) { externes.push(p); return; }
      if (p.type_code && avanceParType.get(p.type_code)) avances.push(p);
      else internes.push(p);
    });
    return { internes, avances, externes };
  }, [prets, avanceParType]);

  const agreger = (liste: Pret[]) => ({
    nbActifs: liste.filter(p => STATUTS_ACTIFS.includes(p.statut)).length,
    montantTotal: liste.reduce((s, p) => s + (p.mt_pret ?? 0), 0),
    capitalRestant: liste.reduce((s, p) => s + (p.capital_restant ?? 0), 0),
  });
  const aggInternes = agreger(internes);
  const aggAvances = agreger(avances);
  const aggExternes = agreger(externes);
  const montantGlobal = aggInternes.montantTotal + aggAvances.montantTotal + aggExternes.montantTotal || 1;

  const enveloppeUsage = stats ? Math.round((stats.enveloppe_interne_utilisee / (stats.plafond_interne_annuel || 1)) * 100) : 0;

  const enAttente = prets.filter(p => p.statut === "en_attente_validation").slice(0, 6);
  const alertesNonLues = alertes.filter(a => !a.lue);

  const repartitionStatuts = useMemo(() => {
    const total = prets.length || 1;
    const counts: Record<string, number> = {};
    prets.forEach(p => { counts[p.statut] = (counts[p.statut] ?? 0) + 1; });
    return Object.entries(counts)
      .map(([statut, n]) => ({ statut, n, pct: (n / total) * 100 }))
      .sort((a, b) => b.n - a.n);
  }, [prets]);

  return (
    <div className="w-full">
      <div className="flex items-center gap-1.5 px-4 pt-4 pb-2 text-[13px] text-muted-foreground">
        <span>Mon équipe</span>
        <span style={{ opacity: 0.5 }}>/</span>
        <span className="font-semibold text-foreground">Gestion des Prêts</span>
        <div className="ml-auto flex items-center gap-3">
          <Link to="/prets/gestion/liste" className="flex items-center gap-1 hover:text-foreground">
            <ListChecks size={13} /> Liste des dossiers
          </Link>
          <Link to="/configuration/prets" className="flex items-center gap-1 hover:text-foreground">
            <Settings size={13} /> Paramétrage
          </Link>
        </div>
      </div>

      <div className="px-4 pb-6 space-y-5">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">Tableau de bord</h1>
          {sl >= 50 && (
            <Button size="sm" onClick={() => setCreationDirecte(true)}>
              <Plus size={14} className="mr-1.5" /> Nouveau dossier
            </Button>
          )}
        </div>

        {alertesNonLues.length > 0 && (
          <Link
            to="/prets/gestion/liste"
            className="flex items-center gap-2 rounded-xl p-3 text-sm"
            style={{ background: "hsl(var(--warning) / 0.1)", color: "hsl(var(--warning))" }}
          >
            <ShieldAlert size={16} />
            {alertesNonLues.length} alerte{alertesNonLues.length > 1 ? "s" : ""} non lue{alertesNonLues.length > 1 ? "s" : ""} nécessitent votre attention.
            <ArrowRight size={13} className="ml-auto" />
          </Link>
        )}

        {/* KPI globaux */}
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
          <KpiCard icon={<TrendingUp size={16} />} label="En attente" value={String(stats?.en_attente ?? 0)} accent="hsl(var(--info))" />
          <KpiCard icon={<Banknote size={16} />} label="Actifs" value={String(stats?.actifs ?? 0)} accent="hsl(var(--success))" />
          <KpiCard icon={<AlertTriangle size={16} />} label="Suspendus" value={String(stats?.suspendus ?? 0)} accent="hsl(var(--warning))" />
          <KpiCard icon={<Wallet size={16} />} label="Encours total" value={formatMontant(stats?.encours_total ?? 0)} />
          <KpiCard icon={<Wallet size={16} />} label="Capital restant" value={formatMontant(stats?.capital_restant ?? 0)} accent="hsl(var(--destructive))" />
          <KpiCard
            icon={<Banknote size={16} />} label="Enveloppe interne" value={formatMontant(stats?.enveloppe_disponible ?? 0)}
            sousLigne={`${enveloppeUsage}% utilisé`} accent={enveloppeUsage > 80 ? "hsl(var(--destructive))" : "hsl(var(--primary))"}
          />
        </div>

        {/* Focus interne / avances / externe */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <SegmentCard
            titre="Prêts internes" icon={<Banknote size={15} />} accent="hsl(var(--primary))"
            {...aggInternes}
            partPct={(aggInternes.montantTotal / montantGlobal) * 100}
            partLabel={`${Math.round((aggInternes.montantTotal / montantGlobal) * 100)}% du volume total accordé`}
            lienFiltre="/prets/gestion/liste?type=interne"
          />
          <SegmentCard
            titre="Avances sur salaire" icon={<Wallet size={15} />} accent="hsl(var(--warning))"
            {...aggAvances}
            partPct={(aggAvances.montantTotal / montantGlobal) * 100}
            partLabel={`${Math.round((aggAvances.montantTotal / montantGlobal) * 100)}% du volume total accordé`}
            lienFiltre="/prets/gestion/liste?type=interne"
          />
          <SegmentCard
            titre="Prêts externes" icon={<Building2 size={15} />} accent="hsl(var(--info))"
            {...aggExternes}
            partPct={(aggExternes.montantTotal / montantGlobal) * 100}
            partLabel={`${Math.round((aggExternes.montantTotal / montantGlobal) * 100)}% du volume total accordé`}
            lienFiltre="/prets/gestion/liste?type=externe"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {/* Répartition par statut */}
          <div className="rounded-2xl border border-border p-4">
            <p className="font-semibold text-sm mb-3">Répartition par statut</p>
            {loading ? (
              <p className="text-xs text-muted-foreground">Chargement…</p>
            ) : repartitionStatuts.length === 0 ? (
              <p className="text-xs text-muted-foreground">Aucun dossier.</p>
            ) : (
              <div className="space-y-2">
                {repartitionStatuts.map(({ statut, n, pct }) => (
                  <div key={statut}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span>{PRET_STATUT_LABELS[statut as keyof typeof PRET_STATUT_LABELS] ?? statut}</span>
                      <span className="text-muted-foreground">{n}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "hsl(var(--primary))" }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Dossiers en attente de validation */}
          <div className="rounded-2xl border border-border p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="font-semibold text-sm">Dossiers en attente de validation</p>
              <Link to="/prets/gestion/liste?statut=en_attente_validation" className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-0.5">
                Tout voir <ArrowRight size={11} />
              </Link>
            </div>
            {loading ? (
              <p className="text-xs text-muted-foreground">Chargement…</p>
            ) : enAttente.length === 0 ? (
              <p className="text-xs text-muted-foreground">Aucun dossier en attente.</p>
            ) : (
              <div className="space-y-2">
                {enAttente.map(p => (
                  <div key={p.id} className="flex items-center justify-between text-xs border-b border-border pb-2 last:border-0 last:pb-0">
                    <div>
                      <p className="font-medium">{p.collab_nom ?? p.matricule}</p>
                      <p className="text-muted-foreground">{p.type_libelle ?? p.type_code}</p>
                    </div>
                    <p className="font-semibold">{formatMontant(p.mt_pret)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <CreationDirectePretDialog open={creationDirecte} onClose={() => setCreationDirecte(false)} onSuccess={charger} />
    </div>
  );
};

export default PretsDashboardPage;
