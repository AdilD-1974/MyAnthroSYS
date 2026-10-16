import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import {
  FileText, Plus, Search, Loader2, Upload, Archive, Globe, Building2, Lock, Pencil,
} from "lucide-react";

// ── Types (miroir de app/schemas/etat.py) ───────────────────────────────────
// type_source, statut et visibilite sont des chaînes libres côté client
// depuis la migration 069 -- leurs libellés/options viennent de l'API
// (/etats/types-source, /etats/metadonnees), plus aucune liste figée ici.

type StatutEtat = "BROUILLON" | "PUBLIE" | "ARCHIVE";
type VisibiliteEtat = "PRIVE" | "SOCIETE" | "GLOBAL";

interface EtatDefinition {
  id: string;
  code: string;
  nom: string;
  description: string | null;
  societe_id: string | null;
  type_source: string;
  statut: StatutEtat;
  visibilite: VisibiliteEtat;
  cree_par_user_id: string | null;
  created_at: string;
  updated_at: string;
}

interface OptionMetadonnee {
  code: string;
  libelle: string;
}

interface EtatMetadonnees {
  statuts: OptionMetadonnee[];
  visibilites: OptionMetadonnee[];
  formats_sortie: OptionMetadonnee[];
  modes_donnee: OptionMetadonnee[];
}

interface TypeSourceEtat {
  code: string;
  libelle: string;
  contexte_requis: string[];
  actif: boolean;
}

// ── Présentation — couleurs uniquement (pas de libellé métier en dur) ───────
// Les couleurs restent un choix purement visuel, indépendant de la donnée :
// même si un statut change de libellé côté back, sa couleur reste stable.

const COULEUR_STATUT: Record<StatutEtat, { bg: string; fg: string }> = {
  BROUILLON: { bg: "hsl(var(--muted))", fg: "hsl(var(--muted-foreground))" },
  PUBLIE: { bg: "hsl(142 71% 45% / 0.15)", fg: "hsl(142 71% 35%)" },
  ARCHIVE: { bg: "hsl(var(--muted))", fg: "hsl(var(--muted-foreground))" },
};

