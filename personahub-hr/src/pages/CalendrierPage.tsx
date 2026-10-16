import React, { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useManagerPopulation } from "@/hooks/useManagerPopulation";
import { supabase } from "@/integrations/supabase/client";
import { ChevronLeft, ChevronRight, Briefcase, Gift, FileText, CalendarDays } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface CalEvent {
  id: string;
  date: string;
  label: string;
  type: "contrat" | "anniversaire" | "ferie" | "document";
  collaborateurId?: string;
  codeFamille?: string;
}

const typeStyles: Record<string, { bg: string; text: string; icon: React.ReactNode }> = {
  contrat:      { bg: "bg-accent/10", text: "text-accent", icon: <Briefcase size={10} /> },
  anniversaire: { bg: "bg-purple-500/10", text: "text-purple-600 dark:text-purple-400", icon: <Gift size={10} /> },
  ferie:        { bg: "bg-red-500/10", text: "text-red-600 dark:text-red-400", icon: <CalendarDays size={10} /> },
  document:     { bg: "bg-amber-500/10", text: "text-amber-600 dark:text-amber-400", icon: <FileText size={10} /> },
};

interface FamilleStyle {
  libelle: string;
  couleur: string;  // hex ex "#06B6D4"
  ordre: number;
}

const MONTHS_FR = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];
const DAYS_FR = ["Lun","Mar","Mer","Jeu","Ven","Sam","Dim"];

