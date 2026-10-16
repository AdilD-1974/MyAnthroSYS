/**
 * EmailConfigPage – Configuration du serveur d'e-mail (SMTP).
 * Route suggérée : /configuration/email  (administrateur).
 * Lit/écrit /api/v1/smtp et envoie un e-mail de test.
 */
import React, { useEffect, useState } from "react";
import { Mail, Save, Send, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { api } from "@/lib/api";

type Securite = "starttls" | "ssl" | "none";

interface SmtpConfig {
  host: string;
  port: number;
  securite: Securite;
  utilisateur: string;
  expediteur: string;
  actif: boolean;
  mot_de_passe_defini?: boolean;
}

const champ = "w-full h-10 px-3 rounded-lg border text-sm outline-none transition-colors";
const champStyle: React.CSSProperties = { background: "hsl(var(--background))", borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" };
const label = "text-xs font-semibold mb-1 block";
const labelStyle: React.CSSProperties = { color: "hsl(var(--muted-foreground))" };

const EmailConfigPage: React.FC = () => {
  const [cfg, setCfg] = useState<SmtpConfig>({ host: "", port: 587, securite: "starttls", utilisateur: "", expediteur: "", actif: false });
  const [motDePasse, setMotDePasse] = useState("");        // vide => inchangé
  const [pwdDefini, setPwdDefini] = useState(false);
  const [chargement, setChargement] = useState(true);
  const [enreg, setEnreg] = useState(false);
  const [destTest, setDestTest] = useState("");
  const [test, setTest] = useState(false);
  const [msg, setMsg] = useState<{ t: "ok" | "err"; texte: string } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const d = await api.get<SmtpConfig>("/smtp");
        setCfg({
          host: d.host || "", port: d.port || 587, securite: (d.securite as Securite) || "starttls",
          utilisateur: d.utilisateur || "", expediteur: d.expediteur || "", actif: !!d.actif,
        });
        setPwdDefini(!!d.mot_de_passe_defini);
      } catch (e: any) {
        setMsg({ t: "err", texte: "Impossible de charger la configuration." });
      } finally {
        setChargement(false);
      }
    })();
  }, []);

  const set = <K extends keyof SmtpConfig>(k: K, v: SmtpConfig[K]) => setCfg((c) => ({ ...c, [k]: v }));

  const enregistrer = async () => {
    setEnreg(true); setMsg(null);
    try {
      const body: any = { ...cfg };
      if (motDePasse) body.mot_de_passe = motDePasse;   // sinon inchangé
      await api.put("/smtp", body);
      if (motDePasse) { setPwdDefini(true); setMotDePasse(""); }
      setMsg({ t: "ok", texte: "Configuration enregistrée." });
    } catch (e: any) {
      setMsg({ t: "err", texte: e?.message || "Échec de l'enregistrement." });
    } finally {
      setEnreg(false);
    }
  };

  const envoyerTest = async () => {
    if (!destTest) { setMsg({ t: "err", texte: "Indiquez une adresse de test." }); return; }
    setTest(true); setMsg(null);
    try {
      await api.post("/smtp/test", { destinataire: destTest });
      setMsg({ t: "ok", texte: `E-mail de test envoyé à ${destTest}.` });
    } catch (e: any) {
      setMsg({ t: "err", texte: e?.message || "Échec de l'envoi du test." });
    } finally {
      setTest(false);
    }
  };

  if (chargement) {
    return (
      <div className="p-8 flex items-center gap-2" style={{ color: "hsl(var(--muted-foreground))" }}>
        <Loader2 size={16} className="animate-spin" /> Chargement…
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      {/* En-tête */}
      <div className="flex items-center gap-3 mb-1">
        <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: "hsl(var(--accent) / 0.12)", color: "hsl(var(--accent))" }}>
          <Mail size={18} />
        </div>
        <h1 className="text-xl font-bold" style={{ color: "hsl(var(--foreground))" }}>Serveur d'e-mail (SMTP)</h1>
      </div>
      <p className="text-sm mb-6" style={{ color: "hsl(var(--muted-foreground))" }}>
        Configuration utilisée par les actions « Email » des workflows. Compatible Gmail, Microsoft 365, OVH, etc.
      </p>

      {/* Message */}
      {msg && (
        <div className="mb-4 px-3 py-2 rounded-lg text-sm flex items-center gap-2"
          style={{ background: msg.t === "ok" ? "hsl(142 70% 45% / 0.12)" : "hsl(0 84% 50% / 0.12)", color: msg.t === "ok" ? "hsl(142 70% 30%)" : "hsl(0 84% 45%)" }}>
          {msg.t === "ok" ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />} {msg.texte}
        </div>
      )}

      {/* Carte config */}
      <div className="rounded-xl border p-5 mb-5" style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className={label} style={labelStyle}>Serveur (host)</label>
            <input className={champ} style={champStyle} value={cfg.host} onChange={(e) => set("host", e.target.value)} placeholder="smtp.gmail.com" />
          </div>
          <div>
            <label className={label} style={labelStyle}>Port</label>
            <input type="number" className={champ} style={champStyle} value={cfg.port} onChange={(e) => set("port", parseInt(e.target.value || "0", 10))} placeholder="587" />
          </div>
          <div>
            <label className={label} style={labelStyle}>Sécurité</label>
            <select className={champ} style={champStyle} value={cfg.securite} onChange={(e) => set("securite", e.target.value as Securite)}>
              <option value="starttls">STARTTLS (587)</option>
              <option value="ssl">SSL/TLS (465)</option>
              <option value="none">Aucune</option>
            </select>
          </div>
          <div>
            <label className={label} style={labelStyle}>Identifiant</label>
            <input className={champ} style={champStyle} value={cfg.utilisateur} onChange={(e) => set("utilisateur", e.target.value)} placeholder="rh@monentreprise.ma" autoComplete="off" />
          </div>
          <div>
            <label className={label} style={labelStyle}>Mot de passe</label>
            <input type="password" className={champ} style={champStyle} value={motDePasse} onChange={(e) => setMotDePasse(e.target.value)}
              placeholder={pwdDefini ? "•••••••• (inchangé)" : "mot de passe / app password"} autoComplete="new-password" />
          </div>
          <div className="sm:col-span-2">
            <label className={label} style={labelStyle}>Expéditeur affiché (From)</label>
            <input className={champ} style={champStyle} value={cfg.expediteur} onChange={(e) => set("expediteur", e.target.value)} placeholder="rh@monentreprise.ma" />
          </div>
        </div>

        <label className="flex items-center gap-2 mt-4 cursor-pointer select-none">
          <input type="checkbox" checked={cfg.actif} onChange={(e) => set("actif", e.target.checked)} />
          <span className="text-sm" style={{ color: "hsl(var(--foreground))" }}>Activer l'envoi via cette configuration</span>
        </label>

        <div className="mt-5">
          <button onClick={enregistrer} disabled={enreg}
            className="inline-flex items-center gap-2 h-10 px-4 rounded-lg text-sm font-semibold transition-opacity disabled:opacity-60"
            style={{ background: "hsl(var(--accent))", color: "white" }}>
            {enreg ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Enregistrer
          </button>
        </div>
      </div>

      {/* Carte test */}
      <div className="rounded-xl border p-5" style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>
        <h2 className="text-sm font-semibold mb-1" style={{ color: "hsl(var(--foreground))" }}>Tester l'envoi</h2>
        <p className="text-xs mb-3" style={{ color: "hsl(var(--muted-foreground))" }}>
          Envoie un e-mail de test à l'adresse indiquée avec la configuration effective (base, sinon environnement).
        </p>
        <div className="flex items-center gap-2">
          <input className={champ + " flex-1"} style={champStyle} value={destTest} onChange={(e) => setDestTest(e.target.value)} placeholder="adresse@exemple.com" />
          <button onClick={envoyerTest} disabled={test}
            className="inline-flex items-center gap-2 h-10 px-4 rounded-lg text-sm font-semibold transition-opacity disabled:opacity-60 whitespace-nowrap"
            style={{ background: "hsl(var(--secondary))", color: "hsl(var(--secondary-foreground))", border: "1px solid hsl(var(--border))" }}>
            {test ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Envoyer un test
          </button>
        </div>
      </div>
    </div>
  );
};

export default EmailConfigPage;
