import { useState, useRef, useCallback, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { createWorker } from 'tesseract.js';
import * as pdfjsLib from 'pdfjs-dist';

// ─── Types ───────────────────────────────────────────────────────────────────

type Step = 'template' | 'images' | 'json' | 'preview' | 'confirm' | 'done';

interface UploadedImage {
  name: string;
  dataUrl: string;
  file: File;
}

interface ChatMessage {
  role: 'agent' | 'user';
  text: string;
  timestamp: Date;
}

interface ExtractedDocument {
  name: string;
  type: 'pdf' | 'image';
  text: string;
}

// ─── Plantilla Markdown por defecto (el "Word" del usuario) ─────────────────

const defaultTemplate = `# {{empresa.nombre}}

---

<div style="text-align: center;">

![Logo]({{imagen.logo}})

# COTIZACIÓN

**Folio:** {{cotizacion.folio}}
**Fecha:** {{cotizacion.fecha}}
**Válida hasta:** {{cotizacion.validaHasta}}

</div>

---

## Datos del Cliente

| Campo | Detalle |
|-------|---------|
| **Cliente** | {{cliente.nombre}} |
| **Empresa** | {{cliente.empresa}} |
| **Dirección** | {{cliente.direccion}} |
| **Teléfono** | {{cliente.telefono}} |
| **Email** | {{cliente.email}} |

---

## Datos de la Empresa

| Campo | Detalle |
|-------|---------|
| **Empresa** | {{empresa.nombre}} |
| **Dirección** | {{empresa.direccion}} |
| **Teléfono** | {{empresa.telefono}} |
| **Email** | {{empresa.email}} |
| **RFC** | {{empresa.rfc}} |

---

## Conceptos Cotizados

{{tablaItems}}

---

## Resumen

| | Monto |
|---|---|
| **Subtotal** | {{cotizacion.subtotal}} |
| **IVA ({{cotizacion.ivaPorcentaje}}%)** | {{cotizacion.iva}} |
| **TOTAL** | **{{cotizacion.total}}** |

---

## Notas y Condiciones

{{cotizacion.notas}}

---

## Términos y Condiciones

{{cotizacion.terminos}}

---

<div style="text-align: center; margin-top: 40px;">

**{{empresa.nombre}}**
*Gracias por su preferencia*

![Firma]({{imagen.firma}})

</div>
`;

// ─── Datos JSON de ejemplo ──────────────────────────────────────────────────

const defaultJsonData = `{
  "empresa": {
    "nombre": "TechSolutions MX",
    "direccion": "Av. Reforma 505, Piso 12, CDMX",
    "telefono": "+52 55 1234 5678",
    "email": "contacto@techsolutions.mx",
    "rfc": "TSM210315ABC"
  },
  "cliente": {
    "nombre": "Ing. Roberto García López",
    "empresa": "Industrias del Norte S.A.",
    "direccion": "Blvd. Costero 890, Monterrey, NL",
    "telefono": "+52 81 9876 5432",
    "email": "rgarcia@industriasnorte.com"
  },
  "cotizacion": {
    "folio": "COT-2026-0042",
    "fecha": "2026-01-15",
    "validaHasta": "2026-02-14",
    "ivaPorcentaje": 16,
    "notas": "• Precios en MXN. No incluyen IVA.\\n• Tiempo de entrega: 15 días hábiles.\\n• Forma de pago: 50% anticipo, 50% contra entrega.",
    "terminos": "• Esta cotización es válida por 30 días naturales.\\n• Los precios pueden variar sin previo aviso después del período de vigencia.\\n• Garantía de 12 meses en todos los servicios.",
    "items": [
      {
        "concepto": "Desarrollo de aplicación web personalizada",
        "cantidad": 1,
        "unidad": "Proyecto",
        "precioUnitario": 85000,
        "importe": 85000
      },
      {
        "concepto": "Diseño UI/UX y prototipado",
        "cantidad": 40,
        "unidad": "Horas",
        "precioUnitario": 750,
        "importe": 30000
      },
      {
        "concepto": "Hosting y dominio (anual)",
        "cantidad": 1,
        "unidad": "Servicio",
        "precioUnitario": 12000,
        "importe": 12000
      },
      {
        "concepto": "Soporte técnico post-lanzamiento",
        "cantidad": 3,
        "unidad": "Meses",
        "precioUnitario": 8000,
        "importe": 24000
      },
      {
        "concepto": "Capacitación al equipo",
        "cantidad": 2,
        "unidad": "Sesiones",
        "precioUnitario": 5000,
        "importe": 10000
      }
    ]
  }
}`;

// ─── Funciones de procesamiento ─────────────────────────────────────────────

function flattenObject(obj: Record<string, any>, prefix = ''): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key in obj) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
      Object.assign(result, flattenObject(obj[key], fullKey));
    } else {
      result[fullKey] = String(obj[key]);
    }
  }
  return result;
}

