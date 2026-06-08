import React, { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useManagerPopulation } from "@/hooks/useManagerPopulation";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { CheckCircle, XCircle, Search, Clock, Eye, CalendarCheck } from "lucide-react";

const STATUT_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  BROUILLON:   { bg: "hsl(var(--muted))",            text: "hsl(var(--muted-foreground))", label: "Brouillon" },
  EN_ATTENTE:  { bg: "hsl(38 92% 50%/0.15)",         text: "hsl(38 92% 40%)",              label: "En attente" },
  APPROUVEE:   { bg: "hsl(142 71% 45%/0.15)",        text: "hsl(142 71% 35%)",             label: "Approuvée" },
  REFUSEE:     { bg: "hsl(0 72% 51%/0.15)",          text: "hsl(0 72% 41%)",               label: "Refusée" },
  ANNULEE:     { bg: "hsl(var(--muted))",             text: "hsl(var(--muted-foreground))", label: "Annulée" },
};

export default function ValidationDemandesPage() {
  const { role } = useAuth();
  const { collaborateurIds, loading: popLoading } = useManagerPopulation();
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [filterStatut, setFilterStatut] = useState("EN_ATTENTE");
  const [filterType, setFilterType] = useState("ALL");
  const [selectedDemande, setSelectedDemande] = useState<any | null>(null);
  const [actionType, setActionType] = useState<"approuver" | "refuser" | null>(null);
  const [commentaire, setCommentaire] = useState("");

  const { data: typesConge = [] } = useQuery({
    queryKey: ["ref-type-conge-actifs"],
    queryFn: async () => {
      const data = []; const error = null; // Supabase desactive
      return data || [];
    },
  });

  // Pour l'admin/gestionnaire RH : toutes les demandes. Pour le manager : filtrées par population
  const isManager = role === "manager";
  const canLoad = !isManager || (!popLoading && collaborateurIds.length >= 0);

  const { data: demandes = [], isLoading } = useQuery({
    queryKey: ["validation-demandes", filterStatut, filterType, collaborateurIds, isManager, search],
    enabled: canLoad,
    queryFn: async () => {
      let q = supabase
        .from("cong_demandes")
        .select("*, collaborateurs(nom, prenom, matricule, statut_collaborateur)")
        .eq("archive", false);

      if (filterStatut !== "ALL") q = q.eq("statut", filterStatut);
      if (filterType !== "ALL") q = q.eq("code_type_conge", filterType);

      // RG-MGR-POP-01 : Le manager ne voit que sa population
      if (isManager) {
        if (collaborateurIds.length === 0) return [];
        q = q.in("collaborateur_id", collaborateurIds);
      }

      const { data, error } = await q.order("date_soumission", { ascending: false });
      if (error) throw error;

      return (data || []).filter((d: any) => {
        if (!search) return true;
        const c = d.collaborateurs;
        const t = search.toLowerCase();
        return c?.nom?.toLowerCase().includes(t) || c?.prenom?.toLowerCase().includes(t) || c?.matricule?.toLowerCase().includes(t);
      });
    },
  });

  const getTypeLibelle = (code: string) => (typesConge as any[]).find(t => t.code === code)?.libelle || code;

  const validateMutation = useMutation({
    mutationFn: async ({ id, statut, motif }: { id: string; statut: string; motif?: string }) => {
      const updateData: any = {
        statut,
        date_validation: new Date().toISOString(),
        commentaire_gestionnaire: motif || null,
      };

      const { error } = await supabase.from("cong_demandes").update(updateData).eq("id", id);
      if (error) throw error;

      // Si approuvée, créer la consommation
      if (statut === "APPROUVEE") {
        const demande = demandes.find((d: any) => d.id === id);
        if (demande) {
          const exercice = new Date(demande.date_debut).getFullYear();
          const { error: errConso } = await supabase.from("cong_consommation").insert({
            collaborateur_id: demande.collaborateur_id,
            code_type_conge: demande.code_type_conge,
            date_debut: demande.date_debut,
            date_retour: demande.date_retour,
            debut_demi_journee: demande.debut_demi_journee,
            fin_demi_journee: demande.fin_demi_journee,
            nbr_jours_calendaires: demande.nbr_jours_calendaires || 0,
            nbr_jours_decomptes: demande.nbr_jours_decomptes || 0,
            exercice,
            demande_id: demande.id,
            est_annulee: false,
          });
          if (errConso) throw errConso;
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["validation-demandes"] });
      qc.invalidateQueries({ queryKey: ["cong-soldes"] });
      toast({ title: actionType === "approuver" ? "Demande approuvée" : "Demande refusée" });
      setSelectedDemande(null);
      setActionType(null);
      setCommentaire("");
    },
    onError: (e: Error) => toast({ title: "Erreur", description: e.message, variant: "destructive" }),
  });

  const handleAction = () => {
    if (!selectedDemande || !actionType) return;
    validateMutation.mutate({
      id: selectedDemande.id,
      statut: actionType === "approuver" ? "APPROUVEE" : "REFUSEE",
      motif: commentaire || undefined,
    });
  };

  const enAttente = demandes.filter((d: any) => d.statut === "EN_ATTENTE").length;
  const approuvees = demandes.filter((d: any) => d.statut === "APPROUVEE").length;
  const refusees = demandes.filter((d: any) => d.statut === "REFUSEE").length;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: "hsl(var(--foreground))" }}>
          <CalendarCheck className="inline mr-2 mb-1" size={22} />Validation des Demandes de Congé
        </h1>
        <p className="text-sm mt-1" style={{ color: "hsl(var(--muted-foreground))" }}>
          {isManager ? "Demandes de votre équipe en attente de validation" : "Toutes les demandes de congé à valider"}
        </p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "En attente", value: enAttente, color: "hsl(38 92% 50%)", icon: <Clock size={18} /> },
          { label: "Approuvées", value: approuvees, color: "hsl(142 71% 45%)", icon: <CheckCircle size={18} /> },
          { label: "Refusées", value: refusees, color: "hsl(0 72% 51%)", icon: <XCircle size={18} /> },
        ].map(k => (
          <Card key={k.label}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg" style={{ background: `${k.color}20`, color: k.color }}>{k.icon}</div>
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
        <CardContent className="p-4 flex gap-3 flex-wrap">
          <div className="relative flex-1 min-w-48">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "hsl(var(--muted-foreground))" }} />
            <Input placeholder="Rechercher un collaborateur…" className="pl-9" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <Select value={filterStatut} onValueChange={setFilterStatut}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="EN_ATTENTE">En attente</SelectItem>
              <SelectItem value="ALL">Tous statuts</SelectItem>
              <SelectItem value="APPROUVEE">Approuvées</SelectItem>
              <SelectItem value="REFUSEE">Refusées</SelectItem>
              <SelectItem value="ANNULEE">Annulées</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="w-48"><SelectValue placeholder="Type de congé" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Tous les types</SelectItem>
              {(typesConge as any[]).map((t: any) => <SelectItem key={t.code} value={t.code}>{t.libelle}</SelectItem>)}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Collaborateur</TableHead>
                <TableHead>Type de congé</TableHead>
                <TableHead>Début</TableHead>
                <TableHead>Fin absence</TableHead>
                <TableHead>Retour</TableHead>
                <TableHead className="text-right">Jours déd.</TableHead>
                <TableHead>Soumis le</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(isLoading || popLoading) && (
                <TableRow><TableCell colSpan={9} className="text-center py-8">Chargement…</TableCell></TableRow>
              )}
              {!isLoading && !popLoading && demandes.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8" style={{ color: "hsl(var(--muted-foreground))" }}>
                    Aucune demande {filterStatut === "EN_ATTENTE" ? "en attente" : ""}
                  </TableCell>
                </TableRow>
              )}
              {(demandes as any[]).map((d: any) => {
                const statut = STATUT_COLORS[d.statut] || STATUT_COLORS.BROUILLON;
                const isPending = d.statut === "EN_ATTENTE";
                return (
                  <TableRow key={d.id}>
                    <TableCell>
                      <div className="font-medium">{d.collaborateurs?.nom} {d.collaborateurs?.prenom}</div>
                      <div className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>{d.collaborateurs?.matricule}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{getTypeLibelle(d.code_type_conge)}</Badge>
                    </TableCell>
                    <TableCell className="text-sm">{new Date(d.date_debut).toLocaleDateString("fr-FR")}</TableCell>
                    <TableCell className="text-sm">{new Date(d.date_fin_absence).toLocaleDateString("fr-FR")}</TableCell>
                    <TableCell className="text-sm">{new Date(d.date_retour).toLocaleDateString("fr-FR")}</TableCell>
                    <TableCell className="text-right font-bold">{Number(d.nbr_jours_decomptes || 0).toFixed(1)}</TableCell>
                    <TableCell className="text-sm">
                      {d.date_soumission ? new Date(d.date_soumission).toLocaleDateString("fr-FR") : "—"}
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
                        style={{ background: statut.bg, color: statut.text }}>
                        {statut.label}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7"
                          onClick={() => { setSelectedDemande(d); setActionType(null); }}>
                          <Eye size={13} />
                        </Button>
                        {isPending && (
                          <>
                            <Button variant="ghost" size="icon" className="h-7 w-7"
                              style={{ color: "hsl(142 71% 45%)" }}
                              onClick={() => { setSelectedDemande(d); setActionType("approuver"); }}>
                              <CheckCircle size={13} />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7"
                              style={{ color: "hsl(0 72% 51%)" }}
                              onClick={() => { setSelectedDemande(d); setActionType("refuser"); }}>
                              <XCircle size={13} />
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Dialog validation / détail */}
      <Dialog open={!!selectedDemande} onOpenChange={open => { if (!open) { setSelectedDemande(null); setActionType(null); setCommentaire(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {actionType === "approuver" ? "Approuver la demande" : actionType === "refuser" ? "Refuser la demande" : "Détail de la demande"}
            </DialogTitle>
          </DialogHeader>
          {selectedDemande && (
            <div className="space-y-4">
              <div className="rounded-lg p-4 space-y-2" style={{ background: "hsl(var(--muted))" }}>
                <div className="font-semibold">{selectedDemande.collaborateurs?.nom} {selectedDemande.collaborateurs?.prenom}</div>
                <div className="text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>{selectedDemande.collaborateurs?.matricule}</div>
                <div className="grid grid-cols-2 gap-2 text-sm mt-2">
                  <div><span style={{ color: "hsl(var(--muted-foreground))" }}>Type :</span> <strong>{getTypeLibelle(selectedDemande.code_type_conge)}</strong></div>
                  <div><span style={{ color: "hsl(var(--muted-foreground))" }}>Jours :</span> <strong>{Number(selectedDemande.nbr_jours_decomptes || 0).toFixed(1)}</strong></div>
                  <div><span style={{ color: "hsl(var(--muted-foreground))" }}>Début :</span> {new Date(selectedDemande.date_debut).toLocaleDateString("fr-FR")}</div>
                  <div><span style={{ color: "hsl(var(--muted-foreground))" }}>Retour :</span> {new Date(selectedDemande.date_retour).toLocaleDateString("fr-FR")}</div>
                </div>
                {selectedDemande.commentaire_collaborateur && (
                  <div className="text-sm mt-2">
                    <span style={{ color: "hsl(var(--muted-foreground))" }}>Commentaire :</span><br />
                    <em>{selectedDemande.commentaire_collaborateur}</em>
                  </div>
                )}
              </div>
              {actionType && (
                <div>
                  <label className="text-sm font-medium block mb-1">
                    {actionType === "refuser" ? "Motif de refus *" : "Commentaire (optionnel)"}
                  </label>
                  <Textarea
                    value={commentaire}
                    onChange={e => setCommentaire(e.target.value)}
                    placeholder={actionType === "refuser" ? "Précisez le motif de refus…" : "Commentaire optionnel…"}
                    rows={3}
                  />
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setSelectedDemande(null); setActionType(null); setCommentaire(""); }}>
              Fermer
            </Button>
            {actionType === "approuver" && (
              <Button
                style={{ background: "hsl(142 71% 45%)", color: "white" }}
                onClick={handleAction}
                disabled={validateMutation.isPending}
              >
                <CheckCircle size={14} className="mr-1" /> Approuver
              </Button>
            )}
            {actionType === "refuser" && (
              <Button
                variant="destructive"
                onClick={handleAction}
                disabled={validateMutation.isPending || !commentaire.trim()}
              >
                <XCircle size={14} className="mr-1" /> Refuser
              </Button>
            )}
            {!actionType && selectedDemande?.statut === "EN_ATTENTE" && (
              <>
                <Button
                  style={{ background: "hsl(142 71% 45%)", color: "white" }}
                  onClick={() => setActionType("approuver")}
                >
                  <CheckCircle size={14} className="mr-1" /> Approuver
                </Button>
                <Button variant="destructive" onClick={() => setActionType("refuser")}>
                  <XCircle size={14} className="mr-1" /> Refuser
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
