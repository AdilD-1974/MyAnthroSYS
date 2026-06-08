/**
 * CollaborateurFicheManager.tsx
 * Fiche collaborateur en LECTURE SEULE pour le manager.
 * Onglets autorisés : Identité | Contrats | Classification & Affectation | Rémunération | Formation & Compétences
 * RG-MANAGER-FICHE-01 (Adil DAIA) : Aucune modification possible depuis cet écran.
 */

import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { db } from "@/lib/api";
import {
  ArrowLeft, User, Shield, Building2, DollarSign,
  BookOpen, Lock, Calendar, Briefcase, Mail, Phone,
  MapPin, Flag, CreditCard, FileText, ChevronRight,
} from "lucide-react";
import { format, parseISO, differenceInYears, differenceInMonths } from "date-fns";
import { fr } from "date-fns/locale";

// ── Interfaces ────────────────────────────────────────────────────────────────

interface Collab {
  id: string; matricule: string; nom: string; prenom: string;
  code_genre?: string; code_nationalite?: string;
  date_naissance?: string; lieu_naissance?: string;
  cin?: string; cin_date_delivrance?: string; cin_date_fin?: string;
  passeport?: string; passeport_date_fin?: string;
  email_professionnel?: string; email_personnel?: string;
  telephone?: string; gsm?: string;
  statut_collaborateur: string; photo_path?: string;
}

const TABS = [
  { id: "identite",       label: "Identité",                  icon: User },
  { id: "contrats",       label: "Contrats",                  icon: Shield },
  { id: "affectation",    label: "Classification & Affectation", icon: Building2 },
  { id: "remuneration",   label: "Rémunération",              icon: DollarSign },
  { id: "formation",      label: "Formation & Compétences",   icon: BookOpen },
];

const getStatutStyle = (s: string) => {
  if (s === "ACTIF")     return { bg: "hsl(84 55% 50% / 0.15)",  color: "hsl(84 55% 35%)" };
  if (s === "EN_DEPART") return { bg: "hsl(39 95% 50% / 0.15)",  color: "hsl(39 95% 35%)" };
  if (s === "SORTI")     return { bg: "hsl(0 70% 50% / 0.12)",   color: "hsl(0 70% 40%)" };
  return                        { bg: "hsl(215 20% 55% / 0.15)", color: "hsl(215 20% 40%)" };
};

const Field = ({ label, value, icon }: { label: string; value?: React.ReactNode; icon?: React.ReactNode }) => (
  value ? (
    <div className="space-y-0.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider flex items-center gap-1"
        style={{ color: "hsl(var(--muted-foreground))" }}>
        {icon && <span style={{ color: "hsl(var(--muted-foreground))" }}>{icon}</span>}
        {label}
      </p>
      <p className="text-sm font-medium" style={{ color: "hsl(var(--foreground))" }}>{value}</p>
    </div>
  ) : null
);

const Section = ({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) => (
  <div className="rounded-2xl border overflow-hidden"
    style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--border))" }}>
    <div className="flex items-center gap-2.5 px-5 py-3.5 border-b"
      style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted) / 0.3)" }}>
      <span style={{ color: "hsl(var(--primary))" }}>{icon}</span>
      <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color: "hsl(var(--foreground))" }}>{title}</h3>
      <div className="ml-auto flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full"
        style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>
        <Lock size={9} /> Lecture seule
      </div>
    </div>
    <div className="p-5">{children}</div>
  </div>
);

// ── Composant principal ───────────────────────────────────────────────────────

