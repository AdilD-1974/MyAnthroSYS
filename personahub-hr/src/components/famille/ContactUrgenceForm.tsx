import React, { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Plus, Pencil, Trash2, AlertCircle, Save, Phone } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from "@/components/ui/dialog";
import RefSelect from "@/components/RefSelect";
import { Button } from "@/components/ui/button";

interface Contact {
  id: string;
  nom_contact?: string | null;
  code_lien: string;
  telephone?: string | null;
  mobile?: string | null;
  mail?: string | null;
  adresse?: string | null;
  est_principal: boolean;
  est_urgence: boolean;
  observations?: string | null;
}

const EMPTY: Omit<Contact, "id"> = {
  nom_contact: "", code_lien: "",
  telephone: "", mobile: "", mail: "", adresse: "",
  est_principal: false, est_urgence: false, observations: "",
};

const FI: React.FC<{ label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean; className?: string }> =
  ({ label, value, onChange, type = "text", required, className }) => (
    <div className={className}>
      <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>
        {label}{required && <span style={{ color: "hsl(0 84% 55%)" }}> *</span>}
      </label>
      <input type={type} value={value || ""} onChange={e => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded-lg border text-sm outline-none"
        style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))", height: 38 }} />
    </div>
  );

const FB: React.FC<{ label: string; value: boolean; onChange: (v: boolean) => void }> = ({ label, value, onChange }) => (
  <div className="flex items-center gap-3">
    <button type="button" onClick={() => onChange(!value)}
      className="w-10 h-5 rounded-full transition-colors relative flex-shrink-0"
      style={{ background: value ? "hsl(var(--accent))" : "hsl(var(--border))" }}>
      <span className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all shadow-sm"
        style={{ left: value ? "calc(100% - 18px)" : "2px" }} />
    </button>
    <span className="text-sm" style={{ color: "hsl(var(--foreground))" }}>{label}</span>
  </div>
);

const FieldView: React.FC<{ label: string; value?: string | null }> = ({ label, value }) => (
  <div>
    <p className="text-xs font-medium mb-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>{label}</p>
    <p className="text-sm" style={{ color: value ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground) / 0.4)" }}>{value || "—"}</p>
  </div>
);

interface Props { collaborateurId: string }

