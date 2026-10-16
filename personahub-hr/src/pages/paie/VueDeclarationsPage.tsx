/**
 * VueDeclarationsPage — tableau de bord des déclarations sociales.
 * Vue d'ensemble CNSS + CIMR : dernière déclaration de chaque type avec sa
 * timeline de statut, stats clés, et historique combiné des déclarations
 * récentes toutes déclarations confondues.
 */
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import {
  Shield, FileText, ArrowRight, Users, Wallet, Calendar,
  TrendingUp, Clock, ChevronRight, Sparkles, Eye
} from "lucide-react";
import { StatutBadge, StatutTimeline, getStatutDef } from "@/components/paie/StatutDeclaration";

const MOIS_LABELS = [
  "", "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"
];
const TRIMESTRE_LABELS = ["", "1er trimestre", "2e trimestre", "3e trimestre", "4e trimestre"];

interface DeclCnss {
  id: string; mois: number; annee: number; statut: string;
  nombre_lignes: number; total_salaires: number; created_at?: string;
}
interface DeclCimr {
  id: string; trimestre: number; annee: number; statut: string;
  nombre_lignes: number; total_salaires: number; created_at?: string;
}

const VueDeclarationsPage: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [cnss, setCnss] = useState<DeclCnss[]>([]);
  const [cimr, setCimr] = useState<DeclCimr[]>([]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const [{ data: cnssData }, { data: cimrData }] = await Promise.all([
        supabase.from("cnss_declarations" as never)
          .select("id,mois,annee,statut,nombre_lignes,total_salaires,created_at" as never)
          .order("created_at" as never, { ascending: false } as never)
          .limit(10),
        supabase.from("cimr_declarations" as never)
          .select("id,trimestre,annee,statut,nombre_lignes,total_salaires,created_at" as never)
          .order("created_at" as never, { ascending: false } as never)
          .limit(10),
      ]);
      setCnss(((cnssData || []) as any[]) as DeclCnss[]);
      setCimr(((cimrData || []) as any[]) as DeclCimr[]);
      setLoading(false);
    };
    load();
  }, []);

  const derniereCnss = cnss[0];
  const derniereCimr = cimr[0];

  // Historique combiné, trié par date décroissante
  const combine = [
    ...cnss.map(d => ({ type: "CNSS" as const, id: d.id, periode: `${MOIS_LABELS[d.mois]} ${d.annee}`, statut: d.statut, lignes: d.nombre_lignes, montant: d.total_salaires, created_at: d.created_at })),
    ...cimr.map(d => ({ type: "CIMR" as const, id: d.id, periode: `${TRIMESTRE_LABELS[d.trimestre]} ${d.annee}`, statut: d.statut, lignes: d.nombre_lignes, montant: d.total_salaires, created_at: d.created_at })),
  ].sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()).slice(0, 12);

  const cardStyle = { borderColor: "hsl(var(--border))", background: "hsl(var(--background))" };

  return (
    <div className="p-4 md:p-6">
      {/* ─── En-tête ─── */}
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2.5 rounded-xl" style={{ background: "hsl(var(--accent) / 0.1)" }}>
          <FileText size={22} style={{ color: "hsl(var(--accent))" }} />
        </div>
        <div>
          <h1 className="text-xl font-bold">Déclarations sociales</h1>
          <p className="text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>
            Vue d'ensemble des télédéclarations CNSS et CIMR
          </p>
        </div>
      </div>

      {/* ─── Cartes des deux organismes ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        {/* CNSS */}
        <div className="rounded-2xl border overflow-hidden" style={cardStyle}>
          <div className="p-5" style={{ background: "linear-gradient(135deg, hsl(var(--primary) / 0.08), hsl(var(--primary) / 0.02))" }}>
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl" style={{ background: "hsl(var(--primary) / 0.15)" }}>
                  <Shield size={20} style={{ color: "hsl(var(--primary))" }} />
                </div>
                <div>
                  <h2 className="font-bold text-base">CNSS</h2>
                  <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>Régime général — mensuelle</p>
                </div>
              </div>
              {derniereCnss && <StatutBadge code={derniereCnss.statut} size="md" />}
            </div>

            {loading ? (
              <div className="mt-4 h-16 rounded-lg animate-pulse" style={{ background: "hsl(var(--muted))" }} />
            ) : derniereCnss ? (
              <>
                <div className="mt-4 flex items-center gap-2 text-sm font-semibold">
                  <Calendar size={14} style={{ color: "hsl(var(--muted-foreground))" }} />
                  {MOIS_LABELS[derniereCnss.mois]} {derniereCnss.annee}
                </div>
                <div className="mt-3 overflow-x-auto pb-1">
                  <StatutTimeline code={derniereCnss.statut} />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div className="flex items-center gap-2 p-2.5 rounded-lg" style={{ background: "hsl(var(--muted))" }}>
                    <Users size={14} style={{ color: "hsl(var(--muted-foreground))" }} />
                    <div>
                      <p className="text-sm font-bold leading-none">{derniereCnss.nombre_lignes}</p>
                      <p className="text-[10px]" style={{ color: "hsl(var(--muted-foreground))" }}>salariés</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 p-2.5 rounded-lg" style={{ background: "hsl(var(--muted))" }}>
                    <Wallet size={14} style={{ color: "hsl(var(--muted-foreground))" }} />
                    <div>
                      <p className="text-sm font-bold leading-none">{(derniereCnss.total_salaires || 0).toLocaleString("fr-FR")} DH</p>
                      <p className="text-[10px]" style={{ color: "hsl(var(--muted-foreground))" }}>masse déclarée</p>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="mt-4 flex items-center gap-2 text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>
                <Sparkles size={14} /> Aucune déclaration CNSS pour l'instant
              </div>
            )}
          </div>
          <button
            onClick={() => navigate("/paie/declarations/cnss", derniereCnss && (derniereCnss.statut === "TRAITEE" || derniereCnss.statut === "ARCHIVEE")
              ? { state: { consulterDeclarationId: derniereCnss.id } } : undefined)}
            className="w-full flex items-center justify-center gap-1.5 py-3 text-sm font-semibold border-t hover:bg-muted/50 transition-colors"
            style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--primary))" }}>
            {derniereCnss && (derniereCnss.statut === "TRAITEE" || derniereCnss.statut === "ARCHIVEE")
              ? <>Consulter la dernière déclaration <Eye size={14} /></>
              : <>Gérer les déclarations CNSS <ArrowRight size={14} /></>}
          </button>
        </div>

        {/* CIMR */}
        <div className="rounded-2xl border overflow-hidden" style={cardStyle}>
          <div className="p-5" style={{ background: "linear-gradient(135deg, hsl(var(--accent) / 0.08), hsl(var(--accent) / 0.02))" }}>
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl" style={{ background: "hsl(var(--accent) / 0.15)" }}>
                  <Shield size={20} style={{ color: "hsl(var(--accent))" }} />
                </div>
                <div>
                  <h2 className="font-bold text-base">CIMR</h2>
                  <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>Retraite complémentaire — trimestrielle</p>
                </div>
              </div>
              {derniereCimr && <StatutBadge code={derniereCimr.statut} size="md" />}
            </div>

            {loading ? (
              <div className="mt-4 h-16 rounded-lg animate-pulse" style={{ background: "hsl(var(--muted))" }} />
            ) : derniereCimr ? (
              <>
                <div className="mt-4 flex items-center gap-2 text-sm font-semibold">
                  <Calendar size={14} style={{ color: "hsl(var(--muted-foreground))" }} />
                  {TRIMESTRE_LABELS[derniereCimr.trimestre]} {derniereCimr.annee}
                </div>
                <div className="mt-3 overflow-x-auto pb-1">
                  <StatutTimeline code={derniereCimr.statut} />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div className="flex items-center gap-2 p-2.5 rounded-lg" style={{ background: "hsl(var(--muted))" }}>
                    <Users size={14} style={{ color: "hsl(var(--muted-foreground))" }} />
                    <div>
                      <p className="text-sm font-bold leading-none">{derniereCimr.nombre_lignes}</p>
                      <p className="text-[10px]" style={{ color: "hsl(var(--muted-foreground))" }}>salariés</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 p-2.5 rounded-lg" style={{ background: "hsl(var(--muted))" }}>
                    <Wallet size={14} style={{ color: "hsl(var(--muted-foreground))" }} />
                    <div>
                      <p className="text-sm font-bold leading-none">{(derniereCimr.total_salaires || 0).toLocaleString("fr-FR")} DH</p>
                      <p className="text-[10px]" style={{ color: "hsl(var(--muted-foreground))" }}>masse déclarée</p>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="mt-4 flex items-center gap-2 text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>
                <Sparkles size={14} /> Aucune déclaration CIMR pour l'instant
              </div>
            )}
          </div>
          <button
            onClick={() => navigate("/paie/declarations/cimr", derniereCimr && (derniereCimr.statut === "TRAITEE" || derniereCimr.statut === "ARCHIVEE")
              ? { state: { consulterDeclarationId: derniereCimr.id } } : undefined)}
            className="w-full flex items-center justify-center gap-1.5 py-3 text-sm font-semibold border-t hover:bg-muted/50 transition-colors"
            style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--accent))" }}>
            {derniereCimr && (derniereCimr.statut === "TRAITEE" || derniereCimr.statut === "ARCHIVEE")
              ? <>Consulter la dernière déclaration <Eye size={14} /></>
              : <>Gérer les déclarations CIMR <ArrowRight size={14} /></>}
          </button>
        </div>
      </div>

      {/* ─── Historique combiné ─── */}
      <div className="rounded-2xl border" style={cardStyle}>
        <div className="flex items-center gap-2 p-4 border-b" style={{ borderColor: "hsl(var(--border))" }}>
          <Clock size={16} style={{ color: "hsl(var(--muted-foreground))" }} />
          <h3 className="text-sm font-bold">Activité récente</h3>
        </div>

        {loading ? (
          <div className="p-6 space-y-2">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-10 rounded-lg animate-pulse" style={{ background: "hsl(var(--muted))" }} />
            ))}
          </div>
        ) : combine.length === 0 ? (
          <div className="text-center py-12">
            <TrendingUp size={28} strokeWidth={1.5} className="mx-auto mb-2" style={{ color: "hsl(var(--muted-foreground))" }} />
            <p className="text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>
              Aucune déclaration enregistrée pour l'instant — commencez par une nouvelle déclaration CNSS ou CIMR.
            </p>
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: "hsl(var(--border))" }}>
            {combine.map(d => {
              const def = getStatutDef(d.statut);
              const verrouillee = d.statut === "TRAITEE" || d.statut === "ARCHIVEE";
              const cible = d.type === "CNSS" ? "/paie/declarations/cnss" : "/paie/declarations/cimr";
              return (
                <button
                  key={`${d.type}-${d.id}`}
                  onClick={() => navigate(cible, { state: { consulterDeclarationId: d.id } })}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/40 transition-colors"
                >
                  <span className="text-[10px] font-bold px-2 py-1 rounded-md w-14 text-center flex-shrink-0"
                    style={{
                      background: d.type === "CNSS" ? "hsl(var(--primary) / 0.1)" : "hsl(var(--accent) / 0.1)",
                      color: d.type === "CNSS" ? "hsl(var(--primary))" : "hsl(var(--accent))",
                    }}>
                    {d.type}
                  </span>
                  <span className="text-sm font-medium flex-shrink-0 w-32">{d.periode}</span>
                  <span className="flex-1">
                    <StatutBadge code={d.statut} />
                  </span>
                  <span className="text-xs hidden sm:inline" style={{ color: "hsl(var(--muted-foreground))" }}>
                    {d.lignes} salarié{d.lignes > 1 ? "s" : ""}
                  </span>
                  <span className="text-xs font-mono w-28 text-right hidden md:inline" style={{ color: "hsl(var(--muted-foreground))" }}>
                    {(d.montant || 0).toLocaleString("fr-FR")} DH
                  </span>
                  {verrouillee ? (
                    <span className="flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-md flex-shrink-0"
                      style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>
                      <Eye size={12} /> Consulter
                    </span>
                  ) : (
                    <ChevronRight size={14} style={{ color: "hsl(var(--muted-foreground))" }} />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default VueDeclarationsPage;