const CollaborateurFicheManager: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("identite");
  const [collab, setCollab] = useState<Collab | null>(null);
  const [contrats, setContrats] = useState<any[]>([]);
  const [affectations, setAffectations] = useState<any[]>([]);
  const [salaires, setSalaires] = useState<any[]>([]);
  const [formations, setFormations] = useState<any[]>([]);
  const [competences, setCompetences] = useState<any[]>([]);
  const [uoMap, setUoMap] = useState<Record<string, string>>({});
  const [tcMap, setTcMap] = useState<Record<string, string>>({});
  const [posteMap, setPosteMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    loadAll();
  }, [id]);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [c, cts, affs, sals, forms, comps, refUOs, refTC, refPostes] = await Promise.all([
        db.findOne<Collab>("collaborateurs", { id }),
        db.list<any>("collaborateur_contrats", { collaborateur_id: id, archive: false, order: "-date_debut" }),
        db.list<any>("collaborateur_affectations", { collaborateur_id: id, archive: false, order: "-date_debut" }),
        db.list<any>("collaborateur_salaires_fixes", { collaborateur_id: id, archive: false, order: "-date_debut" }),
        db.list<any>("collaborateur_formations", { collaborateur_id: id, archive: false, order: "-date_debut" }).catch(() => []),
        db.list<any>("collaborateur_competences", { collaborateur_id: id, archive: false }).catch(() => []),
        db.list<any>("unites_organisationnelles", { order: "libelle" }),
        db.list<any>("ref_type_contrat"),
        db.list<any>("ref_poste"),
      ]);
      setCollab(c);
      setContrats(cts);
      setAffectations(affs);
      setSalaires(sals);
      setFormations(forms);
      setCompetences(comps);
      const um: Record<string, string> = {};
      refUOs.forEach((u: any) => { um[u.id] = u.libelle; });
      setUoMap(um);
      const tm: Record<string, string> = {};
      refTC.forEach((t: any) => { tm[t.code] = t.libelle; });
      setTcMap(tm);
      const pm: Record<string, string> = {};
      refPostes.forEach((p: any) => { pm[p.code] = p.libelle; });
      setPosteMap(pm);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64 gap-2">
      <div className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin"
        style={{ borderColor: "hsl(var(--primary))", borderTopColor: "transparent" }} />
      <span className="text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>Chargement…</span>
    </div>
  );

  if (!collab) return (
    <div className="p-6 text-center">
      <p className="text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>Collaborateur introuvable ou hors de votre périmètre.</p>
    </div>
  );

  const statut = getStatutStyle(collab.statut_collaborateur);
  const initiales = `${collab.prenom?.[0] || ""}${collab.nom?.[0] || ""}`.toUpperCase();
  const contratActif = contrats.find(c => c.code_statut_contrat === "ACTIF") ?? contrats[0];
  const affActuelle = affectations.find(a => !a.date_fin_uo || a.date_fin_uo >= new Date().toISOString().split("T")[0]) ?? affectations[0];
  const salaireActuel = salaires.find(s => {
    const today = new Date().toISOString().split("T")[0];
    return s.date_debut <= today && (!s.date_fin || s.date_fin >= today);
  });
  const anciennete = contratActif?.date_debut ? (() => {
    const d = parseISO(contratActif.date_debut);
    const ans = differenceInYears(new Date(), d);
    const mois = differenceInMonths(new Date(), d) % 12;
    return `${ans > 0 ? `${ans} an${ans > 1 ? "s" : ""}` : ""}${ans > 0 && mois > 0 ? " et " : ""}${mois > 0 ? `${mois} mois` : ans === 0 ? "Moins d'un mois" : ""}`;
  })() : null;

  return (
    <div className="space-y-0">
      {/* Header */}
      <div className="relative overflow-hidden rounded-2xl mb-5"
        style={{ background: "linear-gradient(135deg, hsl(220 60% 18%) 0%, hsl(220 50% 28%) 100%)" }}>
        <div className="px-6 pt-5 pb-0">
          <button onClick={() => navigate(-1)}
            className="flex items-center gap-1.5 text-xs font-medium mb-4 hover:opacity-70 transition-opacity"
            style={{ color: "rgba(255,255,255,0.7)" }}>
            <ArrowLeft size={13} /> Retour à mon équipe
          </button>

          <div className="flex items-start gap-5 mb-5">
            {collab.photo_path ? (
              <img src={collab.photo_path} className="w-16 h-16 rounded-2xl object-cover flex-shrink-0"
                style={{ border: "2px solid rgba(255,255,255,0.2)" }} />
            ) : (
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-xl font-bold flex-shrink-0"
                style={{ background: "rgba(255,255,255,0.15)", color: "white", border: "2px solid rgba(255,255,255,0.2)" }}>
                {initiales}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl font-bold text-white truncate">{collab.prenom} {collab.nom}</h1>
              <div className="flex flex-wrap items-center gap-3 mt-1.5">
                <span className="text-[11px] font-mono px-2 py-0.5 rounded-md"
                  style={{ background: "rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.75)" }}>
                  #{collab.matricule}
                </span>
                {affActuelle?.code_poste && (
                  <span className="text-[11px] text-white/70 flex items-center gap-1">
                    <Briefcase size={10} />{posteMap[affActuelle.code_poste] || affActuelle.code_poste}
                  </span>
                )}
                {affActuelle?.unite_id && (
                  <span className="text-[11px] text-white/60 flex items-center gap-1">
                    <Building2 size={10} />{uoMap[affActuelle.unite_id] || affActuelle.unite_id}
                  </span>
                )}
                {anciennete && (
                  <span className="text-[11px] text-white/60">{anciennete} d'ancienneté</span>
                )}
                <span className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                  style={{ background: statut.bg, color: statut.color }}>
                  {collab.statut_collaborateur}
                </span>
              </div>
            </div>
            {/* Badge lecture seule */}
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl flex-shrink-0"
              style={{ background: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.6)" }}>
              <Lock size={12} />
              <span className="text-[11px] font-medium">Lecture seule</span>
            </div>
          </div>

          {/* Onglets */}
          <div className="flex gap-0 -mx-6 px-6 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
            {TABS.map(tab => {
              const isActive = activeTab === tab.id;
              return (
                <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                  className="flex items-center gap-1.5 px-4 py-3 text-xs font-semibold whitespace-nowrap transition-all flex-shrink-0"
                  style={{
                    color: isActive ? "white" : "rgba(255,255,255,0.5)",
                    borderBottom: isActive ? "2px solid white" : "2px solid transparent",
                    background: isActive ? "rgba(255,255,255,0.08)" : "transparent",
                  }}>
                  <tab.icon size={12} />{tab.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Contenu */}
      <div className="space-y-4">

        {/* ── Identité ── */}
        {activeTab === "identite" && (
          <>
            <Section title="État civil" icon={<User size={14} />}>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-5">
                <Field label="Nom complet" value={`${collab.prenom} ${collab.nom}`} />
                <Field label="Genre" value={collab.code_genre === "H" ? "Homme" : collab.code_genre === "F" ? "Femme" : collab.code_genre} />
                <Field label="Date de naissance" value={collab.date_naissance ? format(parseISO(collab.date_naissance), "dd MMMM yyyy", { locale: fr }) : undefined} icon={<Calendar size={10} />} />
                <Field label="Lieu de naissance" value={collab.lieu_naissance} icon={<MapPin size={10} />} />
                <Field label="Nationalité" value={collab.code_nationalite} icon={<Flag size={10} />} />
              </div>
            </Section>

            <Section title="Documents d'identité" icon={<CreditCard size={14} />}>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-5">
                <Field label="CIN" value={collab.cin} />
                <Field label="Date délivrance CIN" value={collab.cin_date_delivrance ? format(parseISO(collab.cin_date_delivrance), "dd/MM/yyyy") : undefined} />
                <Field label="Date expiration CIN" value={collab.cin_date_fin ? format(parseISO(collab.cin_date_fin), "dd/MM/yyyy") : undefined} />
                <Field label="Passeport" value={collab.passeport} />
                <Field label="Expiration passeport" value={collab.passeport_date_fin ? format(parseISO(collab.passeport_date_fin), "dd/MM/yyyy") : undefined} />
              </div>
            </Section>

            <Section title="Coordonnées" icon={<Mail size={14} />}>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-5">
                <Field label="Email professionnel" value={collab.email_professionnel} icon={<Mail size={10} />} />
                <Field label="Email personnel" value={collab.email_personnel} icon={<Mail size={10} />} />
                <Field label="Mobile" value={collab.gsm} icon={<Phone size={10} />} />
                <Field label="Téléphone" value={collab.telephone} icon={<Phone size={10} />} />
              </div>
            </Section>
          </>
        )}

        {/* ── Contrats ── */}
        {activeTab === "contrats" && (
          <Section title="Historique des contrats" icon={<Shield size={14} />}>
            {contrats.length === 0 ? (
              <p className="text-sm text-center py-8" style={{ color: "hsl(var(--muted-foreground))" }}>Aucun contrat enregistré</p>
            ) : (
              <div className="space-y-3">
                {contrats.map((ct, idx) => (
                  <div key={ct.id} className="flex items-start gap-3 p-4 rounded-xl"
                    style={{ background: idx === 0 ? "hsl(var(--primary) / 0.05)" : "hsl(var(--muted) / 0.3)", border: `1px solid ${idx === 0 ? "hsl(var(--primary) / 0.2)" : "hsl(var(--border))"}` }}>
                    <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-4">
                      <Field label="Type contrat" value={tcMap[ct.code_type_contrat] || ct.code_type_contrat} />
                      <Field label="Date début" value={ct.date_debut ? format(parseISO(ct.date_debut), "dd/MM/yyyy") : undefined} />
                      <Field label="Date fin" value={ct.date_fin ? format(parseISO(ct.date_fin), "dd/MM/yyyy") : "Indéterminée"} />
                      <Field label="Statut" value={ct.code_statut_contrat} />
                    </div>
                    {idx === 0 && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold flex-shrink-0"
                        style={{ background: "hsl(var(--primary) / 0.12)", color: "hsl(var(--primary))" }}>En cours</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Section>
        )}

        {/* ── Classification & Affectation ── */}
        {activeTab === "affectation" && (
          <Section title="Affectations" icon={<Building2 size={14} />}>
            {affectations.length === 0 ? (
              <p className="text-sm text-center py-8" style={{ color: "hsl(var(--muted-foreground))" }}>Aucune affectation enregistrée</p>
            ) : (
              <div className="space-y-3">
                {affectations.map((a, idx) => (
                  <div key={a.id} className="p-4 rounded-xl"
                    style={{ background: idx === 0 ? "hsl(var(--primary) / 0.05)" : "hsl(var(--muted) / 0.3)", border: `1px solid ${idx === 0 ? "hsl(var(--primary) / 0.2)" : "hsl(var(--border))"}` }}>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                      <Field label="Poste" value={a.code_poste ? (posteMap[a.code_poste] || a.code_poste) : undefined} icon={<Briefcase size={10} />} />
                      <Field label="Intitulé poste" value={a.intitule_poste} />
                      <Field label="UO" value={a.unite_id ? (uoMap[a.unite_id] || a.unite_id) : undefined} icon={<Building2 size={10} />} />
                      <Field label="Début" value={a.date_debut ? format(parseISO(a.date_debut), "dd/MM/yyyy") : undefined} />
                      <Field label="Fin" value={a.date_fin_uo ? format(parseISO(a.date_fin_uo), "dd/MM/yyyy") : idx === 0 ? "En cours" : undefined} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>
        )}

        {/* ── Rémunération ── */}
        {activeTab === "remuneration" && (
          <Section title="Salaires" icon={<DollarSign size={14} />}>
            {salaires.length === 0 ? (
              <p className="text-sm text-center py-8" style={{ color: "hsl(var(--muted-foreground))" }}>Aucun salaire enregistré</p>
            ) : (
              <div className="space-y-3">
                {salaires.map((s, idx) => (
                  <div key={s.id} className="p-4 rounded-xl flex items-center justify-between"
                    style={{ background: idx === 0 ? "hsl(var(--primary) / 0.05)" : "hsl(var(--muted) / 0.3)", border: `1px solid ${idx === 0 ? "hsl(var(--primary) / 0.2)" : "hsl(var(--border))"}` }}>
                    <div className="grid grid-cols-3 gap-4 flex-1">
                      <Field label="Salaire de base" value={s.salaire_base ? `${Number(s.salaire_base).toLocaleString("fr-MA", { minimumFractionDigits: 2 })} MAD` : undefined} />
                      <Field label="À partir du" value={s.date_debut ? format(parseISO(s.date_debut), "dd/MM/yyyy") : undefined} />
                      <Field label="Jusqu'au" value={s.date_fin ? format(parseISO(s.date_fin), "dd/MM/yyyy") : idx === 0 ? "En cours" : undefined} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>
        )}

        {/* ── Formation & Compétences ── */}
        {activeTab === "formation" && (
          <>
            <Section title="Formations suivies" icon={<BookOpen size={14} />}>
              {formations.length === 0 ? (
                <p className="text-sm text-center py-8" style={{ color: "hsl(var(--muted-foreground))" }}>Aucune formation enregistrée</p>
              ) : (
                <div className="space-y-2">
                  {formations.map((f: any) => (
                    <div key={f.id} className="flex items-center gap-4 p-3 rounded-xl"
                      style={{ background: "hsl(var(--muted) / 0.3)", border: "1px solid hsl(var(--border))" }}>
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                        style={{ background: "hsl(var(--primary) / 0.1)", color: "hsl(var(--primary))" }}>
                        <BookOpen size={13} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold" style={{ color: "hsl(var(--foreground))" }}>
                          {f.libelle || f.code_formation || "Formation"}
                        </p>
                        <p className="text-[10px]" style={{ color: "hsl(var(--muted-foreground))" }}>
                          {f.date_debut && format(parseISO(f.date_debut), "dd/MM/yyyy")}
                          {f.duree_jours && ` · ${f.duree_jours}j`}
                          {f.statut && ` · ${f.statut}`}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            <Section title="Compétences" icon={<FileText size={14} />}>
              {competences.length === 0 ? (
                <p className="text-sm text-center py-8" style={{ color: "hsl(var(--muted-foreground))" }}>Aucune compétence enregistrée</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {competences.map((comp: any) => (
                    <span key={comp.id} className="px-3 py-1.5 rounded-full text-xs font-medium"
                      style={{ background: "hsl(var(--primary) / 0.1)", color: "hsl(var(--primary))", border: "1px solid hsl(var(--primary) / 0.2)" }}>
                      {comp.libelle || comp.code_competence}
                    </span>
                  ))}
                </div>
              )}
            </Section>
          </>
        )}
      </div>
    </div>
  );
};

export default CollaborateurFicheManager;
