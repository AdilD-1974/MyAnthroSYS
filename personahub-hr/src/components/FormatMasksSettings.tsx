/**
 * FormatMasksSettings – UI de paramétrage des masques d'affichage.
 * Réutilisable dans Paramètres RH et Paramétrage Paie.
 */
import React, { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Save, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface MaskParam {
  id: string;
  code: string;
  libelle: string;
  valeur: string;
  description: string | null;
}

const DATE_FORMATS = [
  "DD/MM/YYYY", "DD-MM-YYYY", "DD.MM.YYYY",
  "MM/DD/YYYY", "MM-DD-YYYY",
  "YYYY-MM-DD", "YYYY/MM/DD",
  "DD/MM/YY", "MM-DD-YY",
];

const SEPARATEUR_OPTIONS = [
  { code: "SPACE", label: "Espace ( )", real: " " },
  { code: "DOT", label: "Point (.)", real: "." },
  { code: "COMMA", label: "Virgule (,)", real: "," },
  { code: "NONE", label: "Aucun", real: "" },
];

const DECIMAL_OPTIONS = [
  { code: ",", label: "Virgule (,)" },
  { code: ".", label: "Point (.)" },
];

const POSITION_OPTIONS = [
  { code: "AVANT", label: "Avant le montant" },
  { code: "APRES", label: "Après le montant" },
];

const sepToCode = (real: string): string => SEPARATEUR_OPTIONS.find(o => o.real === real)?.code || "SPACE";
const codeToSep = (code: string): string => SEPARATEUR_OPTIONS.find(o => o.code === code)?.real ?? " ";

const applyDateFormat = (fmt: string): string => {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yyyy = String(now.getFullYear());
  return fmt.replace("DD", dd).replace("MM", mm).replace("YYYY", yyyy).replace("YY", yyyy.slice(-2));
};

const applyNumberFormat = (val: number, dec: number, sepM: string, sepD: string): string => {
  const parts = val.toFixed(dec).split(".");
  const intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, sepM);
  return intPart + (parts[1] ? sepD + parts[1] : "");
};

