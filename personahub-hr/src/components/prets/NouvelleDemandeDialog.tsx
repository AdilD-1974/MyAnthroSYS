// src/components/prets/NouvelleDemandeDialog.tsx
//
// Dialogue de nouvelle demande, ouvert depuis MesPretsPage.tsx (bouton
// "Nouvelle demande" et etat vide). Etapes : simulation -> adoption ->
// eligibilite -> soumission (dossier fonctionnel para 4.1).
import React, { useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  pretsApi, VerificationEligibiliteResponse,
} from "@/lib/pretsApi";
import SimulateurPret from "@/components/prets/SimulateurPret";

export interface NouvelleDemandeDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

interface ParametresAdoptes {
  type_code: string;
  montant: number;
  nb_echeance: number;
  date_premiere_echeance: string;
}

const NouvelleDemandeDialog: React.FC<NouvelleDemandeDialogProps> = ({ open, onClose, onSuccess }) => {
  const [parametres, setParametres] = useState<ParametresAdoptes | null>(null);
  const [objet, setObjet] = useState("");
  const [motif, setMotif] = useState("");
  const [eligibilite, setEligibilite] = useState<VerificationEligibiliteResponse | null>(null);
  const [verification, setVerification] = useState(false);
  const [soumission, setSoumission] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const reinitialiser = () => {
    setParametres(null);
    setObjet("");
    setMotif("");
    setEligibilite(null);
    setErreur(null);
  };

  const fermer = () => {
    reinitialiser();
    onClose();
  };

  const verifierEligibilite = async (p: ParametresAdoptes) => {
    setVerification(true);
    setErreur(null);
    try {
      const resultat = await pretsApi.verifierEligibilite({
        type_code: p.type_code, montant: p.montant, nb_echeance: p.nb_echeance,
        date_premiere_echeance: p.date_premiere_echeance,
      });
      setEligibilite(resultat);
    } catch (e: any) {
      setErreur(e?.message ?? "Erreur lors de la verification d'eligibilite.");
    } finally {
      setVerification(false);
    }
  };

  const adopter = (p: ParametresAdoptes) => {
    setParametres(p);
    verifierEligibilite(p);
  };

  const soumettre = async () => {
    if (!parametres) return;
    setSoumission(true);
    setErreur(null);
    try {
      await pretsApi.soumettreDemande({
        type_code: parametres.type_code, montant: parametres.montant,
        nb_echeance: parametres.nb_echeance, date_premiere_echeance: parametres.date_premiere_echeance,
        objet: objet || undefined, motif: motif || undefined,
      });
      onSuccess();
      fermer();
    } catch (e: any) {
      setErreur(e?.message ?? "Erreur lors de la soumission de la demande.");
    } finally {
      setSoumission(false);
    }
  };

  const bloque = eligibilite !== null && !eligibilite.eligible;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) fermer(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">Nouvelle demande de pret</DialogTitle>
        </DialogHeader>

        {!parametres ? (
          <SimulateurPret showAdopter onAdopter={adopter} />
        ) : (
          <div className="space-y-4">
            <div className="rounded-md border border-border bg-secondary/20 p-3 text-sm">
              Simulation retenue : <strong>{parametres.montant} DH</strong> sur <strong>{parametres.nb_echeance} mois</strong>,
              premiere echeance le <strong>{parametres.date_premiere_echeance}</strong>.
              <button type="button" className="ml-2 text-xs text-primary underline" onClick={reinitialiser}>
                Modifier la simulation
              </button>
            </div>

            <div>
              <Label className="text-xs mb-1 block">Objet de la demande</Label>
              <Textarea rows={2} value={objet} onChange={e => setObjet(e.target.value)} placeholder="Ex. Travaux de logement, evenement familial..." />
            </div>
            <div>
              <Label className="text-xs mb-1 block">Motif / precisions (optionnel)</Label>
              <Textarea rows={2} value={motif} onChange={e => setMotif(e.target.value)} />
            </div>

            {verification && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 size={13} className="animate-spin" /> Verification de votre eligibilite...
              </div>
            )}

            {eligibilite && (
              <div className="space-y-1.5">
                {eligibilite.resultats.map(r => (
                  <div
                    key={r.code_regle}
                    className="flex items-start gap-2 rounded-md border p-2 text-xs"
                    style={{
                      borderColor: r.respectee ? "hsl(var(--success) / 0.3)" : "hsl(var(--destructive) / 0.3)",
                      background: r.respectee ? "hsl(var(--success) / 0.08)" : "hsl(var(--destructive) / 0.08)",
                    }}
                  >
                    {r.respectee
                      ? <CheckCircle2 size={13} className="mt-0.5 flex-shrink-0" style={{ color: "hsl(var(--success))" }} />
                      : <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" style={{ color: "hsl(var(--destructive))" }} />}
                    <div>
                      <p className="font-medium">{r.libelle}</p>
                      <p className="text-muted-foreground">{r.message}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {erreur && (
              <div className="flex items-center gap-2 text-xs text-destructive">
                <AlertTriangle size={13} /> {erreur}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={fermer}>Annuler</Button>
          {parametres && (
            <Button onClick={soumettre} disabled={soumission || bloque}>
              {soumission && <Loader2 size={14} className="mr-2 animate-spin" />}
              Soumettre la demande
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default NouvelleDemandeDialog;
