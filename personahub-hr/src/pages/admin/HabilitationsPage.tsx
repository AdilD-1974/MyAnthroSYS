import { useState, useEffect, useMemo, useCallback } from "react";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Card, CardHeader, CardTitle, CardContent, CardDescription,
} from "@/components/ui/card";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import {
  ShieldCheck, Globe, Building2, Building, MapPin, FileText, Tag,
  GraduationCap, Award, Layers, Briefcase,
  Trash2, Pencil, Plus, X, Loader2, Users,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────
interface Gestionnaire {
  user_id: string;
  nom: string | null;
  prenom: string | null;
  roles: string[];
}
interface UO {
  id: string; code: string; libelle: string;
  parent_id: string | null; type_uo: string | null; niveau: number | null;
}
interface Societe { id: string; libelle: string; }
interface Etablissement { id: string; code: string; libelle: string; societe_id: string | null; }
interface RefItem { code: string; libelle: string; }

interface ValeurResolue { valeur: string; libelle: string | null; uo_code: string | null; }
interface Condition {
  id: string;
  type_critere: string;
  inclure_sous_uo: boolean;
  valeurs: ValeurResolue[];
}
interface Habilitation {
  id: string;
  user_id: string;
  role: string;
  actif: boolean;
  created_at: string;
  est_global: boolean;
  gest_nom: string | null;
  gest_prenom: string | null;
  conditions: Condition[];
}

// Forme éditable d'une condition dans le formulaire
interface FormCondition {
  type: string;
  valeurs: string[];      // codes/UUIDs cochés (OU)
  inclure_sous_uo: boolean;
}

// Option normalisée pour les sélecteurs de valeurs
interface Option { value: string; label: string; pad?: number; }

const ROLE_LABEL: Record<string, string> = {
  administrateur: "Administrateur",
  gestionnaire_rh: "Gestionnaire RH",
  gestionnaire_paie: "Gestionnaire Paie",
  manager: "Manager",
};

const TYPE_LABEL: Record<string, string> = {
  UO: "Unité organisationnelle",
  SOCIETE: "Société",
  ETABLISSEMENT: "Établissement",
  TYPE_CONTRAT: "Type de contrat",
  STATUT: "Statut",
  CLASSIFICATION: "Classification",
  CATEGORIE_PRO: "Catégorie professionnelle",
  COLLEGE: "Collège",
  CATEGORIE_EMPLOI: "Catégorie d'emploi",
};

// Types de condition proposés (GLOBAL est géré par le toggle, pas ici)
const TYPES_CONDITION = [
  "UO", "SOCIETE", "ETABLISSEMENT", "TYPE_CONTRAT", "STATUT",
  "CLASSIFICATION", "CATEGORIE_PRO", "COLLEGE", "CATEGORIE_EMPLOI",
];

function TypeIcon({ type }: { type: string }) {
  const cls = "h-4 w-4 shrink-0";
  switch (type) {
    case "UO":               return <Building2 className={`${cls} text-blue-600`} />;
    case "SOCIETE":          return <Building className={`${cls} text-violet-600`} />;
    case "ETABLISSEMENT":    return <MapPin className={`${cls} text-amber-600`} />;
    case "TYPE_CONTRAT":     return <FileText className={`${cls} text-cyan-600`} />;
    case "STATUT":           return <Tag className={`${cls} text-rose-600`} />;
    case "CLASSIFICATION":   return <Layers className={`${cls} text-indigo-600`} />;
    case "CATEGORIE_PRO":    return <Award className={`${cls} text-orange-600`} />;
    case "COLLEGE":          return <GraduationCap className={`${cls} text-teal-600`} />;
    case "CATEGORIE_EMPLOI": return <Briefcase className={`${cls} text-fuchsia-600`} />;
    default:                 return <Building2 className={cls} />;
  }
}

let _cidSeq = 0;
const newCid = () => `c_${Date.now()}_${_cidSeq++}`;

export default function HabilitationsPage() {
  const { toast } = useToast();

  const [gestionnaires, setGestionnaires] = useState<Gestionnaire[]>([]);
  const [uos, setUos] = useState<UO[]>([]);
  const [societes, setSocietes] = useState<Societe[]>([]);
  const [etablissements, setEtablissements] = useState<Etablissement[]>([]);
  const [typesContrat, setTypesContrat] = useState<RefItem[]>([]);
  const [statuts, setStatuts] = useState<RefItem[]>([]);
  const [classifications, setClassifications] = useState<RefItem[]>([]);
  const [categoriesPro, setCategoriesPro] = useState<RefItem[]>([]);
  const [colleges, setColleges] = useState<RefItem[]>([]);
  const [categoriesEmploi, setCategoriesEmploi] = useState<RefItem[]>([]);
  const [habils, setHabils] = useState<Habilitation[]>([]);
  const [loading, setLoading] = useState(true);

  // formulaire (création ET édition)
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [fUser, setFUser] = useState<string>("");
  const [fRole, setFRole] = useState<string>("");
  const [fGlobal, setFGlobal] = useState<boolean>(false);
  const [fConditions, setFConditions] = useState<FormCondition[]>([]);
  const [saving, setSaving] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [g, u, soc, etab, tc, st, cl, cp, co, ce, h] = await Promise.all([
        api.get("/habilitations/gestionnaires"),
        api.get("/habilitations/uos"),
        api.get("/habilitations/societes"),
        api.get("/habilitations/etablissements"),
        api.get("/habilitations/types-contrat"),
        api.get("/habilitations/statuts"),
        api.get("/habilitations/classifications"),
        api.get("/habilitations/categories-pro"),
        api.get("/habilitations/colleges"),
        api.get("/habilitations/categories-emploi"),
        api.get("/habilitations"),
      ]);
      setGestionnaires(g || []);
      setUos(u || []);
      setSocietes(soc || []);
      setEtablissements(etab || []);
      setTypesContrat(tc || []);
      setStatuts(st || []);
      setClassifications(cl || []);
      setCategoriesPro(cp || []);
      setColleges(co || []);
      setCategoriesEmploi(ce || []);
      setHabils(h || []);
    } catch (e) {
      toast({
        title: "Erreur de chargement",
        description: "Impossible de charger les habilitations.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const rolesDuGest = useMemo(() => {
    const g = gestionnaires.find((x) => x.user_id === fUser);
    return g ? g.roles : [];
  }, [fUser, gestionnaires]);

  const parGestionnaire = useMemo(() => {
    const map = new Map<string, Habilitation[]>();
    for (const h of habils) {
      const arr = map.get(h.user_id) || [];
      arr.push(h);
      map.set(h.user_id, arr);
    }
    return Array.from(map.entries());
  }, [habils]);

  // Options de valeur pour un type donné
  const optionsForType = useCallback((type: string): Option[] => {
    switch (type) {
      case "UO":
        return uos.map((u) => ({
          value: u.id,
          label: `${u.libelle}${u.code ? ` (${u.code})` : ""}`,
          pad: Math.max(0, (u.niveau ?? 0)),
        }));
      case "SOCIETE":
        return societes.map((s) => ({ value: s.id, label: s.libelle }));
      case "ETABLISSEMENT":
        return etablissements.map((e) => ({ value: e.id, label: `${e.libelle}${e.code ? ` (${e.code})` : ""}` }));
      case "TYPE_CONTRAT":     return typesContrat.map((t) => ({ value: t.code, label: t.libelle }));
      case "STATUT":           return statuts.map((s) => ({ value: s.code, label: s.libelle }));
      case "CLASSIFICATION":   return classifications.map((c) => ({ value: c.code, label: c.libelle }));
      case "CATEGORIE_PRO":    return categoriesPro.map((c) => ({ value: c.code, label: c.libelle }));
      case "COLLEGE":          return colleges.map((c) => ({ value: c.code, label: c.libelle }));
      case "CATEGORIE_EMPLOI": return categoriesEmploi.map((c) => ({ value: c.code, label: c.libelle }));
      default:                 return [];
    }
  }, [uos, societes, etablissements, typesContrat, statuts, classifications, categoriesPro, colleges, categoriesEmploi]);

  const resetForm = () => {
    setEditingId(null);
    setFUser(""); setFRole(""); setFGlobal(false); setFConditions([]);
  };

  const openCreate = () => { resetForm(); setDialogOpen(true); };

  const openEdit = (h: Habilitation) => {
    setEditingId(h.id);
    setFUser(h.user_id);
    setFRole(h.role);
    setFGlobal(h.est_global);
    setFConditions(
      (h.conditions || []).map((c) => ({
        type: c.type_critere,
        valeurs: c.valeurs.map((v) => v.valeur),
        inclure_sous_uo: c.inclure_sous_uo,
      }))
    );
    setDialogOpen(true);
  };

  // ── manipulation des conditions du formulaire ──
  const addCondition = () =>
    setFConditions((prev) => [...prev, { type: "", valeurs: [], inclure_sous_uo: true }]);

  const removeCondition = (idx: number) =>
    setFConditions((prev) => prev.filter((_, i) => i !== idx));

  const setConditionType = (idx: number, type: string) =>
    setFConditions((prev) => prev.map((c, i) => i === idx ? { ...c, type, valeurs: [] } : c));

  const toggleValeur = (idx: number, value: string) =>
    setFConditions((prev) => prev.map((c, i) => {
      if (i !== idx) return c;
      const has = c.valeurs.includes(value);
      return { ...c, valeurs: has ? c.valeurs.filter((v) => v !== value) : [...c.valeurs, value] };
    }));

  const setConditionSousUo = (idx: number, val: boolean) =>
    setFConditions((prev) => prev.map((c, i) => i === idx ? { ...c, inclure_sous_uo: val } : c));

  const handleSubmit = async () => {
    if (!fUser || !fRole) {
      toast({ title: "Champs requis", description: "Gestionnaire et rôle sont obligatoires.", variant: "destructive" });
      return;
    }
    if (!fGlobal) {
      if (fConditions.length === 0) {
        toast({ title: "Aucun critère", description: "Ajoutez au moins un critère, ou activez « périmètre global ».", variant: "destructive" });
        return;
      }
      for (const [i, c] of fConditions.entries()) {
        if (!c.type) {
          toast({ title: "Critère incomplet", description: `Critère ${i + 1} : choisissez un type.`, variant: "destructive" });
          return;
        }
        if (c.valeurs.length === 0) {
          toast({ title: "Critère incomplet", description: `Critère ${i + 1} (${TYPE_LABEL[c.type] ?? c.type}) : cochez au moins une valeur.`, variant: "destructive" });
          return;
        }
      }
    }

    setSaving(true);
    const body = {
      role: fRole,
      est_global: fGlobal,
      conditions: fGlobal ? [] : fConditions.map((c) => ({
        type_critere: c.type,
        valeurs: c.valeurs,
        inclure_sous_uo: c.type === "UO" ? c.inclure_sous_uo : false,
      })),
    };
    try {
      if (editingId) {
        await api.put(`/habilitations/${editingId}`, body);
        toast({ title: "Règle modifiée", description: "Le périmètre a été mis à jour." });
      } else {
        await api.post("/habilitations", { user_id: fUser, ...body });
        toast({ title: "Règle ajoutée", description: "Le périmètre a été créé." });
      }
      resetForm();
      setDialogOpen(false);
      await loadAll();
    } catch (e: any) {
      const msg = e?.response?.data?.detail || e?.message || "Erreur lors de l'enregistrement.";
      toast({ title: "Échec", description: String(msg), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (h: Habilitation) => {
    try {
      await api.patch(`/habilitations/${h.id}/toggle`, {});
      setHabils((prev) => prev.map((x) => x.id === h.id ? { ...x, actif: !x.actif } : x));
    } catch {
      toast({ title: "Erreur", description: "Impossible de modifier l'état.", variant: "destructive" });
    }
  };

  const handleDelete = async (h: Habilitation) => {
    try {
      await api.delete(`/habilitations/${h.id}`);
      setHabils((prev) => prev.filter((x) => x.id !== h.id));
      toast({ title: "Supprimée", description: "Règle de périmètre supprimée." });
    } catch {
      toast({ title: "Erreur", description: "Suppression impossible.", variant: "destructive" });
    }
  };

  const nomGest = (g: { gest_nom: string | null; gest_prenom: string | null }) =>
    `${g.gest_prenom ?? ""} ${g.gest_nom ?? ""}`.trim() || "—";

  // ── rendu d'une condition dans le formulaire ──
  const renderFormCondition = (cond: FormCondition, idx: number) => {
    const options = cond.type ? optionsForType(cond.type) : [];
    return (
      <div key={idx} className="rounded-md border p-3 space-y-2 bg-muted/30">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-muted-foreground">Critère {idx + 1}</span>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeCondition(idx)} title="Retirer ce critère">
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>

        <Select value={cond.type} onValueChange={(v) => setConditionType(idx, v)}>
          <SelectTrigger><SelectValue placeholder="Type de critère" /></SelectTrigger>
          <SelectContent>
            {TYPES_CONDITION.map((t) => (
              <SelectItem key={t} value={t}>{TYPE_LABEL[t]}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {cond.type && (
          <>
            <div className="max-h-44 overflow-y-auto rounded border bg-background p-2 space-y-1">
              {options.length === 0 ? (
                <p className="text-xs text-muted-foreground px-1 py-2">Aucune valeur disponible.</p>
              ) : (
                options.map((opt) => (
                  <label
                    key={opt.value}
                    className="flex items-center gap-2 text-sm py-0.5 px-1 rounded hover:bg-muted cursor-pointer"
                    style={opt.pad ? { paddingLeft: `${opt.pad * 12 + 4}px` } : undefined}
                  >
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 accent-primary"
                      checked={cond.valeurs.includes(opt.value)}
                      onChange={() => toggleValeur(idx, opt.value)}
                    />
                    <span className="truncate">{opt.label}</span>
                  </label>
                ))
              )}
            </div>
            {cond.valeurs.length > 1 && (
              <p className="text-[11px] text-muted-foreground">
                {cond.valeurs.length} valeurs sélectionnées (combinées en OU).
              </p>
            )}
            {cond.type === "UO" && (
              <div className="flex items-center justify-between rounded-md border p-2">
                <span className="text-xs">Inclure les sous-unités</span>
                <Switch checked={cond.inclure_sous_uo} onCheckedChange={(v) => setConditionSousUo(idx, v)} />
              </div>
            )}
          </>
        )}
      </div>
    );
  };

  return (
    <div className="p-6 space-y-6">
      {/* En-tête */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-primary" />
            Périmètres de gestion
          </h1>
          <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
            Définissez la population de collaborateurs que chaque gestionnaire peut traiter.
            Une règle <strong>globale</strong> donne accès à tous les collaborateurs. Sinon, une règle
            combine plusieurs critères en <strong>ET</strong> ; à l'intérieur d'un critère, plusieurs
            valeurs se combinent en <strong>OU</strong>. Plusieurs règles sur un même gestionnaire se
            cumulent (OU).
          </p>
        </div>

        <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) resetForm(); }}>
          <DialogTrigger asChild>
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4 mr-2" />
              Ajouter une règle
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingId ? "Modifier la règle de périmètre" : "Nouvelle règle de périmètre"}</DialogTitle>
              <DialogDescription>
                Attribuez un périmètre à un gestionnaire pour l'un de ses rôles.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              {/* Gestionnaire (verrouillé en édition) */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Gestionnaire</label>
                <Select value={fUser} onValueChange={(v) => { setFUser(v); setFRole(""); }} disabled={!!editingId}>
                  <SelectTrigger><SelectValue placeholder="Choisir un gestionnaire" /></SelectTrigger>
                  <SelectContent>
                    {gestionnaires.map((g) => (
                      <SelectItem key={g.user_id} value={g.user_id}>
                        {`${g.prenom ?? ""} ${g.nom ?? ""}`.trim() || g.user_id.slice(0, 8)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Rôle */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Rôle concerné</label>
                <Select value={fRole} onValueChange={setFRole} disabled={!fUser}>
                  <SelectTrigger><SelectValue placeholder={fUser ? "Choisir un rôle" : "Sélectionnez d'abord un gestionnaire"} /></SelectTrigger>
                  <SelectContent>
                    {rolesDuGest.map((r) => (
                      <SelectItem key={r} value={r}>{ROLE_LABEL[r] ?? r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Périmètre global */}
              <div className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <p className="text-sm font-medium">Périmètre global</p>
                  <p className="text-xs text-muted-foreground">Accès à tous les collaborateurs (ignore les critères).</p>
                </div>
                <Switch checked={fGlobal} onCheckedChange={setFGlobal} />
              </div>

              {/* Constructeur de critères (ET) */}
              {!fGlobal && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium">Critères (combinés en ET)</label>
                    <Button variant="outline" size="sm" onClick={addCondition}>
                      <Plus className="h-3.5 w-3.5 mr-1" /> Ajouter un critère
                    </Button>
                  </div>

                  {fConditions.length === 0 ? (
                    <p className="text-xs text-muted-foreground border rounded-md p-3 text-center">
                      Aucun critère. Ajoutez-en un, ou activez « périmètre global ».
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {fConditions.map((cond, idx) => (
                        <div key={idx}>
                          {idx > 0 && (
                            <div className="flex items-center gap-2 my-1">
                              <div className="h-px bg-border flex-1" />
                              <span className="text-[10px] font-bold text-muted-foreground tracking-wider">ET</span>
                              <div className="h-px bg-border flex-1" />
                            </div>
                          )}
                          {renderFormCondition(cond, idx)}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Annuler</Button>
              <Button onClick={handleSubmit} disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {editingId ? "Enregistrer" : "Créer"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Contenu */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="h-5 w-5 mr-2 animate-spin" /> Chargement…
        </div>
      ) : parGestionnaire.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Users className="h-10 w-10 mx-auto mb-3 opacity-40" />
            Aucune règle de périmètre définie. Cliquez sur « Ajouter une règle » pour commencer.
            <p className="text-xs mt-2">
              Astuce : prévoyez au moins un gestionnaire RH avec un périmètre <strong>global</strong> pour éviter tout blocage.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {parGestionnaire.map(([userId, rules]) => {
            const first = rules[0];
            return (
              <Card key={userId}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Users className="h-4 w-4 text-muted-foreground" />
                    {nomGest(first)}
                  </CardTitle>
                  <CardDescription>{rules.length} règle(s) de périmètre</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {rules.map((h) => (
                    <div
                      key={h.id}
                      className={`flex items-start justify-between gap-3 rounded-md border p-3 ${h.actif ? "" : "opacity-50"}`}
                    >
                      <div className="flex items-start gap-3 min-w-0">
                        {h.est_global
                          ? <Globe className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                          : <ShieldCheck className="h-4 w-4 text-primary shrink-0 mt-0.5" />}
                        <div className="min-w-0 space-y-1.5">
                          <Badge variant="secondary">{ROLE_LABEL[h.role] ?? h.role}</Badge>

                          {h.est_global ? (
                            <p className="text-sm font-medium">Tous les collaborateurs</p>
                          ) : (
                            <div className="space-y-1">
                              {h.conditions.map((c, ci) => (
                                <div key={c.id}>
                                  {ci > 0 && (
                                    <span className="text-[10px] font-bold text-muted-foreground tracking-wider">ET</span>
                                  )}
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <TypeIcon type={c.type_critere} />
                                    <span className="text-xs text-muted-foreground">{TYPE_LABEL[c.type_critere] ?? c.type_critere} :</span>
                                    {c.valeurs.map((v) => (
                                      <Badge key={v.valeur} variant="outline" className="font-normal">
                                        {v.libelle ?? v.valeur}
                                        {c.type_critere === "UO" && v.uo_code ? ` (${v.uo_code})` : ""}
                                      </Badge>
                                    ))}
                                    {c.type_critere === "UO" && (
                                      <span className="text-[11px] text-muted-foreground">
                                        {c.inclure_sous_uo ? "· sous-unités incluses" : "· cette UO seule"}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Switch checked={h.actif} onCheckedChange={() => handleToggle(h)} />
                        <Button variant="ghost" size="icon" onClick={() => openEdit(h)} title="Modifier">
                          <Pencil className="h-4 w-4 text-muted-foreground" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => handleDelete(h)} title="Supprimer">
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
