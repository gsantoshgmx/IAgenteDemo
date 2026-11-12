import { readdir, readFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { createHash, timingSafeEqual } from "node:crypto";

const LAYOUTS = ["cover", "section", "bullets", "stats", "columns", "comparison", "timeline", "chart", "table", "quote", "closing"];

const PRESENTATION_TOOL = {
  name: "crear_presentacion",
  description: `Genera una presentación PowerPoint 16:9 que el usuario podrá previsualizar y descargar desde el chat. Úsala cuando el usuario pida crear, rehacer o modificar una presentación, PowerPoint, deck o diapositivas. Para modificaciones, envía siempre la presentación completa actualizada.

Cada diapositiva elige un diseño en "layout" y llena solo los campos que ese diseño usa:
- cover: portada (solo la primera). title y keyMessage como subtítulo.
- section: separador entre bloques; útil en presentaciones de 10 o más diapositivas. title y keyMessage.
- bullets: title, keyMessage y de 2 a 5 bullets.
- stats: de 2 a 4 cifras clave en "stats" (value corto como "35%", "2.1k" o "$1.2M", label y detail opcional).
- columns: de 2 a 3 "columns" con heading e items (1 a 4): pilares, canales, segmentos, públicos.
- comparison: exactamente 2 "columns": antes/después, opción A/B, situación actual/propuesta (la segunda se resalta como la recomendada).
- timeline: de 3 a 6 "steps" (label como "Mes 1" o "Q2", title y text breve): fases, calendario, roadmap.
- chart: gráfica en "chart" (type bar, line o doughnut; categories y values numéricos de la misma longitud, de 2 a 8; unit opcional como "%", "$" o "k"). Usa solo cifras del usuario o de los documentos de referencia; si son estimaciones, escribe "Datos ilustrativos" en note. bullets opcional con 1 a 3 hallazgos.
- table: tabla en "table" (headers de 2 a 5 columnas y de 1 a 7 rows con el mismo número de celdas; note opcional). Úsala para comparar planes, precios, características o capacidades entre varias opciones. Celdas de hasta 4 palabras.
- quote: frase destacada en "quote" (text y author opcional).
- closing: cierre (solo la última), con hasta 4 bullets como próximos pasos.

Combina los diseños según el contenido: evita que todas sean bullets y no repitas el mismo diseño más de dos veces seguidas. Mantén los textos breves: títulos de hasta 8 palabras, bullets e items de hasta 15 palabras.`,
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Título de la presentación." },
      subtitle: { type: "string", description: "Subtítulo breve." },
      slides: {
        type: "array",
        minItems: 3,
        maxItems: 15,
        items: {
          type: "object",
          properties: {
            layout: { type: "string", enum: LAYOUTS },
            title: { type: "string" },
            keyMessage: { type: "string", description: "Mensaje clave en una frase." },
            bullets: { type: "array", items: { type: "string" }, maxItems: 5 },
            stats: {
              type: "array", maxItems: 4,
              items: { type: "object", properties: { value: { type: "string" }, label: { type: "string" }, detail: { type: "string" } }, required: ["value", "label"] },
            },
            columns: {
              type: "array", maxItems: 3,
              items: { type: "object", properties: { heading: { type: "string" }, items: { type: "array", items: { type: "string" }, maxItems: 4 } }, required: ["heading", "items"] },
            },
            steps: {
              type: "array", maxItems: 6,
              items: { type: "object", properties: { label: { type: "string" }, title: { type: "string" }, text: { type: "string" } }, required: ["label", "title"] },
            },
            chart: {
              type: "object",
              properties: {
                type: { type: "string", enum: ["bar", "line", "doughnut"] },
                seriesName: { type: "string" },
                unit: { type: "string" },
                note: { type: "string" },
                categories: { type: "array", items: { type: "string" } },
                values: { type: "array", items: { type: "number" } },
              },
              required: ["type", "seriesName", "categories", "values"],
            },
            table: {
              type: "object",
              properties: {
                headers: { type: "array", items: { type: "string" }, maxItems: 5 },
                rows: { type: "array", maxItems: 7, items: { type: "array", items: { type: "string" }, maxItems: 5 } },
                note: { type: "string" },
              },
              required: ["headers", "rows"],
            },
            quote: { type: "object", properties: { text: { type: "string" }, author: { type: "string" } }, required: ["text"] },
            speakerNotes: { type: "string", description: "Notas del presentador. Indica supuestos si faltan datos." },
          },
          required: ["layout", "title", "speakerNotes"],
        },
      },
    },
    required: ["title", "subtitle", "slides"],
  },
};

