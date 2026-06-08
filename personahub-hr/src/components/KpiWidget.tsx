import React, { useRef } from "react";
import { useNavigate } from "react-router-dom";
import { KpiWidgetData } from "@/hooks/useKpiWidgets";
import {
  PieChart as RechartsPie, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from "recharts";
import { BarChart3, PieChart, RefreshCw, MousePointerClick, FileDown, Loader2 } from "lucide-react";

interface KpiWidgetProps {
  widget: KpiWidgetData;
}

function getKpiRoute(code: string): string | null {
  switch (code) {
    case "KPI_REPARTITION_SEXE":
    case "KPI_REPARTITION_AGE":
    case "KPI_REPARTITION_ANCIENNETE":
    case "KPI_REPARTITION_TYPE_CONTRAT":
      return "/collaborateurs?statut=ACTIF";
    case "KPI_TOTAL_COLLABORATEURS":
      return "/collaborateurs?statut=hors_sortis";
    case "KPI_REPARTITION_STATUT_CONTRAT":
      return "/collaborateurs?statut=all";
    case "KPI_TOTAL_DEPARTS":
    case "KPI_DEPARTS_PAR_MOTIF":
    case "KPI_DEPARTS_EVOLUTION":
    case "KPI_TAUX_ROTATION":
      return "/collaborateurs?statut=SORTI";
    case "KPI_SOLDE_CONGES_MOYEN":
      return "/absences/compteur-conges";
    default:
      return null;
  }
}

// Capture le SVG du graphique Recharts en PNG base64
async function captureSvgAsPng(container: HTMLDivElement): Promise<string | null> {
  const svgEl = container.querySelector("svg");
  if (!svgEl) return null;
  return new Promise((resolve) => {
    const svgData = new XMLSerializer().serializeToString(svgEl);
    const blob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const w = svgEl.clientWidth || 400;
      const h = svgEl.clientHeight || 200;
      const canvas = document.createElement("canvas");
      canvas.width = w * 2;
      canvas.height = h * 2;
      const ctx = canvas.getContext("2d")!;
      ctx.scale(2, 2);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/png").split(",")[1]);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

// =====================================================
// Composant : KpiWidget
// =====================================================
const KpiWidget: React.FC<KpiWidgetProps> = ({ widget }) => {
  const navigate = useNavigate();
  const chartRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = React.useState(false);
  const cfg = widget.config;
  const chartType = cfg.chart_type || "bar";
  const titre = cfg.titre || widget.libelle;
  const route = getKpiRoute(widget.code);

  const handleDoubleClick = () => {
    if (route) navigate(route);
  };

  const handleExport = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setExporting(true);
    try {
      // 1. Capturer le graphique
      const pngBase64 = chartRef.current ? await captureSvgAsPng(chartRef.current) : null;

      // 2. Créer le classeur Excel avec ExcelJS
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      wb.creator = "SolGEIS";
      wb.created = new Date();
      const ws = wb.addWorksheet(titre.substring(0, 31));

      // En-tête titre
      ws.mergeCells("A1:B1");
      const titleCell = ws.getCell("A1");
      titleCell.value = titre;
      titleCell.font = { bold: true, size: 13, color: { argb: "FF1E3A5F" } };
      titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8F0FE" } };
      titleCell.alignment = { horizontal: "center", vertical: "middle" };
      ws.getRow(1).height = 24;

      // En-têtes colonnes
      const headerRow = ws.addRow(["Catégorie", "Valeur"]);
      headerRow.eachCell(cell => {
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
        cell.alignment = { horizontal: "center" };
        cell.border = {
          bottom: { style: "thin", color: { argb: "FF1E3A5F" } },
        };
      });

      // Données
      widget.chartData.forEach((d, i) => {
        const row = ws.addRow([d.name, d.value]);
        row.getCell(1).alignment = { horizontal: "left" };
        row.getCell(2).alignment = { horizontal: "right" };
        if (i % 2 === 0) {
          row.eachCell(cell => {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F7FA" } };
          });
        }
      });

      // Ligne total (si pertinent)
      if (widget.code !== "KPI_TAUX_ROTATION") {
        const totalRow = ws.addRow(["Total", widget.total]);
        totalRow.eachCell(cell => {
          cell.font = { bold: true };
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8F0FE" } };
        });
      }

      // Largeurs colonnes
      ws.getColumn(1).width = 28;
      ws.getColumn(2).width = 14;

      // 3. Insérer le graphique comme image (colonne D)
      if (pngBase64) {
        const imgId = wb.addImage({ base64: pngBase64, extension: "png" });
        ws.addImage(imgId, {
          tl: { col: 3, row: 0 } as any,
          ext: { width: 420, height: 230 },
        });
        // Élargir la colonne D pour l'image
        ws.getColumn(4).width = 55;
      }

      // 4. Télécharger
      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${titre.replace(/[^a-zA-Z0-9_]/g, "_")}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div
      onDoubleClick={handleDoubleClick}
      className="rounded-xl p-3 transition-all"
      style={{
        background: "hsl(var(--card))",
        border: "1px solid hsl(var(--border))",
        cursor: route ? "pointer" : "default",
      }}
      title={route ? "Double-cliquez pour voir les détails" : undefined}
    >
      {/* En-tête du widget */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <div
            className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0"
            style={{ background: "hsl(var(--primary) / 0.1)", color: "hsl(var(--primary))" }}
          >
            {chartType === "pie" ? <PieChart size={12} /> : <BarChart3 size={12} />}
          </div>
          <h3 className="text-xs font-semibold truncate" style={{ fontFamily: "Poppins, sans-serif", color: "hsl(var(--foreground))" }}>
            {titre}
          </h3>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
          {route && (
            <span className="text-xs flex items-center gap-0.5 opacity-30" style={{ color: "hsl(var(--muted-foreground))" }}>
              <MousePointerClick size={10} />×2
            </span>
          )}
          {widget.code !== "KPI_TAUX_ROTATION" && (
            <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }}>
              {widget.code === "KPI_TOTAL_DEPARTS"
                ? `${widget.total} dép.`
                : widget.code === "KPI_SOLDE_CONGES_MOYEN"
                ? `${widget.total} j.`
                : `${widget.total}`}
            </span>
          )}
          {/* Bouton export Excel */}
          <button
            onClick={handleExport}
            disabled={exporting}
            title="Exporter données + graphique vers Excel"
            className="w-6 h-6 rounded flex items-center justify-center transition-all hover:scale-110 disabled:opacity-50"
            style={{ background: "hsl(84 55% 45% / 0.12)", color: "hsl(84 55% 35%)" }}
          >
            {exporting ? <Loader2 size={11} className="animate-spin" /> : <FileDown size={12} />}
          </button>
        </div>
      </div>

      {/* Graphique */}
      <div ref={chartRef}>
        {widget.total === 0 ? (
          <div className="flex items-center justify-center h-32 text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
            Aucune donnée
          </div>
        ) : chartType === "pie" ? (
          <ResponsiveContainer width="100%" height={160}>
            <RechartsPie>
              <Pie
                data={widget.chartData}
                cx="50%"
                cy="50%"
                outerRadius={55}
                dataKey="value"
                label={({ percent }) => `${(percent * 100).toFixed(0)}%`}
                labelLine={false}
              >
                {widget.chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.fill} />
                ))}
              </Pie>
              <Tooltip formatter={(val: any, name: any) => [`${val} (${((val / widget.total) * 100).toFixed(1)}%)`, name]} />
              <Legend iconSize={8} wrapperStyle={{ fontSize: "10px" }} />
            </RechartsPie>
          </ResponsiveContainer>
        ) : (
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={widget.chartData} margin={{ top: 4, right: 8, left: -25, bottom: 4 }}>
              {cfg.afficher_grille && <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />}
              <XAxis dataKey="name" tick={{ fontSize: 8, fill: "hsl(var(--muted-foreground))" }} />
              <YAxis tick={{ fontSize: 8, fill: "hsl(var(--muted-foreground))" }} />
              <Tooltip formatter={(val: any) => [val, "Valeur"]} />
              <Bar dataKey="value" radius={[3, 3, 0, 0]}>
                {widget.chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
};

// =====================================================
// Composant : KpiWidgetsSkeleton
// =====================================================
export const KpiWidgetsSkeleton: React.FC = () => (
  <div className="flex items-center justify-center h-32 gap-2 text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>
    <RefreshCw className="animate-spin" size={14} />
    Chargement des indicateurs...
  </div>
);

export default KpiWidget;