function buildItemsTable(items: Array<Record<string, any>>): string {
  if (!items || items.length === 0) return '| Sin conceptos |';
  
  const headers = Object.keys(items[0]);
  const headerRow = '| ' + headers.map(h => `**${h.charAt(0).toUpperCase() + h.slice(1)}**`).join(' | ') + ' |';
  const separator = '| ' + headers.map(() => '---').join(' | ') + ' |';
  const rows = items.map(item => 
    '| ' + headers.map(h => {
      const val = item[h];
      if (typeof val === 'number' && (h.toLowerCase().includes('precio') || h.toLowerCase().includes('importe') || h.toLowerCase().includes('total'))) {
        return '$' + val.toLocaleString('es-MX', { minimumFractionDigits: 2 });
      }
      return String(val);
    }).join(' | ') + ' |'
  );
  
  return [headerRow, separator, ...rows].join('\n');
}

function processTemplate(
  template: string, 
  jsonData: Record<string, any>, 
  images: UploadedImage[]
): string {
  let result = template;
  
  // Reemplazar placeholders de imágenes
  images.forEach(img => {
    const key = img.name.replace(/\.[^.]+$/, '').replace(/\s+/g, '_').toLowerCase();
    result = result.replace(new RegExp(`\\{\\{imagen\\.${key}\\}\\}`, 'gi'), img.dataUrl);
    result = result.replace(new RegExp(`\\{\\{imagen\\.${img.name.replace(/\.[^.]+$/, '')}\\}\\}`, 'gi'), img.dataUrl);
  });
  
  // Reemplazar placeholder de tabla de items
  if (jsonData.cotizacion?.items) {
    const table = buildItemsTable(jsonData.cotizacion.items);
    result = result.replace(/\{\{tablaItems\}\}/g, table);
  }
  
  // Calcular totales si no existen
  if (jsonData.cotizacion?.items && !jsonData.cotizacion.subtotal) {
    const subtotal = jsonData.cotizacion.items.reduce((sum: number, item: any) => sum + (item.importe || 0), 0);
    const ivaPorcentaje = jsonData.cotizacion.ivaPorcentaje || 16;
    const iva = subtotal * (ivaPorcentaje / 100);
    const total = subtotal + iva;
    jsonData.cotizacion.subtotal = subtotal;
    jsonData.cotizacion.iva = iva;
    jsonData.cotizacion.total = total;
  }
  
  // Reemplazar placeholders con datos aplanados
  const flat = flattenObject(jsonData);
  for (const [key, value] of Object.entries(flat)) {
    result = result.replace(new RegExp(`\\{\\{${key.replace(/\./g, '\\.')}\\}\\}`, 'g'), value);
  }
  
  // Limpiar placeholders no resueltos
  result = result.replace(/\{\{[^}]+\}\}/g, '—');
  
  return result;
}

// ─── Componente Principal ───────────────────────────────────────────────────

