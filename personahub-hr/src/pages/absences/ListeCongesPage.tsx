/**
 * ListeCongesPage.tsx — « Liste des congés » (filtres avancés + couleurs de types + fiche détail)
 * Auteur : Adil DAIA
 *
 * Périmètre serveur selon rôle actif. Filtres : recherche · famille · type ·
 * statut · UO (arbre récursif) · période. Couleur du type (ref_type_conge.couleur)
 * en pastille dans la liste ET le filtre. Clic ligne → fiche détail complète.
 * Le thème (apparence utilisateur) est respecté via les variables CSS.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  CalendarDays, Download, Search, Loader2, Filter, X, RotateCcw,
  Clock, CheckCircle2, MessageSquare, Paperclip, Repeat, FileStack, User,
} from "lucide-react";
import MultiSelect from "@/components/MultiSelect";
import UoTreePicker from "@/components/UoTreePicker";
import SuiviDemandeWorkflow from "@/pages/espaces/SuiviDemandeWorkflow";

interface Conge {
  id: string; collaborateur_id: string;
  code_type_conge: string; libelle_type_conge?: string; couleur_type?: string; code_famille?: string;
  date_debut: string; date_fin_absence?: string; date_retour?: string; date_reprise_effective?: string;
  debut_demi_journee?: string; fin_demi_journee?: string;
  nbr_jours_calendaires?: number; nbr_jours_decomptes?: number;
  statut: string; motif_refus?: string;
  commentaire_collaborateur?: string; commentaire_gestionnaire?: string;
  est_report_reliquat?: boolean; reconduction_numero?: number; piece_jointe_path?: string;
  date_soumission?: string; date_validation?: string;
  valideur_id?: string;
  demandeur_nom?: string; demandeur_prenom?: string; demandeur_matricule?: string;
  /** RG-CONGE-SOURCE-01 : 'circuit' (cong_demandes) ou 'saisie_directe' (cong_consommation, demande_id null) */
  source?: "circuit" | "saisie_directe";
}
interface TypeConge { code: string; libelle: string; code_famille?: string; couleur?: string; }
interface Famille { code: string; libelle: string; couleur?: string; }

const STATUTS: Record<string, { label: string; bg: string; fg: string }> = {
  brouillon:  { label: "Brouillon",  bg: "hsl(var(--muted))",              fg: "hsl(var(--muted-foreground))" },
  en_attente: { label: "En attente", bg: "hsl(var(--warning) / 0.15)",     fg: "hsl(var(--warning))" },
  approuvee:  { label: "Approuvé",   bg: "hsl(var(--success) / 0.15)",     fg: "hsl(var(--success))" },
  refusee:    { label: "Refusé",     bg: "hsl(var(--destructive) / 0.15)", fg: "hsl(var(--destructive))" },
  annulee:    { label: "Annulé",     bg: "hsl(var(--muted))",              fg: "hsl(var(--muted-foreground))" },
  modifiee:   { label: "Modifié",    bg: "hsl(var(--info) / 0.15)",        fg: "hsl(var(--info))" },
};
const SCOPE_LABEL: Record<string, string> = {
  tous: "Tous les congés", equipe: "Congés de mon effectif", aucun: "Mes congés",
};
const DEMI: Record<string, string> = { matin: "matin", apres_midi: "après-midi", apresmidi: "après-midi", am: "matin", pm: "après-midi" };
const pad = (n: number) => String(n).padStart(2, "0");
const CUR_YEAR = new Date().getFullYear();
const FALLBACK_COLOR = "hsl(var(--primary))";

