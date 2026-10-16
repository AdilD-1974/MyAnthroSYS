/**
 * DeleguerButton.tsx
 * Auteur : Adil DAIA
 *
 * Bouton « Déléguer » pour une tâche de validation en attente (délégation
 * PONCTUELLE). Réassigne l'étape courante à un autre collaborateur, qui la
 * verra dans son inbox à votre place.
 *
 *   <DeleguerButton
 *      instanceEtapeId={tache.ie_id}
 *      acteurId={monCollaborateurId}
 *      onDone={refetchInbox}
 *   />
 */
import { useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Share2 } from "lucide-react";
import CollaborateurPicker from "@/components/CollaborateurPicker";

interface Props {
  instanceEtapeId: string;
  acteurId: string;            // collaborateur courant
  onDone?: () => void;
  size?: "sm" | "default";
}

export default function DeleguerButton({ instanceEtapeId, acteurId, onDone, size = "sm" }: Props) {
  const [open, setOpen] = useState(false);
  const [cible, setCible] = useState("");
  const [motif, setMotif] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    if (!cible) { setErr("Choisissez un délégataire."); return; }
    setBusy(true);
    try {
      await api.post(`/workflow/decide`, {
        instance_etape_id: instanceEtapeId,
        acteur_id: acteurId,
        type_decision: "DELEGUER",
        cible_id: cible,
        commentaire: motif || null,
      });
      setOpen(false); setCible(""); setMotif("");
      onDone?.();
    } catch (e: any) {
      setErr(typeof e === "string" ? e : e?.response?.data?.detail || e?.detail || e?.message || "Échec de la délégation.");
    } finally { setBusy(false); }
  };

  return (
    <>
      <Button variant="outline" size={size} onClick={() => setOpen(true)} className="gap-1.5">
        <Share2 size={14} /> Déléguer
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Déléguer cette validation</DialogTitle>
            <DialogDescription>
              Le collaborateur choisi recevra cette tâche à votre place.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Déléguer à *</Label>
              <CollaborateurPicker value={cible} onChange={setCible} excludeId={acteurId} />
            </div>
            <div className="space-y-1.5">
              <Label>Motif (facultatif)</Label>
              <Textarea rows={2} value={motif} onChange={(e) => setMotif(e.target.value)} />
            </div>
            {err && <p className="text-sm text-red-600">{err}</p>}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Annuler</Button>
            <Button onClick={submit} disabled={busy || !cible}>
              {busy ? "Délégation…" : "Déléguer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
