import React, { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import { UserPlus, Loader2, Search, RefreshCw, Copy, Check, X, AlertTriangle, KeyRound } from "lucide-react";

interface Sans { collaborateur_id: string; matricule: string | null; nom: string | null; prenom: string | null; email: string | null; email_source: string; }
interface Genere { collaborateur_id: string; nom: string | null; prenom: string | null; email: string; mot_de_passe_temporaire: string; statut: string; message?: string | null; }

const SRC_LABEL: Record<string, { label: string; color: string }> = {
  professionnel: { label: "Pro", color: "#16A34A" },
  personnel: { label: "Perso", color: "#E07B39" },
  genere: { label: "Généré", color: "#DC2626" },
};

export default function CollaborateursSansCompte() {
  const [list, setList] = useState<Sans[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [results, setResults] = useState<Genere[] | null>(null);

  const load = async () => {
    setLoading(true);
    try { setList((await api.get("/provisioning/collaborateurs-sans-compte")) as Sans[]); setSel(new Set()); }
    catch { toast({ title: "Chargement impossible", description: "Vérifiez le routeur de provisioning et vos droits administrateur.", variant: "destructive" }); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const ql = q.toLowerCase();
  const filtered = ql ? list.filter((c) => `${c.matricule} ${c.nom} ${c.prenom} ${c.email}`.toLowerCase().includes(ql)) : list;

  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allShownSelected = filtered.length > 0 && filtered.every((c) => sel.has(c.collaborateur_id));
  const toggleAll = () => setSel((s) => {
    const n = new Set(s);
    if (allShownSelected) filtered.forEach((c) => n.delete(c.collaborateur_id));
    else filtered.forEach((c) => n.add(c.collaborateur_id));
    return n;
  });

  const generer = async () => {
    if (sel.size === 0) return;
    if (!confirm(`Générer ${sel.size} compte(s) collaborateur ? Un mot de passe temporaire sera créé pour chacun.`)) return;
    setGenerating(true);
    try {
      const res = (await api.post("/provisioning/generer-comptes", { collaborateur_ids: [...sel], role: "collaborateur" })) as Genere[];
      setResults(res);
      const crees = res.filter((r) => r.statut === "cree").length;
      toast({ title: `${crees} compte(s) créé(s)`, description: res.length - crees > 0 ? `${res.length - crees} ignoré(s).` : undefined });
      await load();
    } catch { toast({ title: "Échec de la génération", variant: "destructive" }); }
    finally { setGenerating(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="relative max-w-sm flex-1 min-w-[220px]">
          <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: "hsl(var(--muted-foreground))" }} />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher par matricule, nom, email…" className="pl-8" />
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={load} className="gap-1.5"><RefreshCw size={14} /> Actualiser</Button>
          <Button size="sm" onClick={generer} disabled={generating || sel.size === 0} className="gap-1.5">
            {generating ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />} Générer {sel.size > 0 ? `(${sel.size})` : ""}
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16" style={{ color: "hsl(var(--muted-foreground))" }}><Loader2 className="animate-spin mr-2" size={20} /> Chargement…</div>
      ) : list.length === 0 ? (
        <div className="rounded-2xl border p-10 text-center" style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}>
          <Check size={28} className="mx-auto mb-2" style={{ color: "hsl(142 64% 40%)" }} />
          Tous les collaborateurs actifs ont déjà un compte.
        </div>
      ) : (
        <div className="rounded-2xl border overflow-hidden" style={{ borderColor: "hsl(var(--border))" }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: "hsl(var(--muted) / 0.4)", color: "hsl(var(--muted-foreground))" }}>
                <th className="w-10 px-3 py-2.5 text-left"><input type="checkbox" checked={allShownSelected} onChange={toggleAll} /></th>
                <th className="px-3 py-2.5 text-left font-medium">Matricule</th>
                <th className="px-3 py-2.5 text-left font-medium">Collaborateur</th>
                <th className="px-3 py-2.5 text-left font-medium">Email (login)</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => {
                const src = SRC_LABEL[c.email_source] || { label: c.email_source, color: "#64748B" };
                const checked = sel.has(c.collaborateur_id);
                return (
                  <tr key={c.collaborateur_id} className="border-t cursor-pointer hover:bg-muted/30" style={{ borderColor: "hsl(var(--border))" }} onClick={() => toggle(c.collaborateur_id)}>
                    <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={checked} onChange={() => toggle(c.collaborateur_id)} /></td>
                    <td className="px-3 py-2.5 font-mono text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>{c.matricule || "—"}</td>
                    <td className="px-3 py-2.5 font-medium" style={{ color: "hsl(var(--foreground))" }}>{c.nom} {c.prenom}</td>
                    <td className="px-3 py-2.5">
                      <span style={{ color: "hsl(var(--foreground))" }}>{c.email}</span>
                      <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded font-semibold" style={{ background: src.color + "1F", color: src.color }} title={c.email_source === "genere" ? "Aucun email renseigné : login généré depuis le matricule" : `Email ${src.label.toLowerCase()}`}>{src.label}</span>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>Aucun résultat.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {results && <ResultsModal results={results} onClose={() => setResults(null)} />}
    </div>
  );
}

// ── Récap des comptes générés (mots de passe affichés une seule fois) ─────────
const ResultsModal: React.FC<{ results: Genere[]; onClose: () => void }> = ({ results, onClose }) => {
  const crees = results.filter((r) => r.statut === "cree");
  const ignores = results.filter((r) => r.statut !== "cree");
  const [copied, setCopied] = useState(false);

  const copyAll = () => {
    const txt = crees.map((r) => `${r.nom} ${r.prenom}\t${r.email}\t${r.mot_de_passe_temporaire}`).join("\n");
    navigator.clipboard?.writeText(txt); setCopied(true); setTimeout(() => setCopied(false), 1500);
  };
  const copyOne = (r: Genere) => navigator.clipboard?.writeText(`${r.email} / ${r.mot_de_passe_temporaire}`);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-background rounded-2xl shadow-xl w-full max-w-2xl p-5 space-y-4 max-h-[90vh] overflow-auto" style={{ border: "1px solid hsl(var(--border))" }}>
        <div className="flex items-center justify-between">
          <h2 className="font-semibold flex items-center gap-2" style={{ color: "hsl(var(--foreground))" }}><KeyRound size={18} /> Comptes générés</h2>
          <button onClick={onClose} style={{ color: "hsl(var(--muted-foreground))" }}><X size={18} /></button>
        </div>

        {crees.length > 0 && (
          <div className="rounded-xl border p-3 flex items-start gap-2" style={{ borderColor: "hsl(38 92% 50% / 0.4)", background: "hsl(38 92% 50% / 0.08)" }}>
            <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" style={{ color: "hsl(38 92% 40%)" }} />
            <p className="text-xs" style={{ color: "hsl(var(--foreground))" }}>
              Ces mots de passe temporaires ne seront <strong>plus affichés</strong> ensuite. Transmettez-les de façon sécurisée — l'utilisateur devra le changer à sa première connexion.
            </p>
          </div>
        )}

        {crees.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[12px] font-semibold" style={{ color: "hsl(var(--foreground))" }}>{crees.length} compte(s) créé(s)</span>
              <button onClick={copyAll} className="text-[12px] font-medium flex items-center gap-1 hover:underline" style={{ color: "hsl(var(--primary))" }}>
                {copied ? <Check size={13} /> : <Copy size={13} />} Tout copier
              </button>
            </div>
            <div className="rounded-xl border overflow-hidden" style={{ borderColor: "hsl(var(--border))" }}>
              <table className="w-full text-sm">
                <thead><tr style={{ background: "hsl(var(--muted) / 0.4)", color: "hsl(var(--muted-foreground))" }}>
                  <th className="px-3 py-2 text-left font-medium">Collaborateur</th>
                  <th className="px-3 py-2 text-left font-medium">Email</th>
                  <th className="px-3 py-2 text-left font-medium">Mot de passe</th>
                  <th className="w-10"></th>
                </tr></thead>
                <tbody>
                  {crees.map((r) => (
                    <tr key={r.collaborateur_id} className="border-t" style={{ borderColor: "hsl(var(--border))" }}>
                      <td className="px-3 py-2" style={{ color: "hsl(var(--foreground))" }}>{r.nom} {r.prenom}</td>
                      <td className="px-3 py-2" style={{ color: "hsl(var(--foreground))" }}>{r.email}</td>
                      <td className="px-3 py-2 font-mono" style={{ color: "hsl(var(--foreground))" }}>{r.mot_de_passe_temporaire}</td>
                      <td className="px-2 py-2"><button onClick={() => copyOne(r)} title="Copier" style={{ color: "hsl(var(--muted-foreground))" }}><Copy size={13} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {ignores.length > 0 && (
          <div>
            <span className="text-[12px] font-semibold" style={{ color: "hsl(var(--muted-foreground))" }}>{ignores.length} ignoré(s)</span>
            <ul className="mt-1 space-y-0.5">
              {ignores.map((r) => (
                <li key={r.collaborateur_id} className="text-[12px]" style={{ color: "hsl(var(--muted-foreground))" }}>
                  {r.nom} {r.prenom} — {r.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex justify-end"><Button size="sm" onClick={onClose}>Fermer</Button></div>
      </div>
    </div>
  );
};