export default function ListeCongesPage() {
  const { role } = useAuth() as any;
  const annees = useMemo(() => [CUR_YEAR + 1, CUR_YEAR, CUR_YEAR - 1, CUR_YEAR - 2, CUR_YEAR - 3], []);

  const [familles, setFamilles] = useState<Famille[]>([]);
  const [types, setTypes] = useState<TypeConge[]>([]);
  const [conges, setConges] = useState<Conge[]>([]);
  const [scope, setScope] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const [q, setQ] = useState("");
  const [fFamilles, setFFamilles] = useState<string[]>([]);
  const [fTypes, setFTypes] = useState<string[]>([]);
  const [fStatuts, setFStatuts] = useState<string[]>(["approuvee"]);
  const [fUo, setFUo] = useState<string[]>([]);
  const [detail, setDetail] = useState<Conge | null>(null);

  const [mode, setMode] = useState<"annee" | "semestre" | "trimestre" | "perso">("annee");
  const [annee, setAnnee] = useState<number>(CUR_YEAR);
  const [semestre, setSemestre] = useState<"1" | "2">("1");
  const [trimestre, setTrimestre] = useState<"1" | "2" | "3" | "4">("1");
  const [du, setDu] = useState("");
  const [au, setAu] = useState("");

  useEffect(() => {
    api.get(`/conges/familles`).then(r => setFamilles(r || [])).catch(() => {});
    api.get(`/conges/types`).then(r => setTypes(r || [])).catch(() => {});
  }, []);

  const familleColor = useMemo(() => {
    const m: Record<string, string> = {};
    familles.forEach(f => { if (f.couleur) m[f.code] = f.couleur; });
    return m;
  }, [familles]);
  const typeColor = useMemo(() => {
    const m: Record<string, string> = {};
    types.forEach(t => {
      const col = t.couleur || (t.code_famille ? familleColor[t.code_famille] : undefined);
      if (col) m[t.code] = col;
    });
    return m;
  }, [types, familleColor]);
  const colorOf = (c: Conge) => typeColor[c.code_type_conge] || FALLBACK_COLOR;

  const typeOptions = useMemo(() => {
    const base = fFamilles.length ? types.filter(t => t.code_famille && fFamilles.includes(t.code_famille)) : types;
    return base.map(t => ({ value: t.code, label: t.libelle, color: typeColor[t.code] }));
  }, [types, fFamilles, typeColor]);

  useEffect(() => {
    if (!fFamilles.length) return;
    setFTypes(prev => prev.filter(c => types.some(t => t.code === c && t.code_famille && fFamilles.includes(t.code_famille))));
    // eslint-disable-next-line
  }, [fFamilles]);

  const periode = useMemo<{ min?: string; max?: string }>(() => {
    if (mode === "annee") return { min: `${annee}-01-01`, max: `${annee}-12-31` };
    if (mode === "semestre")
      return semestre === "1" ? { min: `${annee}-01-01`, max: `${annee}-06-30` } : { min: `${annee}-07-01`, max: `${annee}-12-31` };
    if (mode === "trimestre") {
      const t = Number(trimestre); const m1 = (t - 1) * 3 + 1; const m2 = t * 3;
      const last = new Date(annee, m2, 0).getDate();
      return { min: `${annee}-${pad(m1)}-01`, max: `${annee}-${pad(m2)}-${pad(last)}` };
    }
    return { min: du || undefined, max: au || undefined };
  }, [mode, annee, semestre, trimestre, du, au]);

  const charger = async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      fFamilles.forEach(f => p.append("familles", f));
      fTypes.forEach(t => p.append("types", t));
      fStatuts.forEach(s => p.append("statuts", s));
      fUo.forEach(u => p.append("uo_ids", u));
      if (periode.min) p.set("date_min", periode.min);
      if (periode.max) p.set("date_max", periode.max);
      if (q.trim()) p.set("q", q.trim());
      if (role) p.set("role_actif", role);
      const res: any = await api.get(`/conges/liste?${p.toString()}`);
      setConges(res?.conges || []);
      setScope(res?.scope || "");
    } catch { setConges([]); } finally { setLoading(false); }
  };

  useEffect(() => { charger(); /* eslint-disable-next-line */ },
    [fFamilles, fTypes, fStatuts, fUo, mode, annee, semestre, trimestre, du, au, role]);
  useEffect(() => { const id = setTimeout(charger, 350); return () => clearTimeout(id); /* eslint-disable-next-line */ }, [q]);

  const fmt = (s?: string) => (s ? new Date(s).toLocaleDateString("fr-FR") : "—");
  const fmtDT = (s?: string) => (s ? new Date(s).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "—");
  const demi = (v?: string) => (v ? (DEMI[v.toLowerCase()] || v.toLowerCase()) : "");

  const reset = () => {
    setQ(""); setFFamilles([]); setFTypes([]); setFStatuts(["approuvee"]); setFUo([]);
    setMode("annee"); setAnnee(CUR_YEAR); setSemestre("1"); setTrimestre("1"); setDu(""); setAu("");
  };

  const periodeLabel =
    mode === "annee" ? `${annee}`
    : mode === "semestre" ? `${semestre === "1" ? "1er" : "2e"} sem. ${annee}`
    : mode === "trimestre" ? `T${trimestre} ${annee}`
    : (du || au) ? `${du ? fmt(du) : "…"} → ${au ? fmt(au) : "…"}` : "Période libre";

  const chips: { key: string; label: string; clear: () => void }[] = [];
  fFamilles.forEach(c => chips.push({ key: `fam-${c}`, label: familles.find(f => f.code === c)?.libelle || c, clear: () => setFFamilles(p => p.filter(x => x !== c)) }));
  fTypes.forEach(c => chips.push({ key: `typ-${c}`, label: types.find(t => t.code === c)?.libelle || c, clear: () => setFTypes(p => p.filter(x => x !== c)) }));
  fStatuts.forEach(c => chips.push({ key: `sta-${c}`, label: STATUTS[c]?.label || c, clear: () => setFStatuts(p => p.filter(x => x !== c)) }));
  fUo.forEach(c => chips.push({ key: `uo-${c}`, label: "UO", clear: () => setFUo(p => p.filter(x => x !== c)) }));
  const isDefault = !q && !fFamilles.length && !fTypes.length && !fUo.length
    && fStatuts.length === 1 && fStatuts[0] === "approuvee" && mode === "annee" && annee === CUR_YEAR;

  const exportCsv = () => {
    const head = ["Matricule", "Collaborateur", "Type", "Début", "Fin", "Reprise", "Jours décomptés", "Statut", "Origine"];
    const lines = conges.map(c => [
      c.demandeur_matricule || "", `${c.demandeur_nom || ""} ${c.demandeur_prenom || ""}`.trim(),
      c.libelle_type_conge || c.code_type_conge, fmt(c.date_debut), fmt(c.date_fin_absence), fmt(c.date_retour),
      c.nbr_jours_decomptes ?? c.nbr_jours_calendaires ?? "", STATUTS[c.statut]?.label || c.statut,
      c.source === "saisie_directe" ? "Saisie directe" : "Circuit",
    ]);
    const csv = [head, ...lines].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(";")).join("\r\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "conges.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  const familleOptions = familles.map(f => ({ value: f.code, label: f.libelle }));
  const statutOptions = Object.entries(STATUTS).map(([k, v]) => ({ value: k, label: v.label }));

  return (
    <div className="max-w-6xl mx-auto">
      {/* Fil d'Ariane */}
      <div className="flex items-center gap-1.5 px-6 pt-4 pb-2 text-[13px] text-muted-foreground">
        <span>Absences</span>
        <span style={{ opacity: 0.5 }}>/</span>
        <span className="font-semibold text-foreground">Liste des congés</span>
      </div>

      <div className="p-6 space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><CalendarDays size={22} /> Liste des congés</h1>
          {scope && <p className="text-sm text-muted-foreground mt-0.5">{SCOPE_LABEL[scope] || ""} · <span className="font-medium">{conges.length}</span> résultat(s) · {periodeLabel}</p>}
        </div>
        <Button variant="outline" onClick={exportCsv} disabled={conges.length === 0} className="gap-1.5">
          <Download size={15} /> Exporter CSV
        </Button>
      </div>

      {/* Barre de filtres */}
      <div className="border p-3 space-y-3" style={{ borderColor: "hsl(var(--border))", borderRadius: "var(--radius)" }}>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 opacity-50" />
            <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Rechercher (nom, prénom, matricule)…" className="pl-8" />
          </div>
          <MultiSelect options={familleOptions} selected={fFamilles} onChange={setFFamilles} placeholder="Famille" className="w-[180px]" />
          <MultiSelect options={typeOptions} selected={fTypes} onChange={setFTypes} placeholder="Type de congé" className="w-[210px]" />
          <MultiSelect options={statutOptions} selected={fStatuts} onChange={setFStatuts} placeholder="Statut" searchable={false} className="w-[160px]" />
          <div className="w-[220px]"><UoTreePicker selected={fUo} onChange={setFUo} /></div>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1 border-t" style={{ borderColor: "hsl(var(--border))" }}>
          <span className="text-[12px] font-semibold uppercase tracking-wider pt-2" style={{ color: "hsl(var(--muted-foreground))" }}>Période</span>
          <Select value={mode} onValueChange={(v: any) => setMode(v)}>
            <SelectTrigger className="w-[150px] mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="annee">Année</SelectItem>
              <SelectItem value="semestre">Semestre</SelectItem>
              <SelectItem value="trimestre">Trimestre</SelectItem>
              <SelectItem value="perso">Personnalisée</SelectItem>
            </SelectContent>
          </Select>
          {mode !== "perso" && (
            <Select value={String(annee)} onValueChange={v => setAnnee(Number(v))}>
              <SelectTrigger className="w-[100px] mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>{annees.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
            </Select>
          )}
          {mode === "semestre" && (
            <Select value={semestre} onValueChange={(v: any) => setSemestre(v)}>
              <SelectTrigger className="w-[130px] mt-1"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="1">1er semestre</SelectItem><SelectItem value="2">2e semestre</SelectItem></SelectContent>
            </Select>
          )}
          {mode === "trimestre" && (
            <Select value={trimestre} onValueChange={(v: any) => setTrimestre(v)}>
              <SelectTrigger className="w-[140px] mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">T1 (jan–mar)</SelectItem><SelectItem value="2">T2 (avr–juin)</SelectItem>
                <SelectItem value="3">T3 (juil–sep)</SelectItem><SelectItem value="4">T4 (oct–déc)</SelectItem>
              </SelectContent>
            </Select>
          )}
          {mode === "perso" && (
            <>
              <Input type="date" value={du} onChange={e => setDu(e.target.value)} className="w-[150px] mt-1" />
              <span className="text-sm text-muted-foreground">→</span>
              <Input type="date" value={au} min={du} onChange={e => setAu(e.target.value)} className="w-[150px] mt-1" />
            </>
          )}
          <div className="flex-1" />
          {!isDefault && (
            <Button variant="ghost" size="sm" onClick={reset} className="gap-1.5 mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>
              <RotateCcw size={14} /> Réinitialiser
            </Button>
          )}
        </div>

        {chips.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            {chips.map(c => (
              <span key={c.key} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px]"
                style={{ background: "hsl(var(--muted))", color: "hsl(var(--foreground))" }}>
                {c.label}
                <button type="button" onClick={c.clear} className="opacity-60 hover:opacity-100"><X size={12} /></button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Tableau */}
      <div className="border overflow-hidden" style={{ borderColor: "hsl(var(--border))" }}>
        {loading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground"><Loader2 size={20} className="animate-spin mr-2" /> Chargement…</div>
        ) : conges.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Filter size={32} className="text-muted-foreground" />
            <p className="mt-2 text-sm text-muted-foreground">Aucun congé pour ces critères.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left" style={{ background: "hsl(var(--muted) / 0.5)", color: "hsl(var(--muted-foreground))" }}>
                  <th className="px-3 py-2 font-semibold">Collaborateur</th>
                  <th className="px-3 py-2 font-semibold">Type</th>
                  <th className="px-3 py-2 font-semibold">Période</th>
                  <th className="px-3 py-2 font-semibold text-right">Jours</th>
                  <th className="px-3 py-2 font-semibold">Statut</th>
                  <th className="px-3 py-2 font-semibold">Origine</th>
                </tr>
              </thead>
              <tbody>
                {conges.map(c => {
                  const st = STATUTS[c.statut] || { label: c.statut, bg: "hsl(var(--muted))", fg: "hsl(var(--muted-foreground))" };
                  const col = colorOf(c);
                  return (
                    <tr key={c.id} onClick={() => setDetail(c)} className="border-t cursor-pointer hover:bg-[hsl(var(--muted)/0.4)]" style={{ borderColor: "hsl(var(--border))" }}>
                      <td className="px-3 py-2">
                        <div className="font-medium">{c.demandeur_nom} {c.demandeur_prenom}</div>
                        {c.demandeur_matricule && <div className="text-[11px] text-muted-foreground">#{c.demandeur_matricule}</div>}
                      </td>
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center gap-2">
                          <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ background: col }} />
                          {c.libelle_type_conge || c.code_type_conge}
                        </span>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{fmt(c.date_debut)} → {fmt(c.date_fin_absence)}</td>
                      <td className="px-3 py-2 text-right">{c.nbr_jours_decomptes ?? c.nbr_jours_calendaires ?? "—"}</td>
                      <td className="px-3 py-2">
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: st.bg, color: st.fg }}>{st.label}</span>
                      </td>
                      <td className="px-3 py-2">
                        {c.source === "saisie_directe" ? (
                          <span className="text-[11px] font-medium px-2 py-0.5 rounded-full" style={{ background: "hsl(var(--info) / 0.15)", color: "hsl(var(--info))" }}>Saisie directe</span>
                        ) : (
                          <span className="text-[11px] font-medium px-2 py-0.5 rounded-full" style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>Circuit</span>
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

      {detail && <DetailModal c={detail} color={colorOf(detail)} onClose={() => setDetail(null)} fmt={fmt} fmtDT={fmtDT} demi={demi} />}
      </div>
    </div>
  );
}

/* ── Fiche détail ─────────────────────────────────────────────────────────── */
function DetailModal({ c, color, onClose, fmt, fmtDT, demi }: {
  c: Conge; color: string; onClose: () => void;
  fmt: (s?: string) => string; fmtDT: (s?: string) => string; demi: (v?: string) => string;
}) {
  const st = STATUTS[c.statut] || { label: c.statut, bg: "hsl(var(--muted))", fg: "hsl(var(--muted-foreground))" };
  const [valideur, setValideur] = useState<string | null>(null);
  useEffect(() => {
    if (!c.valideur_id) { setValideur(null); return; }
    api.get(`/db/collaborateurs?id=eq.${c.valideur_id}&select=nom,prenom`)
      .then((r: any[]) => { const v = r?.[0]; setValideur(v ? `${v.nom || ""} ${v.prenom || ""}`.trim() : null); })
      .catch(() => setValideur(null));
  }, [c.valideur_id]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.5)" }} onClick={onClose}>
      <div className="w-full max-w-2xl rounded-2xl overflow-hidden max-h-[88vh] flex flex-col"
        style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} onClick={e => e.stopPropagation()}>

        {/* Bandeau coloré (couleur du type) */}
        <div className="px-5 py-4 flex items-start justify-between gap-3"
          style={{ background: `linear-gradient(90deg, ${color} 0%, transparent 140%)`, borderBottom: "1px solid hsl(var(--border))" }}>
          <div className="text-white">
            <div className="text-lg font-bold drop-shadow">{c.demandeur_nom} {c.demandeur_prenom}</div>
            <div className="text-[12px] opacity-90 flex items-center gap-2">
              {c.demandeur_matricule && <span>#{c.demandeur_matricule}</span>}
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-white/90" /> {c.libelle_type_conge || c.code_type_conge}
              </span>
            </div>
          </div>
          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-white/90" style={{ color: st.fg }}>{st.label}</span>
        </div>

        <div className="p-5 overflow-auto space-y-5">
          {/* Dates */}
          <Section title="Dates & demi-journées" icon={<CalendarDays size={14} />}>
            <Info label="Début" value={fmt(c.date_debut) + (c.debut_demi_journee ? ` · ${demi(c.debut_demi_journee)}` : "")} />
            <Info label="Fin d'absence" value={fmt(c.date_fin_absence) + (c.fin_demi_journee ? ` · ${demi(c.fin_demi_journee)}` : "")} />
            <Info label="Retour prévu" value={fmt(c.date_retour)} />
            <Info label="Reprise effective" value={fmt(c.date_reprise_effective)} />
          </Section>

          {/* Décompte */}
          <Section title="Décompte" icon={<FileStack size={14} />}>
            <Info label="Jours décomptés" value={String(c.nbr_jours_decomptes ?? "—")} strong />
            <Info label="Jours calendaires" value={String(c.nbr_jours_calendaires ?? "—")} />
          </Section>

          {/* Traitement */}
          <Section title="Traitement" icon={<Clock size={14} />}>
            <Info label="Soumise le" value={fmtDT(c.date_soumission)} />
            <Info label="Validée le" value={fmtDT(c.date_validation)} />
            <Info label="Validée par" value={valideur || "—"} icon={valideur ? <User size={12} /> : undefined} />
          </Section>

          {/* Marqueurs */}
          {(c.est_report_reliquat || c.reconduction_numero || c.piece_jointe_path) && (
            <div className="flex flex-wrap gap-2">
              {c.est_report_reliquat && (
                <span className="inline-flex items-center gap-1 text-[12px] rounded-full px-2 py-0.5" style={{ background: "hsl(var(--info) / 0.15)", color: "hsl(var(--info))" }}>
                  <Repeat size={12} /> Report de reliquat
                </span>
              )}
              {!!c.reconduction_numero && (
                <span className="inline-flex items-center gap-1 text-[12px] rounded-full px-2 py-0.5" style={{ background: "hsl(var(--muted))" }}>
                  <Repeat size={12} /> Reconduction n°{c.reconduction_numero}
                </span>
              )}
              {c.piece_jointe_path && (
                <a href={`/api/v1/storage/${c.piece_jointe_path}`} target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[12px] rounded-full px-2 py-0.5" style={{ background: "hsl(var(--muted))", color: "hsl(var(--primary))" }}>
                  <Paperclip size={12} /> Pièce jointe
                </a>
              )}
            </div>
          )}

          {/* Commentaires / motif */}
          {(c.commentaire_collaborateur || c.commentaire_gestionnaire || c.motif_refus) && (
            <Section title="Commentaires & motifs" icon={<MessageSquare size={14} />} full>
              {c.commentaire_collaborateur && <Note label="Commentaire du collaborateur" value={c.commentaire_collaborateur} />}
              {c.commentaire_gestionnaire && <Note label="Commentaire du gestionnaire" value={c.commentaire_gestionnaire} />}
              {c.motif_refus && <Note label="Motif de refus" value={c.motif_refus} danger />}
            </Section>
          )}

          {/* Circuit de validation — uniquement pour les demandes passées par le workflow.
              Une saisie directe (cong_consommation, demande_id null) n'a pas de circuit :
              c.id référence ici cong_consommation, pas cong_demandes. */}
          <div className="pt-1 border-t" style={{ borderColor: "hsl(var(--border))" }}>
            <p className="text-[12px] font-semibold uppercase tracking-wider mb-2 mt-3" style={{ color: "hsl(var(--muted-foreground))" }}>
              Circuit de validation
            </p>
            {c.source === "saisie_directe" ? (
              <p className="text-[13px]" style={{ color: "hsl(var(--muted-foreground))" }}>
                Congé enregistré directement par le RH — aucun circuit de validation n'a été déclenché.
              </p>
            ) : (
              <SuiviDemandeWorkflow tableSource="cong_demandes" demandeId={c.id} statutDemande={c.statut} />
            )}
          </div>
        </div>

        <div className="px-5 py-3 border-t flex justify-end" style={{ borderColor: "hsl(var(--border))" }}>
          <Button variant="outline" size="sm" onClick={onClose}>Fermer</Button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, icon, children, full }: { title: string; icon?: ReactNode; children: ReactNode; full?: boolean }) {
  return (
    <div>
      <p className="text-[12px] font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5" style={{ color: "hsl(var(--muted-foreground))" }}>
        {icon} {title}
      </p>
      <div className={full ? "space-y-2" : "grid grid-cols-2 gap-x-4 gap-y-3"}>{children}</div>
    </div>
  );
}
function Info({ label, value, strong, icon }: { label: string; value: string; strong?: boolean; icon?: ReactNode }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider" style={{ color: "hsl(var(--muted-foreground))" }}>{label}</p>
      <p className={`flex items-center gap-1.5 ${strong ? "font-bold text-base" : "font-medium"}`}>{icon}{value}</p>
    </div>
  );
}
function Note({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="rounded-lg p-2.5 text-sm" style={{ background: danger ? "hsl(var(--destructive) / 0.08)" : "hsl(var(--muted) / 0.5)" }}>
      <p className="text-[11px] uppercase tracking-wider mb-0.5" style={{ color: danger ? "hsl(var(--destructive))" : "hsl(var(--muted-foreground))" }}>{label}</p>
      <p style={{ color: danger ? "hsl(var(--destructive))" : "inherit" }}>{value}</p>
    </div>
  );
}
