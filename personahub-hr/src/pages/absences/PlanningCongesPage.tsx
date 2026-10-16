import React, { useState, useMemo } from "react";
import { api } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useManagerPopulation } from "@/hooks/useManagerPopulation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ChevronLeft, ChevronRight, Search, CalendarDays, Download, ChevronDown, X } from "lucide-react";
import * as XLSX from "xlsx";
import { calcJoursAvecType } from "./congeCalculs";

const MOIS_FR = ["Jan", "Fév", "Mar", "Avr", "Mai", "Jun", "Jul", "Aoû", "Sep", "Oct", "Nov", "Déc"];
const MOIS_LONG = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];

const TYPE_COLORS = [
  "hsl(221 83% 53%)", "hsl(142 71% 45%)", "hsl(38 92% 50%)", "hsl(271 91% 65%)",
  "hsl(0 72% 51%)", "hsl(180 71% 45%)", "hsl(330 81% 60%)", "hsl(60 71% 45%)",
];

// ─── Filtre multi-choix générique (checkboxes dans un popover) ─
// `selected = []` est interprété comme "tous" (aucun filtre appliqué),
// exactement comme l'ancienne valeur "ALL" des Select simples.
function MultiSelectFilter({
  label, options, selected, onChange, width = "w-44",
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (v: string[]) => void;
  width?: string;
}) {
  const [open, setOpen] = useState(false);
  const toggle = (v: string) =>
    onChange(selected.includes(v) ? selected.filter(s => s !== v) : [...selected, v]);

  const displayLabel =
    selected.length === 0
      ? label
      : selected.length === 1
        ? options.find(o => o.value === selected[0])?.label ?? label
        : `${selected.length} sélectionnés`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={`h-8 justify-between font-normal ${width}`}>
          <span className="truncate">{displayLabel}</span>
          <span className="flex items-center gap-1 ml-1 flex-shrink-0">
            {selected.length > 0 && (
              <Badge variant="secondary" className="h-4 px-1.5 text-[10px] leading-none">{selected.length}</Badge>
            )}
            <ChevronDown size={13} style={{ color: "hsl(var(--muted-foreground))" }} />
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-2" align="start">
        <div className="flex items-center justify-between px-1 pb-1.5 mb-1" style={{ borderBottom: "1px solid hsl(var(--border))" }}>
          <span className="text-xs font-semibold" style={{ color: "hsl(var(--muted-foreground))" }}>{label}</span>
          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="text-xs inline-flex items-center gap-0.5 hover:underline"
              style={{ color: "hsl(var(--primary))" }}
            >
              <X size={11} /> Réinitialiser
            </button>
          )}
        </div>
        <div className="max-h-64 overflow-y-auto space-y-0.5">
          {options.length === 0 ? (
            <div className="text-xs px-2 py-2" style={{ color: "hsl(var(--muted-foreground))" }}>Aucune option</div>
          ) : options.map(opt => {
            const checked = selected.includes(opt.value);
            return (
              <label
                key={opt.value}
                className="flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer text-sm"
                style={{ background: checked ? "hsl(var(--muted))" : "transparent" }}
                onMouseEnter={e => { if (!checked) e.currentTarget.style.background = "hsl(var(--muted)/0.5)"; }}
                onMouseLeave={e => { if (!checked) e.currentTarget.style.background = "transparent"; }}
              >
                <Checkbox checked={checked} onCheckedChange={() => toggle(opt.value)} />
                <span className="truncate">{opt.label}</span>
              </label>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default function PlanningCongesPage() {
  const { role } = useAuth();
  const isManager = role === "manager";
  const { collaborateurIds: managerCollabIds, loading: popLoading } = useManagerPopulation();

  const now = new Date();
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth()); // 0-indexed
  const [viewMode, setViewMode] = useState<"mois" | "annuel">("mois");
  const [filterTypes, setFilterTypes] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [filterStatuts, setFilterStatuts] = useState<string[]>([]);

  const { data: typesConge = [] } = useQuery({
    queryKey: ["ref-type-conge-actifs"],
    queryFn: async () => {
      const data = await api.get("/db/ref_type_conge?actif=eq.true&order=libelle");
      return data || [];
    },
  });

  // Jours fériés de l'année affichée (+ marge fin/début d'année pour les congés
  // à cheval sur deux exercices) — nécessaire pour calculer la vraie portion
  // d'un congé qui tombe dans un mois donné (RG-CONGE-PERIODE-MOIS-01).
  const { data: feriesSet = new Set<string>() } = useQuery<Set<string>>({
    queryKey: ["jours-feries-planning", viewYear],
    queryFn: async () => {
      const data: any[] = await api.get(
        `/db/ref_jours_feries?select=date_debut,nombre_jours&date_debut=gte.${viewYear - 1}-12-01&date_debut=lte.${viewYear + 1}-01-31`
      );
      const s = new Set<string>();
      (data || []).forEach((r) => {
        const nb = r.nombre_jours ?? 1;
        const d = new Date(r.date_debut + "T00:00:00");
        for (let i = 0; i < nb; i++) { const cur = new Date(d); cur.setDate(cur.getDate() + i); s.add(cur.toISOString().split("T")[0]); }
      });
      return s;
    },
  });

  const getTypeJour = (code: string): string | null =>
    (typesConge as any[]).find(t => (t.code ?? t.code_type_conge) === code)?.code_type_jour ?? null;

  /** Jours décomptés d'un congé qui tombent dans [intervalDebut, intervalFin] (ISO yyyy-mm-dd).
   * Réutilise calcJoursAvecType (congeCalculs.ts) — même règles que la saisie
   * et que la récupération paie, pour ne jamais afficher un total différent
   * d'un module à l'autre. Les demi-journées de bord ne s'appliquent que si
   * la borne de l'intervalle coïncide avec la vraie borne du congé. */
  const joursDansIntervalle = (d: any, intervalDebut: string, intervalFin: string): number => {
    const finAbsence = d.date_fin_absence ?? d.date_retour ?? d.date_debut;
    const debutEff = d.date_debut > intervalDebut ? d.date_debut : intervalDebut;
    const finEff = finAbsence < intervalFin ? finAbsence : intervalFin;
    if (debutEff > finEff) return 0;
    const debutDemi = debutEff === d.date_debut ? d.debut_demi_journee : null;
    const finDemi = finEff === finAbsence ? d.fin_demi_journee : null;
    return calcJoursAvecType(debutEff, finEff, debutDemi || "", finDemi || "", getTypeJour(d.code_type_conge), feriesSet).dec;
  };

  const { data: demandes = [], isLoading } = useQuery({
    queryKey: ["cong-planning", viewYear, filterTypes, filterStatuts, search, managerCollabIds, isManager],
    enabled: !isManager || !popLoading,
    queryFn: async () => {
      const yearStart = `${viewYear}-01-01`;
      const yearEnd = `${viewYear}-12-31`;
      // RG-MGR-POP-01 : filtrer par population du manager
      if (isManager && managerCollabIds.length === 0) return [];

      // ── Branche A : circuit (cong_demandes), TOUS statuts (y compris en_attente/brouillon) ──
      const paramsDemandes = new URLSearchParams({
        archive: "eq.false",
        date_debut: `gte.${yearStart}`,
        date_fin_absence: `lte.${yearEnd}`,
        select: "*,collaborateurs(nom,prenom,matricule)",
        order: "date_debut",
      });
      if (filterTypes.length === 1) paramsDemandes.set("code_type_conge", `eq.${filterTypes[0]}`);
      else if (filterTypes.length > 1) paramsDemandes.set("code_type_conge", `in.(${filterTypes.join(",")})`);
      if (isManager) paramsDemandes.set("collaborateur_id", `in.(${managerCollabIds.join(",")})`);

      // ── Branche B : saisie directe (cong_consommation, demande_id null) — toujours "approuvee" ──
      const paramsConso = new URLSearchParams({
        archive: "eq.false",
        est_annulee: "eq.false",
        demande_id: "is.null",
        date_debut: `gte.${yearStart}`,
        date_retour: `lte.${yearEnd}`,
        select: "*,collaborateurs(nom,prenom,matricule)",
        order: "date_debut",
      });
      if (filterTypes.length === 1) paramsConso.set("code_type_conge", `eq.${filterTypes[0]}`);
      else if (filterTypes.length > 1) paramsConso.set("code_type_conge", `in.(${filterTypes.join(",")})`);
      if (isManager) paramsConso.set("collaborateur_id", `in.(${managerCollabIds.join(",")})`);

      const [dataDemandes, dataConso]: [any[], any[]] = await Promise.all([
        api.get(`/db/cong_demandes?${paramsDemandes.toString()}`),
        api.get(`/db/cong_consommation?${paramsConso.toString()}`),
      ]);

      const circuit = (dataDemandes || []).map((d: any) => ({ ...d, source: "circuit" }));
      const directes = (dataConso || []).map((d: any) => ({
        ...d,
        statut: "approuvee",
        date_fin_absence: d.date_fin_absence ?? d.date_retour, // cong_consommation n'a pas date_fin_absence
        source: "saisie_directe",
      }));

      let fusion = [...circuit, ...directes];

      // Filtre statut, appliqué côté client (les valeurs réelles sont en minuscule :
      // en_attente / approuvee / brouillon / refusee / annulee / modifiee)
      if (filterStatuts.length > 0) {
        const wanted = new Set(filterStatuts.map((s) => s.toLowerCase()));
        fusion = fusion.filter((d) => wanted.has(String(d.statut ?? "").toLowerCase()));
      }

      return fusion.filter((d: any) => {
        if (!search) return true;
        const c = d.collaborateurs;
        const t = search.toLowerCase();
        return c?.nom?.toLowerCase().includes(t) || c?.prenom?.toLowerCase().includes(t) || c?.matricule?.toLowerCase().includes(t);
      });
    },
  });

  // Statut "en cours de validation" : identification visuelle dédiée (pointillés + opacité réduite)
  const estEnAttente = (d: any) => ["en_attente", "brouillon"].includes(String(d?.statut ?? "").toLowerCase());

  // Construire map couleurs par type
  // Priorité à la couleur définie dans le référentiel (ref_type_conge) :
  // on essaie plusieurs noms de champ possibles selon le schéma réel.
  // Si aucune couleur n'est définie pour un type, repli sur la palette
  // automatique (comme avant) pour ne jamais afficher de case sans couleur.
  const getCouleurRef = (typeObj: any): string | undefined =>
    typeObj?.couleur || typeObj?.couleur_hex || typeObj?.couleur_hexa ||
    typeObj?.color || typeObj?.hex_color || typeObj?.code_couleur || undefined;

  const typeColorMap = useMemo(() => {
    const map: Record<string, string> = {};
    const codesPresents = [...new Set((demandes as any[]).map((d: any) => d.code_type_conge).filter(Boolean))];
    let fallbackIdx = 0;
    codesPresents.forEach((code) => {
      const typeObj = (typesConge as any[]).find(t => (t.code ?? t.code_type_conge) === code);
      const couleurRef = getCouleurRef(typeObj);
      if (couleurRef) {
        map[code as string] = couleurRef;
      } else {
        map[code as string] = TYPE_COLORS[fallbackIdx % TYPE_COLORS.length];
        fallbackIdx++;
      }
    });
    return map;
  }, [demandes, typesConge]);

  // legendeItems : libellé + couleur pour les types présents
  const legendeItems = useMemo(() => {
    return Object.entries(typeColorMap).map(([code, color]) => {
      const typeObj = (typesConge as any[]).find(t => (t.code ?? t.code_type_conge) === code);
      return { code, color, libelle: typeObj?.libelle || code };
    });
  }, [typeColorMap, typesConge]);

  const getTypeLibelle = (code: string) => (typesConge as any[]).find(t => (t.code ?? t.code_type_conge) === code)?.libelle || code;

  // ─── Vue Mensuelle ─────────────────────────────────────────
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const firstDayOfMonth = new Date(viewYear, viewMonth, 1).getDay();

  // Helper robuste : date de fin
  // RG-CONGE-PARSE-DATE-LOCAL-01 (30/07/2026) : new Date("YYYY-MM-DD") sans
  // heure est interprété par JS en UTC minuit, alors que les cellules du
  // calendrier sont construites en heure LOCALE (new Date(year,month,day)).
  // Au Maroc (UTC+0/+1), ce décalage faisait perdre le premier jour d'un
  // congé dans les comparaisons (>= start échouait pour le jour de début).
  // On force donc systématiquement l'heure locale via "T00:00:00", comme
  // déjà fait dans congeCalculs.ts.
  const parseLocal = (dateStr: string) => new Date(dateStr + "T00:00:00");
  const getEndDate = (d: any) => parseLocal(d.date_fin_absence ?? d.date_retour ?? d.date_fin);


  // Collaborateurs uniques dans le mois courant
  const collabsInMonth = useMemo(() => {
    const monthStart = new Date(viewYear, viewMonth, 1);
    const monthEnd = new Date(viewYear, viewMonth + 1, 0);
    const filtered = demandes.filter((d: any) => {
      const start = parseLocal(d.date_debut);
      const end = getEndDate(d);
      return start <= monthEnd && end >= monthStart;
    });
    const map = new Map<string, { id: string; nom: string; prenom: string; matricule: string }>();
    filtered.forEach((d: any) => {
      if (!map.has(d.collaborateur_id)) {
        map.set(d.collaborateur_id, { id: d.collaborateur_id, ...d.collaborateurs });
      }
    });
    return Array.from(map.values());
  }, [demandes, viewYear, viewMonth]);

  const isAbsent = (collabId: string, day: number) => {
    const date = new Date(viewYear, viewMonth, day);
    return demandes.filter((d: any) => {
      if (d.collaborateur_id !== collabId) return false;
      const start = parseLocal(d.date_debut);
      const end = getEndDate(d);
      return date >= start && date <= end;
    });
  };

  const isWeekend = (day: number) => {
    const d = new Date(viewYear, viewMonth, day).getDay();
    return d === 0 || d === 6;
  };

  const isToday = (day: number) => {
    const t = new Date();
    return t.getFullYear() === viewYear && t.getMonth() === viewMonth && t.getDate() === day;
  };

  // ─── Vue Annuelle ─────────────────────────────────────────
  const collabsAnnuel = useMemo(() => {
    const map = new Map<string, any>();
    demandes.forEach((d: any) => {
      if (!map.has(d.collaborateur_id)) {
        map.set(d.collaborateur_id, { id: d.collaborateur_id, ...d.collaborateurs });
      }
    });
    return Array.from(map.values());
  }, [demandes]);

  const getDemandeMois = (collabId: string, mois: number) => {
    return demandes.filter((d: any) => {
      if (d.collaborateur_id !== collabId) return false;
      const start = parseLocal(d.date_debut);
      const end = getEndDate(d);
      const moisStart = new Date(viewYear, mois, 1);
      const moisEnd = new Date(viewYear, mois + 1, 0);
      return start <= moisEnd && end >= moisStart;
    });
  };

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  };

  // ─── Export Excel ──────────────────────────────────────────
  const exportExcel = () => {
    const wb = XLSX.utils.book_new();

    if (viewMode === "mois") {
      // En-têtes : Collaborateur | Matricule | 1 | 2 | … | N
      const daysInM = new Date(viewYear, viewMonth + 1, 0).getDate();
      const days = Array.from({ length: daysInM }, (_, i) => i + 1);
      const dayLabels = days.map(d => {
        const dow = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"][new Date(viewYear, viewMonth, d).getDay()];
        return `${d}\n${dow}`;
      });
      const headers = ["Collaborateur", "Matricule", ...dayLabels];
      const rows = collabsInMonth.map(collab => {
        const cells: (string | number)[] = [
          `${collab.nom} ${collab.prenom}`,
          collab.matricule,
        ];
        days.forEach(day => {
          const abs = isAbsent(collab.id, day);
          if (abs.length > 0) {
            cells.push(abs.map(a => getTypeLibelle(a.code_type_conge)).join(" / "));
          } else {
            const isWE = [0, 6].includes(new Date(viewYear, viewMonth, day).getDay());
            cells.push(isWE ? "WE" : "");
          }
        });
        return cells;
      });

      const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);

      // Largeur colonnes
      ws["!cols"] = [{ wch: 28 }, { wch: 12 }, ...days.map(() => ({ wch: 8 }))];

      // Style cellule titre (ligne 1 en gras via sheetFormatPr n'est pas dispo directement,
      // on utilise la propriété '!rows' pour la hauteur et on marque le titre)
      ws["!rows"] = [{ hpt: 36 }];

      XLSX.utils.book_append_sheet(wb, ws, `Planning ${MOIS_LONG[viewMonth]} ${viewYear}`);
    } else {
      // Vue annuelle : Collaborateur | Matricule | Jan | … | Déc | Total
      const headers = ["Collaborateur", "Matricule", ...MOIS_LONG, "Total jours"];
      const rows = collabsAnnuel.map(collab => {
        const totalParMois = Array.from({ length: 12 }, (_, m) => {
          const moisDem = getDemandeMois(collab.id, m);
          return moisDem.reduce((acc: number, d: any) => acc + Number(d.nbr_jours_decomptes || 0), 0);
        });
        const total = totalParMois.reduce((a, b) => a + b, 0);
        return [
          `${collab.nom} ${collab.prenom}`,
          collab.matricule,
          ...totalParMois.map(j => (j > 0 ? j : "")),
          total > 0 ? total : "",
        ];
      });

      const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
      ws["!cols"] = [{ wch: 28 }, { wch: 12 }, ...Array(12).fill({ wch: 10 }), { wch: 12 }];
      XLSX.utils.book_append_sheet(wb, ws, `Planning Annuel ${viewYear}`);

      // Feuille détail : une ligne par demande
      const detailHeaders = ["Collaborateur", "Matricule", "Type de congé", "Début", "Fin", "Date retour", "Jours cal.", "Jours décomp.", "Statut"];
      const detailRows = (demandes as any[]).map(d => [
        `${d.collaborateurs?.nom} ${d.collaborateurs?.prenom}`,
        d.collaborateurs?.matricule || "",
        getTypeLibelle(d.code_type_conge),
        d.date_debut,
        d.date_fin_absence,
        d.date_retour,
        d.nbr_jours_calendaires ?? "",
        d.nbr_jours_decomptes ?? "",
        d.statut,
      ]);
      const wsDetail = XLSX.utils.aoa_to_sheet([detailHeaders, ...detailRows]);
      wsDetail["!cols"] = [{ wch: 28 }, { wch: 12 }, { wch: 24 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 14 }];
      XLSX.utils.book_append_sheet(wb, wsDetail, "Détail demandes");
    }

    const filename = viewMode === "mois"
      ? `Planning_${MOIS_LONG[viewMonth]}_${viewYear}.xlsx`
      : `Planning_Annuel_${viewYear}.xlsx`;
    XLSX.writeFile(wb, filename);
  };

  return (
    <div className="p-6 space-y-6">
      {/* En-tête */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "hsl(var(--foreground))" }}>
            <CalendarDays className="inline mr-2 mb-1" size={22} />Planning des Congés
          </h1>
          <p className="text-sm mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>
            Vue calendaire mensuelle ou annuelle des absences
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant={viewMode === "mois" ? "default" : "outline"} size="sm"
            onClick={() => setViewMode("mois")}>Vue mensuelle</Button>
          <Button variant={viewMode === "annuel" ? "default" : "outline"} size="sm"
            onClick={() => setViewMode("annuel")}>Vue annuelle</Button>
          <Button variant="outline" size="sm" onClick={exportExcel} disabled={isLoading}>
            <Download size={14} /> Exporter Excel
          </Button>
        </div>
      </div>

      {/* Navigation et filtres */}
      <Card>
        <CardContent className="p-4 flex gap-3 flex-wrap items-center">
          {viewMode === "mois" ? (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={prevMonth}><ChevronLeft size={14} /></Button>
              <span className="font-semibold w-36 text-center" style={{ color: "hsl(var(--foreground))" }}>
                {MOIS_LONG[viewMonth]} {viewYear}
              </span>
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={nextMonth}><ChevronRight size={14} /></Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setViewYear(y => y - 1)}><ChevronLeft size={14} /></Button>
              <span className="font-semibold w-16 text-center">{viewYear}</span>
              <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setViewYear(y => y + 1)}><ChevronRight size={14} /></Button>
            </div>
          )}
          <div className="relative flex-1 min-w-40">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "hsl(var(--muted-foreground))" }} />
            <Input placeholder="Rechercher…" className="pl-9 h-8" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <MultiSelectFilter
            label="Tous les types"
            width="w-48"
            options={(typesConge as any[]).map((t: any) => ({ value: t.code, label: t.libelle }))}
            selected={filterTypes}
            onChange={setFilterTypes}
          />
          <MultiSelectFilter
            label="Tous statuts"
            width="w-40"
            options={[
              { value: "approuvee", label: "Approuvées" },
              { value: "en_attente", label: "En attente" },
              { value: "brouillon", label: "Brouillons" },
            ]}
            selected={filterStatuts}
            onChange={setFilterStatuts}
          />
        </CardContent>
      </Card>

      {/* Légende : uniquement les types de congé présents dans le planning affiché */}
      {legendeItems.length > 0 && (
        <div className="flex gap-2 flex-wrap items-center">
          {legendeItems.map(({ code, color, libelle }) => (
            <span key={code} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold"
              style={{ background: `${color}18`, color, border: `1.5px solid ${color}50` }}>
              <span className="w-2.5 h-2.5 rounded-full inline-block flex-shrink-0" style={{ background: color }}></span>
              {libelle}
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold"
            style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>
            <span className="w-2.5 h-2.5 rounded-sm inline-block flex-shrink-0"
              style={{ border: "1.5px dashed hsl(var(--muted-foreground))", background: "transparent" }}></span>
            En attente de validation
          </span>
        </div>
      )}

      {isLoading && (
        <Card><CardContent className="p-8 text-center" style={{ color: "hsl(var(--muted-foreground))" }}>Chargement du planning…</CardContent></Card>
      )}

      {/* ─── Vue Mensuelle ─── */}
      {!isLoading && viewMode === "mois" && (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            {collabsInMonth.length === 0 ? (
              <div className="p-8 text-center" style={{ color: "hsl(var(--muted-foreground))" }}>
                Aucune absence ce mois-ci
              </div>
            ) : (
              <table className="w-full text-xs border-collapse min-w-max">
                <thead>
                  <tr style={{ background: "hsl(var(--muted))" }}>
                    <th className="text-left p-2 font-medium sticky left-0 z-10 min-w-40"
                      style={{ background: "hsl(var(--muted))", borderRight: "1px solid hsl(var(--border))" }}>
                      Collaborateur
                    </th>
                    {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(day => (
                      <th key={day}
                        className="p-1 text-center font-medium w-7"
                        style={{
                          background: isToday(day) ? "hsl(var(--primary)/0.15)" : isWeekend(day) ? "hsl(var(--muted)/0.5)" : "hsl(var(--muted))",
                          color: isWeekend(day) ? "hsl(var(--muted-foreground))" : "hsl(var(--foreground))",
                          borderLeft: "1px solid hsl(var(--border))",
                        }}>
                        <div>{day}</div>
                        <div style={{ color: "hsl(var(--muted-foreground))", fontWeight: 400 }}>
                          {["D", "L", "M", "M", "J", "V", "S"][new Date(viewYear, viewMonth, day).getDay()]}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {collabsInMonth.map((collab, idx) => (
                    <tr key={collab.id} style={{ background: idx % 2 === 0 ? "hsl(var(--background))" : "hsl(var(--muted)/0.2)" }}>
                      <td className="p-2 sticky left-0 z-10 font-medium"
                        style={{ background: idx % 2 === 0 ? "hsl(var(--background))" : "hsl(var(--muted)/0.2)", borderRight: "1px solid hsl(var(--border))" }}>
                        <div>{collab.nom} {collab.prenom}</div>
                        <div style={{ color: "hsl(var(--muted-foreground))", fontWeight: 400 }}>{collab.matricule}</div>
                      </td>
                      {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(day => {
                        const absences = isAbsent(collab.id, day);
                        const isWE = isWeekend(day);
                        const first = absences[0];
                        const pending = first ? estEnAttente(first) : false;
                        return (
                          <td key={day} className="p-0 text-center h-10"
                            style={{ borderLeft: "1px solid hsl(var(--border)/0.5)", background: isWE ? "hsl(var(--muted)/0.3)" : undefined }}
                            title={absences.map(a => `${getTypeLibelle(a.code_type_conge)}${estEnAttente(a) ? " (en attente)" : ""}`).join(", ")}>
                            {absences.length > 0 && (
                              <div className="w-full h-full flex items-center justify-center">
                                <div className="w-5 h-5 rounded-sm"
                                  style={pending
                                    ? { background: `${typeColorMap[first.code_type_conge] || "hsl(var(--primary))"}30`, border: `1.5px dashed ${typeColorMap[first.code_type_conge] || "hsl(var(--primary))"}` }
                                    : { background: typeColorMap[first.code_type_conge] || "hsl(var(--primary))" }} />
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      )}

      {/* ─── Vue Annuelle ─── */}
      {!isLoading && viewMode === "annuel" && (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            {collabsAnnuel.length === 0 ? (
              <div className="p-8 text-center" style={{ color: "hsl(var(--muted-foreground))" }}>
                Aucune absence cette année
              </div>
            ) : (
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr style={{ background: "hsl(var(--muted))" }}>
                    <th className="text-left p-3 font-medium sticky left-0 z-10 min-w-48"
                      style={{ background: "hsl(var(--muted))", borderRight: "1px solid hsl(var(--border))" }}>
                      Collaborateur
                    </th>
                    {MOIS_FR.map((m, i) => (
                      <th key={i} className="p-2 text-center font-medium"
                        style={{ borderLeft: "1px solid hsl(var(--border))", minWidth: 60,
                          background: i === now.getMonth() && viewYear === now.getFullYear() ? "hsl(var(--primary)/0.1)" : undefined }}>
                        {m}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {collabsAnnuel.map((collab, idx) => (
                    <tr key={collab.id} style={{ background: idx % 2 === 0 ? "hsl(var(--background))" : "hsl(var(--muted)/0.2)" }}>
                      <td className="p-2 sticky left-0 z-10"
                        style={{ background: idx % 2 === 0 ? "hsl(var(--background))" : "hsl(var(--muted)/0.2)", borderRight: "1px solid hsl(var(--border))" }}>
                        <div className="font-medium">{collab.nom} {collab.prenom}</div>
                        <div style={{ color: "hsl(var(--muted-foreground))" }}>{collab.matricule}</div>
                      </td>
                      {Array.from({ length: 12 }, (_, m) => {
                        const moisDemandes = getDemandeMois(collab.id, m);
                        const moisStartIso = `${viewYear}-${String(m + 1).padStart(2, "0")}-01`;
                        const moisEndIso = new Date(viewYear, m + 1, 0).toISOString().split("T")[0];
                        // RG-CONGE-PERIODE-MOIS-01 (30/07/2026) : un congé à cheval sur
                        // deux mois affichait à tort son TOTAL complet dans CHAQUE mois
                        // traversé (ex. un congé de 5j apparaissait "5j" en mai ET "5j" en
                        // juin). On calcule ici la vraie portion du mois, comme pour la
                        // récupération de paie (joursDansPeriode / RecuperationModulesPage).
                        const joursPortionMois = (d: any) => joursDansIntervalle(d, moisStartIso, moisEndIso);
                        const calPortionMois = (d: any) => {
                          const finAbsence = d.date_fin_absence ?? d.date_retour ?? d.date_debut;
                          const debutEff = d.date_debut > moisStartIso ? d.date_debut : moisStartIso;
                          const finEff = finAbsence < moisEndIso ? finAbsence : moisEndIso;
                          if (debutEff > finEff) return 0;
                          return calcJoursAvecType(debutEff, finEff, "", "", null, feriesSet).cal;
                        };
                        return (
                          <td key={m} className="p-1 text-center" style={{ borderLeft: "1px solid hsl(var(--border)/0.5)", minWidth: 70 }}>
                            {moisDemandes.length > 0 && (
                              <div className="flex flex-col gap-1 items-center">
                                {moisDemandes.slice(0, 2).map((d: any, di: number) => {
                                  const droits = joursPortionMois(d);
                                  const cal = calPortionMois(d);
                                  const totalDroits = Number(d.nbr_jours_decomptes ?? 0);
                                  const chevauche = droits > 0 && totalDroits > 0 && Math.abs(droits - totalDroits) > 0.01;
                                  const color = typeColorMap[d.code_type_conge] || "hsl(var(--primary))";
                                  const pending = estEnAttente(d);
                                  return (
                                    <div key={di}
                                      className="w-full px-1.5 py-1 rounded font-medium"
                                      style={pending
                                        ? { background: `${color}22`, border: `1.5px dashed ${color}`, color, fontSize: "calc(10px * var(--font-scale))" }
                                        : { background: color, color: "white", fontSize: "calc(10px * var(--font-scale))" }}
                                      title={`${getTypeLibelle(d.code_type_conge)}${pending ? " — en attente de validation" : ""} — ${droits}j${chevauche ? ` sur ce mois / ${totalDroits}j au total` : " (droits)"}${cal ? ` / ${cal}j cal.` : ""}`}>
                                      <div style={{ opacity: 0.85, fontSize: "calc(9px * var(--font-scale))", fontWeight: 400 }}>
                                        {getTypeLibelle(d.code_type_conge)}{pending ? " ⏳" : ""}{chevauche ? " ↔" : ""}
                                      </div>
                                      <div className="font-bold" style={{ fontSize: "calc(11px * var(--font-scale))" }}>
                                        {droits > 0 ? `${droits}j` : "—"}
                                        <span style={{ opacity: 0.75, fontWeight: 400 }}> / {cal > 0 ? `${cal}j` : "—"}</span>
                                      </div>
                                    </div>
                                  );
                                })}
                                {moisDemandes.length > 2 && (
                                  <div className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>+{moisDemandes.length - 2}</div>
                                )}
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