const ContactUrgenceForm: React.FC<Props> = ({ collaborateurId }) => {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Contact | null>(null);
  const [form, setForm] = useState<Omit<Contact, "id">>(EMPTY);
  const [saving, setSaving] = useState(false);

  React.useEffect(() => { load(); }, [collaborateurId]);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("collaborateur_contacts")
      .select("*")
      .eq("collaborateur_id", collaborateurId)
      .eq("archive", false)
      .order("est_principal", { ascending: false });
    if (data) setContacts(data as Contact[]);
    setLoading(false);
  };

  const openNew = () => { setEditing(null); setForm(EMPTY); setOpen(true); };
  const openEdit = (c: Contact) => { setEditing(c); setForm({ ...c }); setOpen(true); };
  const set = (k: keyof typeof EMPTY, v: any) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.nom_contact?.trim() || !form.code_lien) return;
    setSaving(true);
    const payload = {
      collaborateur_id: collaborateurId,
      nom_contact: form.nom_contact.trim(),
      code_lien: form.code_lien,
      telephone: form.telephone || null,
      mobile: form.mobile || null,
      mail: form.mail || null,
      adresse: form.adresse || null,
      est_principal: form.est_principal,
      est_urgence: form.est_urgence,
      observations: form.observations || null,
    };
    if (editing) {
      await supabase.from("collaborateur_contacts").update(payload).eq("id", editing.id);
    } else {
      await supabase.from("collaborateur_contacts").insert(payload);
    }
    setSaving(false);
    setOpen(false);
    load();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Supprimer ce contact ?")) return;
    await supabase.from("collaborateur_contacts").update({ archive: true }).eq("id", id);
    load();
  };

  return (
    <>
      <div>
        <div className="flex items-center justify-end mb-3">
          <button onClick={openNew}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold"
            style={{ background: "hsl(var(--accent))", color: "white" }}>
            <Plus size={12} />Ajouter
          </button>
        </div>

        {loading
          ? <div className="h-12 flex items-center justify-center"><div className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "hsl(var(--accent))", borderTopColor: "transparent" }} /></div>
          : contacts.length === 0
            ? <p className="text-sm text-center py-6" style={{ color: "hsl(var(--muted-foreground))" }}>Aucun contact d'urgence enregistré</p>
            : <div className="space-y-2">
                {contacts.map(c => (
                  <div key={c.id} className="rounded-xl border p-4" style={{ background: "hsl(var(--muted) / 0.3)", borderColor: "hsl(var(--border))" }}>
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0"
                          style={{ background: "hsl(var(--accent) / 0.12)", color: "hsl(var(--accent))" }}>
                          {c.nom_contact?.[0]?.toUpperCase() ?? "?"}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-semibold text-sm" style={{ color: "hsl(var(--foreground))" }}>{c.nom_contact}</p>
                            {c.est_principal && (
                              <span className="text-xs px-1.5 py-0.5 rounded-full font-medium"
                                style={{ background: "hsl(var(--accent) / 0.15)", color: "hsl(var(--accent))" }}>
                                Principal
                              </span>
                            )}
                            {c.est_urgence && (
                              <span className="text-xs px-1.5 py-0.5 rounded-full font-medium"
                                style={{ background: "hsl(0 84% 60% / 0.15)", color: "hsl(0 84% 45%)" }}>
                                Urgence
                              </span>
                            )}
                          </div>
                          <p className="text-xs mt-0.5" style={{ color: "hsl(var(--muted-foreground))" }}>
                            Lien : <span className="font-medium">{c.code_lien}</span>
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-1 flex-shrink-0">
                        <button onClick={() => openEdit(c)} className="p-1.5 rounded hover:bg-accent/10 transition-colors" style={{ color: "hsl(var(--accent))" }}><Pencil size={13} /></button>
                        <button onClick={() => handleDelete(c.id)} className="p-1.5 rounded hover:bg-red-50 transition-colors" style={{ color: "hsl(0 84% 55%)" }}><Trash2 size={13} /></button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
                      {c.telephone && (
                        <div className="flex items-center gap-1.5">
                          <Phone size={12} style={{ color: "hsl(var(--muted-foreground))" }} />
                          <span className="text-xs" style={{ color: "hsl(var(--foreground))" }}>{c.telephone}</span>
                        </div>
                      )}
                      {c.mobile && (
                        <div className="flex items-center gap-1.5">
                          <Phone size={12} style={{ color: "hsl(var(--accent))" }} />
                          <span className="text-xs" style={{ color: "hsl(var(--foreground))" }}>{c.mobile}</span>
                        </div>
                      )}
                      {c.mail && <FieldView label="Email" value={c.mail} />}
                      {c.adresse && <FieldView label="Adresse" value={c.adresse} />}
                    </div>
                    {c.observations && (
                      <p className="text-xs mt-2 pt-2 border-t" style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}>
                        {c.observations}
                      </p>
                    )}
                  </div>
                ))}
              </div>
        }
      </div>

      {/* Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Modifier le contact" : "Ajouter un contact d'urgence"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Identification */}
            <div className="rounded-lg p-3 border" style={{ background: "hsl(var(--muted) / 0.3)", borderColor: "hsl(var(--border))" }}>
              <p className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: "hsl(var(--accent))" }}>Identification</p>
              <div className="grid grid-cols-2 gap-3">
                <FI label="Nom du contact" value={form.nom_contact || ""} onChange={v => set("nom_contact", v)} required className="col-span-2" />
                {/* FK → ref_lien_parente */}
                <div className="col-span-2">
                  <RefSelect
                    table="ref_lien_parente"
                    value={form.code_lien}
                    onChange={v => set("code_lien", v)}
                    label="Lien de parenté"
                    required
                    placeholder="— Sélectionner le lien —"
                  />
                </div>
              </div>
            </div>

            {/* Coordonnées */}
            <div className="rounded-lg p-3 border" style={{ background: "hsl(var(--muted) / 0.3)", borderColor: "hsl(var(--border))" }}>
              <p className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: "hsl(var(--accent))" }}>Coordonnées</p>
              <div className="grid grid-cols-2 gap-3">
                <FI label="Téléphone fixe" value={form.telephone || ""} onChange={v => set("telephone", v)} type="tel" />
                <FI label="Mobile" value={form.mobile || ""} onChange={v => set("mobile", v)} type="tel" />
                <FI label="Email" value={form.mail || ""} onChange={v => set("mail", v)} type="email" className="col-span-2" />
                <FI label="Adresse" value={form.adresse || ""} onChange={v => set("adresse", v)} className="col-span-2" />
              </div>
            </div>

            {/* Indicateurs */}
            <div className="rounded-lg p-3 border" style={{ background: "hsl(var(--muted) / 0.3)", borderColor: "hsl(var(--border))" }}>
              <p className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: "hsl(var(--accent))" }}>Indicateurs</p>
              <div className="space-y-3">
                <FB label="Contact principal" value={form.est_principal} onChange={v => set("est_principal", v)} />
                <FB label="Contact d'urgence" value={form.est_urgence} onChange={v => set("est_urgence", v)} />
              </div>
            </div>

            {/* Observations */}
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "hsl(var(--muted-foreground))" }}>Observations</label>
              <textarea value={form.observations || ""} onChange={e => set("observations", e.target.value)} rows={2}
                className="w-full px-3 py-2 rounded-lg border text-sm outline-none resize-none"
                style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))" }} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Annuler</Button>
            <Button onClick={handleSave} disabled={saving || !form.nom_contact?.trim() || !form.code_lien}
              style={{ background: "hsl(var(--accent))", color: "white" }}>
              {saving ? "Enregistrement..." : <><Save size={13} className="mr-1" />Enregistrer</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default ContactUrgenceForm;
