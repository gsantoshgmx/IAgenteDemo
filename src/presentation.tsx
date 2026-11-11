import { useEffect, useRef, type CSSProperties } from 'react';
import type PptxGenJS from 'pptxgenjs';

// ─── Tipos ───────────────────────────────────────────────────────────────────

export type SlideLayout =
  | 'cover' | 'section' | 'bullets' | 'stats' | 'columns'
  | 'comparison' | 'timeline' | 'chart' | 'table' | 'quote' | 'closing';

export interface SlideTable {
  headers: string[];
  rows: string[][];
  note?: string;
}

export interface SlideChart {
  type: 'bar' | 'line' | 'doughnut';
  seriesName: string;
  unit?: string;
  note?: string;
  categories: string[];
  values: number[];
}

export interface MarketingSlide {
  layout?: SlideLayout;
  title: string;
  keyMessage: string;
  bullets: string[];
  speakerNotes: string;
  stats?: { value: string; label: string; detail?: string }[];
  columns?: { heading: string; items: string[] }[];
  steps?: { label: string; title: string; text?: string }[];
  chart?: SlideChart;
  table?: SlideTable;
  quote?: { text: string; author?: string };
}

export interface MarketingPresentation {
  title: string;
  subtitle: string;
  slides: MarketingSlide[];
}

export type ThemeVariant = 'modern' | 'minimal';

export interface PresentationTheme {
  /** modern: portada oscura, tarjetas y círculos. minimal: fondo blanco, tipografía grande y números destacados. */
  variant: ThemeVariant;
  colors: {
    primary: string; secondary: string; accent: string; dark: string; background: string;
    surface: string; text: string; muted: string; onDark: string; border: string; alternate: string;
  };
  fonts: { heading: string; body: string };
  label: string;
  footer: string;
  logo?: { data: string; width: number; height: number };
}

export const DEFAULT_THEME: PresentationTheme = {
  variant: 'modern',
  colors: {
    primary: '16775C', secondary: '42D6A4', accent: 'F2A33A', dark: '10251F', background: 'F4F6F2',
    surface: 'FFFFFF', text: '1C2C25', muted: '5B6B62', onDark: 'D9E4DE', border: 'DCE3DE', alternate: 'EAF2EE',
  },
  fonts: { heading: 'Aptos Display', body: 'Aptos' },
  label: 'MERCADOTECNIA',
  footer: '',
};

/** Lee agentes/mercadotecnia/estilo.json (y el logo) a través del backend local. */
export async function loadPresentationTheme(): Promise<{ theme: PresentationTheme; warning?: string }> {
  try {
    const response = await fetch('/api/claude/style');
    const result = await response.json();
    if (!response.ok) return { theme: DEFAULT_THEME, warning: result.error };
    const theme: PresentationTheme = {
      variant: result.theme?.variant === 'minimal' ? 'minimal' : 'modern',
      colors: { ...DEFAULT_THEME.colors, ...(result.theme?.colors || {}) },
      fonts: { ...DEFAULT_THEME.fonts, ...(result.theme?.fonts || {}) },
      label: result.theme?.label ?? DEFAULT_THEME.label,
      footer: result.theme?.footer ?? DEFAULT_THEME.footer,
    };
    if (result.logo) {
      const size = await new Promise<{ width: number; height: number } | null>(resolve => {
        const image = new Image();
        image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
        image.onerror = () => resolve(null);
        image.src = result.logo;
      });
      if (size?.width && size.height) theme.logo = { data: result.logo, ...size };
    }
    return { theme, warning: result.warning };
  } catch {
    return { theme: DEFAULT_THEME, warning: 'No se pudo leer el estilo de la presentación; se usó el estilo por defecto.' };
  }
}

// ─── Motor de diseño (compartido por la vista previa y el .pptx) ─────────────

const SLIDE_W = 13.333;
const SLIDE_H = 7.5;
const WHITE = 'FFFFFF';
const LINE_HEIGHT = 1.2;

interface Box { x: number; y: number; w: number; h: number }
type Element =
  | (Box & { kind: 'rect'; fill: string; transparency?: number; border?: string })
  | (Box & { kind: 'ellipse'; fill: string; transparency?: number })
  | (Box & {
      kind: 'text'; text: string; pt: number; color: string; font: string;
      bold?: boolean; italic?: boolean; align?: 'left' | 'center' | 'right'; valign?: 'top' | 'middle' | 'bottom'; spacing?: number;
    })
  | (Box & { kind: 'image'; data: string })
  | (Box & { kind: 'chart'; chart: SlideChart; colors: string[]; font: string; textColor: string; mutedColor: string })
  | (Box & {
      kind: 'table'; headers: string[]; rows: string[][]; colW: number[]; rowH: number; pt: number; font: string;
      headerFill: string; headerColor: string; fill: string; altFill: string; border: string; color: string; firstColor: string;
    });

interface SlideDesign { background: string; elements: Element[] }

/** Reduce el tamaño de letra hasta que el texto estimado quepa en la caja (PowerPoint no lo hace solo). */
function fitSize(text: string, pt: number, w: number, h: number, bold = false, min = 10) {
  const paragraphs = text.split('\n');
  for (let size = pt; size > min; size -= 1) {
    const charWidth = (size / 72) * (bold ? 0.56 : 0.5);
    const perLine = Math.max(1, Math.floor((w / charWidth) * 0.9));
    const lines = paragraphs.reduce((count, paragraph) => count + Math.max(1, Math.ceil(paragraph.length / perLine)), 0);
    if ((lines * size * LINE_HEIGHT) / 72 <= h) return size;
  }
  return min;
}

const pad = (value: number) => String(value).padStart(2, '0');

export function slideLayout(slide: MarketingSlide, index: number, total: number): SlideLayout {
  if (slide.layout) return slide.layout;
  if (index === 0) return 'cover';
  if (index === total - 1) return 'closing';
  return 'bullets';
}

export function formatChartValue(value: number, chart: SlideChart) {
  const decimals = chart.values.every(Number.isInteger) ? 0 : 1;
  const number = new Intl.NumberFormat('es-MX', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value);
  const unit = chart.unit || '';
  return ['$', '€', '£'].includes(unit) ? `${unit}${number}` : `${number}${unit === '%' ? '%' : unit ? ` ${unit}` : ''}`;
}