function IconeVisibilite({ visibilite }: { visibilite: VisibiliteEtat }) {
  if (visibilite === "GLOBAL") return <Globe size={13} />;
  if (visibilite === "SOCIETE") return <Building2 size={13} />;
  return <Lock size={13} />;
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function EtatsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [filtreStatut, setFiltreStatut] = useState<StatutEtat | "TOUS">("TOUS");
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [archivingId, setArchivingId] = useState<string | null>(null);

  const { data: etats, isLoading, isError } = useQuery({
    queryKey: ["etats-liste"],
    queryFn: async () => (await api.get("/etats")) as EtatDefinition[],
  });

  const { data: metadonnees } = useQuery({
    queryKey: ["etats-metadonnees"],
    queryFn: async () => (await api.get("/etats/metadonnees")) as EtatMetadonnees,
    staleTime: Infinity, // énumérations fixes côté code, pas besoin de revalider
  });

  const { data: typesSource } = useQuery({
    queryKey: ["etats-types-source"],
    queryFn: async () => (await api.get("/etats/types-source")) as TypeSourceEtat[],
  });

  // Libellés résolus dynamiquement — plus aucun dict figé dans ce fichier
  const libelleStatut = useMemo(() => {
    const m: Record<string, string> = {};
    (metadonnees?.statuts || []).forEach((o) => { m[o.code] = o.libelle; });
    return m;
  }, [metadonnees]);

  const libelleVisibilite = useMemo(() => {
    const m: Record<string, string> = {};
    (metadonnees?.visibilites || []).forEach((o) => { m[o.code] = o.libelle; });
    return m;
  }, [metadonnees]);

  const libelleSource = useMemo(() => {
    const m: Record<string, string> = {};
    (typesSource || []).forEach((o) => { m[o.code] = o.libelle; });
    return m;
  }, [typesSource]);

  const filtresStatutDisponibles = metadonnees?.statuts || [];

  const filtres = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (etats || []).filter((e) => {
      if (filtreStatut !== "TOUS" && e.statut !== filtreStatut) return false;
      if (!q) return true;
      return e.nom.toLowerCase().includes(q) || e.code.toLowerCase().includes(q);
    });
  }, [etats, search, filtreStatut]);

  const publier = async (etat: EtatDefinition) => {
    setPublishingId(etat.id);
    try {
      await api.patch(`/etats/${etat.id}`, { statut: "PUBLIE" });
      toast({ title: "État publié", description: `« ${etat.nom} » est maintenant disponible.` });
      qc.invalidateQueries({ queryKey: ["etats-liste"] });
    } catch (e: any) {
      toast({
        title: "Échec de la publication",
        description: e?.message || "Une erreur est survenue.",
        variant: "destructive",
      });
    } finally {
      setPublishingId(null);
    }
  };

  const archiver = async (etat: EtatDefinition) => {
    setArchivingId(etat.id);
    try {
      await api.delete(`/etats/${etat.id}`);
      toast({ title: "État archivé", description: `« ${etat.nom} » a été archivé.` });
      qc.invalidateQueries({ queryKey: ["etats-liste"] });
    } catch (e: any) {
      toast({
        title: "Échec de l'archivage",
        description: e?.message || "Une erreur est survenue.",
        variant: "destructive",
      });
    } finally {
      setArchivingId(null);
    }
  };

  if (isError) {
    return (
      <div className="p-5">
        <div
          className="rounded-2xl border p-6 text-sm"
          style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}
        >
          Impossible de charger les états. Si le message concerne un accès refusé, ce module n'est
          peut-être pas encore activé pour votre rôle — contactez un administrateur.
        </div>
      </div>
    );
  }

  return (
    <div className="p-5 space-y-4">
      {/* En-tête */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: "hsl(var(--foreground))" }}>
            <FileText size={20} /> Générateur d'états
          </h1>
          <p className="text-sm mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>
            Créez et gérez les états personnalisés (bulletins, attestations, documents de départ...).
          </p>
        </div>
        <Button onClick={() => navigate("/etats/nouveau")} className="gap-1.5">
          <Plus size={15} /> Nouvel état
        </Button>
      </div>

      {/* Filtres */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative max-w-md flex-1 min-w-[220px]">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2"
            style={{ color: "hsl(var(--muted-foreground))" }}
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher un état…"
            className="pl-9"
          />
        </div>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => setFiltreStatut("TOUS")}
            className="text-xs px-3 py-1.5 rounded-full border transition-colors"
            style={{
              borderColor: "hsl(var(--border))",
              background: filtreStatut === "TOUS" ? "hsl(var(--primary))" : "transparent",
              color: filtreStatut === "TOUS" ? "hsl(var(--primary-foreground))" : "hsl(var(--muted-foreground))",
            }}
          >
            Tous
          </button>
          {filtresStatutDisponibles.map((s) => (
            <button
              key={s.code}
              type="button"
              onClick={() => setFiltreStatut(s.code as StatutEtat)}
              className="text-xs px-3 py-1.5 rounded-full border transition-colors"
              style={{
                borderColor: "hsl(var(--border))",
                background: filtreStatut === s.code ? "hsl(var(--primary))" : "transparent",
                color: filtreStatut === s.code ? "hsl(var(--primary-foreground))" : "hsl(var(--muted-foreground))",
              }}
            >
              {s.libelle}
            </button>
          ))}
        </div>
      </div>

      {/* Liste */}
      {isLoading ? (
        <div
          className="flex items-center justify-center py-16"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          <Loader2 size={20} className="animate-spin mr-2" /> Chargement…
        </div>
      ) : filtres.length === 0 ? (
        <div
          className="rounded-2xl border p-10 text-center text-sm"
          style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}
        >
          {search || filtreStatut !== "TOUS"
            ? "Aucun état ne correspond à ces critères."
            : "Aucun état créé pour l'instant — commencez par en créer un."}
        </div>
      ) : (
        <div className="rounded-2xl border overflow-hidden" style={{ borderColor: "hsl(var(--border))" }}>
          <table className="w-full text-sm border-collapse table-fixed">
            <colgroup>
              <col style={{ width: "34%" }} />
              <col style={{ width: "16%" }} />
              <col style={{ width: "13%" }} />
              <col style={{ width: "13%" }} />
              <col style={{ width: "24%" }} />
            </colgroup>
            <thead style={{ background: "hsl(var(--muted))" }}>
              <tr style={{ borderBottom: "1px solid hsl(var(--border))" }}>
                <th
                  className="text-left px-4 py-3 text-[11px] font-bold uppercase tracking-wider"
                  style={{ color: "hsl(var(--muted-foreground))" }}
                >
                  Nom
                </th>
                <th
                  className="text-left px-3 py-3 text-[11px] font-bold uppercase tracking-wider"
                  style={{ color: "hsl(var(--muted-foreground))" }}
                >
                  Source
                </th>
                <th
                  className="text-left px-3 py-3 text-[11px] font-bold uppercase tracking-wider"
                  style={{ color: "hsl(var(--muted-foreground))" }}
                >
                  Statut
                </th>
                <th
                  className="text-left px-3 py-3 text-[11px] font-bold uppercase tracking-wider"
                  style={{ color: "hsl(var(--muted-foreground))" }}
                >
                  Visibilité
                </th>
                <th className="px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtres.map((etat) => {
                const c = COULEUR_STATUT[etat.statut];
                return (
                  <tr
                    key={etat.id}
                    className="hover:bg-accent/5 transition-colors"
                    style={{ borderBottom: "1px solid hsl(var(--border))" }}
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium" style={{ color: "hsl(var(--foreground))" }}>
                        {etat.nom}
                      </div>
                      {etat.description && (
                        <div className="text-xs mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>
                          {etat.description}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3" style={{ color: "hsl(var(--muted-foreground))" }}>
                      {libelleSource[etat.type_source] || etat.type_source}
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className="text-xs font-medium px-2 py-1 rounded-full"
                        style={{ background: c.bg, color: c.fg }}
                      >
                        {libelleStatut[etat.statut] || etat.statut}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className="inline-flex items-center gap-1 text-xs"
                        style={{ color: "hsl(var(--muted-foreground))" }}
                      >
                        <IconeVisibilite visibilite={etat.visibilite} />
                        {libelleVisibilite[etat.visibilite] || etat.visibilite}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right whitespace-nowrap">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="gap-1.5 h-7 text-xs"
                        onClick={() => navigate(`/etats/${etat.id}/modifier`)}
                      >
                        <Pencil size={12} />
                        Modifier
                      </Button>
                      {etat.statut === "BROUILLON" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5 h-7 text-xs"
                          disabled={publishingId === etat.id}
                          onClick={() => publier(etat)}
                        >
                          {publishingId === etat.id ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <Upload size={12} />
                          )}
                          Publier
                        </Button>
                      )}
                      {etat.statut !== "ARCHIVE" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="gap-1.5 h-7 text-xs ml-1.5"
                          disabled={archivingId === etat.id}
                          onClick={() => archiver(etat)}
                        >
                          {archivingId === etat.id ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <Archive size={12} />
                          )}
                          Archiver
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