const CalendrierPage: React.FC = () => {
  const navigate = useNavigate();
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth());
  const [events, setEvents] = useState<CalEvent[]>([]);

  // RG-MGR-CALENDRIER-01 (Adil DAIA) : pour un manager, seuls les événements
  // rattachés à un collaborateur de SA population sont affichés ; les jours
  // fériés (non nominatifs) restent visibles. Admin/RH voient tout.
  const { role } = useAuth();
  const { collaborateurIds } = useManagerPopulation();
  const popSet = useMemo(() => new Set(collaborateurIds), [collaborateurIds]);
  const visibleEvents = useMemo(() => {
    if (role !== "manager") return events;
    return events.filter(e =>
      e.type === "ferie" || (e.collaborateurId != null && popSet.has(e.collaborateurId))
    );
  }, [events, role, popSet]);
  const [familles, setFamilles] = useState<Record<string, FamilleStyle>>({});
  const [evenements, setEvenements] = useState<Record<string, string>>({});

  const handleEventClick = (ev: CalEvent) => {
    if (!ev.collaborateurId) return;
    if (ev.type === "anniversaire" || ev.type === "document") {
      navigate(`/collaborateurs/${ev.collaborateurId}`);
    } else if (ev.type === "contrat") {
      navigate(`/collaborateurs/${ev.collaborateurId}?tab=contrat`);
    }
  };

  useEffect(() => {
    loadFamilles();
    loadEvenements();
  }, []);

  useEffect(() => {
    loadEvents();
  }, [year, month, evenements]);

  // Charger les familles d'événements (avec leurs couleurs depuis la BDD)
  const loadFamilles = async () => {
    try {
      const { data } = await supabase
        .from("ref_famille_ferie" as never)
        .select("code, libelle, couleur, ordre" as never)
        .eq("actif" as never, true as never);
      const map: Record<string, FamilleStyle> = {};
      ((data || []) as any[]).forEach(f => {
        map[f.code] = {
          libelle: f.libelle,
          couleur: f.couleur || "#64748B",
          ordre: f.ordre || 99,
        };
      });
      setFamilles(map);
    } catch (e) {
      console.error("Erreur chargement familles:", e);
    }
  };

  // Charger les libellés des événements fériés (Aïd Al-Fitr, Marche Verte, etc.)
  const loadEvenements = async () => {
    try {
      const { data } = await supabase
        .from("ref_evenement_ferie" as never)
        .select("code, libelle" as never)
        .eq("actif" as never, true as never);
      const map: Record<string, string> = {};
      ((data || []) as any[]).forEach(e => {
        map[e.code] = e.libelle;
      });
      setEvenements(map);
    } catch (e) {
      console.error("Erreur chargement événements:", e);
    }
  };

  // Convertit un code couleur hex en style inline (avec opacité pour le fond)
  const getEventStyle = (ev: CalEvent): { bg: string; color: string; icon: React.ReactNode } => {
    if (ev.type === "ferie" && ev.codeFamille && familles[ev.codeFamille]) {
      const couleur = familles[ev.codeFamille].couleur;
      return {
        bg: `${couleur}1A`,  // 1A = 10% opacity en hex
        color: couleur,
        icon: <CalendarDays size={10} />,
      };
    }
    // Fallback sur les types statiques (contrat, anniversaire, document)
    const t = typeStyles[ev.type];
    return { bg: "", color: "", icon: t.icon };
  };

  const loadEvents = async () => {
    const evts: CalEvent[] = [];
    const start = `${year}-${String(month + 1).padStart(2, "0")}-01`;
    const endDate = new Date(year, month + 1, 0);
    const end = `${year}-${String(month + 1).padStart(2, "0")}-${String(endDate.getDate()).padStart(2, "0")}`;

    // Jours fériés
    try {
      const { data } = await supabase
        .from("ref_jours_feries" as never)
        .select("id, date_debut, libelle_specifique, code_famille, code_evenement, nombre_jours, actif" as never)
        .eq("actif" as never, true as never)
        .gte("date_debut" as never, start as never)
        .lte("date_debut" as never, end as never);
      ((data || []) as any[]).forEach(j => {
        // Pour les fériés multi-jours (ex: Aïd 2 jours), on crée une entrée par jour
        const nbJours = j.nombre_jours && j.nombre_jours > 0 ? j.nombre_jours : 1;
        for (let i = 0; i < nbJours; i++) {
          const d = new Date(j.date_debut);
          d.setDate(d.getDate() + i);
          const dateStr = d.toISOString().split("T")[0];
          // Ne garder que les jours qui tombent dans le mois affiché
          if (dateStr >= start && dateStr <= end) {
            // Priorité : libellé spécifique (saisi pour cette occurrence) > libellé du référentiel > code
            const labelEvenement =
              j.libelle_specifique ||
              (j.code_evenement ? evenements[j.code_evenement] : null) ||
              j.code_evenement ||
              "Jour férié";
            evts.push({
              id: `fer_${j.id}_${i}`,
              date: dateStr,
              label: labelEvenement,
              type: "ferie",
              codeFamille: j.code_famille,
            });
          }
        }
      });
    } catch (e) {
      console.error("Erreur chargement jours fériés:", e);
    }

    // Anniversaires
    try {
      const { data } = await supabase
        .from("collaborateurs")
        .select("id, matricule, nom, prenom, date_naissance")
        .eq("archive", false)
        .neq("statut_collaborateur", "SORTI")
        .not("date_naissance", "is", null);
      ((data || []) as any[]).forEach(c => {
        const dn = new Date(c.date_naissance);
        if (dn.getMonth() === month) {
          const d = `${year}-${String(month + 1).padStart(2, "0")}-${String(dn.getDate()).padStart(2, "0")}`;
          evts.push({ id: `ann_${c.id}`, date: d, label: `🎂 ${c.prenom} ${c.nom}`, type: "anniversaire", collaborateurId: c.id });
        }
      });
    } catch {}

    // Contrats arrivant à échéance
    try {
      const { data } = await supabase
        .from("collaborateur_contrats")
        .select(`id, date_fin, date_depart_previsionnelle, collaborateur_id,
          collaborateurs!inner(nom, prenom, matricule, statut_collaborateur, archive)` as never)
        .eq("archive" as never, false as never)
        .neq("collaborateurs.statut_collaborateur" as never, "SORTI" as never)
        .eq("collaborateurs.archive" as never, false as never);

      ((data || []) as any[]).forEach(c => {
        const col = c.collaborateurs;
        const df = c.date_fin || c.date_depart_previsionnelle;
        if (df && df >= start && df <= end) {
          evts.push({ id: `ctr_${c.id}`, date: df, label: `Fin contrat: ${col.prenom} ${col.nom}`, type: "contrat", collaborateurId: c.collaborateur_id });
        }
      });
    } catch {}

    // Documents expirant
    try {
      const { data } = await supabase
        .from("collaborateurs")
        .select("id, nom, prenom, cin_date_fin, passeport_date_fin")
        .eq("archive", false)
        .neq("statut_collaborateur", "SORTI");
      ((data || []) as any[]).forEach(c => {
        if (c.cin_date_fin && c.cin_date_fin >= start && c.cin_date_fin <= end) {
          evts.push({ id: `doc_cin_${c.id}`, date: c.cin_date_fin, label: `CIN expire: ${c.prenom} ${c.nom}`, type: "document", collaborateurId: c.id });
        }
        if (c.passeport_date_fin && c.passeport_date_fin >= start && c.passeport_date_fin <= end) {
          evts.push({ id: `doc_pass_${c.id}`, date: c.passeport_date_fin, label: `Passeport expire: ${c.prenom} ${c.nom}`, type: "document", collaborateurId: c.id });
        }
      });
    } catch {}

    setEvents(evts);
  };

  // Calendar grid
  const firstDay = new Date(year, month, 1);
  let startDow = firstDay.getDay() - 1; // Lundi = 0
  if (startDow < 0) startDow = 6;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const totalCells = Math.ceil((startDow + daysInMonth) / 7) * 7;

  const prev = () => { if (month === 0) { setMonth(11); setYear(y => y - 1); } else setMonth(m => m - 1); };
  const next = () => { if (month === 11) { setMonth(0); setYear(y => y + 1); } else setMonth(m => m + 1); };
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  return (
    <div className="max-w-6xl mx-auto">
      {/* Fil d'Ariane */}
      <div className="flex items-center gap-1.5 px-6 pt-4 pb-2 text-[13px]" style={{ color: "hsl(var(--muted-foreground))" }}>
        <span className="font-semibold" style={{ color: "hsl(var(--foreground))" }}>Calendrier</span>
      </div>

      {/* Barre d'outils : navigation mois */}
      <div className="flex items-center gap-2 px-6 py-2.5 flex-wrap" style={{ borderBottom: "1px solid hsl(var(--border))", background: "hsl(var(--card))" }}>
        <button
          onClick={() => { setYear(today.getFullYear()); setMonth(today.getMonth()); }}
          className="text-[13px] h-8 px-3 font-medium transition-colors"
          style={{ color: "hsl(var(--muted-foreground))" }}
        >
          Aujourd'hui
        </button>
        <div className="w-px h-5 mx-1" style={{ background: "hsl(var(--border))" }} />
        <button onClick={prev} className="p-1.5 rounded transition-colors" style={{ color: "hsl(var(--muted-foreground))" }}><ChevronLeft size={16} /></button>
        <span className="text-[14px] font-semibold min-w-[160px] text-center" style={{ color: "hsl(var(--foreground))" }}>
          {MONTHS_FR[month]} {year}
        </span>
        <button onClick={next} className="p-1.5 rounded transition-colors" style={{ color: "hsl(var(--muted-foreground))" }}><ChevronRight size={16} /></button>
      </div>

      <div className="p-6">
      {/* Légende */}
      <div className="flex flex-col gap-2 mb-4">
        <div className="flex gap-4 flex-wrap">
          {Object.entries(typeStyles).map(([type, s]) => (
            <span key={type} className={`flex items-center gap-1.5 text-xs ${s.text}`}>
              <span className={`w-3 h-3 rounded-full ${s.bg} flex items-center justify-center`}>{s.icon}</span>
              {type === "contrat" ? "Contrats" : type === "anniversaire" ? "Anniversaires" : type === "ferie" ? "Jours fériés" : "Documents"}
            </span>
          ))}
        </div>
        {Object.keys(familles).length > 0 && (
          <div className="flex gap-3 flex-wrap text-[10px] items-center" style={{ color: "hsl(var(--muted-foreground))" }}>
            <span>Familles fériés :</span>
            {Object.entries(familles)
              .sort(([, a], [, b]) => a.ordre - b.ordre)
              .map(([code, f]) => (
                <span key={code} className="flex items-center gap-1" style={{ color: f.couleur }}>
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: f.couleur }} />
                  {f.libelle}
                </span>
              ))}
          </div>
        )}
      </div>

      {/* Calendar grid */}
      <div className="border overflow-hidden" style={{ borderColor: "hsl(var(--border))" }}>
        <div className="grid grid-cols-7">
          {DAYS_FR.map(d => (
            <div key={d} className="px-2 py-2 text-center text-xs font-bold uppercase" style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {Array.from({ length: totalCells }).map((_, i) => {
            const dayNum = i - startDow + 1;
            const isValid = dayNum >= 1 && dayNum <= daysInMonth;
            const dateStr = isValid ? `${year}-${String(month + 1).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}` : "";
            const dayEvents = isValid ? visibleEvents.filter(e => e.date === dateStr) : [];
            const isToday = dateStr === todayStr;

            return (
              <div
                key={i}
                className="min-h-[90px] border-t border-r last:border-r-0 p-1"
                style={{
                  borderColor: "hsl(var(--border))",
                  background: isToday ? "hsl(var(--accent) / 0.06)" : isValid ? "hsl(var(--card))" : "hsl(var(--muted) / 0.3)",
                }}
              >
                {isValid && (
                  <>
                    <span
                      className={`text-xs font-medium inline-block w-6 h-6 rounded-full text-center leading-6 ${isToday ? "bg-accent text-white font-bold" : ""}`}
                      style={!isToday ? { color: "hsl(var(--foreground))" } : {}}
                    >
                      {dayNum}
                    </span>
                    <div className="space-y-0.5 mt-0.5">
                      <TooltipProvider delayDuration={200}>
                        {dayEvents.slice(0, 3).map(ev => {
                          const s = getEventStyle(ev);
                          // Pour les fériés avec couleur dynamique, on utilise des styles inline
                          const isFerie = ev.type === "ferie" && ev.codeFamille && familles[ev.codeFamille];
                          if (isFerie) {
                            return (
                              <Tooltip key={ev.id}>
                                <TooltipTrigger asChild>
                                  <div
                                    onClick={() => handleEventClick(ev)}
                                    className={`text-[9px] px-1 py-0.5 rounded truncate flex items-center gap-1 ${ev.collaborateurId ? "cursor-pointer hover:opacity-80" : ""}`}
                                    style={{ backgroundColor: s.bg, color: s.color }}
                                  >
                                    {s.icon} <span className="truncate">{ev.label}</span>
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="max-w-[250px] text-xs">
                                  <p>{ev.label}</p>
                                  {ev.codeFamille && familles[ev.codeFamille] && (
                                    <p className="text-muted-foreground mt-0.5">{familles[ev.codeFamille].libelle}</p>
                                  )}
                                </TooltipContent>
                              </Tooltip>
                            );
                          }
                          // Affichage normal pour les autres types (contrats, anniversaires, documents)
                          const t = typeStyles[ev.type];
                          return (
                            <Tooltip key={ev.id}>
                              <TooltipTrigger asChild>
                                <div
                                  onClick={() => handleEventClick(ev)}
                                  className={`${t.bg} ${t.text} text-[9px] px-1 py-0.5 rounded truncate flex items-center gap-1 ${ev.collaborateurId ? "cursor-pointer hover:opacity-80" : ""}`}
                                >
                                  {t.icon} <span className="truncate">{ev.label}</span>
                                </div>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-[250px] text-xs">
                                <p>{ev.label}</p>
                                {ev.collaborateurId && <p className="text-muted-foreground mt-0.5">Cliquez pour ouvrir la fiche</p>}
                              </TooltipContent>
                            </Tooltip>
                          );
                        })}
                      </TooltipProvider>
                      {dayEvents.length > 3 && (
                        <span className="text-[9px] px-1" style={{ color: "hsl(var(--muted-foreground))" }}>
                          +{dayEvents.length - 3} autres
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
      </div>
    </div>
  );
};

export default CalendrierPage;