type TextOptions = {
  bold?: boolean; italic?: boolean; heading?: boolean; align?: 'left' | 'center' | 'right';
  valign?: 'top' | 'middle' | 'bottom'; spacing?: number; min?: number;
};
type TableStyle = Pick<Extract<Element, { kind: 'table' }>, 'headerFill' | 'headerColor' | 'fill' | 'altFill' | 'border' | 'color' | 'firstColor'>;

/** Primitivas de dibujo comunes a todas las variantes. */
function makeBuilder(theme: PresentationTheme) {
  const els: Element[] = [];
  const text = (box: Box, value: string, pt: number, color: string, options: TextOptions = {}) => {
    if (!value) return;
    els.push({
      kind: 'text', ...box, text: value, color,
      pt: fitSize(value, pt, box.w, box.h, options.bold, options.min ?? Math.max(9, Math.round(pt * 0.55))),
      font: options.heading ? theme.fonts.heading : theme.fonts.body,
      bold: options.bold, italic: options.italic, align: options.align, valign: options.valign, spacing: options.spacing,
    });
  };
  const rect = (box: Box, fill: string, extra: { border?: string; transparency?: number } = {}) => els.push({ kind: 'rect', ...box, fill, ...extra });
  const circle = (box: Box, fill: string, transparency?: number) => els.push({ kind: 'ellipse', ...box, fill, transparency });
  const numberedCircle = (x: number, y: number, size: number, label: string, fill: string) => {
    circle({ x, y, w: size, h: size }, fill);
    text({ x, y, w: size, h: size }, label, size * 26, WHITE, { bold: true, align: 'center', valign: 'middle', min: 8 });
  };
  const logo = (x: number, y: number, maxW: number, maxH: number, alignRight = false) => {
    if (!theme.logo) return;
    const scale = Math.min(maxW / theme.logo.width, maxH / theme.logo.height);
    const w = theme.logo.width * scale;
    const h = theme.logo.height * scale;
    els.push({ kind: 'image', x: alignRight ? x + maxW - w : x, y, w, h, data: theme.logo.data });
  };
  const bulletList = (items: string[]) => items.map(item => `•  ${item}`).join('\n');
  /** Tabla nativa; la primera columna es más ancha. Devuelve el alto ocupado. */
  const table = (x: number, y: number, w: number, maxH: number, data: SlideTable, style: TableStyle) => {
    const weights = data.headers.map((_, i) => (i === 0 ? 1.4 : 1));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    const colW = weights.map(weight => (w * weight) / total);
    const rowH = Math.min(0.68, maxH / (data.rows.length + 1));
    let pt = 16;
    [data.headers, ...data.rows].forEach((row, r) => row.forEach((cell, j) => {
      pt = Math.min(pt, fitSize(cell, 16, colW[j] - 0.3, rowH - 0.08, r === 0 || j === 0, 10));
    }));
    els.push({ kind: 'table', x, y, w, h: rowH * (data.rows.length + 1), headers: data.headers, rows: data.rows, colW, rowH, pt, font: theme.fonts.body, ...style });
    return rowH * (data.rows.length + 1);
  };
  return { els, text, rect, circle, numberedCircle, logo, bulletList, table };
}

function designSlide(deck: MarketingPresentation, index: number, theme: PresentationTheme): SlideDesign {
  return theme.variant === 'minimal' ? designMinimal(deck, index, theme) : designModern(deck, index, theme);
}

