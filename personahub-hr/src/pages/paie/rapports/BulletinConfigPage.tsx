/**
 * BulletinConfigPage — Configuration des 5 modèles de Bulletin de paie.
 *
 * Les 5 modèles ont un contenu identique (conforme au Code du Travail
 * marocain) — seule la présentation visuelle diffère. Cet écran permet de
 * personnaliser le corps (colonnes affichées, libellés de section) et le
 * pied de page (cumuls annuels, mentions légales, signature) de chaque
 * modèle indépendamment.
 *
 * Route suggérée : /paie/editions/bulletins
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Loader2, Save, Plus, Trash2, Eye, FileDown, Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Skeleton } from "@/components/ui/skeleton";
import { db } from "@/lib/api";
import {
  rapportsApi,
  type RapportTemplate,
  type BulletinConfig,
  type EnteteChamp,
  type CorpsColonne,
  type PiedCumul,
  type ChampsDisponibles,
  type BulletinApercuResponse,
} from "@/lib/rapportsApi";

type Collab = { id: string; matricule: string; nom: string; prenom: string };
type RubriquePaieOption = ChampsDisponibles["rubriques"][number];

// Combobox mono-sélection pour choisir un code de rubrique de paie — même
// pattern Popover+Command que le sélecteur de collaborateur ci-dessous,
// pour remplacer la saisie libre (source d'erreurs : un code mal orthographié
// ressort silencieusement vide dans l'aperçu, sans message d'erreur).
function RubriqueCombobox({
  value, onChange, options, placeholder = "Choisir une rubrique…",
}: {
  value: string;
  onChange: (code: string) => void;
  options: RubriquePaieOption[];
  placeholder?: string;
}) {
  const [ouvert, setOuvert] = useState(false);
  const selection = options.find((o) => o.code === value);
  return (
    <Popover open={ouvert} onOpenChange={setOuvert}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" className="w-56 justify-between font-normal">
          <span className="truncate">{selection ? `${selection.code} — ${selection.libelle}` : (value || placeholder)}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command filter={(v, s) => (v.toLowerCase().includes(s.toLowerCase()) ? 1 : 0)}>
          <CommandInput placeholder="Code ou libellé…" />
          <CommandList>
            <CommandEmpty>Aucune rubrique.</CommandEmpty>
            <CommandGroup>
              {options.map((o) => (
                <CommandItem
                  key={o.code}
                  value={`${o.code} ${o.libelle}`}
                  onSelect={() => { onChange(o.code); setOuvert(false); }}
                >
                  <Check className={`mr-2 h-4 w-4 ${o.code === value ? "opacity-100" : "opacity-0"}`} />
                  <span className="font-mono text-xs mr-2">{o.code}</span>
                  <span className="text-muted-foreground">{o.libelle}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

const COLONNES_DISPONIBLES: CorpsColonne[] = [
  { cle: "base", libelle: "Base" },
  { cle: "nombre", libelle: "Nombre/Taux" },
  { cle: "taux", libelle: "Taux" },
  { cle: "montant", libelle: "Montant salarial" },
  { cle: "montant_patronal", libelle: "Montant patronal" },
];

export default function BulletinConfigPage() {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<RapportTemplate[]>([]);
  const [templateId, setTemplateId] = useState<string>("");
  const [config, setConfig] = useState<BulletinConfig | null>(null);
  const [champs, setChamps] = useState<ChampsDisponibles | null>(null);
  const [chargement, setChargement] = useState(true);
  const [sauvegarde, setSauvegarde] = useState(false);

  const [bulletinIdTest, setBulletinIdTest] = useState("");
  const [collabs, setCollabs] = useState<Collab[]>([]);
  const [collabId, setCollabId] = useState("");
  const [collabOpen, setCollabOpen] = useState(false);
  const [periodeResolue, setPeriodeResolue] = useState("");
  const [resolutionEnCours, setResolutionEnCours] = useState(false);
  const [apercu, setApercu] = useState<BulletinApercuResponse | null>(null);
  const [apercuEnCours, setApercuEnCours] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [tpls, ch, cs] = await Promise.all([
          rapportsApi.listerTemplates("BULLETIN"),
          rapportsApi.champsDisponibles(),
          db.list<Collab>("collaborateurs", { select: "id,matricule,nom,prenom", archive: false, order: "nom", limit: 2000 }),
        ]);
        setTemplates(tpls);
        setChamps(ch);
        cs.sort((a, b) => (a.nom + a.prenom).localeCompare(b.nom + b.prenom));
        setCollabs(cs);
        const parDefaut = tpls.find((t) => t.par_defaut) ?? tpls[0];
        if (parDefaut) setTemplateId(parDefaut.id);
      } catch (e: any) {
        toast.error("Chargement impossible", { description: e.message });
      } finally {
        setChargement(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!templateId) return;
    setChargement(true);
    rapportsApi.lireConfigBulletin(templateId)
      .then(setConfig)
      .catch((e) => toast.error("Config introuvable", { description: e.message }))
      .finally(() => setChargement(false));
  }, [templateId]);

  function majEntete(index: number, patch: Partial<EnteteChamp>) {
    if (!config) return;
    const entete = config.entete_config.map((c, i) => (i === index ? { ...c, ...patch } : c));
    setConfig({ ...config, entete_config: entete });
  }

  function ajouterEntete() {
    if (!config) return;
    setConfig({ ...config, entete_config: [...config.entete_config, { libelle: "Nouveau champ", cle_identite: "" }] });
  }

  function supprimerEntete(index: number) {
    if (!config) return;
    setConfig({ ...config, entete_config: config.entete_config.filter((_, i) => i !== index) });
  }

  function toggleColonne(cle: string) {
    if (!config) return;
    const deja = config.corps_config.colonnes.some((c) => c.cle === cle);
    const colonnes = deja
      ? config.corps_config.colonnes.filter((c) => c.cle !== cle)
      : [...config.corps_config.colonnes, COLONNES_DISPONIBLES.find((c) => c.cle === cle)!];
    setConfig({ ...config, corps_config: { ...config.corps_config, colonnes } });
  }

  function majCumul(index: number, patch: Partial<PiedCumul>) {
    if (!config) return;
    const cumuls = config.pied_config.cumuls.map((c, i) => (i === index ? { ...c, ...patch } : c));
    setConfig({ ...config, pied_config: { ...config.pied_config, cumuls } });
  }

  function ajouterCumul() {
    if (!config) return;
    setConfig({
      ...config,
      pied_config: { ...config.pied_config, cumuls: [...config.pied_config.cumuls, { code_rubrique: "", libelle: "Nouveau cumul" }] },
    });
  }

  function supprimerCumul(index: number) {
    if (!config) return;
    setConfig({ ...config, pied_config: { ...config.pied_config, cumuls: config.pied_config.cumuls.filter((_, i) => i !== index) } });
  }

  async function enregistrer() {
    if (!config || !templateId) return;
    setSauvegarde(true);
    try {
      const nouvelle = await rapportsApi.sauvegarderConfigBulletin(templateId, {
        style: config.style,
        entete_config: config.entete_config,
        corps_config: config.corps_config,
        pied_config: config.pied_config,
      });
      setConfig(nouvelle);
      toast.success("Configuration enregistrée");
    } catch (e: any) {
      toast.error("Échec de l'enregistrement", { description: e.message });
    } finally {
      setSauvegarde(false);
    }
  }

  useEffect(() => {
    if (!collabId) { setBulletinIdTest(""); setPeriodeResolue(""); setApercu(null); return; }
    setResolutionEnCours(true);
    rapportsApi.dernierBulletin(collabId)
      .then((r) => { setBulletinIdTest(r.bulletin_id); setPeriodeResolue(`${r.periode_libelle} (${r.origine})`); })
      .catch((e) => { toast.error("Aucune paie trouvée", { description: e.message }); setBulletinIdTest(""); setPeriodeResolue(""); })
      .finally(() => setResolutionEnCours(false));
  }, [collabId]);

  const collab = collabs.find((c) => c.id === collabId);

  async function lancerApercu() {
    if (!templateId || !bulletinIdTest.trim()) {
      toast.error("Renseigne un identifiant de bulletin pour tester l'aperçu");
      return;
    }
    setApercuEnCours(true);
    try {
      const res = await rapportsApi.apercuBulletin(templateId, bulletinIdTest.trim());
      setApercu(res);
    } catch (e: any) {
      toast.error("Aperçu impossible", { description: e.message });
    } finally {
      setApercuEnCours(false);
    }
  }

  async function exporterPdf() {
    if (!templateId || !bulletinIdTest.trim()) return;
    try {
      const blob = await rapportsApi.genererBulletinPdf(templateId, bulletinIdTest.trim());
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "bulletin_de_paie.pdf";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast.error("Export impossible", { description: e.message });
    }
  }

  return (
    <div className="p-6 space-y-6 w-full">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Configuration des Bulletins de paie</h1>
        <p className="text-sm text-muted-foreground mt-1">
          5 modèles au contenu identique (conforme au Code du Travail marocain) — seule la présentation change.
          Personnalise le corps et le pied de page de chaque modèle indépendamment.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="space-y-1.5 max-w-md">
            <label className="text-sm font-medium">Modèle à configurer</label>
            <Select value={templateId} onValueChange={setTemplateId}>
              <SelectTrigger><SelectValue placeholder="Choisir un modèle" /></SelectTrigger>
              <SelectContent>
                {templates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.libelle}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {chargement && <Skeleton className="h-96 w-full" />}

      {!chargement && config && (
        <>
          <Card>
            <CardHeader><CardTitle className="text-base">En-tête — champs collaborateur</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {config.entete_config.map((c, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <Input className="w-56" value={c.libelle} onChange={(e) => majEntete(i, { libelle: e.target.value })} placeholder="Libellé imprimé" />
                  <Select value={c.cle_identite} onValueChange={(v) => majEntete(i, { cle_identite: v })}>
                    <SelectTrigger className="w-72"><SelectValue placeholder="Champ source…" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="identite.nom_complet">Civilité + Nom + Prénom</SelectItem>
                      {champs?.champs_snapshot.map((f) => (
                        <SelectItem key={f.cle} value={f.cle}>{f.libelle}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button size="icon" variant="ghost" onClick={() => supprimerEntete(i)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
              <Button size="sm" variant="outline" onClick={ajouterEntete}>
                <Plus className="h-4 w-4 mr-1" /> Ajouter un champ
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Corps — colonnes du tableau des rubriques</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-4 flex-wrap">
                {COLONNES_DISPONIBLES.map((c) => (
                  <label key={c.cle} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={config.corps_config.colonnes.some((x) => x.cle === c.cle)}
                      onChange={() => toggleColonne(c.cle)}
                    />
                    {c.libelle}
                  </label>
                ))}
              </div>
              <div className="flex gap-6 items-center">
                <label className="flex items-center gap-2 text-sm">
                  <Switch
                    checked={config.corps_config.afficher_cotisations_patronales}
                    onCheckedChange={(v) => setConfig({ ...config, corps_config: { ...config.corps_config, afficher_cotisations_patronales: v } })}
                  />
                  Afficher les cotisations patronales
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3 max-w-lg">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Libellé section gains</label>
                  <Input value={config.corps_config.libelle_section_gains}
                    onChange={(e) => setConfig({ ...config, corps_config: { ...config.corps_config, libelle_section_gains: e.target.value } })} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Libellé section retenues</label>
                  <Input value={config.corps_config.libelle_section_retenues}
                    onChange={(e) => setConfig({ ...config, corps_config: { ...config.corps_config, libelle_section_retenues: e.target.value } })} />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Pied de page</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm font-medium block mb-2">Cumuls annuels affichés</label>
                <div className="space-y-2">
                  {config.pied_config.cumuls.map((c, i) => (
                    <div key={i} className="flex gap-2 items-center">
                      <RubriqueCombobox
                        value={c.code_rubrique}
                        options={champs?.rubriques || []}
                        onChange={(code) => {
                          const option = champs?.rubriques.find((o) => o.code === code);
                          majCumul(i, { code_rubrique: code, libelle: c.libelle || option?.libelle || "" });
                        }}
                      />
                      <Input className="w-56" placeholder="Libellé" value={c.libelle} onChange={(e) => majCumul(i, { libelle: e.target.value })} />
                      <Button size="icon" variant="ghost" onClick={() => supprimerCumul(i)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  ))}
                  <Button size="sm" variant="outline" onClick={ajouterCumul}>
                    <Plus className="h-4 w-4 mr-1" /> Ajouter un cumul
                  </Button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium">Mentions légales</label>
                <Textarea
                  value={config.pied_config.mentions_legales}
                  onChange={(e) => setConfig({ ...config, pied_config: { ...config.pied_config, mentions_legales: e.target.value } })}
                  rows={3}
                />
              </div>

              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={config.pied_config.afficher_signature}
                  onCheckedChange={(v) => setConfig({ ...config, pied_config: { ...config.pied_config, afficher_signature: v } })}
                />
                Afficher la zone de signature
              </label>
              {config.pied_config.afficher_signature && (
                <Input
                  className="max-w-md"
                  value={config.pied_config.texte_signature}
                  onChange={(e) => setConfig({ ...config, pied_config: { ...config.pied_config, texte_signature: e.target.value } })}
                  placeholder="Texte affiché au-dessus de la signature"
                />
              )}
            </CardContent>
          </Card>

          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => navigate(-1)} disabled={sauvegarde}>
              Annuler
            </Button>
            <Button onClick={enregistrer} disabled={sauvegarde}>
              {sauvegarde ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
              Enregistrer
            </Button>
          </div>

          <Card>
            <CardHeader><CardTitle className="text-base">Tester sur un bulletin réel</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2 items-end flex-wrap">
                <div className="space-y-1.5 w-72">
                  <label className="text-sm font-medium">Collaborateur (matricule actif)</label>
                  <Popover open={collabOpen} onOpenChange={setCollabOpen}>
                    <PopoverTrigger asChild>
                      <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
                        {collab ? `${collab.nom} ${collab.prenom} — ${collab.matricule}` : "Sélectionner…"}
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                      <Command filter={(v, s) => (v.toLowerCase().includes(s.toLowerCase()) ? 1 : 0)}>
                        <CommandInput placeholder="Nom, prénom ou matricule…" />
                        <CommandList>
                          <CommandEmpty>Aucun collaborateur.</CommandEmpty>
                          <CommandGroup>
                            {collabs.map((c) => (
                              <CommandItem
                                key={c.id}
                                value={`${c.nom} ${c.prenom} ${c.matricule}`}
                                onSelect={() => { setCollabId(c.id); setCollabOpen(false); }}
                              >
                                <Check className={`mr-2 h-4 w-4 ${c.id === collabId ? "opacity-100" : "opacity-0"}`} />
                                <span className="flex-1">{c.nom} {c.prenom}</span>
                                <span className="text-xs text-muted-foreground">{c.matricule}</span>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>
                <Button variant="outline" onClick={lancerApercu} disabled={apercuEnCours || !bulletinIdTest}>
                  {apercuEnCours ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Eye className="h-4 w-4 mr-1" />}
                  Aperçu
                </Button>
                <Button variant="outline" onClick={exporterPdf} disabled={!bulletinIdTest}>
                  <FileDown className="h-4 w-4 mr-1" /> Exporter PDF
                </Button>
              </div>

              {resolutionEnCours && <p className="text-xs text-muted-foreground">Recherche de la dernière paie calculée…</p>}
              {!resolutionEnCours && periodeResolue && (
                <p className="text-xs text-muted-foreground">
                  Dernière paie calculée : <span className="font-medium">{periodeResolue}</span>
                </p>
              )}
              {!resolutionEnCours && collabId && !periodeResolue && (
                <p className="text-xs text-destructive">Aucune paie calculée trouvée pour ce collaborateur.</p>
              )}

              {apercu && (
                <div className="border rounded p-4 text-sm space-y-2 bg-muted/30">
                  <p className="font-semibold">{apercu.periode_libelle}</p>
                  {apercu.entete_collaborateur.map((c, i) => (
                    <p key={i}><span className="font-medium">{c.libelle} :</span> {String(c.valeur ?? "—")}</p>
                  ))}
                  <p className="pt-2 font-semibold">Net à payer : {apercu.totaux.net_a_payer?.toLocaleString("fr-MA")}</p>
                  <p className="text-xs text-muted-foreground">{apercu.lignes.length} ligne(s) de paie</p>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