const FormatMasksSettings: React.FC = () => {
  const [masks, setMasks] = useState<MaskParam[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadMasks();
  }, []);

  const loadMasks = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("parametres_rh" as never)
      .select("id,code,libelle,valeur,description")
      .like("code" as never, "FORMAT_%" as never)
      .order("code" as never);

    // Valeurs par défaut (pour l'affichage initial si aucune ligne en base)
    const DEFAULTS: Record<string, string> = {
      FORMAT_DATE: "DD/MM/YYYY",
      FORMAT_NOMBRE_DECIMALES: "2",
      FORMAT_NOMBRE_SEPARATEUR_MILLIERS: "SPACE",
      FORMAT_NOMBRE_SEPARATEUR_DECIMAL: ",",
      FORMAT_DEVISE_SYMBOLE: "MAD",
      FORMAT_DEVISE_POSITION: "APRES",
      FORMAT_POURCENTAGE_DECIMALES: "2",
      FORMAT_MATRICULE: "######",
    };

    if (error) {
      console.error("[FORMAT] loadMasks erreur :", error);
      setMasks([]);
      setValues({ ...DEFAULTS });
    } else {
      const rows = (data as MaskParam[]) || [];
      setMasks(rows);
      // Démarrer avec les défauts puis écraser avec ce qui est en base
      const v: Record<string, string> = { ...DEFAULTS };
      rows.forEach(d => { v[d.code] = d.valeur || ""; });
      setValues(v);
    }
    setLoading(false);
  };

  const updateValue = (code: string, val: string) => {
    setValues((prev) => ({ ...prev, [code]: val }));
  };

  const saveAll = async () => {
    setSaving(true);
    // Liste exhaustive des 8 codes attendus (pour gérer le cas où une ligne
    // n'existe pas encore en base et nécessite un INSERT au lieu d'un UPDATE)
    const ALL_CODES = [
      "FORMAT_DATE",
      "FORMAT_NOMBRE_DECIMALES",
      "FORMAT_NOMBRE_SEPARATEUR_MILLIERS",
      "FORMAT_NOMBRE_SEPARATEUR_DECIMAL",
      "FORMAT_DEVISE_SYMBOLE",
      "FORMAT_DEVISE_POSITION",
      "FORMAT_POURCENTAGE_DECIMALES",
      "FORMAT_MATRICULE",
    ];
    const LIBELLES: Record<string, string> = {
      FORMAT_DATE: "Format de date",
      FORMAT_NOMBRE_DECIMALES: "Décimales nombres",
      FORMAT_NOMBRE_SEPARATEUR_MILLIERS: "Séparateur des milliers",
      FORMAT_NOMBRE_SEPARATEUR_DECIMAL: "Séparateur décimal",
      FORMAT_DEVISE_SYMBOLE: "Symbole devise",
      FORMAT_DEVISE_POSITION: "Position symbole devise",
      FORMAT_POURCENTAGE_DECIMALES: "Décimales pourcentage",
      FORMAT_MATRICULE: "Masque matricule",
    };

    let nbUpdates = 0;
    let nbInserts = 0;
    let nbErreurs = 0;

    for (const code of ALL_CODES) {
      const newVal = values[code];
      if (newVal === undefined) continue; // l'utilisateur n'a pas touché ce champ et il n'est pas en base
      const existing = masks.find(m => m.code === code);

      if (existing) {
        // UPDATE si la valeur a changé
        if (existing.valeur !== newVal) {
          const { error } = await supabase.from("parametres_rh" as never)
            .update({ valeur: newVal } as never)
            .eq("id" as never, existing.id as never);
          if (error) {
            console.error(`[FORMAT] UPDATE ${code} :`, error);
            nbErreurs++;
          } else {
            nbUpdates++;
          }
        }
      } else {
        // INSERT — la ligne n'existait pas en base
        const { error } = await supabase.from("parametres_rh" as never)
          .insert({
            code,
            libelle: LIBELLES[code] || code,
            valeur: newVal,
            actif: true,
          } as never);
        if (error) {
          console.error(`[FORMAT] INSERT ${code} :`, error);
          nbErreurs++;
        } else {
          nbInserts++;
        }
      }
    }

    // RG-FORMAT-01 (Adil DAIA) : invalider le cache global pour rafraîchir partout
    try {
      const { invalidateFormatMasks } = await import("@/hooks/useFormatMasks");
      invalidateFormatMasks();
    } catch { /* ignore */ }

    if (nbErreurs > 0) {
      toast.error(`${nbErreurs} erreur(s) lors de la sauvegarde — voir la console`);
    } else if (nbUpdates === 0 && nbInserts === 0) {
      toast.info("Aucune modification à enregistrer");
    } else {
      toast.success(`Masques sauvegardés (${nbInserts} créé(s), ${nbUpdates} modifié(s))`);
    }
    setSaving(false);
    loadMasks();
  };

  const v = values;
  const previewDate = applyDateFormat(v.FORMAT_DATE || "DD/MM/YYYY");
  const previewNumber = applyNumberFormat(
    1234567.89,
    parseInt(v.FORMAT_NOMBRE_DECIMALES) || 2,
    codeToSep(v.FORMAT_NOMBRE_SEPARATEUR_MILLIERS || "SPACE"),
    v.FORMAT_NOMBRE_SEPARATEUR_DECIMAL || ","
  );
  const previewCurrency = v.FORMAT_DEVISE_POSITION === "AVANT"
    ? `${v.FORMAT_DEVISE_SYMBOLE || "MAD"} ${previewNumber}`
    : `${previewNumber} ${v.FORMAT_DEVISE_SYMBOLE || "MAD"}`;
  const previewPercent = applyNumberFormat(
    15.75,
    parseInt(v.FORMAT_POURCENTAGE_DECIMALES) || 2,
    codeToSep(v.FORMAT_NOMBRE_SEPARATEUR_MILLIERS || "SPACE"),
    v.FORMAT_NOMBRE_SEPARATEUR_DECIMAL || ","
  ) + " %";

  if (loading) return <div className="text-center py-8 text-muted-foreground text-sm">Chargement…</div>;

  return (
    <div className="space-y-6">
      {/* Prévisualisation en temps réel */}
      <Card className="border-accent/30 bg-accent/5">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Eye size={14} className="text-accent" />
            Prévisualisation en temps réel
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-[10px] text-muted-foreground uppercase mb-1">Date</p>
              <Badge variant="outline" className="text-sm font-mono">{previewDate}</Badge>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase mb-1">Nombre</p>
              <Badge variant="outline" className="text-sm font-mono">{previewNumber}</Badge>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase mb-1">Devise</p>
              <Badge variant="outline" className="text-sm font-mono">{previewCurrency}</Badge>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase mb-1">Pourcentage</p>
              <Badge variant="outline" className="text-sm font-mono">{previewPercent}</Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Dates */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Format de date</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label className="text-xs">Masque</Label>
              <Select value={v.FORMAT_DATE || "DD/MM/YYYY"} onValueChange={(val) => updateValue("FORMAT_DATE", val)}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DATE_FORMATS.map((f) => (
                    <SelectItem key={f} value={f}>
                      {f} → {applyDateFormat(f)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground mt-1">DD=jour, MM=mois, YYYY=année (4 chiffres), YY=année (2 chiffres)</p>
            </div>
          </CardContent>
        </Card>

        {/* Nombres */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Format numérique</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label className="text-xs">Décimales</Label>
              <Select value={v.FORMAT_NOMBRE_DECIMALES || "2"} onValueChange={(val) => updateValue("FORMAT_NOMBRE_DECIMALES", val)}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["0", "1", "2", "3", "4"].map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Séparateur des milliers</Label>
              <Select value={v.FORMAT_NOMBRE_SEPARATEUR_MILLIERS || "SPACE"} onValueChange={(val) => updateValue("FORMAT_NOMBRE_SEPARATEUR_MILLIERS", val)}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SEPARATEUR_OPTIONS.map((o) => <SelectItem key={o.code} value={o.code}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Séparateur décimal</Label>
              <Select value={v.FORMAT_NOMBRE_SEPARATEUR_DECIMAL || ","} onValueChange={(val) => updateValue("FORMAT_NOMBRE_SEPARATEUR_DECIMAL", val)}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DECIMAL_OPTIONS.map((o) => <SelectItem key={o.code} value={o.code}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Devises */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Format monétaire</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label className="text-xs">Symbole / Code devise</Label>
              <Input value={v.FORMAT_DEVISE_SYMBOLE || ""} onChange={(e) => updateValue("FORMAT_DEVISE_SYMBOLE", e.target.value)} className="h-9 text-sm" placeholder="MAD, €, $, DH" />
            </div>
            <div>
              <Label className="text-xs">Position du symbole</Label>
              <Select value={v.FORMAT_DEVISE_POSITION || "APRES"} onValueChange={(val) => updateValue("FORMAT_DEVISE_POSITION", val)}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {POSITION_OPTIONS.map((o) => <SelectItem key={o.code} value={o.code}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Pourcentages & Matricule */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Pourcentages & Matricule</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label className="text-xs">Décimales pourcentage</Label>
              <Select value={v.FORMAT_POURCENTAGE_DECIMALES || "2"} onValueChange={(val) => updateValue("FORMAT_POURCENTAGE_DECIMALES", val)}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["0", "1", "2", "3", "4"].map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Masque matricule</Label>
              <Input value={v.FORMAT_MATRICULE || ""} onChange={(e) => updateValue("FORMAT_MATRICULE", e.target.value)} className="h-9 text-sm" placeholder="######" />
              <p className="text-[10px] text-muted-foreground mt-1"># = chiffre, A = lettre. Ex : ######, AA-####, ###-AAA</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-end">
        <Button onClick={saveAll} disabled={saving} className="gap-2">
          <Save size={14} /> {saving ? "Sauvegarde…" : "Enregistrer les masques"}
        </Button>
      </div>
    </div>
  );
};

export default FormatMasksSettings;