function designModern(deck: MarketingPresentation, index: number, theme: PresentationTheme): SlideDesign {
  const slide = deck.slides[index];
  const total = deck.slides.length;
  const layout = slideLayout(slide, index, total);
  const c = theme.colors;
  const { els, text, rect, circle, numberedCircle, logo, bulletList, table } = makeBuilder(theme);
  const pageNumber = (color: string) => text({ x: 11.63, y: 6.98, w: 1, h: 0.28 }, pad(index + 1), 10, color, { bold: true, align: 'right' });

  // Encabezado y pie comunes de las diapositivas claras.
  const lightFrame = () => {
    rect({ x: 0.7, y: 0.55, w: 0.08, h: 0.3 }, c.primary);
    text({ x: 0.9, y: 0.52, w: 7, h: 0.36 }, `${pad(index)}  ·  ${theme.label}`, 11, c.primary, { bold: true, spacing: 1.5, valign: 'middle' });
    logo(10.83, 0.45, 1.8, 0.5, true);
    text({ x: 0.7, y: 0.95, w: 11.93, h: 0.95 }, slide.title, 30, c.text, { bold: true, heading: true, valign: 'middle', min: 18 });
    text({ x: 0.7, y: 1.95, w: 11.93, h: 0.62 }, slide.keyMessage, 16, c.muted, { valign: 'top', min: 11 });
    rect({ x: 0.7, y: 6.9, w: 11.93, h: 0.012 }, c.border);
    text({ x: 0.7, y: 7.0, w: 9, h: 0.25 }, theme.footer || deck.title, 9, c.muted);
    pageNumber(c.primary);
  };

  const CY = 2.75; // inicio del área de contenido
  const CH = 3.95; // alto del área de contenido
  const CW = 11.93; // ancho útil
  const palette = [c.primary, c.secondary, c.accent, c.dark];

  switch (layout) {
    case 'cover': {
      circle({ x: 8.6, y: -1.8, w: 7, h: 7 }, c.primary);
      circle({ x: 10.9, y: 4.4, w: 3.4, h: 3.4 }, c.secondary, 25);
      circle({ x: 8.1, y: 5.3, w: 0.9, h: 0.9 }, c.accent);
      logo(0.8, 0.6, 2.2, 0.7);
      text({ x: 0.8, y: 1.75, w: 7.5, h: 0.4 }, theme.label, 12, c.secondary, { bold: true, spacing: 2 });
      rect({ x: 0.8, y: 2.3, w: 0.9, h: 0.07 }, c.accent);
      text({ x: 0.8, y: 2.55, w: 7.6, h: 2.1 }, slide.title || deck.title, 40, WHITE, { bold: true, heading: true, min: 24 });
      text({ x: 0.8, y: 4.75, w: 7.3, h: 0.95 }, slide.keyMessage || deck.subtitle, 18, c.onDark, { min: 12 });
      text({ x: 0.8, y: 6.65, w: 7, h: 0.35 }, theme.footer, 11, c.onDark);
      return { background: c.dark, elements: els };
    }
    case 'section': {
      const sectionNumber = deck.slides.slice(0, index + 1).filter((item, i) => slideLayout(item, i, total) === 'section').length;
      rect({ x: 9.8, y: 0, w: SLIDE_W - 9.8, h: SLIDE_H }, c.dark);
      circle({ x: 10.45, y: 2.6, w: 2.3, h: 2.3 }, c.secondary);
      text({ x: 0.8, y: 1.5, w: 4, h: 1.6 }, pad(sectionNumber), 80, c.onDark, { bold: true, heading: true });
      text({ x: 0.8, y: 3.2, w: 8.4, h: 1.5 }, slide.title, 38, WHITE, { bold: true, heading: true, min: 22 });
      text({ x: 0.8, y: 4.8, w: 8.2, h: 1.0 }, slide.keyMessage, 18, c.onDark, { min: 12 });
      pageNumber(c.onDark);
      return { background: c.primary, elements: els };
    }
    case 'closing': {
      logo(10.83, 6.55, 1.8, 0.5, true);
      text({ x: 0.8, y: 0.75, w: 8, h: 0.4 }, 'PRÓXIMOS PASOS', 12, c.secondary, { bold: true, spacing: 2 });
      text({ x: 0.8, y: 1.3, w: 11.7, h: 1.2 }, slide.title, 34, WHITE, { bold: true, heading: true, min: 20 });
      text({ x: 0.8, y: 2.5, w: 11.5, h: 0.8 }, slide.keyMessage, 18, c.onDark, { min: 12 });
      const items = slide.bullets.slice(0, 4);
      const gap = 0.3;
      const cardW = (11.73 - gap * (items.length - 1)) / Math.max(1, items.length);
      items.forEach((item, i) => {
        const x = 0.8 + i * (cardW + gap);
        rect({ x, y: 3.75, w: cardW, h: 2.4 }, c.primary);
        text({ x: x + 0.3, y: 3.95, w: 1.2, h: 0.65 }, pad(i + 1), 28, c.secondary, { bold: true, heading: true });
        text({ x: x + 0.3, y: 4.7, w: cardW - 0.6, h: 1.3 }, item, 15, WHITE, { min: 10 });
      });
      return { background: c.dark, elements: els };
    }
    case 'quote': {
      rect({ x: 0, y: 0, w: 0.22, h: SLIDE_H }, c.primary);
      text({ x: 0.8, y: 0.7, w: 2, h: 1.9 }, '“', 150, c.secondary, { bold: true, heading: true });
      text({ x: 1.6, y: 2.0, w: 10.4, h: 3.0 }, slide.quote?.text || slide.keyMessage || slide.title, 32, c.text, { bold: true, heading: true, valign: 'middle', min: 18 });
      rect({ x: 1.6, y: 5.25, w: 0.8, h: 0.06 }, c.accent);
      text({ x: 1.6, y: 5.45, w: 10, h: 0.5 }, slide.quote?.author || '', 16, c.primary, { bold: true });
      logo(10.83, 0.55, 1.8, 0.5, true);
      text({ x: 0.7, y: 7.0, w: 9, h: 0.25 }, theme.footer || deck.title, 9, c.muted);
      pageNumber(c.primary);
      return { background: c.background, elements: els };
    }
    case 'stats': {
      lightFrame();
      const items = (slide.stats || []).slice(0, 4);
      const gap = 0.3;
      const cardW = (CW - gap * (items.length - 1)) / Math.max(1, items.length);
      items.forEach((stat, i) => {
        const x = 0.7 + i * (cardW + gap);
        rect({ x, y: CY, w: cardW, h: 3.6 }, c.surface, { border: c.border });
        rect({ x, y: CY, w: cardW, h: 0.08 }, palette[i % palette.length]);
        text({ x: x + 0.3, y: CY + 0.45, w: cardW - 0.6, h: 1.3 }, stat.value, 50, c.primary, { bold: true, heading: true, valign: 'middle', min: 24 });
        text({ x: x + 0.3, y: CY + 1.9, w: cardW - 0.6, h: 0.65 }, stat.label, 16, c.text, { bold: true, min: 11 });
        text({ x: x + 0.3, y: CY + 2.55, w: cardW - 0.6, h: 0.9 }, stat.detail || '', 12, c.muted, { min: 9 });
      });
      return { background: c.background, elements: els };
    }
    case 'columns': {
      lightFrame();
      const items = (slide.columns || []).slice(0, 3);
      const gap = 0.3;
      const cardW = (CW - gap * (items.length - 1)) / Math.max(1, items.length);
      items.forEach((column, i) => {
        const x = 0.7 + i * (cardW + gap);
        rect({ x, y: CY, w: cardW, h: CH - 0.15 }, c.surface, { border: c.border });
        numberedCircle(x + 0.3, CY + 0.3, 0.52, String(i + 1), palette[i % palette.length]);
        text({ x: x + 0.3, y: CY + 0.95, w: cardW - 0.6, h: 0.7 }, column.heading, 18, c.text, { bold: true, heading: true, min: 12 });
        text({ x: x + 0.3, y: CY + 1.7, w: cardW - 0.6, h: CH - 2.0 }, bulletList(column.items), 13, c.muted, { min: 9 });
      });
      return { background: c.background, elements: els };
    }
    case 'comparison': {
      lightFrame();
      const [left, right] = slide.columns || [];
      const panelW = 5.65;
      const panels = [
        { column: left, x: 0.7, fill: c.surface, band: c.border, heading: c.text, body: c.text },
        { column: right, x: 0.7 + panelW + 0.63, fill: c.primary, band: c.dark, heading: WHITE, body: WHITE },
      ];
      panels.forEach(panel => {
        if (!panel.column) return;
        rect({ x: panel.x, y: CY, w: panelW, h: CH - 0.15 }, panel.fill, panel.fill === c.surface ? { border: c.border } : {});
        rect({ x: panel.x, y: CY, w: panelW, h: 0.72 }, panel.band);
        text({ x: panel.x + 0.35, y: CY, w: panelW - 0.7, h: 0.72 }, panel.column.heading, 17, panel.heading, { bold: true, heading: true, valign: 'middle', min: 11 });
        text({ x: panel.x + 0.35, y: CY + 0.95, w: panelW - 0.7, h: CH - 1.3 }, bulletList(panel.column.items), 15, panel.body, { min: 10 });
      });
      numberedCircle(0.7 + panelW + 0.315 - 0.38, CY + 1.55, 0.76, 'VS', c.accent);
      return { background: c.background, elements: els };
    }
    case 'timeline': {
      lightFrame();
      const steps = (slide.steps || []).slice(0, 6);
      const segment = CW / Math.max(1, steps.length);
      rect({ x: 0.7 + segment / 2, y: 3.98, w: CW - segment, h: 0.04 }, c.border);
      steps.forEach((step, i) => {
        const center = 0.7 + segment * (i + 0.5);
        const box = { x: center - segment / 2 + 0.1, w: segment - 0.2 };
        text({ ...box, y: 3.2, h: 0.5 }, step.label, 13, c.primary, { bold: true, align: 'center', valign: 'bottom', min: 9 });
        numberedCircle(center - 0.26, 3.74, 0.52, String(i + 1), i === steps.length - 1 ? c.accent : c.primary);
        text({ ...box, y: 4.45, h: 0.75 }, step.title, 16, c.text, { bold: true, heading: true, align: 'center', min: 10 });
        text({ ...box, y: 5.2, h: 1.5 }, step.text || '', 12, c.muted, { align: 'center', min: 9 });
      });
      return { background: c.background, elements: els };
    }
    case 'chart': {
      lightFrame();
      const insights = slide.bullets.slice(0, 3);
      const chartW = insights.length ? 8.1 : CW;
      if (slide.chart) {
        els.push({
          kind: 'chart', x: 0.7, y: CY, w: chartW, h: CH - 0.4, chart: slide.chart,
          colors: [c.primary, c.secondary, c.accent, c.dark, c.muted, c.border], font: theme.fonts.body, textColor: c.text, mutedColor: c.muted,
        });
        text({ x: 0.7, y: 6.45, w: chartW, h: 0.3 }, slide.chart.note || '', 10, c.muted, { italic: true, min: 8 });
      }
      if (insights.length) {
        const x = 0.7 + chartW + 0.3;
        const w = CW - chartW - 0.3;
        rect({ x, y: CY, w, h: CH - 0.15 }, c.surface, { border: c.border });
        rect({ x, y: CY, w, h: 0.08 }, c.primary);
        text({ x: x + 0.3, y: CY + 0.3, w: w - 0.6, h: 0.35 }, 'LECTURA', 11, c.primary, { bold: true, spacing: 1.5 });
        insights.forEach((insight, i) => {
          text({ x: x + 0.3, y: CY + 0.8 + i * 1.0, w: w - 0.6, h: 0.92 }, insight, 13, c.text, { min: 9 });
        });
      }
      return { background: c.background, elements: els };
    }
    case 'table': {
      lightFrame();
      if (slide.table) {
        const used = table(0.7, CY, CW, CH - (slide.table.note ? 0.5 : 0.1), slide.table, {
          headerFill: c.primary, headerColor: WHITE, fill: c.surface, altFill: c.alternate, border: c.border, color: c.text, firstColor: c.text,
        });
        text({ x: 0.7, y: CY + used + 0.12, w: CW, h: 0.35 }, slide.table.note || '', 11, c.muted, { min: 8 });
      }
      return { background: c.background, elements: els };
    }
    case 'bullets':
    default: {
      lightFrame();
      const items = slide.bullets.slice(0, 5);
      const rowH = Math.min(0.9, CH / Math.max(1, items.length));
      items.forEach((item, i) => {
        const y = CY + i * rowH;
        numberedCircle(0.75, y + (rowH - 0.44) / 2, 0.44, String(i + 1), c.primary);
        text({ x: 1.45, y, w: 11.18, h: rowH }, item, 18, c.text, { valign: 'middle', min: 11 });
        if (i < items.length - 1) rect({ x: 1.45, y: y + rowH - 0.006, w: 11.18, h: 0.012 }, c.border);
      });
      return { background: c.background, elements: els };
    }
  }
}