const str = (value, max) => String(value ?? "").trim().slice(0, max);
const list = (value, max, map) => (Array.isArray(value) ? value.slice(0, max).map(map).filter(Boolean) : []);

/** Valida cada diapositiva; si a un diseño le faltan datos, cae en "bullets" para no romper el archivo. */
function sanitizeSlide(slide, index, total) {
  const s = slide && typeof slide === "object" ? slide : {};
  let layout = LAYOUTS.includes(s.layout) ? s.layout : index === 0 ? "cover" : index === total - 1 ? "closing" : "bullets";
  const out = {
    layout,
    title: str(s.title, 120) || "Idea principal",
    keyMessage: str(s.keyMessage, 240),
    bullets: list(s.bullets, 5, item => str(item, 200)),
    speakerNotes: str(s.speakerNotes, 1500),
  };
  const stats = list(s.stats, 4, item => (item && str(item.value, 16) ? { value: str(item.value, 16), label: str(item.label, 60), detail: str(item.detail, 120) } : null));
  const columns = list(s.columns, 3, item => (item && str(item.heading, 60) ? { heading: str(item.heading, 60), items: list(item.items, 4, entry => str(entry, 140)) } : null));
  const steps = list(s.steps, 6, item => (item && str(item.title, 60) ? { label: str(item.label, 24), title: str(item.title, 60), text: str(item.text, 160) } : null));
  let chart = null;
  if (s.chart && typeof s.chart === "object") {
    const categories = list(s.chart.categories, 8, item => str(item, 30));
    const values = Array.isArray(s.chart.values) ? s.chart.values.slice(0, 8).map(Number) : [];
    const type = ["bar", "line", "doughnut"].includes(s.chart.type) ? s.chart.type : "bar";
    if (categories.length >= 2 && categories.length === values.length && values.every(Number.isFinite) && (type !== "doughnut" || values.every(value => value >= 0))) {
      chart = { type, seriesName: str(s.chart.seriesName, 60) || "Serie", unit: str(s.chart.unit, 8), note: str(s.chart.note, 160), categories, values };
    }
  }
  let table = null;
  if (s.table && typeof s.table === "object") {
    const headers = list(s.table.headers, 5, item => str(item, 40));
    const rows = list(s.table.rows, 7, row => (Array.isArray(row) ? headers.map((_, j) => str(row[j], 40)) : null));
    if (headers.length >= 2 && rows.length >= 1) table = { headers, rows, note: str(s.table.note, 200) };
  }
  const quote = s.quote && str(s.quote.text, 300) ? { text: str(s.quote.text, 300), author: str(s.quote.author, 80) } : null;

  const hasData = { stats: stats.length >= 2, columns: columns.length >= 2, comparison: columns.length >= 2, timeline: steps.length >= 3, chart: Boolean(chart), table: Boolean(table), quote: Boolean(quote) };
  if (layout in hasData && !hasData[layout]) out.layout = layout = "bullets";
  if (layout === "stats") out.stats = stats;
  if (layout === "columns") out.columns = columns;
  if (layout === "comparison") out.columns = columns.slice(0, 2);
  if (layout === "timeline") out.steps = steps;
  if (layout === "chart") out.chart = chart;
  if (layout === "table") out.table = table;
  if (layout === "quote") out.quote = quote;
  return out;
}

function sanitizeDeck(deck, fallbackTitle = "Presentación") {
  const slides = deck.slides.slice(0, 15);
  return {
    title: str(deck.title, 120) || fallbackTitle,
    subtitle: str(deck.subtitle, 200),
    slides: slides.map((slide, index) => sanitizeSlide(slide, index, slides.length)),
  };
}

/** Busca la llamada a crear_presentacion en la respuesta de Claude. */
function extractPresentation(result, fallbackTitle) {
  const toolCall = result.content?.find(item => item.type === "tool_use" && item.name === PRESENTATION_TOOL.name);
  if (!toolCall) return null;
  if (result.stop_reason === "max_tokens" || !Array.isArray(toolCall.input?.slides) || !toolCall.input.slides.length) {
    return { error: "La presentación quedó incompleta. Intenta pedir menos diapositivas o vuelve a intentarlo." };
  }
  return { presentation: sanitizeDeck(toolCall.input, fallbackTitle) };
}