export default function App() {
  const [step, setStep] = useState<Step>('template');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [template, setTemplate] = useState(defaultTemplate);
  const [jsonInput, setJsonInput] = useState(defaultJsonData);
  const [images, setImages] = useState<UploadedImage[]>([]);
  const [processedMarkdown, setProcessedMarkdown] = useState('');
  const [jsonError, setJsonError] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [extractedDocument, setExtractedDocument] = useState<ExtractedDocument | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractionProgress, setExtractionProgress] = useState(0);
  const [extractionError, setExtractionError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const extractorInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Agregar mensaje del agente
  const addAgentMessage = useCallback((text: string) => {
    setMessages(prev => [...prev, { role: 'agent', text, timestamp: new Date() }]);
  }, []);

  const addUserMessage = useCallback((text: string) => {
    setMessages(prev => [...prev, { role: 'user', text, timestamp: new Date() }]);
  }, []);

  // Mensaje inicial
  useEffect(() => {
    addAgentMessage(
      '¡Hola! 👋 Soy tu agente de generación de cotizaciones.\n\n' +
      'Te guiaré paso a paso:\n' +
      '1️⃣ **Plantilla Markdown** — Define tu documento base\n' +
      '2️⃣ **Imágenes** — Sube logo, firma, fotos\n' +
      '3️⃣ **JSON de cotización** — Ingresa los datos\n' +
      '4️⃣ **Preview** — Revisa el resultado\n' +
      '5️⃣ **PDF** — Exporta el documento final\n\n' +
      'Comencemos con la **plantilla Markdown** (tu "Word").\n' +
      'Usa placeholders como `{{empresa.nombre}}`, `{{imagen.logo}}`, `{{tablaItems}}`.'
    );
  }, [addAgentMessage]);

  // ─── Handlers ─────────────────────────────────────────────────────────────

  const handleTemplateConfirm = () => {
    addUserMessage('✅ Plantilla Markdown confirmada');
    addAgentMessage(
      '¡Perfecto! Tu plantilla ha sido guardada. 📄\n\n' +
      'Ahora necesito las **imágenes** que referenciarás en la plantilla.\n\n' +
      'Sube archivos como:\n' +
      '• `logo.png` → se referencia como `{{imagen.logo}}`\n' +
      '• `firma.png` → se referencia como `{{imagen.firma}}`\n' +
      '• Cualquier otra imagen que necesites\n\n' +
      '💡 *Puedes subir varias imágenes a la vez.*'
    );
    setStep('images');
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const newImages: UploadedImage[] = [];
    let loaded = 0;

    Array.from(files).forEach(file => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        newImages.push({
          name: file.name,
          dataUrl: ev.target?.result as string,
          file
        });
        loaded++;
        if (loaded === files.length) {
          setImages(prev => [...prev, ...newImages]);
          const names = newImages.map(i => `• ${i.name}`).join('\n');
          addUserMessage(`📷 Imágenes subidas:\n${names}`);
          addAgentMessage(
            `¡Recibidas ${newImages.length} imagen(es)! 🖼️\n\n` +
            `Puedes referenciarlas en tu plantilla como:\n` +
            newImages.map(i => `• \`{{imagen.${i.name.replace(/\.[^.]+$/, '')}}}\``).join('\n') +
            `\n\n¿Deseas agregar más imágenes o continuamos con el **JSON de cotización**?`
          );
        }
      };
      reader.readAsDataURL(file);
    });
  };

  const extractPdfText = async (file: File): Promise<string> => {
    const buffer = await file.arrayBuffer();
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url
    ).toString();
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
    const pages: string[] = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(content.items.map(item => ('str' in item ? item.str : '')).join(' '));
      setExtractionProgress(Math.round((pageNumber / pdf.numPages) * 100));
    }

    return pages.join('\n\n');
  };

  const extractImageText = async (file: File): Promise<string> => {
    const worker = await createWorker('spa+eng', 1, {
      logger: message => {
        if (message.status === 'recognizing text') setExtractionProgress(Math.round(message.progress * 100));
      }
    });
    const result = await worker.recognize(file);
    await worker.terminate();
    return result.data.text.trim();
  };

  const handleDocumentExtraction = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsExtracting(true);
    setExtractionProgress(0);
    setExtractionError('');
    setExtractedDocument(null);

    try {
      const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
      const text = isPdf ? await extractPdfText(file) : await extractImageText(file);
      if (!text.trim()) throw new Error('No se encontró texto legible en el archivo.');
      setExtractedDocument({ name: file.name, type: isPdf ? 'pdf' : 'image', text });
      addUserMessage(`📄 Contenido extraído de ${file.name}`);
      addAgentMessage('El contenido está listo. Puedes revisarlo, copiarlo o convertirlo a JSON.');
    } catch (error) {
      setExtractionError((error as Error).message || 'No fue posible procesar el archivo.');
    } finally {
      setIsExtracting(false);
      if (extractorInputRef.current) extractorInputRef.current.value = '';
    }
  };

  const convertExtractedToJson = () => {
    if (!extractedDocument) return;
    const lines = extractedDocument.text.split('\n').map(line => line.trim()).filter(Boolean);
    const fields: Record<string, string> = {};
    lines.forEach((line, index) => {
      const match = line.match(/^([^:]{2,40}):\s*(.+)$/i);
      if (match) fields[match[1].trim().toLowerCase().replace(/\s+/g, '_')] = match[2].trim();
      else fields[`linea_${index + 1}`] = line;
    });
    setJsonInput(JSON.stringify({ documento: { nombre: extractedDocument.name, campos: fields } }, null, 2));
    addAgentMessage('Convertí el contenido a una estructura JSON editable y la cargué en el siguiente paso.');
    setStep('json');
  };

  const handleContinueToJson = () => {
    addAgentMessage(
      'Excelente. Ahora ingresa el **JSON con los datos de la cotización**.\n\n' +
      'El JSON debe contener los campos que referenciaste en tu plantilla.\n' +
      'Por ejemplo: `{{empresa.nombre}}` → `{"empresa": {"nombre": "..."}}`\n\n' +
      '💡 *Te dejé un ejemplo precargado que puedes modificar.*'
    );
    setStep('json');
  };

  const handleJsonConfirm = () => {
    try {
      JSON.parse(jsonInput);
      setJsonError('');
      addUserMessage('✅ JSON de cotización confirmado');
      setIsGenerating(true);
      
      setTimeout(() => {
        const data = JSON.parse(jsonInput);
        const result = processTemplate(template, data, images);
        setProcessedMarkdown(result);
        setIsGenerating(false);
        
        addAgentMessage(
          '¡Datos procesados correctamente! 🎉\n\n' +
          'He combinado tu plantilla Markdown con:\n' +
          `• ${images.length} imagen(es)\n` +
          `• Datos del JSON (empresa, cliente, ${data.cotizacion?.items?.length || 0} conceptos)\n\n` +
          '👉 Revisa el **preview** a la derecha y dime si autorizas la generación del PDF.'
        );
        setStep('preview');
      }, 1500);
    } catch (err) {
      setJsonError('❌ JSON inválido: ' + (err as Error).message);
    }
  };

  const handleAuthorizePDF = () => {
    addUserMessage('✅ Autorizo la generación del PDF');
    addAgentMessage(
      '¡Perfecto! Generando tu PDF... 📑\n\n' +
      'Tu cotización ha sido procesada exitosamente.\n' +
      'El PDF está listo para descarga.'
    );
    setStep('confirm');
    
    setTimeout(() => {
      generatePDF();
    }, 500);
  };

  const generatePDF = async () => {
    const html2pdfModule = await import('html2pdf.js');
    const html2pdf = html2pdfModule.default;
    const element = document.getElementById('pdf-content');
    if (!element) return;

    const opt = {
      margin: [10, 10, 10, 10],
      filename: `cotizacion_${Date.now()}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, logging: false },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' as const },
    };

    await (html2pdf() as any).setOptions(opt).from(element).save();
    
    setStep('done');
    addAgentMessage(
      '✅ **¡PDF generado y descargado!**\n\n' +
      'Tu cotización ha sido exportada exitosamente.\n\n' +
      '¿Deseas generar otra cotización? Puedes reiniciar el proceso.'
    );
  };

  const handleReset = () => {
    setStep('template');
    setMessages([]);
    setImages([]);
    setProcessedMarkdown('');
    setJsonInput(defaultJsonData);
    setTemplate(defaultTemplate);
    
    setTimeout(() => {
      addAgentMessage(
        '¡Nuevo proceso iniciado! 🔄\n\n' +
        'Comencemos con la **plantilla Markdown**.'
      );
    }, 100);
  };

  // ─── Extract placeholders from template ───────────────────────────────────

  const extractPlaceholders = (tmpl: string): string[] => {
    const matches = tmpl.match(/\{\{[^}]+\}\}/g);
    if (!matches) return [];
    return [...new Set(matches.map(m => m.replace(/[{}]/g, '')))];
  };

  const placeholders = extractPlaceholders(template);

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="h-screen flex flex-col bg-gray-950 text-gray-100">
      {/* Header */}
      <header className="bg-gray-900 border-b border-gray-800 px-6 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-white font-bold text-lg shadow-lg shadow-violet-500/20">
            📋
          </div>
          <div>
            <h1 className="text-lg font-bold bg-gradient-to-r from-violet-400 to-indigo-400 bg-clip-text text-transparent">
              Agente de Cotizaciones
            </h1>
            <p className="text-xs text-gray-500">Markdown → PDF con placeholders inteligentes</p>
          </div>
        </div>
        
        {/* Step indicator */}
        <div className="flex items-center gap-2">
          {(['template', 'images', 'json', 'preview', 'confirm'] as Step[]).map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300 ${
                step === s ? 'bg-violet-500 text-white scale-110 shadow-lg shadow-violet-500/30' :
                (['template', 'images', 'json', 'preview', 'confirm'].indexOf(step) > i) ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' :
                'bg-gray-800 text-gray-500 border border-gray-700'
              }`}>
                {(['template', 'images', 'json', 'preview', 'confirm'].indexOf(step) > i) ? '✓' : i + 1}
              </div>
              {i < 4 && <div className={`w-6 h-0.5 ${
                (['template', 'images', 'json', 'preview', 'confirm'].indexOf(step) > i) ? 'bg-emerald-500/40' : 'bg-gray-800'
              }`} />}
            </div>
          ))}
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left panel - Chat */}
        <div className="w-[420px] border-r border-gray-800 flex flex-col bg-gray-900/50">
          {/* Chat messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[90%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                  msg.role === 'agent' 
                    ? 'bg-gray-800 border border-gray-700 text-gray-200' 
                    : 'bg-violet-600/20 border border-violet-500/30 text-violet-100'
                }`}>
                  <div className="whitespace-pre-wrap">{msg.text}</div>
                  <div className={`text-[10px] mt-1 ${msg.role === 'agent' ? 'text-gray-500' : 'text-violet-400/60'}`}>
                    {msg.timestamp.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              </div>
            ))}
            {isGenerating && (
              <div className="flex justify-start">
                <div className="bg-gray-800 border border-gray-700 rounded-2xl px-4 py-3">
                  <div className="flex gap-1">
                    <div className="w-2 h-2 bg-violet-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="w-2 h-2 bg-violet-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="w-2 h-2 bg-violet-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Action buttons based on step */}
          <div className="p-4 border-t border-gray-800 space-y-2">
            {step === 'template' && (
              <button onClick={handleTemplateConfirm} className="w-full py-2.5 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 rounded-xl font-medium text-sm transition-all shadow-lg shadow-violet-500/20">
                ✅ Confirmar Plantilla y Continuar
              </button>
            )}
            {step === 'images' && (
              <>
                <button onClick={() => fileInputRef.current?.click()} className="w-full py-2.5 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 rounded-xl font-medium text-sm transition-all shadow-lg shadow-violet-500/20">
                  📷 Subir Imágenes
                </button>
                <input ref={fileInputRef} type="file" multiple accept="image/*" onChange={handleImageUpload} className="hidden" />
                {images.length > 0 && (
                  <button onClick={handleContinueToJson} className="w-full py-2.5 bg-emerald-600/20 border border-emerald-500/30 hover:bg-emerald-600/30 text-emerald-400 rounded-xl font-medium text-sm transition-all">
                    Continuar con JSON →
                  </button>
                )}
              </>
            )}
            {step === 'json' && (
              <button onClick={handleJsonConfirm} className="w-full py-2.5 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 rounded-xl font-medium text-sm transition-all shadow-lg shadow-violet-500/20">
                ✅ Procesar Datos y Generar Preview
              </button>
            )}
            {step === 'preview' && (
              <button onClick={handleAuthorizePDF} className="w-full py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 rounded-xl font-medium text-sm transition-all shadow-lg shadow-emerald-500/20">
                📄 Autorizar Generación de PDF
              </button>
            )}
            {step === 'confirm' && (
              <div className="text-center py-2 text-emerald-400 text-sm">
                ⏳ Generando PDF...
              </div>
            )}
            {step === 'done' && (
              <button onClick={handleReset} className="w-full py-2.5 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 rounded-xl font-medium text-sm transition-all shadow-lg shadow-violet-500/20">
                🔄 Nueva Cotización
              </button>
            )}
          </div>
        </div>

        {/* Right panel - Workspace */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Step: Template */}
          {step === 'template' && (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between shrink-0">
                <div>
                  <h2 className="text-lg font-bold text-gray-100">📝 Plantilla Markdown</h2>
                  <p className="text-xs text-gray-500">Edita tu documento base con placeholders <code className="text-violet-400">{'{{variable}}'}</code></p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 bg-gray-800 px-2 py-1 rounded-lg">
                    {placeholders.length} placeholders detectados
                  </span>
                </div>
              </div>
              <div className="flex-1 flex overflow-hidden">
                <div className="flex-1 flex flex-col">
                  <textarea
                    value={template}
                    onChange={(e) => setTemplate(e.target.value)}
                    className="flex-1 bg-gray-950 text-gray-200 p-6 font-mono text-sm resize-none focus:outline-none border-none leading-relaxed"
                    spellCheck={false}
                  />
                </div>
                <div className="w-[400px] border-l border-gray-800 flex flex-col overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-800 text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Preview en vivo
                  </div>
                  <div className="flex-1 overflow-y-auto p-4 markdown-preview">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {template}
                    </ReactMarkdown>
                  </div>
                </div>
              </div>
              {/* Placeholders list */}
              <div className="px-6 py-3 border-t border-gray-800 bg-gray-900/50 shrink-0">
                <div className="flex flex-wrap gap-2">
                  {placeholders.map(p => (
                    <span key={p} className="text-xs bg-violet-500/10 border border-violet-500/20 text-violet-300 px-2 py-1 rounded-lg font-mono">
                      {p}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step: Images */}
          {step === 'images' && (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-800 shrink-0">
                <h2 className="text-lg font-bold text-gray-100">🖼️ Imágenes</h2>
                <p className="text-xs text-gray-500">Sube imágenes para la plantilla o extrae contenido de un PDF</p>
              </div>
              <div className="flex-1 overflow-y-auto p-6">
                <section className="mb-8 rounded-2xl border border-sky-500/20 bg-sky-500/5 p-5">
                  <div className="flex items-start justify-between gap-4 mb-4">
                    <div>
                      <h3 className="font-semibold text-sky-300">📄 Lector de PDF e imágenes</h3>
                      <p className="text-sm text-gray-400 mt-1">Convierte documentos en texto y JSON editable directamente en tu navegador.</p>
                    </div>
                    <span className="text-[10px] uppercase tracking-wider text-sky-400/70 border border-sky-400/20 rounded-full px-2 py-1">OCR local</span>
                  </div>
                  <input
                    ref={extractorInputRef}
                    type="file"
                    accept="application/pdf,image/png,image/jpeg,image/webp"
                    onChange={handleDocumentExtraction}
                    className="hidden"
                  />
                  <button
                    onClick={() => extractorInputRef.current?.click()}
                    disabled={isExtracting}
                    className="w-full py-3 border border-sky-500/40 bg-sky-500/10 hover:bg-sky-500/20 disabled:opacity-50 rounded-xl text-sm font-medium text-sky-200 transition-all"
                  >
                    {isExtracting ? `Procesando documento... ${extractionProgress}%` : 'Seleccionar PDF o imagen'}
                  </button>
                  {isExtracting && (
                    <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden mt-3">
                      <div className="h-full bg-sky-400 transition-all duration-300" style={{ width: `${extractionProgress}%` }} />
                    </div>
                  )}
                  {extractionError && <p className="text-xs text-red-400 mt-3">{extractionError}</p>}
                  {extractedDocument && !isExtracting && (
                    <div className="mt-4 space-y-3">
                      <div className="flex items-center justify-between text-xs text-gray-400">
                        <span>{extractedDocument.type === 'pdf' ? 'PDF' : 'Imagen'}: {extractedDocument.name}</span>
                        <span>{extractedDocument.text.length.toLocaleString('es-MX')} caracteres</span>
                      </div>
                      <textarea
                        value={extractedDocument.text}
                        onChange={(event) => setExtractedDocument({ ...extractedDocument, text: event.target.value })}
                        className="w-full min-h-[180px] bg-gray-950/80 border border-gray-700 rounded-xl p-3 text-sm text-gray-200 resize-y focus:outline-none focus:border-sky-500/60"
                        placeholder="El texto extraído aparecerá aquí..."
                      />
                      <div className="flex flex-wrap gap-2">
                        <button
                          onClick={() => navigator.clipboard?.writeText(extractedDocument.text)}
                          className="px-3 py-2 bg-gray-800 border border-gray-700 hover:bg-gray-700 rounded-lg text-xs text-gray-300 transition-all"
                        >
                          Copiar texto
                        </button>
                        <button
                          onClick={convertExtractedToJson}
                          className="px-3 py-2 bg-sky-600/20 border border-sky-500/30 hover:bg-sky-600/30 rounded-lg text-xs text-sky-300 transition-all"
                        >
                          Convertir a JSON y continuar →
                        </button>
                      </div>
                    </div>
                  )}
                </section>
                {images.length === 0 ? (
                  <div 
                    onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed border-gray-700 rounded-2xl p-16 text-center cursor-pointer hover:border-violet-500/50 hover:bg-violet-500/5 transition-all"
                  >
                    <div className="text-5xl mb-4">📷</div>
                    <p className="text-gray-400 text-lg mb-2">Arrastra imágenes aquí o haz clic para subir</p>
                    <p className="text-gray-600 text-sm">PNG, JPG, SVG — Múltiples archivos permitidos</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                    {images.map((img, i) => (
                      <div key={i} className="bg-gray-800 rounded-xl overflow-hidden border border-gray-700 group">
                        <div className="aspect-square bg-gray-900 flex items-center justify-center p-2">
                          <img src={img.dataUrl} alt={img.name} className="max-w-full max-h-full object-contain" />
                        </div>
                        <div className="p-3">
                          <p className="text-sm font-medium text-gray-200 truncate">{img.name}</p>
                          <p className="text-xs text-violet-400 font-mono mt-1">
                            {'{{'}imagen.{img.name.replace(/\.[^.]+$/, '')}{'}}'}
                          </p>
                          <button 
                            onClick={() => setImages(prev => prev.filter((_, idx) => idx !== i))}
                            className="mt-2 text-xs text-red-400 hover:text-red-300 transition-colors"
                          >
                            🗑️ Eliminar
                          </button>
                        </div>
                      </div>
                    ))}
                    <div 
                      onClick={() => fileInputRef.current?.click()}
                      className="border-2 border-dashed border-gray-700 rounded-xl flex items-center justify-center cursor-pointer hover:border-violet-500/50 hover:bg-violet-500/5 transition-all min-h-[200px]"
                    >
                      <div className="text-center">
                        <div className="text-3xl mb-2">+</div>
                        <p className="text-gray-500 text-sm">Agregar más</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Step: JSON */}
          {step === 'json' && (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between shrink-0">
                <div>
                  <h2 className="text-lg font-bold text-gray-100">📊 JSON de Cotización</h2>
                  <p className="text-xs text-gray-500">Ingresa los datos que se combinarán con la plantilla</p>
                </div>
                {jsonError && (
                  <span className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 px-3 py-1 rounded-lg">
                    {jsonError}
                  </span>
                )}
              </div>
              <div className="flex-1 flex overflow-hidden">
                <textarea
                  value={jsonInput}
                  onChange={(e) => { setJsonInput(e.target.value); setJsonError(''); }}
                  className="flex-1 bg-gray-950 text-gray-200 p-6 font-mono text-sm resize-none focus:outline-none border-none leading-relaxed"
                  spellCheck={false}
                />
                <div className="w-[350px] border-l border-gray-800 overflow-y-auto p-4">
                  <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-3">Placeholders necesarios</h3>
                  <div className="space-y-2">
                    {placeholders.map(p => {
                      const isImage = p.startsWith('imagen.');
                      const isTable = p === 'tablaItems';
                      let status = 'pending';
                      try {
                        const data = JSON.parse(jsonInput);
                        const flat = flattenObject(data);
                        if (flat[p] || (isTable && data.cotizacion?.items)) status = 'found';
                        if (isImage && images.some(img => img.name.replace(/\.[^.]+$/, '') === p.replace('imagen.', ''))) status = 'found';
                      } catch { status = 'error'; }
                      
                      return (
                        <div key={p} className={`flex items-center gap-2 text-xs p-2 rounded-lg ${
                          status === 'found' ? 'bg-emerald-500/10 border border-emerald-500/20' :
                          status === 'error' ? 'bg-red-500/10 border border-red-500/20' :
                          'bg-gray-800 border border-gray-700'
                        }`}>
                          <span>{status === 'found' ? '✅' : status === 'error' ? '❌' : '⏳'}</span>
                          <span className={`font-mono ${isImage ? 'text-sky-400' : isTable ? 'text-amber-400' : 'text-gray-300'}`}>
                            {p}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  
                  <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wider mt-6 mb-3">Imágenes cargadas</h3>
                  {images.length > 0 ? (
                    <div className="space-y-2">
                      {images.map((img, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs bg-gray-800 border border-gray-700 p-2 rounded-lg">
                          <img src={img.dataUrl} alt="" className="w-8 h-8 rounded object-cover" />
                          <span className="text-gray-300 truncate">{img.name}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-600">No hay imágenes cargadas</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Step: Preview / Confirm / Done */}
          {(step === 'preview' || step === 'confirm' || step === 'done') && (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between shrink-0">
                <div>
                  <h2 className="text-lg font-bold text-gray-100">
                    {step === 'preview' && '👁️ Vista Previa del Documento'}
                    {step === 'confirm' && '📄 Generando PDF...'}
                    {step === 'done' && '✅ PDF Generado'}
                  </h2>
                  <p className="text-xs text-gray-500">
                    {step === 'preview' && 'Revisa el resultado antes de autorizar la exportación'}
                    {step === 'confirm' && 'Tu documento se está convirtiendo a PDF'}
                    {step === 'done' && 'El documento ha sido exportado exitosamente'}
                  </p>
                </div>
                {step === 'preview' && (
                  <div className="flex items-center gap-3">
                    <button 
                      onClick={() => { setStep('json'); addAgentMessage('Volviendo al editor de JSON. Puedes modificar los datos y regenerar el preview.'); }}
                      className="px-4 py-2 bg-gray-800 border border-gray-700 hover:bg-gray-700 rounded-xl text-sm text-gray-300 transition-all"
                    >
                      ← Editar JSON
                    </button>
                    <button 
                      onClick={handleAuthorizePDF}
                      className="px-4 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 rounded-xl text-sm font-medium text-white transition-all shadow-lg shadow-emerald-500/20"
                    >
                      ✅ Autorizar PDF
                    </button>
                  </div>
                )}
              </div>
              <div className="flex-1 overflow-y-auto bg-gray-800/30 p-8 flex justify-center">
                <div className="w-full max-w-[800px]">
                  <div 
                    id="pdf-content"
                    className="bg-white text-gray-900 rounded-lg shadow-2xl p-12 markdown-preview-pdf"
                  >
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {processedMarkdown}
                    </ReactMarkdown>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