/** Variante inspirada en presentaciones institucionales: fondo blanco, títulos grandes y acentos en el color primario. */
function designMinimal(deck: MarketingPresentation, index: number, theme: PresentationTheme): SlideDesign {
  const slide = deck.slides[index];
  const total = deck.slides.length;
  const layout = slideLayout(slide, index, total);
  const c = theme.colors;
  const { els, text, rect, circle, logo, table } = makeBuilder(theme);
  const X = 0.75;
  const CW = 11.83;
  const CY = 2.95;
  const CH = 3.8;
  const lines = (items: string[]) => items.join('\n');

  const footer = () => {
    text({ x: X, y: 7.0, w: 8, h: 0.28 }, theme.footer || deck.title, 10, c.muted);
    text({ x: 11.58, y: 7.0, w: 1, h: 0.28 }, pad(index + 1), 10, c.muted, { align: 'right' });
  };
  const frame = () => {
    logo(10.83, 0.5, 1.75, 0.5, true);
    text({ x: X, y: 0.55, w: theme.logo ? 9.9 : CW, h: 1.15 }, slide.title, 34, c.text, { bold: true, heading: true, min: 20 });
    text({ x: X, y: 1.8, w: CW, h: 0.85 }, slide.keyMessage, 20, c.muted, { min: 12 });
    footer();
  };
  const done = () => ({ background: c.background, elements: els });

  switch (layout) {
    case 'cover': {
      logo(10.83, 0.6, 1.75, 0.6, true);
      text({ x: 0.8, y: 0.8, w: 6.5, h: 0.45 }, theme.label, 16, c.primary);
      text({ x: 0.8, y: 2.0, w: 6.3, h: 1.8 }, slide.title || deck.title, 54, c.text, { bold: true, heading: true, valign: 'bottom', min: 28 });
      text({ x: 0.8, y: 3.9, w: 5.6, h: 1.3 }, slide.keyMessage || deck.subtitle, 24, c.muted, { min: 14 });
      circle({ x: 7.15, y: 1.95, w: 3.7, h: 3.2 }, c.primary);
      circle({ x: 9.45, y: 2.55, w: 3.3, h: 2.9 }, c.secondary, 15);
      footer();
      return done();
    }
    case 'section': {
      const sectionNumber = deck.slides.slice(0, index + 1).filter((item, i) => slideLayout(item, i, total) === 'section').length;
      text({ x: X, y: 1.5, w: 4, h: 1.6 }, pad(sectionNumber), 88, c.primary, { bold: true, heading: true, valign: 'bottom' });
      text({ x: X, y: 3.25, w: 10.5, h: 1.4 }, slide.title, 40, c.text, { bold: true, heading: true, min: 22 });
      text({ x: X, y: 4.75, w: 9.5, h: 1.0 }, slide.keyMessage, 22, c.muted, { min: 12 });
      footer();
      return done();
    }
    case 'closing': {
      logo(10.83, 0.6, 1.75, 0.6, true);
      text({ x: X, y: 0.9, w: 7.6, h: 1.8 }, slide.title, 40, c.text, { bold: true, heading: true, min: 22 });
      text({ x: X, y: 3.1, w: 7.4, h: 1.2 }, slide.keyMessage, 20, c.muted, { min: 12 });
      const items = slide.bullets.slice(0, 4);
      const rowH = Math.min(1.15, 3.9 / Math.max(1, items.length));
      items.forEach((item, i) => {
        text({ x: 8.95, y: 2.7 + i * rowH, w: 3.63, h: rowH - 0.15 }, item, 20, i === 0 ? c.primary : c.text, { bold: true, heading: true, min: 12 });
      });
      footer();
      return done();
    }
    case 'quote': {
      text({ x: X, y: 0.9, w: 2, h: 1.7 }, '“', 140, c.primary, { bold: true, heading: true });
      text({ x: 1.6, y: 2.0, w: 10.5, h: 2.9 }, slide.quote?.text || slide.keyMessage || slide.title, 34, c.text, { bold: true, heading: true, valign: 'middle', min: 18 });
      text({ x: 1.6, y: 5.2, w: 10, h: 0.5 }, slide.quote?.author || '', 18, c.primary, { bold: true });
      footer();
      return done();
    }
    case 'stats': {
      frame();
      const items = (slide.stats || []).slice(0, 4);
      const gap = 0.4;
      const colW = (CW - gap * (items.length - 1)) / Math.max(1, items.length);
      items.forEach((stat, i) => {
        const x = X + i * (colW + gap);
        text({ x, y: CY, w: colW, h: 1.45 }, stat.value, 60, c.primary, { bold: true, heading: true, valign: 'bottom', min: 28 });
        text({ x, y: CY + 1.6, w: colW, h: 0.75 }, stat.label, 20, c.text, { bold: true, heading: true, min: 12 });
        text({ x, y: CY + 2.4, w: colW, h: 1.3 }, stat.detail || '', 16, c.muted, { min: 10 });
      });
      return done();
    }
    case 'columns': {
      frame();
      const items = (slide.columns || []).slice(0, 3);
      const gap = 0.45;
      const colW = (CW - gap * (items.length - 1)) / Math.max(1, items.length);
      items.forEach((column, i) => {
        const x = X + i * (colW + gap);
        text({ x, y: CY - 0.1, w: colW, h: 1.0 }, pad(i + 1), 50, c.primary, { bold: true, heading: true, valign: 'bottom' });
        text({ x, y: CY + 1.05, w: colW, h: 0.85 }, column.heading, 20, c.text, { bold: true, heading: true, min: 12 });
        text({ x, y: CY + 2.0, w: colW, h: 1.8 }, lines(column.items), 16, c.muted, { min: 10 });
      });
      return done();
    }
    case 'comparison': {
      frame();
      const panelW = 5.6;
      (slide.columns || []).slice(0, 2).forEach((column, i) => {
        const x = i === 0 ? X : X + CW - panelW;
        text({ x, y: CY, w: panelW, h: 0.8 }, column.heading, 26, c.primary, { bold: true, heading: true, valign: 'middle', min: 14 });
        text({ x, y: CY + 1.05, w: panelW, h: 2.7 }, lines(column.items), 18, c.muted, { min: 11 });
      });
      rect({ x: X + CW / 2, y: CY, w: 0.012, h: CH - 0.2 }, c.border);
      return done();
    }
    case 'timeline': {
      frame();
      const steps = (slide.steps || []).slice(0, 6);
      const segment = CW / Math.max(1, steps.length);
      rect({ x: X, y: CY + 0.95, w: CW, h: 0.02 }, c.border);
      steps.forEach((step, i) => {
        const x = X + segment * i;
        const w = segment - 0.3;
        text({ x, y: CY, w, h: 0.55 }, step.label, 14, c.primary, { bold: true, valign: 'bottom', min: 9 });
        circle({ x, y: CY + 0.84, w: 0.24, h: 0.24 }, i === steps.length - 1 ? c.accent : c.primary);
        text({ x, y: CY + 1.3, w, h: 0.8 }, step.title, 18, c.text, { bold: true, heading: true, min: 11 });
        text({ x, y: CY + 2.15, w, h: 1.6 }, step.text || '', 14, c.muted, { min: 9 });
      });
      return done();
    }
    case 'chart': {
      frame();
      const insights = slide.bullets.slice(0, 3);
      const chartW = insights.length ? 8.1 : CW;
      if (slide.chart) {
        els.push({
          kind: 'chart', x: X, y: CY, w: chartW, h: CH - 0.45, chart: slide.chart,
          colors: [c.primary, c.secondary, c.accent, c.dark, c.muted, c.border], font: theme.fonts.body, textColor: c.text, mutedColor: c.muted,
        });
        text({ x: X, y: CY + CH - 0.4, w: chartW, h: 0.32 }, slide.chart.note || '', 11, c.muted, { italic: true, min: 8 });
      }
      if (insights.length) {
        const x = X + chartW + 0.45;
        const w = CW - chartW - 0.45;
        text({ x, y: CY, w, h: 0.45 }, 'Hallazgos', 18, c.primary, { bold: true, heading: true });
        insights.forEach((insight, i) => text({ x, y: CY + 0.65 + i * 1.0, w, h: 0.92 }, insight, 15, c.muted, { min: 9 }));
      }
      return done();
    }
    case 'table': {
      frame();
      if (slide.table) {
        const used = table(X, CY, CW, CH - (slide.table.note ? 0.5 : 0.1), slide.table, {
          headerFill: c.primary, headerColor: WHITE, fill: c.surface, altFill: c.alternate, border: c.text, color: c.text, firstColor: c.text,
        });
        text({ x: X, y: CY + used + 0.12, w: CW, h: 0.35 }, slide.table.note || '', 13, c.muted, { min: 9 });
      }
      return done();
    }
    case 'bullets':
    default: {
      frame();
      const items = slide.bullets.slice(0, 5);
      const rowH = Math.min(0.8, CH / Math.max(1, items.length));
      items.forEach((item, i) => {
        const y = CY + i * rowH;
        text({ x: X, y, w: 0.9, h: rowH }, pad(i + 1), 22, c.primary, { bold: true, heading: true, valign: 'middle' });
        text({ x: X + 0.95, y, w: CW - 0.95, h: rowH }, item, 20, c.muted, { valign: 'middle', min: 12 });
      });
      return done();
    }
  }
}

