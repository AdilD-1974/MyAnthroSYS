/**
 * RapportTemplatesPage — Liste et gestion des templates de rapport
 * (Journal, Bulletin), identifiés par code / libellé / libellé court.
 *
 * Route suggérée : /paie/editions/journaux
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Loader2, Pencil, Copy, Archive, ArchiveRestore } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { rapportsApi, type RapportTemplate, type TypeRapport } from "@/lib/rapportsApi";

const VIDE: Omit<RapportTemplate, "id"> = {
  code: "", libelle: "", libelle_court: "", type_rapport: "JOURNAL",
  description: "", actif: true, par_defaut: false,
};

// Même palette que JournalGrilleConfigPage.tsx (identité=bleu, rubrique=
// vert) : un modèle Bulletin ou Journal se repère au premier coup d'œil,
// cohérent avec le code couleur déjà en place ailleurs dans le module Paie.
const COULEUR_TYPE: Record<TypeRapport, { bordure: string; fond: string }> = {
  BULLETIN: { bordure: "hsl(217 91% 60%)", fond: "hsl(217 91% 60% / 0.05)" },
  JOURNAL: { bordure: "hsl(142 71% 45%)", fond: "hsl(142 71% 45% / 0.05)" },
};

export default function RapportTemplatesPage() {
  const [templates, setTemplates] = useState<RapportTemplate[]>([]);
  const [chargement, setChargement] = useState(true);
  const [dialogOuvert, setDialogOuvert] = useState(false);
  const [enEdition, setEnEdition] = useState<RapportTemplate | null>(null);
  const [form, setForm] = useState<Omit<RapportTemplate, "id">>(VIDE);
  const [sauvegarde, setSauvegarde] = useState(false);

  async function charger() {
    setChargement(true);
    try {
      const tpls = await rapportsApi.listerTemplates();
      setTemplates(tpls);
    } catch (e: any) {
      toast.error("Chargement impossible", { description: e.message });
    } finally {
      setChargement(false);
    }
  }

  useEffect(() => { charger(); }, []);

  function ouvrirCreation() {
    setEnEdition(null);
    setForm(VIDE);
    setDialogOuvert(true);
  }

  function ouvrirEdition(t: RapportTemplate) {
    setEnEdition(t);
    setForm({
      code: t.code, libelle: t.libelle, libelle_court: t.libelle_court ?? "",
      type_rapport: t.type_rapport, description: t.description ?? "",
      actif: t.actif, par_defaut: t.par_defaut,
    });
    setDialogOuvert(true);
  }

  // Duplication : réutilise le même dialogue en mode création (enEdition
  // reste null -> enregistrer() appellera creerTemplate) mais pré-rempli
  // avec les valeurs de l'original. Code suffixé pour éviter un conflit
  // immédiat ; "par défaut" jamais dupliqué (un seul modèle par défaut par
  // type a du sens).
  function ouvrirDuplication(t: RapportTemplate) {
    setEnEdition(null);
    setForm({
      code: `${t.code}_COPIE`, libelle: `${t.libelle} (copie)`,
      libelle_court: t.libelle_court ?? "", type_rapport: t.type_rapport,
      description: t.description ?? "", actif: true, par_defaut: false,
    });
    setDialogOuvert(true);
  }

  async function basculerArchivage(t: RapportTemplate) {
    try {
      await rapportsApi.modifierTemplate(t.id, {
        code: t.code, libelle: t.libelle, libelle_court: t.libelle_court,
        type_rapport: t.type_rapport, description: t.description,
        actif: !t.actif, par_defaut: t.par_defaut,
      });
      toast.success(t.actif ? "Modèle archivé" : "Modèle réactivé");
      await charger();
    } catch (e: any) {
      toast.error("Échec de l'opération", { description: e.message });
    }
  }

  async function enregistrer() {
    if (!form.code.trim() || !form.libelle.trim()) {
      toast.error("Code et libellé sont obligatoires");
      return;
    }
    setSauvegarde(true);
    try {
      if (enEdition) {
        await rapportsApi.modifierTemplate(enEdition.id, form);
        toast.success("Journal modifié");
      } else {
        await rapportsApi.creerTemplate(form);
        toast.success("Journal créé");
      }
      setDialogOuvert(false);
      await charger();
    } catch (e: any) {
      toast.error("Échec de l'enregistrement", { description: e.message });
    } finally {
      setSauvegarde(false);
    }
  }

  return (
    <div className="p-6 space-y-6 w-full">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Journaux &amp; Bulletins</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Liste des modèles de rapport, identifiés par code, libellé et libellé court.
          </p>
        </div>
        <Dialog open={dialogOuvert} onOpenChange={setDialogOuvert}>
          <DialogTrigger asChild>
            <Button onClick={ouvrirCreation}><Plus className="h-4 w-4 mr-1" /> Nouveau</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{enEdition ? "Modifier le modèle" : "Nouveau modèle de rapport"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Code</label>
                  <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="ex. JOURNAL_CADRES" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Type</label>
                  <Select value={form.type_rapport} onValueChange={(v) => setForm({ ...form, type_rapport: v as TypeRapport })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="JOURNAL">Journal</SelectItem>
                      <SelectItem value="BULLETIN">Bulletin</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Libellé</label>
                <Input value={form.libelle} onChange={(e) => setForm({ ...form, libelle: e.target.value })} placeholder="ex. Journal de paie — Cadres" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Libellé court</label>
                <Input value={form.libelle_court ?? ""} onChange={(e) => setForm({ ...form, libelle_court: e.target.value })} placeholder="ex. JRN Cadres" maxLength={50} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Description</label>
                <Input value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOuvert(false)}>Annuler</Button>
              <Button onClick={enregistrer} disabled={sauvegarde}>
                {sauvegarde && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                Enregistrer
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Modèles existants</CardTitle></CardHeader>
        <CardContent>
          {chargement ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <Table className="table-fixed">
              <colgroup>
                <col style={{ width: "16%" }} />
                <col style={{ width: "26%" }} />
                <col style={{ width: "16%" }} />
                <col style={{ width: "9%" }} />
                <col style={{ width: "9%" }} />
                <col style={{ width: "9%" }} />
                <col style={{ width: "15%" }} />
              </colgroup>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Libellé</TableHead>
                  <TableHead>Libellé court</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Par défaut</TableHead>
                  <TableHead>Statut</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {templates.map((t) => {
                  const couleur = COULEUR_TYPE[t.type_rapport];
                  return (
                    <TableRow
                      key={t.id}
                      style={{
                        borderLeft: `3px solid ${couleur.bordure}`,
                        background: t.actif ? couleur.fond : "hsl(var(--muted) / 0.4)",
                        opacity: t.actif ? 1 : 0.65,
                      }}
                    >
                      <TableCell className="font-mono text-xs py-3">{t.code}</TableCell>
                      <TableCell className="py-3 truncate">{t.libelle}</TableCell>
                      <TableCell className="py-3 truncate">{t.libelle_court || "—"}</TableCell>
                      <TableCell className="py-3">
                        <Badge variant="outline" style={{ borderColor: couleur.bordure, color: couleur.bordure }}>
                          {t.type_rapport === "JOURNAL" ? "Journal" : "Bulletin"}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-3">{t.par_defaut ? <Badge>Oui</Badge> : "—"}</TableCell>
                      <TableCell className="py-3">
                        {t.actif
                          ? <Badge variant="outline" className="text-emerald-600 border-emerald-600/40">Actif</Badge>
                          : <Badge variant="outline" className="text-muted-foreground">Archivé</Badge>}
                      </TableCell>
                      <TableCell className="py-3 text-right whitespace-nowrap">
                        <Button size="icon" variant="ghost" onClick={() => ouvrirEdition(t)} title="Modifier">
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => ouvrirDuplication(t)} title="Dupliquer">
                          <Copy className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => basculerArchivage(t)} title={t.actif ? "Archiver" : "Réactiver"}>
                          {t.actif
                            ? <Archive className="h-4 w-4 text-destructive" />
                            : <ArchiveRestore className="h-4 w-4 text-emerald-600" />}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