// ─── Estilo de la presentación (agentes/mercadotecnia/estilo.json) ───────────

const HEX = /^#?([0-9a-f]{6})$/i;
const COLOR_KEYS = {
  primario: "primary", secundario: "secondary", acento: "accent", oscuro: "dark", fondo: "background",
  superficie: "surface", texto: "text", textoSuave: "muted", textoClaro: "onDark", borde: "border", alterno: "alternate",
};
const LOGO_TYPES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg" };

async function loadPresentationStyle(root) {
  const folder = join(root, "agentes", "mercadotecnia");
  let raw;
  try {
    raw = JSON.parse(await readFile(join(folder, "estilo.json"), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return { theme: {}, logo: null };
    return { theme: {}, logo: null, warning: `No se pudo leer agentes/mercadotecnia/estilo.json (${error.message}). Se usó el estilo por defecto.` };
  }
  const warnings = [];
  const colors = {};
  for (const [key, target] of Object.entries(COLOR_KEYS)) {
    const value = raw.colores?.[key];
    if (value === undefined) continue;
    const match = HEX.exec(String(value).trim());
    if (match) colors[target] = match[1].toUpperCase();
    else warnings.push(`color "${key}" inválido (usa formato #RRGGBB)`);
  }
  const fonts = {};
  if (raw.fuentes?.titulos) fonts.heading = str(raw.fuentes.titulos, 60);
  if (raw.fuentes?.texto) fonts.body = str(raw.fuentes.texto, 60);
  const theme = { colors, fonts };
  if (raw["diseño"] !== undefined) {
    if (["minimalista", "moderno"].includes(raw["diseño"])) theme.variant = raw["diseño"] === "minimalista" ? "minimal" : "modern";
    else warnings.push('"diseño" debe ser "minimalista" o "moderno"');
  }
  if (typeof raw.etiqueta === "string") theme.label = str(raw.etiqueta, 40);
  if (typeof raw.pie === "string") theme.footer = str(raw.pie, 80);

  let logo = null;
  if (raw.logo) {
    const name = basename(String(raw.logo));
    const mime = LOGO_TYPES[extname(name).toLowerCase()];
    if (!mime) warnings.push("el logo debe ser .png o .jpg");
    else {
      try {
        const file = await readFile(join(folder, name));
        if (file.length > 2 * 1024 * 1024) warnings.push("el logo supera 2 MB");
        else logo = `data:${mime};base64,${file.toString("base64")}`;
      } catch {
        warnings.push(`no se encontró el logo "${name}" en agentes/mercadotecnia/`);
      }
    }
  }
  return { theme, logo, warning: warnings.length ? `estilo.json: ${warnings.join("; ")}.` : undefined };
}

const KNOWLEDGE_LIMIT = 200 * 1024;

/** Lee los .md de agentes/<agente>/ en cada solicitud, para poder editarlos sin reiniciar el servidor. */
async function loadAgentKnowledge(root, agent) {
  const folder = join(root, "agentes", agent);
  let names;
  try {
    names = (await readdir(folder)).filter(name => name.toLowerCase().endsWith(".md")).sort();
  } catch {
    return "";
  }
  let total = 0;
  const documents = [];
  for (const name of names) {
    const text = (await readFile(join(folder, name), "utf8")).trim();
    if (!text) continue;
    total += text.length;
    if (total > KNOWLEDGE_LIMIT) {
      console.warn(`[claude] agentes/${agent}: se omitió ${name} y los siguientes por superar ${KNOWLEDGE_LIMIT / 1024} KB.`);
      break;
    }
    documents.push(`<documento nombre="${name}">\n${text}\n</documento>`);
  }
  if (!documents.length) return "";
  return `Documentos de referencia de la organización. Aplica sus metodologías y criterios cuando sean pertinentes a la solicitud (por ejemplo, al definir objetivos, metas o KPIs, o al estructurar una presentación), y menciónalos por nombre cuando los uses. Si un documento contiene enlaces o promociones, no los repitas salvo que el usuario lo pida.\n\n${documents.join("\n\n")}`;
}

/** Instrucciones fijas primero y conocimiento después, con caché para no pagar el texto completo en cada mensaje. */
function buildSystem(instructions, knowledge) {
  const blocks = [{ type: "text", text: instructions }];
  if (knowledge) blocks.push({ type: "text", text: knowledge });
  blocks[blocks.length - 1].cache_control = { type: "ephemeral" };
  return blocks;
}

export function createClaudeMiddleware({ root = process.cwd(), serverless = false } = {}) {
  let apiKey = "";
  let model = "claude-sonnet-4-5";

  return async (request, response, next = () => {}) => {
        const path = new URL(request.url || "/", "http://localhost").pathname;
        if (!path.startsWith("/api/claude/")) return next();

        if (serverless) {
          apiKey = process.env.ANTHROPIC_API_KEY || "";
          model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";
        }

        const sendJson = (status, data) => {
          response.statusCode = status;
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.end(JSON.stringify(data));
        };

        const readBody = async () => {
          if (request.body !== undefined) {
            if (typeof request.body === "string") return JSON.parse(request.body);
            return request.body;
          }
          let body = "";
          for await (const chunk of request) {
            body += chunk;
            if (body.length > 1024 * 1024) throw new Error("El cuerpo de la solicitud es demasiado grande.");
          }
          return body ? JSON.parse(body) : {};
        };

        try {
          if (serverless && path !== "/api/claude/style") {
            const expected = process.env.CLAUDE_ACCESS_TOKEN || "";
            const provided = typeof request.headers["x-claude-access-token"] === "string" ? request.headers["x-claude-access-token"] : "";
            const matches = expected && provided && timingSafeEqual(
              createHash("sha256").update(expected).digest(),
              createHash("sha256").update(provided).digest(),
            );
            if (!matches) {
              if (path === "/api/claude/settings" && request.method === "GET") {
                return sendJson(200, { configured: false, mode: "vercel", model });
              }
              return sendJson(401, { error: expected ? "Token de acceso incorrecto." : "Configura CLAUDE_ACCESS_TOKEN en Vercel." });
            }
          }

          if (path === "/api/claude/settings" && request.method === "GET") {
            return sendJson(200, { configured: Boolean(apiKey), model, mode: serverless ? "vercel" : "local" });
          }

          if (path === "/api/claude/settings" && request.method === "POST") {
            if (serverless) return sendJson(405, { error: "Configura ANTHROPIC_API_KEY y ANTHROPIC_MODEL en las variables de entorno de Vercel." });
            const body = await readBody();
            if (typeof body.apiKey !== "string" || !body.apiKey.trim()) {
              return sendJson(400, { error: "Captura una API key válida." });
            }
            apiKey = body.apiKey.trim();
            model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : model;
            return sendJson(200, { configured: true, model });
          }

          if (path === "/api/claude/settings" && request.method === "DELETE") {
            if (serverless) return sendJson(405, { error: "Modifica las variables de entorno desde Vercel." });
            apiKey = "";
            return sendJson(200, { configured: false, model });
          }

          if (path === "/api/claude/presentation" && request.method === "POST") {
            if (!apiKey) return sendJson(409, { error: "Configura primero la API key de Claude." });
            const body = await readBody();
            const topic = typeof body.topic === "string" ? body.topic.trim().slice(0, 500) : "";
            const audience = typeof body.audience === "string" ? body.audience.trim().slice(0, 300) : "";
            const objective = typeof body.objective === "string" ? body.objective.trim().slice(0, 300) : "";
            const slideCount = Math.max(5, Math.min(12, Number(body.slideCount) || 8));
            if (!topic) return sendJson(400, { error: "Indica el tema de la presentación." });

            const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "x-api-key": apiKey,
                "anthropic-version": "2023-06-01",
              },
              body: JSON.stringify({
                model,
                max_tokens: 8000,
                system: buildSystem(
                  "Eres un estratega de mercadotecnia y diseñador de presentaciones ejecutivas. Responde llamando a la herramienta crear_presentacion. Todas las cadenas deben estar en español. No inventes estadísticas; si se requieren datos que no fueron proporcionados, indícalo como supuesto en las notas.",
                  await loadAgentKnowledge(root, "mercadotecnia"),
                ),
                tools: [PRESENTATION_TOOL],
                messages: [{
                  role: "user",
                  content: `Crea con la herramienta crear_presentacion una presentación de ${slideCount} diapositivas.\nTema: ${topic}\nAudiencia: ${audience || "general"}\nObjetivo: ${objective || "informar y proponer próximos pasos"}`,
                }],
              }),
            });
            const result = await anthropicResponse.json();
            if (!anthropicResponse.ok) {
              return sendJson(anthropicResponse.status, { error: result.error?.message || "Anthropic rechazó la solicitud." });
            }
            const extracted = extractPresentation(result, topic);
            if (!extracted) return sendJson(502, { error: "Claude no generó la presentación. Intenta de nuevo." });
            if (extracted.error) return sendJson(502, { error: extracted.error });
            return sendJson(200, extracted.presentation);
          }

          if (path === "/api/claude/style" && request.method === "GET") {
            const style = await loadPresentationStyle(root);
            if (style.warning) console.warn(`[claude] ${style.warning}`);
            return sendJson(200, style);
          }

          if (path === "/api/claude/chat" && request.method === "POST") {
            if (!apiKey) return sendJson(409, { error: "Configura primero la API key de Claude." });
            const body = await readBody();
            const agent = body.agent === "marketing" ? "marketing" : "cotizaciones";
            const messages = Array.isArray(body.messages)
              ? body.messages.slice(-30).filter(message =>
                  (message.role === "user" || message.role === "assistant") && typeof message.content === "string"
                )
              : [];
            if (!messages.length) return sendJson(400, { error: "Escribe un mensaje para Claude." });

            const anthropicResponse = await fetch("https://api.anthropic.com/v1/messages", {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "x-api-key": apiKey,
                "anthropic-version": "2023-06-01",
              },
              body: JSON.stringify({
                model,
                max_tokens: agent === "marketing" ? 8000 : 1200,
                system: agent === "marketing"
                  ? buildSystem("Eres un agente experto en mercadotecnia y marketing digital. Ayudas con estrategia, investigación de audiencias, posicionamiento, campañas, contenido, redes sociales, calendarios editoriales, anuncios y métricas. Responde siempre en español, de forma práctica y estructurada. Cuando falte contexto, pregunta por objetivo, audiencia, presupuesto, canal y plazo antes de dar recomendaciones específicas. No inventes datos ni afirmes que ejecutaste acciones.\n\nPuedes crear presentaciones PowerPoint con la herramienta crear_presentacion. Úsala cuando el usuario pida una presentación, PowerPoint, deck o diapositivas, aprovechando todo el contexto de la conversación (por defecto 8 diapositivas). Si en la conversación ya hay una presentación (aparece como JSON tras la etiqueta [Presentación generada]) y el usuario pide cambios, vuelve a llamar la herramienta con la versión completa actualizada. Acompaña la llamada con una frase breve que resuma lo que preparaste; no repitas el contenido de las diapositivas en el texto, porque el usuario verá una vista previa.", await loadAgentKnowledge(root, "mercadotecnia"))
                  : "Eres el asistente de esta aplicación de cotizaciones y gestión de documentos de proyectos Muamba. Responde siempre en español, de forma clara y práctica. No afirmes que ejecutaste acciones que no se hayan realizado.",
                messages,
                ...(agent === "marketing" ? { tools: [PRESENTATION_TOOL] } : {}),
              }),
            });
            const result = await anthropicResponse.json();
            if (!anthropicResponse.ok) {
              return sendJson(anthropicResponse.status, { error: result.error?.message || "Anthropic rechazó la solicitud." });
            }
            const reply = result.content?.filter(item => item.type === "text").map(item => item.text).join("\n").trim();
            const extracted = extractPresentation(result);
            if (extracted?.error) return sendJson(502, { error: extracted.error });
            if (extracted) {
              const { presentation } = extracted;
              return sendJson(200, {
                reply: reply || `Preparé la presentación **${presentation.title}** con ${presentation.slides.length} diapositivas.`,
                presentation,
              });
            }
            return sendJson(200, { reply: reply || "Claude no devolvió texto." });
          }

          return sendJson(404, { error: "Ruta de Claude no encontrada." });
        } catch (error) {
          return sendJson(400, { error: error instanceof Error ? error.message : "Solicitud inválida." });
        }
  };
}