// ─── Exportación a .pptx ─────────────────────────────────────────────────────

function presentationFileName(deck: MarketingPresentation) {
  return deck.title.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'presentacion-mercadotecnia';
}

function chartFormatCode(chart: SlideChart) {
  const number = chart.values.every(Number.isInteger) ? '#,##0' : '#,##0.0';
  const unit = (chart.unit || '').replace(/"/g, '');
  if (!unit) return number;
  if (['$', '€', '£'].includes(unit)) return `"${unit}"${number}`;
  return `${number}"${unit === '%' ? '%' : ` ${unit}`}"`;
}

function addChart(pptx: PptxGenJS, slide: PptxGenJS.Slide, el: Extract<Element, { kind: 'chart' }>) {
  const { chart } = el;
  const data = [{ name: chart.seriesName, labels: chart.categories, values: chart.values }];
  const base = {
    x: el.x, y: el.y, w: el.w, h: el.h,
    dataLabelFontFace: el.font, dataLabelFontSize: 12, dataLabelColor: el.textColor, dataLabelFormatCode: chartFormatCode(chart),
    catAxisLabelFontFace: el.font, catAxisLabelFontSize: 12, catAxisLabelColor: el.mutedColor,
  };
  if (chart.type === 'doughnut') {
    slide.addChart(pptx.ChartType.doughnut, data, {
      ...base, holeSize: 58, chartColors: el.colors, showPercent: true, showValue: false, dataLabelColor: WHITE,
      showLegend: true, legendPos: 'r', legendFontFace: el.font, legendFontSize: 12, legendColor: el.textColor,
    });
    return;
  }
  slide.addChart(chart.type === 'line' ? pptx.ChartType.line : pptx.ChartType.bar, data, {
    ...base, barDir: 'col', barGapWidthPct: 70, chartColors: [el.colors[0]], showValue: true,
    dataLabelPosition: chart.type === 'line' ? 't' : 'outEnd',
    lineSize: 3, lineDataSymbol: 'circle', lineDataSymbolSize: 9,
    valAxisHidden: true, valGridLine: { style: 'none' }, catAxisLineShow: false, showLegend: false,
  });
}

/** Construye el archivo con pptxgenjs (también se usa en pruebas desde Node). */
export async function createPptx(deck: MarketingPresentation, theme: PresentationTheme) {
  const PptxGen = (await import('pptxgenjs')).default;
  const pptx = new PptxGen();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'Agente de Mercadotecnia';
  pptx.subject = deck.subtitle;
  pptx.title = deck.title;

  deck.slides.forEach((content, index) => {
    const slide = pptx.addSlide();
    const design = designSlide(deck, index, theme);
    slide.background = { color: design.background };
    design.elements.forEach(el => {
      const box = { x: el.x, y: el.y, w: el.w, h: el.h };
      switch (el.kind) {
        case 'rect':
        case 'ellipse':
          slide.addShape(el.kind === 'rect' ? pptx.ShapeType.rect : pptx.ShapeType.ellipse, {
            ...box,
            fill: { color: el.fill, transparency: el.transparency },
            line: el.kind === 'rect' && el.border ? { color: el.border, width: 0.75 } : { color: el.fill, transparency: 100 },
          });
          break;
        case 'text':
          slide.addText(el.text, {
            ...box, fontFace: el.font, fontSize: el.pt, color: el.color, bold: el.bold, italic: el.italic,
            align: el.align || 'left', valign: el.valign || 'top', charSpacing: el.spacing, margin: 0, lineSpacingMultiple: 0.98,
          });
          break;
        case 'image':
          slide.addImage({ ...box, data: el.data.replace(/^data:/, '') });
          break;
        case 'chart':
          addChart(pptx, slide, el);
          break;
        case 'table': {
          const cell = (value: string, r: number, j: number): PptxGenJS.TableCell => ({
            text: value,
            options: r === 0
              ? { fill: { color: el.headerFill }, color: el.headerColor, bold: true, align: j === 0 ? 'left' : 'center' }
              : { fill: { color: r % 2 === 0 ? el.altFill : el.fill }, color: j === 0 ? el.firstColor : el.color, bold: j === 0, align: j === 0 ? 'left' : 'center' },
          });
          slide.addTable([el.headers, ...el.rows].map((row, r) => row.map((value, j) => cell(value, r, j))), {
            x: el.x, y: el.y, w: el.w, colW: el.colW, rowH: el.rowH, fontFace: el.font, fontSize: el.pt, valign: 'middle',
            border: { type: 'solid', pt: 0.75, color: el.border }, margin: [0.04, 0.15, 0.04, 0.15],
          });
          break;
        }
      }
    });
    if (content.speakerNotes) slide.addNotes(content.speakerNotes);
  });
  return pptx;
}

export async function downloadPresentationFile(deck: MarketingPresentation, theme: PresentationTheme) {
  const pptx = await createPptx(deck, theme);
  const file = await pptx.write({ outputType: 'blob' }) as Blob;
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${presentationFileName(deck)}.pptx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ─── Vista previa en HTML ────────────────────────────────────────────────────

const pct = (value: number, of: number) => `${(value / of) * 100}%`;
const ptToCqw = (pt: number) => `${(pt / 72 / SLIDE_W) * 100}cqw`;
const fontStack = (font: string) => `"${font}", Aptos, "Segoe UI", system-ui, sans-serif`;

function ChartPreview({ el }: { el: Extract<Element, { kind: 'chart' }> }) {
  // Unidades del SVG: 1 pulgada = 100.
  const W = el.w * 100;
  const H = el.h * 100;
  const { chart } = el;
  const fontSize = (12 / 72) * 100;
  const common = { fontFamily: fontStack(el.font), fontSize };

  if (chart.type === 'doughnut') {
    const total = chart.values.reduce((sum, value) => sum + Math.max(0, value), 0) || 1;
    const radius = Math.min(H, W * 0.55) * 0.36;
    const stroke = radius * 0.62;
    const cx = W * 0.3;
    const cy = H / 2;
    const circumference = 2 * Math.PI * radius;
    let offset = 0;
    return (
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" style={common}>
        {chart.values.map((value, i) => {
          const length = (Math.max(0, value) / total) * circumference;
          const segment = (
            <circle key={i} cx={cx} cy={cy} r={radius} fill="none" stroke={`#${el.colors[i % el.colors.length]}`} strokeWidth={stroke}
              strokeDasharray={`${length} ${circumference - length}`} strokeDashoffset={-offset} transform={`rotate(-90 ${cx} ${cy})`} />
          );
          offset += length;
          return segment;
        })}
        {chart.categories.map((category, i) => (
          <g key={category + i} transform={`translate(${W * 0.62} ${cy - (chart.categories.length * 32) / 2 + i * 32})`}>
            <rect width={16} height={16} y={-12} fill={`#${el.colors[i % el.colors.length]}`} />
            <text x={26} fill={`#${el.textColor}`}>{category} · {Math.round((Math.max(0, chart.values[i]) / total) * 100)}%</text>
          </g>
        ))}
      </svg>
    );
  }

  const top = 40;
  const bottom = 45;
  const plotH = H - top - bottom;
  const slot = W / chart.values.length;
  const max = Math.max(...chart.values, 0) || 1;
  const yFor = (value: number) => top + plotH - (Math.max(0, value) / max) * plotH;
  const color = `#${el.colors[0]}`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" style={common}>
      {chart.type === 'line' && (
        <polyline fill="none" stroke={color} strokeWidth={(3 / 72) * 100} points={chart.values.map((value, i) => `${slot * (i + 0.5)},${yFor(value)}`).join(' ')} />
      )}
      {chart.values.map((value, i) => {
        const cx = slot * (i + 0.5);
        const y = yFor(value);
        return (
          <g key={i}>
            {chart.type === 'bar'
              ? <rect x={cx - slot * 0.3} y={y} width={slot * 0.6} height={top + plotH - y} fill={color} />
              : <circle cx={cx} cy={y} r={7} fill={color} />}
            <text x={cx} y={y - 10} textAnchor="middle" fill={`#${el.textColor}`}>{formatChartValue(value, chart)}</text>
            <text x={cx} y={H - 15} textAnchor="middle" fill={`#${el.mutedColor}`}>{chart.categories[i]}</text>
          </g>
        );
      })}
    </svg>
  );
}

export function SlidePreview({ deck, index, theme }: { deck: MarketingPresentation; index: number; theme: PresentationTheme }) {
  const design = designSlide(deck, index, theme);
  return (
    <div className="relative w-full aspect-video overflow-hidden select-none" style={{ containerType: 'inline-size', background: `#${design.background}` }}>
      {design.elements.map((el, i) => {
        const position: CSSProperties = { position: 'absolute', left: pct(el.x, SLIDE_W), top: pct(el.y, SLIDE_H), width: pct(el.w, SLIDE_W), height: pct(el.h, SLIDE_H) };
        switch (el.kind) {
          case 'rect':
          case 'ellipse':
            return (
              <div key={i} style={{
                ...position, background: `#${el.fill}`, opacity: el.transparency ? 1 - el.transparency / 100 : undefined,
                borderRadius: el.kind === 'ellipse' ? '50%' : undefined, boxSizing: 'border-box',
                border: el.kind === 'rect' && el.border ? `max(1px, ${ptToCqw(0.75)}) solid #${el.border}` : undefined,
              }} />
            );
          case 'text':
            return (
              <div key={i} style={{
                ...position, display: 'flex', flexDirection: 'column',
                justifyContent: el.valign === 'middle' ? 'center' : el.valign === 'bottom' ? 'flex-end' : 'flex-start',
                fontFamily: fontStack(el.font), fontSize: ptToCqw(el.pt), lineHeight: LINE_HEIGHT, color: `#${el.color}`,
                fontWeight: el.bold ? 700 : 400, fontStyle: el.italic ? 'italic' : undefined, textAlign: el.align || 'left',
                letterSpacing: el.spacing ? ptToCqw(el.spacing) : undefined, whiteSpace: 'pre-line', overflowWrap: 'break-word',
              }}>
                {el.text}
              </div>
            );
          case 'image':
            return <img key={i} src={el.data} alt="" style={{ ...position, objectFit: 'contain' }} />;
          case 'chart':
            return <div key={i} style={position}><ChartPreview el={el} /></div>;
          case 'table':
            return (
              <div key={i} style={{
                ...position, display: 'grid', gridTemplateColumns: el.colW.map(width => `${(width / el.w) * 100}%`).join(' '),
                gridAutoRows: '1fr', borderTop: `max(1px, ${ptToCqw(0.75)}) solid #${el.border}`, borderLeft: `max(1px, ${ptToCqw(0.75)}) solid #${el.border}`,
                fontFamily: fontStack(el.font), fontSize: ptToCqw(el.pt), lineHeight: 1.15,
              }}>
                {[el.headers, ...el.rows].flatMap((row, r) => row.map((value, j) => (
                  <div key={`${r}-${j}`} style={{
                    display: 'flex', alignItems: 'center', justifyContent: j === 0 ? 'flex-start' : 'center', textAlign: j === 0 ? 'left' : 'center',
                    padding: `0 ${(0.15 / SLIDE_W) * 100}cqw`, boxSizing: 'border-box', overflow: 'hidden',
                    borderRight: `max(1px, ${ptToCqw(0.75)}) solid #${el.border}`, borderBottom: `max(1px, ${ptToCqw(0.75)}) solid #${el.border}`,
                    background: `#${r === 0 ? el.headerFill : r % 2 === 0 ? el.altFill : el.fill}`,
                    color: `#${r === 0 ? el.headerColor : j === 0 ? el.firstColor : el.color}`, fontWeight: r === 0 || j === 0 ? 700 : 400,
                  }}>
                    {value}
                  </div>
                )))}
              </div>
            );
        }
      })}
    </div>
  );
}

// ─── Tarjeta en el chat y panel lateral ──────────────────────────────────────

export function PresentationCard({ deck, theme, onOpen, onDownload, isDownloading }: {
  deck: MarketingPresentation; theme: PresentationTheme; onOpen: () => void; onDownload: () => void; isDownloading: boolean;
}) {
  return (
    <div className="mt-3 w-full max-w-md overflow-hidden rounded-xl border border-gray-700 bg-gray-950/70">
      <button onClick={onOpen} className="block w-full text-left group" aria-label={`Abrir vista previa de ${deck.title}`}>
        <div className="relative border-b border-gray-800">
          <SlidePreview deck={deck} index={0} theme={theme} />
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/25 transition-colors flex items-center justify-center">
            <span className="opacity-0 group-hover:opacity-100 transition-opacity rounded-full bg-gray-950/85 px-3 py-1.5 text-xs text-gray-100">Abrir vista previa</span>
          </div>
        </div>
      </button>
      <div className="flex items-center justify-between gap-3 px-3.5 py-3">
        <button onClick={onOpen} className="min-w-0 text-left">
          <p className="truncate text-sm font-medium text-gray-100">{deck.title}</p>
          <p className="text-xs text-gray-500">Presentación · PPTX · {deck.slides.length} diapositivas</p>
        </button>
        <button onClick={onDownload} disabled={isDownloading} className="shrink-0 rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-200 hover:border-emerald-500/50 hover:text-emerald-200 disabled:opacity-50">
          {isDownloading ? 'Creando...' : 'Descargar'}
        </button>
      </div>
    </div>
  );
}

export function PresentationPanel({ deck, theme, slide, onSlideChange, onClose, onDownload, isDownloading }: {
  deck: MarketingPresentation; theme: PresentationTheme; slide: number; onSlideChange: (slide: number) => void;
  onClose: () => void; onDownload: () => void; isDownloading: boolean;
}) {
  const total = deck.slides.length;
  const thumbsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (event.key === 'ArrowRight' || event.key === 'PageDown') onSlideChange(Math.min(total - 1, slide + 1));
      else if (event.key === 'ArrowLeft' || event.key === 'PageUp') onSlideChange(Math.max(0, slide - 1));
      else if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [slide, total, onSlideChange, onClose]);

  useEffect(() => {
    thumbsRef.current?.querySelector<HTMLElement>(`[data-slide="${slide}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [slide]);

  const notes = deck.slides[slide]?.speakerNotes;

  return (
    <aside aria-label="Vista previa de la presentación" className="fixed inset-0 z-40 flex flex-col bg-gray-900 lg:static lg:z-auto lg:w-[min(56vw,820px)] lg:shrink-0 lg:border-l lg:border-gray-800">
      <div className="flex items-center justify-between gap-3 border-b border-gray-800 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-gray-100">{deck.title}</p>
          <p className="text-xs text-gray-500">PowerPoint 16:9 · {total} diapositivas</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button onClick={onDownload} disabled={isDownloading} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50">
            {isDownloading ? 'Creando archivo...' : 'Descargar .pptx'}
          </button>
          <button onClick={onClose} aria-label="Cerrar vista previa" className="rounded-lg px-2 py-1 text-gray-400 hover:bg-gray-800 hover:text-white">✕</button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-5 md:px-6">
        <div className="overflow-hidden rounded-lg shadow-2xl ring-1 ring-black/40">
          <SlidePreview deck={deck} index={slide} theme={theme} />
        </div>
        <div className="mt-3 flex items-center justify-center gap-3 text-sm">
          <button onClick={() => onSlideChange(Math.max(0, slide - 1))} disabled={slide === 0} aria-label="Diapositiva anterior" className="rounded-lg border border-gray-700 px-3 py-1 text-gray-300 hover:bg-gray-800 disabled:opacity-30">‹</button>
          <span className="tabular-nums text-gray-400">{slide + 1} / {total}</span>
          <button onClick={() => onSlideChange(Math.min(total - 1, slide + 1))} disabled={slide === total - 1} aria-label="Diapositiva siguiente" className="rounded-lg border border-gray-700 px-3 py-1 text-gray-300 hover:bg-gray-800 disabled:opacity-30">›</button>
        </div>
        {notes && (
          <div className="mt-5 rounded-lg border border-gray-800 bg-gray-950/60 p-4">
            <p className="mb-1 text-[11px] uppercase tracking-widest text-gray-500">Notas del presentador</p>
            <p className="whitespace-pre-line text-sm leading-relaxed text-gray-300">{notes}</p>
          </div>
        )}
      </div>

      <div ref={thumbsRef} className="flex gap-2 overflow-x-auto border-t border-gray-800 px-4 py-3">
        {deck.slides.map((item, index) => (
          <button
            key={`${index}-${item.title}`}
            data-slide={index}
            onClick={() => onSlideChange(index)}
            aria-label={`Ir a la diapositiva ${index + 1}`}
            aria-current={index === slide}
            className={`w-32 shrink-0 overflow-hidden rounded-md ring-2 transition ${index === slide ? 'ring-emerald-400' : 'ring-transparent opacity-70 hover:opacity-100'}`}
          >
            <SlidePreview deck={deck} index={index} theme={theme} />
          </button>
        ))}
      </div>
    </aside>
  );
}
