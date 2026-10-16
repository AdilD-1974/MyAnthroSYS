import React, { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Eye, EyeOff, LogIn, UserPlus, Building2, Users, CreditCard, BookOpen } from "lucide-react";
import logoSlide from "@/assets/logo-slide.png";
import logoIcon from "@/assets/logo-icon.png";
import BrandingMark from "@/components/BrandingMark";

const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const { signIn } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [prenom, setPrenom] = useState("");
  const [nom, setNom] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setSuccess(""); setLoading(true);
    try {
      if (mode === "login") {
        await signIn(email, password);
        navigate("/accueil");
      } else {
        const { error } = await supabase.auth.signUp({
          email, password,
          options: { data: { prenom, nom }, emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        setSuccess("Compte créé ! Vérifiez votre email pour confirmer votre inscription.");
      }
    } catch (err: any) {
      setError(err.message || "Une erreur est survenue");
    } finally {
      setLoading(false);
    }
  };

  const inputBase = "w-full px-4 py-2.5 rounded-lg border text-sm outline-none transition-all focus:ring-2";

  return (
    <div className="min-h-screen flex" style={{ background: "hsl(var(--background))" }}>

      {/* Animations du logo de la solution (ANTHRO-SYS) */}
      <style>{`
        @keyframes anthro-float { 0%,100% { transform: translateY(0) rotate(0deg); } 50% { transform: translateY(-5px) rotate(2.5deg); } }
        @keyframes anthro-glow  { 0%,100% { box-shadow: 0 4px 12px hsl(0 0% 0% / 0.3); } 50% { box-shadow: 0 8px 24px hsl(175 80% 50% / 0.6); } }
      `}</style>

      {/* Logo CLIENT en filigrane : dérive sur tout l'écran, derrière la carte de connexion */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden" aria-hidden="true" style={{ zIndex: 0 }}>
        <BrandingMark variant="watermark" animation="drift" opacity={0.18} maxWidth={520} className="absolute top-0 left-0" />
      </div>

      {/* ── Left panel ── */}
      <div
        className="hidden lg:flex flex-col w-[460px] flex-shrink-0 relative overflow-hidden"
        style={{ background: "linear-gradient(160deg, hsl(200 60% 14%) 0%, hsl(195 50% 25%) 60%, hsl(175 80% 35% / 0.6) 100%)" }}
      >
        <div className="absolute top-0 right-0 w-80 h-80 rounded-full opacity-5" style={{ background: "white", transform: "translate(40%, -30%)" }} />
        <div className="absolute bottom-20 left-0 w-64 h-64 rounded-full opacity-5" style={{ background: "hsl(180 55% 45%)", transform: "translate(-40%, 20%)" }} />
        <div className="absolute bottom-0 right-0 w-48 h-48 rounded-full opacity-8" style={{ background: "hsl(175 80% 40%)", transform: "translate(30%, 30%)" }} />

        <div className="relative z-10 px-10 pt-10 pb-6">
          <div className="flex items-center gap-3 mb-2">
            <img src={logoIcon} alt="ANTHRO-SYS" className="w-12 h-12 rounded-xl" style={{ animation: "anthro-float 5s ease-in-out infinite, anthro-glow 3.8s ease-in-out infinite" }} />
            <div>
              <p className="text-xs font-medium tracking-widest uppercase mb-0.5" style={{ color: "hsl(175 80% 60%)" }}>Système d'Information RH</p>
              <span className="text-3xl font-black tracking-tight" style={{ fontFamily: "Poppins, sans-serif", color: "white" }}>
                ANTHRO<span style={{ color: "hsl(175 80% 55%)" }}>-SYS</span>
              </span>
            </div>
          </div>
        </div>

        <div className="relative z-10 px-8 flex-1 flex flex-col justify-center">
          <div className="rounded-2xl overflow-hidden mb-8 shadow-2xl" style={{ boxShadow: "0 20px 60px hsl(0 0% 0% / 0.4)" }}>
            <img src={logoSlide} alt="ANTHRO-SYS SIRH" className="w-full object-cover" />
          </div>

          <h1 className="text-2xl font-bold text-white mb-3 leading-snug" style={{ fontFamily: "Poppins, sans-serif" }}>
            Simplifiez votre gestion RH,<br />
            <span style={{ color: "hsl(175 80% 60%)" }}>boostez</span> vos performances
          </h1>
          <p className="text-sm leading-relaxed mb-8" style={{ color: "hsl(0 0% 100% / 0.6)" }}>
            Votre SIRH complet pour centraliser collaborateurs, contrats, paie et référentiels en toute simplicité.
          </p>

          <div className="space-y-3">
            {[
              { icon: <Users size={14} />, title: "Gestion des collaborateurs", desc: "Dossiers RH centralisés", color: "hsl(175 80% 55%)" },
              { icon: <CreditCard size={14} />, title: "Gestion de la paie", desc: "Bulletins automatisés", color: "hsl(180 55% 55%)" },
              { icon: <BookOpen size={14} />, title: "Référentiels complets", desc: "Données partagées et cohérentes", color: "hsl(39 95% 65%)" },
              { icon: <Building2 size={14} />, title: "Multi-organisations", desc: "Gestion des UO et établissements", color: "hsl(280 60% 65%)" },
            ].map(f => (
              <div key={f.title} className="flex items-center gap-3">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${f.color}25`, color: f.color }}>
                  {f.icon}
                </div>
                <div>
                  <p className="text-sm font-semibold" style={{ color: "hsl(0 0% 100% / 0.9)" }}>{f.title}</p>
                  <p className="text-xs" style={{ color: "hsl(0 0% 100% / 0.45)" }}>{f.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="relative z-10 px-10 pb-6">
          <div className="pt-4 border-t" style={{ borderColor: "hsl(0 0% 100% / 0.1)" }}>
            <p className="text-xs" style={{ color: "hsl(0 0% 100% / 0.3)" }}>
              © {new Date().getFullYear()} ANTHRO-SYS – Tous droits réservés
            </p>
          </div>
        </div>
      </div>

      {/* ── Right panel ── */}
      <div className="flex-1 flex items-center justify-center p-6 overflow-auto">
        <div className="w-full max-w-md relative z-10">

          <div className="flex lg:hidden items-center gap-2 mb-8 justify-center">
            <img src={logoIcon} alt="ANTHRO-SYS" className="w-10 h-10 rounded-xl" style={{ animation: "anthro-float 5s ease-in-out infinite" }} />
            <span className="text-xl font-black" style={{ fontFamily: "Poppins, sans-serif", color: "hsl(var(--primary))" }}>
              ANTHRO<span style={{ color: "hsl(175 80% 40%)" }}>-SYS</span>
            </span>
          </div>

          <div
            className="rounded-2xl p-8"
            style={{ background: "hsl(var(--card))", boxShadow: "var(--shadow-lg)", border: "1px solid hsl(var(--border))" }}
          >
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-1">
                <div className="w-6 h-6 rounded flex items-center justify-center" style={{ background: "hsl(var(--primary))" }}>
                  <LogIn size={12} color="white" />
                </div>
                <h2 className="text-xl font-bold" style={{ fontFamily: "Poppins, sans-serif", color: "hsl(var(--foreground))" }}>
                  {mode === "login" ? "Connexion" : "Créer un compte"}
                </h2>
              </div>
              <p className="text-sm ml-8" style={{ color: "hsl(var(--muted-foreground))" }}>
                {mode === "login"
                  ? "Accédez à votre espace ANTHRO-SYS"
                  : "Rejoignez la plateforme ANTHRO-SYS SIRH"}
              </p>
            </div>

            {error && (
              <div className="mb-4 px-4 py-3 rounded-lg text-sm flex items-start gap-2" style={{ background: "hsl(0 84% 96%)", color: "hsl(0 84% 40%)", border: "1px solid hsl(0 84% 85%)" }}>
                <span className="flex-shrink-0 mt-0.5">⚠️</span> {error}
              </div>
            )}
            {success && (
              <div className="mb-4 px-4 py-3 rounded-lg text-sm flex items-start gap-2" style={{ background: "hsl(84 55% 95%)", color: "hsl(84 55% 30%)", border: "1px solid hsl(84 55% 75%)" }}>
                <span className="flex-shrink-0 mt-0.5">✅</span> {success}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              {mode === "register" && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold block mb-1.5" style={{ color: "hsl(var(--foreground))" }}>Prénom</label>
                    <input type="text" value={prenom} onChange={e => setPrenom(e.target.value)} required className={inputBase}
                      style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))", "--tw-ring-color": "hsl(var(--accent))" } as any} placeholder="Jean" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold block mb-1.5" style={{ color: "hsl(var(--foreground))" }}>Nom</label>
                    <input type="text" value={nom} onChange={e => setNom(e.target.value)} required className={inputBase}
                      style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))" }} placeholder="Dupont" />
                  </div>
                </div>
              )}

              <div>
                <label className="text-xs font-semibold block mb-1.5" style={{ color: "hsl(var(--foreground))" }}>Adresse e-mail</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} required className={inputBase}
                  style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))" }} placeholder="jean.dupont@entreprise.fr" />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold" style={{ color: "hsl(var(--foreground))" }}>Mot de passe</label>
                  {mode === "login" && (
                    <button type="button" className="text-xs transition-all" style={{ color: "hsl(var(--accent))" }}>Mot de passe oublié ?</button>
                  )}
                </div>
                <div className="relative">
                  <input type={showPwd ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)} required
                    className={`${inputBase} pr-10`}
                    style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--background))", color: "hsl(var(--foreground))" }}
                    placeholder="••••••••" minLength={6} />
                  <button type="button" onClick={() => setShowPwd(!showPwd)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 transition-colors" style={{ color: "hsl(var(--muted-foreground))" }}>
                    {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <button type="submit" disabled={loading}
                className="w-full py-3 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all mt-2"
                style={{
                  background: loading ? "hsl(var(--muted))" : "linear-gradient(135deg, hsl(200 60% 22%), hsl(195 50% 30%))",
                  color: loading ? "hsl(var(--muted-foreground))" : "white",
                  boxShadow: loading ? "none" : "var(--shadow-md)",
                }}>
                {loading ? (
                  <div className="w-4 h-4 rounded-full border-2 animate-spin" style={{ borderColor: "hsl(var(--muted-foreground))", borderTopColor: "transparent" }} />
                ) : mode === "login" ? (
                  <><LogIn size={16} /> Se connecter</>
                ) : (
                  <><UserPlus size={16} /> Créer mon compte</>
                )}
              </button>
            </form>

            <div className="flex items-center gap-3 my-5">
              <div className="flex-1 h-px" style={{ background: "hsl(var(--border))" }} />
              <span className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>ou</span>
              <div className="flex-1 h-px" style={{ background: "hsl(var(--border))" }} />
            </div>

            <button
              onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); setSuccess(""); }}
              className="w-full py-2.5 rounded-xl text-sm font-semibold border transition-all hover:bg-muted/50"
              style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--foreground))" }}>
              {mode === "login" ? "Pas encore de compte ? S'inscrire" : "Déjà un compte ? Se connecter"}
            </button>
          </div>

          <p className="text-center text-xs mt-5" style={{ color: "hsl(var(--muted-foreground))" }}>
            ANTHRO-SYS SIRH v1.0 — Gestion administrative &amp; RH
          </p>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
