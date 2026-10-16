import React, { useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useManagerPopulation } from "@/hooks/useManagerPopulation";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Search, TrendingUp, AlertTriangle, BarChart3,
  RefreshCw, ArrowUpDown, ArrowUp, ArrowDown, Download,
} from "lucide-react";
import * as XLSX from "xlsx";

const EXERCICE_COURANT = new Date().getFullYear();

interface SoldeItem {
  id: string;
  collaborateur_id: string;
  code_type_conge: string;
  exercice: number;
  solde_acquis: number;
  solde_pris: number;
  solde_en_attente: number;
  reliquat_reporte: number;
  solde_restant: number;
  collaborateurs?: { nom: string; prenom: string; matricule: string; statut_collaborateur: string };
}

interface DrillDown {
  solde: SoldeItem;
  typeLibelle: string;
}

export default function SuiviCongesPage() {
  const { role } = useAuth();
  const isManager = role === "manager";
  const { collaborateurIds: managerCollabIds, loading: popLoading } = useManagerPopulation();

  const [search, setSearch] = useState("");
  const [filterExercice, setFilterExercice] = useState(String(EXERCICE_COURANT));
  const [filterType, setFilterType] = useState("ALL");
  const [drillDown, setDrillDown] = useState<DrillDown | null>(null);

  const exercices = Array.from({ length: 5 }, (_, i) => String(EXERCICE_COURANT - 2 + i));

  const { data: typesConge = [] } = useQuery({
    queryKey: ["ref-type-conge-actifs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ref_type_conge" as never)
        .select("code, libelle, code_famille")
        .eq("actif" as never, true as never)
        .order("libelle" as never) as any;
      if (error) throw error;
      return data || [];
    },
  });

  // ── États tri ──────────────────────────────────────────────────────────
  type SortDir = "asc" | "desc";
  const [soldeSortCol, setSoldeSortCol] = useState("nom");
  const [soldeSortDir, setSoldeSortDir] = useState<SortDir>("asc");
  const [consoSortCol, setConsoSortCol] = useState("date_debut");
  const [consoSortDir, setConsoSortDir] = useState<SortDir>("desc");
  const [relSortCol, setRelSortCol]     = useState("date_butoir");
  const [relSortDir, setRelSortDir]     = useState<SortDir>("asc");

  const toggleSort = (col: string, cur: string, dir: SortDir, setCol: (c:string)=>void, setDir:(d:SortDir)=>void) => {
    if (cur === col) setDir(dir === "asc" ? "desc" : "asc");
    else { setCol(col); setDir("asc"); }
  };
  const SortIcon = ({ col, cur, dir }: { col:string; cur:string; dir:SortDir }) =>
    cur !== col ? <ArrowUpDown size={11} className="ml-1 opacity-30" /> :
    dir === "asc" ? <ArrowUp size={11} className="ml-1 text-accent" /> :
    <ArrowDown size={11} className="ml-1 text-accent" />;

  const cmpStr = (a:string, b:string, d:SortDir) => d==="asc" ? a.localeCompare(b,"fr") : b.localeCompare(a,"fr");
  const cmpNum = (a:number, b:number, d:SortDir) => d==="asc" ? a-b : b-a;

  const { data: soldes = [], isLoading: soldesLoading } = useQuery({
    queryKey: ["cong-suivi-soldes", filterExercice, filterType, search, managerCollabIds, isManager],
    enabled: !isManager || !popLoading,
    queryFn: async () => {
      let q = supabase
        .from("cong_solde")
        .select("*, collaborateurs(nom, prenom, matricule, statut_collaborateur)")
        .eq("exercice", Number(filterExercice))
        .eq("archive", false);
      if (filterType !== "ALL") q = q.eq("code_type_conge", filterType);
      if (isManager) {
        if (managerCollabIds.length === 0) return [];
        q = q.in("collaborateur_id", managerCollabIds);
      }
      const { data, error } = await q.order("collaborateur_id");
      if (error) throw error;
      return (data || []).filter((s: any) => {
        if (!search) return true;
        const c = s.collaborateurs;
        const t = search.toLowerCase();
        return c?.nom?.toLowerCase().includes(t) || c?.prenom?.toLowerCase().includes(t) || c?.matricule?.toLowerCase().includes(t);
      });
    },
  });

  const { data: reliquats = [], isLoading: reliquatsLoading } = useQuery({
    queryKey: ["cong-reliquats", filterExercice, managerCollabIds, isManager],
    enabled: !isManager || !popLoading,
    queryFn: async () => {
      let q = supabase
        .from("cong_reliquat")
        .select("*, collaborateurs(nom, prenom, matricule)")
        .eq("exercice_report", Number(filterExercice))
        .eq("archive", false)
        .order("date_butoir");
      if (isManager) {
        if (managerCollabIds.length === 0) return [];
        q = q.in("collaborateur_id", managerCollabIds);
      }
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
  });

  const { data: consommations = [], isLoading: consoLoading } = useQuery({
    queryKey: ["cong-consommations-suivi", filterExercice, filterType, search, managerCollabIds, isManager],
    enabled: !isManager || !popLoading,
    queryFn: async () => {
      let q = supabase
        .from("cong_consommation")
        .select("*, collaborateurs(nom, prenom, matricule)")
        .eq("exercice", Number(filterExercice))
        .eq("est_annulee", false)
        .eq("archive", false);
      if (filterType !== "ALL") q = q.eq("code_type_conge", filterType);
      if (isManager) {
        if (managerCollabIds.length === 0) return [];
        q = q.in("collaborateur_id", managerCollabIds);
      }
      const { data, error } = await q.order("date_debut", { ascending: false });
      if (error) throw error;
      return (data || []).filter((c: any) => {
        if (!search) return true;
        const col = c.collaborateurs;
        const t = search.toLowerCase();
        return col?.nom?.toLowerCase().includes(t) || col?.prenom?.toLowerCase().includes(t) || col?.matricule?.toLowerCase().includes(t);
      });
    },
  });

  // Drill-down : demandes liées à un compteur spécifique
  const { data: drillDemandes = [], isLoading: drillLoading } = useQuery({
    queryKey: ["cong-drill-demandes", drillDown?.solde.collaborateur_id, drillDown?.solde.code_type_conge, drillDown?.solde.exercice],
    enabled: !!drillDown,
    queryFn: async () => {
      if (!drillDown) return [];
      const data = []; const error = null; // Supabase desactive
      if (error) throw error;
      return data || [];
    },
  });

  const getTypeLibelle = (code: string) => (typesConge as any[]).find(t => t.code === code)?.libelle || code;

  // ── Données triées ─────────────────────────────────────────────────────
  const soldesSorted = useMemo(() => [...(soldes as any[])].sort((a,b) => {
    switch(soldeSortCol) {
      case "nom":     return cmpStr(`${a.collaborateurs?.nom}${a.collaborateurs?.prenom}`,`${b.collaborateurs?.nom}${b.collaborateurs?.prenom}`, soldeSortDir);
      case "type":    return cmpStr(getTypeLibelle(a.code_type_conge), getTypeLibelle(b.code_type_conge), soldeSortDir);
      case "acquis":  return cmpNum(Number(a.solde_acquis), Number(b.solde_acquis), soldeSortDir);
      case "pris":    return cmpNum(Number(a.solde_pris), Number(b.solde_pris), soldeSortDir);
      case "attente": return cmpNum(Number(a.solde_en_attente), Number(b.solde_en_attente), soldeSortDir);
      case "reliquat":return cmpNum(Number(a.reliquat_reporte), Number(b.reliquat_reporte), soldeSortDir);
      case "restant": return cmpNum(Number(a.solde_restant), Number(b.solde_restant), soldeSortDir);
      default: return 0;
    }
  }), [soldes, soldeSortCol, soldeSortDir, typesConge]);

  const consoSorted = useMemo(() => [...(consommations as any[])].sort((a,b) => {
    switch(consoSortCol) {
      case "nom":     return cmpStr(`${a.collaborateurs?.nom}${a.collaborateurs?.prenom}`,`${b.collaborateurs?.nom}${b.collaborateurs?.prenom}`, consoSortDir);
      case "type":    return cmpStr(getTypeLibelle(a.code_type_conge), getTypeLibelle(b.code_type_conge), consoSortDir);
      case "date_debut": return cmpStr(a.date_debut, b.date_debut, consoSortDir);
      case "jours":   return cmpNum(Number(a.nbr_jours_decomptes), Number(b.nbr_jours_decomptes), consoSortDir);
      default: return 0;
    }
  }), [consommations, consoSortCol, consoSortDir, typesConge]);

  const relSorted = useMemo(() => [...(reliquats as any[])].sort((a,b) => {
    switch(relSortCol) {
      case "nom":      return cmpStr(`${a.collaborateurs?.nom}${a.collaborateurs?.prenom}`,`${b.collaborateurs?.nom}${b.collaborateurs?.prenom}`, relSortDir);
      case "date_butoir": return cmpStr(a.date_butoir||"", b.date_butoir||"", relSortDir);
      case "jours":    return cmpNum(Number(a.jours_reliquat||0)-Number(a.jours_consommes||0), Number(b.jours_reliquat||0)-Number(b.jours_consommes||0), relSortDir);
      default: return 0;
    }
  }), [reliquats, relSortCol, relSortDir]);

  // ── Exports Excel ──────────────────────────────────────────────────────
  const exportSoldes = () => {
    const rows = soldesSorted.map((s:any) => ({
      "Matricule":        s.collaborateurs?.matricule || "",
      "Nom":              s.collaborateurs?.nom || "",
      "Prénom":           s.collaborateurs?.prenom || "",
      "Type de congé":    getTypeLibelle(s.code_type_conge),
      "Exercice":         s.exercice,
      "Acquis":           Number(s.solde_acquis),
      "Pris":             Number(s.solde_pris),
      "En attente":       Number(s.solde_en_attente),
      "Reliquat":         Number(s.reliquat_reporte),
      "Solde restant":    Number(s.solde_restant),
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Soldes");
    XLSX.writeFile(wb, `soldes_conges_${filterExercice}.xlsx`);
  };

  const exportConsommations = () => {
    const rows = consoSorted.map((c:any) => ({
      "Matricule":        c.collaborateurs?.matricule || "",
      "Nom":              c.collaborateurs?.nom || "",
      "Prénom":           c.collaborateurs?.prenom || "",
      "Type de congé":    getTypeLibelle(c.code_type_conge),
      "Date début":       new Date(c.date_debut).toLocaleDateString("fr-FR"),
      "Date retour":      c.date_retour ? new Date(c.date_retour).toLocaleDateString("fr-FR") : "",
      "Jours calendaires":Number(c.nbr_jours_calendaires),
      "Jours déduits":    Number(c.nbr_jours_decomptes),
      "Statut":           c.est_annulee ? "Annulée" : "Validée",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Consommations");
    XLSX.writeFile(wb, `consommations_conges_${filterExercice}.xlsx`);
  };

  const exportReliquats = () => {
    const rows = relSorted.map((r:any) => ({
      "Matricule":        r.collaborateurs?.matricule || "",
      "Nom":              r.collaborateurs?.nom || "",
      "Prénom":           r.collaborateurs?.prenom || "",
      "Type de congé":    getTypeLibelle(r.code_type_conge),
      "Jours reliquat":   Number(r.jours_reliquat || 0),
      "Jours consommés":  Number(r.jours_consommes || 0),
      "Solde restant":    Number(r.jours_reliquat||0) - Number(r.jours_consommes||0),
      "Date butoir":      r.date_butoir ? new Date(r.date_butoir).toLocaleDateString("fr-FR") : "",
      "Statut":           r.statut,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Reliquats");
    XLSX.writeFile(wb, `reliquats_conges_${filterExercice}.xlsx`);
  };

  const totalCollabs = new Set(soldes.map((s: any) => s.collaborateur_id)).size;
  const soldeMoyen = soldes.length ? (soldes.reduce((acc: number, s: any) => acc + Number(s.solde_restant), 0) / soldes.length).toFixed(1) : "0";
  const reliquatsActifs = reliquats.filter((r: any) => r.statut === "ACTIF").length;
  const reliquatsExpires = reliquats.filter((r: any) => {
    const b = new Date(r.date_butoir);
    return r.statut === "ACTIF" && b <= new Date();
  }).length;

  const getReliquatColor = (r: any) => {
    const daysLeft = Math.ceil((new Date(r.date_butoir).getTime() - Date.now()) / 86400000);
    if (daysLeft < 0) return "hsl(0 72% 51%)";
    if (daysLeft < 30) return "hsl(38 92% 50%)";
    return "hsl(142 71% 45%)";
  };

  const getStatutDemandeColor = (statut: string) => {
    switch (statut) {
      case "APPROUVEE": return { bg: "hsl(142 71% 45%/0.1)", color: "hsl(142 71% 45%)" };
      case "EN_ATTENTE": return { bg: "hsl(38 92% 50%/0.1)", color: "hsl(38 92% 50%)" };
      case "BROUILLON": return { bg: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" };
      case "REFUSEE": return { bg: "hsl(0 72% 51%/0.1)", color: "hsl(0 72% 51%)" };
      case "ANNULEE": return { bg: "hsl(0 72% 51%/0.1)", color: "hsl(0 72% 51%)" };
      default: return { bg: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" };
    }
  };

  return (
    <TooltipProvider>
    <div className="max-w-6xl mx-auto">
      {/* Fil d'Ariane */}
      <div className="flex items-center gap-1.5 px-6 pt-4 pb-2 text-[13px]" style={{ color: "hsl(var(--muted-foreground))" }}>
        <span>Absences</span>
        <span style={{ opacity: 0.5 }}>/</span>
        <span className="font-semibold" style={{ color: "hsl(var(--foreground))" }}>Suivi des Congés</span>
      </div>

      <div className="p-6 space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Collaborateurs suivis",      value: totalCollabs,       icon: <BarChart3 size={18} />,     token: "primary" },
          { label: "Solde moyen restant",         value: `${soldeMoyen} j`,  icon: <TrendingUp size={18} />,    token: "success" },
          { label: "Reliquats actifs",            value: reliquatsActifs,    icon: <RefreshCw size={18} />,     token: "warning" },
          { label: "Reliquats expirés/à risque",  value: reliquatsExpires,   icon: <AlertTriangle size={18} />, token: "destructive" },
        ].map(k => (
          <Card key={k.label}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg" style={{ background: `hsl(var(--${k.token}) / 0.12)`, color: `hsl(var(--${k.token}))` }}>{k.icon}</div>
              <div>
                <p className="text-2xl font-bold" style={{ color: "hsl(var(--foreground))" }}>{k.value}</p>
                <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>{k.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filtres */}
      <Card>
        <CardContent className="p-4 flex gap-3 flex-wrap items-center">
          <div className="relative flex-1 min-w-48">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "hsl(var(--muted-foreground))" }} />
            <Input placeholder="Rechercher un collaborateur…" className="pl-9" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <Select value={filterExercice} onValueChange={setFilterExercice}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>{exercices.map(e => <SelectItem key={e} value={e}>{e}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="w-52"><SelectValue placeholder="Tous les types" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Tous les types</SelectItem>
              {(typesConge as any[]).map((t: any) => <SelectItem key={t.code} value={t.code}>{t.libelle}</SelectItem>)}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Tabs defaultValue="soldes">
        <TabsList>
          <TabsTrigger value="soldes">Soldes ({soldes.length})</TabsTrigger>
          <TabsTrigger value="reliquats">Reliquats ({reliquats.length})</TabsTrigger>
          <TabsTrigger value="consommations">Historique ({consommations.length})</TabsTrigger>
        </TabsList>

        {/* ─── Soldes ─── */}
        <TabsContent value="soldes">
          <Card>
            <div className="flex items-center justify-between px-4 py-2 border-b" style={{ borderColor: "hsl(var(--border))" }}>
              <span className="text-sm font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>
                {soldesSorted.length} ligne(s)
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="sm" variant="outline" onClick={exportSoldes} className="gap-1.5">
                    <Download size={14} /> Excel
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Exporter les soldes en Excel</TooltipContent>
              </Tooltip>
            </div>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    {[
                      { col: "nom",     label: "Collaborateur" },
                      { col: "type",    label: "Type" },
                      { col: "acquis",  label: "Acquis",   right: true },
                      { col: "pris",    label: "Pris",     right: true },
                      { col: "attente", label: "En attente", right: true },
                      { col: "reliquat",label: "Reliquat", right: true },
                      { col: "restant", label: "Restant",  right: true },
                    ].map(({ col, label, right }) => (
                      <TableHead key={col} className={`cursor-pointer select-none hover:bg-muted/40 ${right ? "text-right" : ""}`}
                        onClick={() => toggleSort(col, soldeSortCol, soldeSortDir, setSoldeSortCol, setSoldeSortDir)}>
                        <span className="inline-flex items-center gap-1">
                          {label}<SortIcon col={col} cur={soldeSortCol} dir={soldeSortDir} />
                        </span>
                      </TableHead>
                    ))}
                    <TableHead className="min-w-28">Progression</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {soldesLoading && <TableRow><TableCell colSpan={9} className="text-center py-8">Chargement…</TableCell></TableRow>}
                  {!soldesLoading && soldesSorted.length === 0 && (
                    <TableRow><TableCell colSpan={9} className="text-center py-8" style={{ color: "hsl(var(--muted-foreground))" }}>Aucun solde</TableCell></TableRow>
                  )}
                  {soldesSorted.map((s: any) => {
                    const total = Number(s.solde_acquis) + Number(s.reliquat_reporte);
                    const pct = total > 0 ? Math.min(100, Math.round((Number(s.solde_pris) / total) * 100)) : 0;
                    const restant = Number(s.solde_restant);
                    const restantColor = restant < 0 ? "hsl(0 72% 51%)" : restant < 3 ? "hsl(38 92% 50%)" : "hsl(142 71% 45%)";
                    return (
                      <TableRow key={s.id} className="hover:bg-muted/30 cursor-pointer"
                        onClick={() => setDrillDown({ solde: s, typeLibelle: getTypeLibelle(s.code_type_conge) })}>
                        <TableCell>
                          <div className="font-medium">{s.collaborateurs?.nom} {s.collaborateurs?.prenom}</div>
                          <div className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>{s.collaborateurs?.matricule}</div>
                        </TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">{getTypeLibelle(s.code_type_conge)}</Badge></TableCell>
                        <TableCell className="text-right">{Number(s.solde_acquis).toFixed(1)}</TableCell>
                        <TableCell className="text-right">{Number(s.solde_pris).toFixed(1)}</TableCell>
                        <TableCell className="text-right">
                          {Number(s.solde_en_attente) > 0 ? <span style={{ color: "hsl(38 92% 50%)" }}>{Number(s.solde_en_attente).toFixed(1)}</span> : "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          {Number(s.reliquat_reporte) > 0 ? <span style={{ color: "hsl(var(--primary))" }}>{Number(s.reliquat_reporte).toFixed(1)}</span> : "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          <span className="font-bold" style={{ color: restantColor }}>{restant.toFixed(1)}</span>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "hsl(var(--muted))" }}>
                              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: restantColor }} />
                            </div>
                            <span className="text-xs w-8" style={{ color: "hsl(var(--muted-foreground))" }}>{pct}%</span>
                          </div>
                        </TableCell>
                        <TableCell onClick={e => e.stopPropagation()}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-7 w-7"
                                onClick={() => setDrillDown({ solde: s, typeLibelle: getTypeLibelle(s.code_type_conge) })}>
                                <BarChart3 size={13} />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Voir le détail</TooltipContent>
                          </Tooltip>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Reliquats ─── */}
        <TabsContent value="reliquats">
          <Card>
            <div className="flex items-center justify-between px-4 py-2 border-b" style={{ borderColor: "hsl(var(--border))" }}>
              <span className="text-sm font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>
                {relSorted.length} ligne(s)
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="sm" variant="outline" onClick={exportReliquats} className="gap-1.5">
                    <Download size={14} /> Excel
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Exporter les reliquats en Excel</TooltipContent>
              </Tooltip>
            </div>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    {[
                      { col: "nom",         label: "Collaborateur" },
                      { col: "type",        label: "Type" },
                      { col: "jours",       label: "Solde reliquat", right: true },
                      { col: "date_butoir", label: "Date butoir" },
                    ].map(({ col, label, right }) => (
                      <TableHead key={col} className={`cursor-pointer select-none hover:bg-muted/40 ${right ? "text-right" : ""}`}
                        onClick={() => toggleSort(col, relSortCol, relSortDir, setRelSortCol, setRelSortDir)}>
                        <span className="inline-flex items-center gap-1">
                          {label}<SortIcon col={col} cur={relSortCol} dir={relSortDir} />
                        </span>
                      </TableHead>
                    ))}
                    <TableHead>Statut</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reliquatsLoading && <TableRow><TableCell colSpan={5} className="text-center py-8">Chargement…</TableCell></TableRow>}
                  {!reliquatsLoading && relSorted.length === 0 && (
                    <TableRow><TableCell colSpan={5} className="text-center py-8" style={{ color: "hsl(var(--muted-foreground))" }}>Aucun reliquat</TableCell></TableRow>
                  )}
                  {relSorted.map((r: any) => {
                    const soldeRel = Number(r.jours_reliquat || 0) - Number(r.jours_consommes || 0);
                    const color = getReliquatColor(r);
                    return (
                      <TableRow key={r.id} className="hover:bg-muted/30">
                        <TableCell>
                          <div className="font-medium">{r.collaborateurs?.nom} {r.collaborateurs?.prenom}</div>
                          <div className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>{r.collaborateurs?.matricule}</div>
                        </TableCell>
                        <TableCell><Badge variant="outline" className="text-xs">{getTypeLibelle(r.code_type_conge)}</Badge></TableCell>
                        <TableCell className="text-right">
                          <span className="font-bold" style={{ color }}>{soldeRel.toFixed(1)} j</span>
                        </TableCell>
                        <TableCell>
                          {r.date_butoir ? (
                            <span className="text-sm" style={{ color }}>
                              {new Date(r.date_butoir).toLocaleDateString("fr-FR")}
                            </span>
                          ) : "—"}
                        </TableCell>
                        <TableCell>
                          <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: `${color}20`, color }}>
                            {r.statut}
                          </span>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Historique consommations ─── */}
        <TabsContent value="consommations">
          <Card>
            <div className="flex items-center justify-between px-4 py-2 border-b" style={{ borderColor: "hsl(var(--border))" }}>
              <span className="text-sm font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>
                {consoSorted.length} ligne(s)
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="sm" variant="outline" onClick={exportConsommations} className="gap-1.5">
                    <Download size={14} /> Excel
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Exporter l'historique en Excel</TooltipContent>
              </Tooltip>
            </div>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    {[
                      { col: "nom",        label: "Collaborateur" },
                      { col: "type",       label: "Type" },
                      { col: "date_debut", label: "Début absence" },
                    ].map(({ col, label }) => (
                      <TableHead key={col} className="cursor-pointer select-none hover:bg-muted/40"
                        onClick={() => toggleSort(col, consoSortCol, consoSortDir, setConsoSortCol, setConsoSortDir)}>
                        <span className="inline-flex items-center gap-1">
                          {label}<SortIcon col={col} cur={consoSortCol} dir={consoSortDir} />
                        </span>
                      </TableHead>
                    ))}
                    <TableHead>Retour</TableHead>
                    <TableHead className="text-right cursor-pointer select-none hover:bg-muted/40"
                      onClick={() => toggleSort("jours", consoSortCol, consoSortDir, setConsoSortCol, setConsoSortDir)}>
                      <span className="inline-flex items-center gap-1 justify-end">
                        J. déduits<SortIcon col="jours" cur={consoSortCol} dir={consoSortDir} />
                      </span>
                    </TableHead>
                    <TableHead className="text-right">J. cal.</TableHead>
                    <TableHead>Statut</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {consoLoading && <TableRow><TableCell colSpan={7} className="text-center py-8">Chargement…</TableCell></TableRow>}
                  {!consoLoading && consoSorted.length === 0 && (
                    <TableRow><TableCell colSpan={7} className="text-center py-8" style={{ color: "hsl(var(--muted-foreground))" }}>Aucune consommation</TableCell></TableRow>
                  )}
                  {consoSorted.map((c: any) => (
                    <TableRow key={c.id} className="hover:bg-muted/30">
                      <TableCell>
                        <div className="font-medium">{c.collaborateurs?.nom} {c.collaborateurs?.prenom}</div>
                        <div className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>{c.collaborateurs?.matricule}</div>
                      </TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">{getTypeLibelle(c.code_type_conge)}</Badge></TableCell>
                      <TableCell>{new Date(c.date_debut).toLocaleDateString("fr-FR")}</TableCell>
                      <TableCell>{c.date_retour ? new Date(c.date_retour).toLocaleDateString("fr-FR") : "—"}</TableCell>
                      <TableCell className="text-right font-bold">{Number(c.nbr_jours_decomptes).toFixed(1)}</TableCell>
                      <TableCell className="text-right">{Number(c.nbr_jours_calendaires).toFixed(1)}</TableCell>
                      <TableCell>
                        {c.est_annulee
                          ? <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "hsl(0 72% 51%/0.1)", color: "hsl(0 72% 51%)" }}>Annulée</span>
                          : <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: "hsl(142 71% 45%/0.1)", color: "hsl(142 71% 45%)" }}>Validée</span>
                        }
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

        {/* ─── Sheet détail demandes par compteur ─── */}
        <Sheet open={!!drillDown} onOpenChange={open => { if (!open) setDrillDown(null); }}>
          <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
            {drillDown && (
              <>
                <SheetHeader className="mb-4">
                  <SheetTitle>
                    Détail — {drillDown.solde.collaborateurs?.prenom} {drillDown.solde.collaborateurs?.nom}
                  </SheetTitle>
                  <div className="flex gap-2 items-center flex-wrap">
                    <Badge variant="outline">{drillDown.typeLibelle}</Badge>
                    <Badge variant="secondary">Exercice {drillDown.solde.exercice}</Badge>
                    <span className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
                      {drillDown.solde.collaborateurs?.matricule}
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-2 mt-3">
                    {[
                      { label: "Acquis",     value: Number(drillDown.solde.solde_acquis).toFixed(1),     color: "hsl(var(--foreground))" },
                      { label: "Pris",       value: Number(drillDown.solde.solde_pris).toFixed(1),       color: "hsl(var(--foreground))" },
                      { label: "En attente", value: Number(drillDown.solde.solde_en_attente).toFixed(1), color: "hsl(38 92% 50%)" },
                      { label: "Restant",    value: Number(drillDown.solde.solde_restant).toFixed(1),
                        color: Number(drillDown.solde.solde_restant) < 0 ? "hsl(0 72% 51%)" : Number(drillDown.solde.solde_restant) < 3 ? "hsl(38 92% 50%)" : "hsl(142 71% 45%)" },
                    ].map(k => (
                      <div key={k.label} className="rounded-lg border p-3 text-center">
                        <p className="text-lg font-bold" style={{ color: k.color }}>{k.value}</p>
                        <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>{k.label}</p>
                      </div>
                    ))}
                  </div>
                </SheetHeader>
                <div className="mt-2">
                  <p className="text-sm font-semibold mb-2">Historique des demandes ({drillDemandes.length})</p>
                  {drillLoading && <p className="text-center py-8 text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>Chargement…</p>}
                  {!drillLoading && drillDemandes.length === 0 && (
                    <p className="text-center py-8 text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>Aucune demande pour ce compteur</p>
                  )}
                  <div className="space-y-2">
                    {(drillDemandes as any[]).map((d: any) => {
                      const sc = getStatutDemandeColor(d.statut);
                      return (
                        <div key={d.id} className="rounded-lg border p-3 flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-medium">
                                {new Date(d.date_debut).toLocaleDateString("fr-FR")} → {d.date_retour ? new Date(d.date_retour).toLocaleDateString("fr-FR") : "—"}
                              </span>
                              <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: sc.bg, color: sc.color }}>
                                {d.statut.replace("_", " ")}
                              </span>
                            </div>
                            <div className="text-xs mt-1 flex gap-4" style={{ color: "hsl(var(--muted-foreground))" }}>
                              <span>{Number(d.nbr_jours_decomptes ?? 0).toFixed(1)} j déduits</span>
                              <span>{Number(d.nbr_jours_calendaires ?? 0).toFixed(1)} j cal.</span>
                              {d.motif_refus && <span style={{ color: "hsl(0 72% 51%)" }}>Motif : {d.motif_refus}</span>}
                            </div>
                          </div>
                          {d.date_validation && (
                            <div className="text-xs text-right shrink-0" style={{ color: "hsl(var(--muted-foreground))" }}>
                              Validé le<br />{new Date(d.date_validation).toLocaleDateString("fr-FR")}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </SheetContent>
        </Sheet>
      </div>
    </div>
    </TooltipProvider>
  );
}
