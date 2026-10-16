import React, { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Save, User, Mail, Phone, Briefcase } from "lucide-react";

const ProfilePage: React.FC = () => {
  const { user, profile: authProfile } = useAuth();
  const [form, setForm] = useState({ nom: "", prenom: "", email: "", telephone: "", poste: "" });
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (authProfile) {
      setForm({
        nom: authProfile.nom || "",
        prenom: authProfile.prenom || "",
        email: authProfile.email || user?.email || "",
        telephone: authProfile.telephone || "",
        poste: authProfile.poste || "",
      });
    }
  }, [authProfile, user]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setLoading(true);
    await supabase.from("profiles").update(form).eq("user_id", user.id);
    setLoading(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const inputClass = "w-full px-4 py-2.5 rounded-lg border text-sm outline-none transition-all focus:ring-2";

  return (
    <div className="max-w-2xl mx-auto">
      {/* Fil d'Ariane */}
      <div className="flex items-center gap-1.5 px-6 pt-4 pb-3 text-[13px]" style={{ color: "hsl(var(--muted-foreground))" }}>
        <span className="font-semibold" style={{ color: "hsl(var(--foreground))" }}>Mon Profil</span>
      </div>

      <div className="px-6 pb-8">
      <div className="p-6" style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "var(--radius)" }}>
        {/* Avatar */}
        <div className="flex items-center gap-4 mb-8">
          <div className="w-16 h-16 flex items-center justify-center text-2xl font-bold"
            style={{ background: "hsl(var(--primary))", color: "white", borderRadius: "var(--radius)" }}>
            {form.prenom?.[0]?.toUpperCase() || "U"}
          </div>
          <div>
            <h2 className="text-lg font-bold" style={{ color: "hsl(var(--foreground))" }}>
              {form.prenom} {form.nom}
            </h2>
            <p className="text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>{form.poste || "— Poste non renseigné"}</p>
          </div>
        </div>

        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium block mb-1.5" style={{ color: "hsl(var(--foreground))" }}>
                <User size={12} className="inline mr-1" />Prénom
              </label>
              <input value={form.prenom} onChange={e => setForm({ ...form, prenom: e.target.value })}
                className={inputClass} style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))" }}
                placeholder="Jean" />
            </div>
            <div>
              <label className="text-xs font-medium block mb-1.5" style={{ color: "hsl(var(--foreground))" }}>
                <User size={12} className="inline mr-1" />Nom
              </label>
              <input value={form.nom} onChange={e => setForm({ ...form, nom: e.target.value })}
                className={inputClass} style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))" }}
                placeholder="Dupont" />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium block mb-1.5" style={{ color: "hsl(var(--foreground))" }}>
              <Mail size={12} className="inline mr-1" />Email
            </label>
            <input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
              className={inputClass} style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))" }}
              placeholder="jean.dupont@entreprise.fr" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium block mb-1.5" style={{ color: "hsl(var(--foreground))" }}>
                <Phone size={12} className="inline mr-1" />Téléphone
              </label>
              <input value={form.telephone} onChange={e => setForm({ ...form, telephone: e.target.value })}
                className={inputClass} style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))" }}
                placeholder="+33 6 00 00 00 00" />
            </div>
            <div>
              <label className="text-xs font-medium block mb-1.5" style={{ color: "hsl(var(--foreground))" }}>
                <Briefcase size={12} className="inline mr-1" />Poste
              </label>
              <input value={form.poste} onChange={e => setForm({ ...form, poste: e.target.value })}
                className={inputClass} style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))" }}
                placeholder="Responsable RH" />
            </div>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit" disabled={loading}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-all"
              style={{ background: "hsl(var(--primary))", color: "white", opacity: loading ? 0.7 : 1 }}
            >
              {loading ? <div className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: "white", borderTopColor: "transparent" }} /> : <Save size={14} />}
              Enregistrer
            </button>
            {saved && <p className="text-sm font-medium" style={{ color: "hsl(var(--success))" }}>✓ Profil enregistré</p>}
          </div>
        </form>
      </div>
      </div>
    </div>
  );
};

export default ProfilePage;
