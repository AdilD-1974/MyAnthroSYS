/**
 * SmsConfigPage – Configuration de la passerelle SMS (agrégateur HTTP générique).
 * Route : /configuration/sms (administrateur). Lit/écrit /api/v1/sms + test.
 */
import React, { useEffect, useState } from "react";
import { MessageSquare, Save, Send, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { api } from "@/lib/api";

interface SmsConfig {
  actif: boolean;
  base_url: string;
  methode: "GET" | "POST";
  format: "query" | "form" | "json";
  cle_destinataire: string;
  cle_message: string;
  params_statiques: Record<string, string>;
  ok_si_contient: string | null;
  indicatif: string;
  champ_telephone: string;
}

const champ = "w-full h-10 px-3 rounded-lg border text-sm outline-none";
const champStyle: React.CSSProperties = { background: "hsl(var(--background))", borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" };
const label = "text-xs font-semibold mb-1 block";
const labelStyle: React.CSSProperties = { color: "hsl(var(--muted-foreground))" };

const defaut: SmsConfig = {
  actif: false, base_url: "", methode: "GET", format: "query",
  cle_destinataire: "to", cle_message: "message", params_statiques: {},
  ok_si_contient: "", indicatif: "212", champ_telephone: "telephone",
};

const SmsConfigPage: React.FC = () => {
  const [cfg, setCfg] = useState<SmsConfig>(defaut);
  const [paramsTexte, setParamsTexte] = useState("{}");
  const [chargement, setChargement] = useState(true);
  const [enreg, setEnreg] = useState(false);
  const [destTest, setDestTest] = useState("");
  const [test, setTest] = useState(false);
  const [msg, setMsg] = useState<{ t: "ok" | "err"; texte: string } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const d = await api.get<SmsConfig>("/sms");
        const c = { ...defaut, ...d, params_statiques: d.params_statiques || {} };
        setCfg(c);
        setParamsTexte(JSON.stringify(c.params_statiques, null, 2));
      } catch {
        setMsg({ t: "err", texte: "Impossible de charger la configuration." });
      } finally {
        setChargement(false);
      }
    })();
  }, []);

  const set = <K extends keyof SmsConfig>(k: K, v: SmsConfig[K]) => setCfg((c) => ({ ...c, [k]: v }));

  const enregistrer = async () => {
    setEnreg(true); setMsg(null);
    let params: Record<string, string> = {};
    try { params = paramsTexte.trim() ? JSON.parse(paramsTexte) : {}; }
    catch { setMsg({ t: "err", texte: "Paramètres statiques : JSON invalide." }); setEnreg(false); return; }
    try {
      await api.put("/sms", { ...cfg, params_statiques: params, ok_si_contient: cfg.ok_si_contient || null });
      setMsg({ t: "ok", texte: "Configuration enregistrée." });
    } catch (e: any) {
      setMsg({ t: "err", texte: e?.message || "Échec de l'enregistrement." });
    } finally { setEnreg(false); }
  };

  const envoyerTest = async () => {
    if (!destTest) { setMsg({ t: "err", texte: "Indiquez un numéro de test." }); return; }
    setTest(true); setMsg(null);
    try {
      await api.post("/sms/test", { destinataire: destTest });
      setMsg({ t: "ok", texte: `SMS de test envoyé à ${destTest}.` });
    } catch (e: any) {
      setMsg({ t: "err", texte: e?.message || "Échec de l'envoi du test." });
    } finally { setTest(false); }
  };

  if (chargement) return <div className="p-8 flex items-center gap-2" style={{ color: "hsl(var(--muted-foreground))" }}><Loader2 size={16} className="animate-spin" /> Chargement…</div>;

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: "hsl(var(--accent) / 0.12)", color: "hsl(var(--accent))" }}>
          <MessageSquare size={18} />
        </div>
        <h1 className="text-xl font-bold" style={{ color: "hsl(var(--foreground))" }}>Passerelle SMS</h1>
      </div>
      <p className="text-sm mb-6" style={{ color: "hsl(var(--muted-foreground))" }}>
        Agrégateur HTTP générique. Renseignez l'URL de l'API et le nom des paramètres attendus par votre fournisseur.
      </p>

      {msg && (
        <div className="mb-4 px-3 py-2 rounded-lg text-sm flex items-center gap-2"
          style={{ background: msg.t === "ok" ? "hsl(142 70% 45% / 0.12)" : "hsl(0 84% 50% / 0.12)", color: msg.t === "ok" ? "hsl(142 70% 30%)" : "hsl(0 84% 45%)" }}>
          {msg.t === "ok" ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />} {msg.texte}
        </div>
      )}

      <div className="rounded-xl border p-5 mb-5" style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className={label} style={labelStyle}>URL de l'API</label>
            <input className={champ} style={champStyle} value={cfg.base_url} onChange={(e) => set("base_url", e.target.value)} placeholder="https://api.agregateur.ma/send" />
          </div>
          <div>
            <label className={label} style={labelStyle}>Méthode</label>
            <select className={champ} style={champStyle} value={cfg.methode} onChange={(e) => set("methode", e.target.value as any)}>
              <option value="GET">GET</option><option value="POST">POST</option>
            </select>
          </div>
          <div>
            <label className={label} style={labelStyle}>Format (si POST)</label>
            <select className={champ} style={champStyle} value={cfg.format} onChange={(e) => set("format", e.target.value as any)}>
              <option value="query">Query string</option><option value="form">Formulaire</option><option value="json">JSON</option>
            </select>
          </div>
          <div>
            <label className={label} style={labelStyle}>Paramètre « numéro »</label>
            <input className={champ} style={champStyle} value={cfg.cle_destinataire} onChange={(e) => set("cle_destinataire", e.target.value)} placeholder="to" />
          </div>
          <div>
            <label className={label} style={labelStyle}>Paramètre « message »</label>
            <input className={champ} style={champStyle} value={cfg.cle_message} onChange={(e) => set("cle_message", e.target.value)} placeholder="message" />
          </div>
          <div>
            <label className={label} style={labelStyle}>Indicatif pays</label>
            <input className={champ} style={champStyle} value={cfg.indicatif} onChange={(e) => set("indicatif", e.target.value)} placeholder="212" />
          </div>
          <div>
            <label className={label} style={labelStyle}>Colonne téléphone (collaborateurs)</label>
            <input className={champ} style={champStyle} value={cfg.champ_telephone} onChange={(e) => set("champ_telephone", e.target.value)} placeholder="telephone" />
          </div>
          <div className="sm:col-span-2">
            <label className={label} style={labelStyle}>Marqueur de succès dans la réponse (optionnel)</label>
            <input className={champ} style={champStyle} value={cfg.ok_si_contient || ""} onChange={(e) => set("ok_si_contient", e.target.value)} placeholder='ex: "OK" ou "200"' />
          </div>
          <div className="sm:col-span-2">
            <label className={label} style={labelStyle}>Paramètres fixes (identifiants, expéditeur…) — JSON</label>
            <textarea className="w-full px-3 py-2 rounded-lg border text-sm font-mono outline-none" style={champStyle} rows={5}
              value={paramsTexte} onChange={(e) => setParamsTexte(e.target.value)}
              placeholder={'{\n  "user": "votre_login",\n  "password": "votre_mdp",\n  "sender": "ANTHROSYS"\n}'} />
          </div>
        </div>

        <label className="flex items-center gap-2 mt-4 cursor-pointer select-none">
          <input type="checkbox" checked={cfg.actif} onChange={(e) => set("actif", e.target.checked)} />
          <span className="text-sm" style={{ color: "hsl(var(--foreground))" }}>Activer l'envoi via cette passerelle</span>
        </label>

        <div className="mt-5">
          <button onClick={enregistrer} disabled={enreg} className="inline-flex items-center gap-2 h-10 px-4 rounded-lg text-sm font-semibold disabled:opacity-60" style={{ background: "hsl(var(--accent))", color: "white" }}>
            {enreg ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Enregistrer
          </button>
        </div>
      </div>

      <div className="rounded-xl border p-5" style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>
        <h2 className="text-sm font-semibold mb-1" style={{ color: "hsl(var(--foreground))" }}>Tester l'envoi</h2>
        <p className="text-xs mb-3" style={{ color: "hsl(var(--muted-foreground))" }}>Envoie un SMS de test au numéro indiqué.</p>
        <div className="flex items-center gap-2">
          <input className={champ + " flex-1"} style={champStyle} value={destTest} onChange={(e) => setDestTest(e.target.value)} placeholder="0612345678" />
          <button onClick={envoyerTest} disabled={test} className="inline-flex items-center gap-2 h-10 px-4 rounded-lg text-sm font-semibold disabled:opacity-60 whitespace-nowrap" style={{ background: "hsl(var(--secondary))", color: "hsl(var(--secondary-foreground))", border: "1px solid hsl(var(--border))" }}>
            {test ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Envoyer un test
          </button>
        </div>
      </div>
    </div>
  );
};

export default SmsConfigPage;
