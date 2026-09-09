import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Types
interface QuoteItem {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

interface QuoteData {
  companyName: string;
  companyAddress: string;
  companyPhone: string;
  companyEmail: string;
  clientName: string;
  clientAddress: string;
  clientPhone: string;
  quoteNumber: string;
  date: string;
  validUntil: string;
  items: QuoteItem[];
  notes: string;
  terms: string;
}

type Step = 'welcome' | 'images' | 'json' | 'preview' | 'confirm' | 'done';

// Default quote data example
const defaultQuoteData: QuoteData = {
  companyName: "Mi Empresa S.A. de C.V.",
  companyAddress: "Av. Reforma 123, Col. Centro, CDMX",
  companyPhone: "+52 55 1234 5678",
  companyEmail: "ventas@miempresa.com",
  clientName: "Cliente Ejemplo S.A.",
  clientAddress: "Calle Principal 456, Guadalajara, JAL",
  clientPhone: "+52 33 9876 5432",
  quoteNumber: "COT-2026-001",
  date: new Date().toISOString().split('T')[0],
  validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
  items: [
    { description: "Servicio de consultoría", quantity: 10, unitPrice: 1500, total: 15000 },
    { description: "Desarrollo de software", quantity: 1, unitPrice: 45000, total: 45000 },
    { description: "Licencias anuales", quantity: 5, unitPrice: 2000, total: 10000 },
  ],
  notes: "Los precios no incluyen IVA. Pago a 30 días.",
  terms: "Esta cotización es válida por 30 días a partir de la fecha de emisión."
};

// Template Markdown
function generateMarkdownTemplate(data: QuoteData, images: string[]): string {
  const subtotal = data.items.reduce((sum, item) => sum + item.total, 0);
  const iva = subtotal * 0.16;
  const total = subtotal + iva;

  let itemsTable = '| Descripción | Cantidad | Precio Unitario | Total |\n|---|---|---|---|\n';
  data.items.forEach(item => {
    itemsTable += `| ${item.description} | ${item.quantity} | $${item.unitPrice.toLocaleString()} | $${item.total.toLocaleString()} |\n`;
  });

  let imageSection = '';
  if (images.length > 0) {
    imageSection = '\n## 📎 Imágenes Adjuntas\n\n';
    images.forEach((img, idx) => {
      imageSection += `![Imagen ${idx + 1}](${img})\n\n`;
    });
  }

  return `# 📋 COTIZACIÓN

---

## 🏢 Datos del Emisor

| Campo | Detalle |
|---|---|
| **Empresa** | ${data.companyName} |
| **Dirección** | ${data.companyAddress} |
| **Teléfono** | ${data.companyPhone} |
| **Email** | ${data.companyEmail} |

## 👤 Datos del Cliente

| Campo | Detalle |
|---|---|
| **Cliente** | ${data.clientName} |
| **Dirección** | ${data.clientAddress} |
| **Teléfono** | ${data.clientPhone} |

---

## 📄 Información de Cotización

| Campo | Detalle |
|---|---|
| **Número** | ${data.quoteNumber} |
| **Fecha** | ${data.date} |
| **Válida hasta** | ${data.validUntil} |

---

## 🛒 Detalle de Servicios/Productos

${itemsTable}

---

## 💰 Resumen

| Concepto | Monto |
|---|---|
| **Subtotal** | $${subtotal.toLocaleString()} |
| **IVA (16%)** | $${iva.toLocaleString()} |
| **TOTAL** | **$${total.toLocaleString()}** |

---

## 📝 Notas

${data.notes}

## 📜 Términos y Condiciones

${data.terms}
${imageSection}
---

*Documento generado automáticamente por el Agente de Cotizaciones*
`;
}

// Chat message component
function ChatMessage({ role, content, children }: { role: 'agent' | 'user'; content?: string; children?: React.ReactNode }) {
  return (
    <div className={`flex ${role === 'user' ? 'justify-end' : 'justify-start'} mb-4`}>
      {role === 'agent' && (
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center mr-3 flex-shrink-0 mt-1">
          <span className="text-white text-sm">🤖</span>
        </div>
      )}
      <div className={`max-w-[80%] rounded-2xl px-4 py-3 ${
        role === 'agent' 
          ? 'bg-gray-800 text-gray-100 border border-gray-700' 
          : 'bg-gradient-to-r from-blue-600 to-blue-700 text-white'
      }`}>
        {content && <p className="text-sm leading-relaxed whitespace-pre-wrap">{content}</p>}
        {children}
      </div>
      {role === 'user' && (
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center ml-3 flex-shrink-0 mt-1">
          <span className="text-white text-sm">👤</span>
        </div>
      )}
    </div>
  );
}

// Step indicator
function StepIndicator({ currentStep }: { currentStep: Step }) {
  const steps = [
    { id: 'images', label: 'Imágenes', icon: '🖼️' },
    { id: 'json', label: 'Cotización', icon: '📊' },
    { id: 'preview', label: 'Preview', icon: '👁️' },
    { id: 'confirm', label: 'PDF', icon: '📄' },
  ];

  const stepIndex = steps.findIndex(s => s.id === currentStep);

  return (
    <div className="flex items-center justify-center gap-2 mb-6">
      {steps.map((step, idx) => (
        <div key={step.id} className="flex items-center">
          <div className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
            idx <= stepIndex 
              ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30' 
              : 'bg-gray-800 text-gray-500 border border-gray-700'
          }`}>
            <span>{step.icon}</span>
            <span className="hidden sm:inline">{step.label}</span>
          </div>
          {idx < steps.length - 1 && (
            <div className={`w-6 h-0.5 mx-1 ${idx < stepIndex ? 'bg-blue-600' : 'bg-gray-700'}`} />
          )}
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const [step, setStep] = useState<Step>('welcome');
  const [images, setImages] = useState<string[]>([]);
  const [quoteData, setQuoteData] = useState<QuoteData>(defaultQuoteData);
  const [jsonInput, setJsonInput] = useState<string>(JSON.stringify(defaultQuoteData, null, 2));
  const [jsonError, setJsonError] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [messages, setMessages] = useState<{role: 'agent' | 'user'; content: string; id: number}[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const msgIdRef = useRef(0);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Initial welcome message
  useEffect(() => {
    addAgentMessage("¡Hola! 👋 Soy tu **Agente de Cotizaciones**.\n\nTe voy a guiar paso a paso para generar tu documento PDF profesional.\n\n**¿Qué haremos?**\n1. 📸 Subirás imágenes (logo, fotos de productos)\n2. 📊 Me proporcionarás los datos de la cotización en JSON\n3. 👁️ Revisarás el preview del documento\n4. 📄 Autorizarás la generación del PDF\n\n¿Comenzamos? Haz clic en el botón para empezar.");
  }, []);

  const addAgentMessage = (content: string) => {
    msgIdRef.current++;
    setMessages(prev => [...prev, { role: 'agent', content, id: msgIdRef.current }]);
  };

  const addUserMessage = (content: string) => {
    msgIdRef.current++;
    setMessages(prev => [...prev, { role: 'user', content, id: msgIdRef.current }]);
  };

  const handleStart = () => {
    addUserMessage("¡Sí, comencemos!");
    setTimeout(() => {
      setStep('images');
      addAgentMessage("Perfecto! 🎉\n\n**Paso 1: Subir Imágenes**\n\nPor favor, sube las imágenes que quieras incluir en tu cotización. Pueden ser:\n\n• 🏷️ Logo de tu empresa\n• 📷 Fotos de productos\n• 🖼️ Imágenes decorativas\n\nPuedes subir una o varias imágenes. Cuando termines, presiona \"Continuar\".");
    }, 500);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    Array.from(files).forEach(file => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const result = event.target?.result as string;
        setImages(prev => [...prev, result]);
      };
      reader.readAsDataURL(file);
    });
  };

  const handleRemoveImage = (index: number) => {
    setImages(prev => prev.filter((_, i) => i !== index));
  };

  const handleContinueToJson = () => {
    addUserMessage(`He subido ${images.length} imagen(es). Continuar al siguiente paso.`);
    setTimeout(() => {
      setStep('json');
      addAgentMessage("Excelente! 📸\n\n**Paso 2: Datos de Cotización (JSON)**\n\nAhora necesito los datos de tu cotización. Te proporciono un JSON de ejemplo que puedes editar:\n\n```json\n{\n  \"companyName\": \"Tu empresa\",\n  \"clientName\": \"Tu cliente\",\n  \"items\": [...]\n}\n```\n\nEdita el JSON con tus datos reales y presiona **Validar y Continuar**.\n\n💡 *Tip: Puedes modificar todos los campos según tu necesidad.*");
    }, 500);
  };

  const handleValidateJson = () => {
    try {
      const parsed = JSON.parse(jsonInput);
      
      // Validate required fields
      if (!parsed.companyName || !parsed.clientName || !parsed.items || !Array.isArray(parsed.items)) {
        throw new Error("Faltan campos obligatorios: companyName, clientName, items (array)");
      }

      // Validate items structure
      for (const item of parsed.items) {
        if (!item.description || item.quantity === undefined || item.unitPrice === undefined) {
          throw new Error("Cada item debe tener: description, quantity, unitPrice");
        }
        // Calculate total if not provided
        if (item.total === undefined) {
          item.total = item.quantity * item.unitPrice;
        }
      }

      setQuoteData(parsed);
      setJsonError('');
      addUserMessage("JSON validado correctamente. Generar preview.");
      
      setTimeout(() => {
        setStep('preview');
        setIsGenerating(true);
        addAgentMessage("⏳ Generando preview de tu cotización...");
        
        setTimeout(() => {
          setIsGenerating(false);
          addAgentMessage("✅ ¡Preview generado exitosamente!\n\n**Paso 3: Vista Previa**\n\nA continuación puedes ver cómo se verá tu documento final. Revisa que todo esté correcto.\n\nSi necesitas cambios, puedes volver al paso anterior. Si todo está bien, presiona **Autorizar PDF**.");
        }, 1500);
      }, 500);
    } catch (err) {
      setJsonError(`❌ Error: ${(err as Error).message}`);
    }
  };

  const handleAuthorizePDF = () => {
    addUserMessage("✅ Autorizo la generación del PDF.");
    setStep('confirm');
    setIsGenerating(true);
    addAgentMessage("⏳ Generando PDF...");

    setTimeout(() => {
      generatePDF();
    }, 1000);
  };

  const generatePDF = async () => {
    const html2pdf = (await import('html2pdf.js')).default;
    const element = document.getElementById('pdf-content');
    
    if (!element) {
      addAgentMessage("❌ Error: No se encontró el contenido para generar el PDF.");
      setIsGenerating(false);
      return;
    }

    const markdown = generateMarkdownTemplate(quoteData, images);
    
    // Create a temporary container for PDF generation
    const tempDiv = document.createElement('div');
    tempDiv.id = 'pdf-temp';
    tempDiv.style.padding = '40px';
    tempDiv.style.fontFamily = 'Arial, sans-serif';
    tempDiv.style.color = '#1a1a1a';
    tempDiv.style.maxWidth = '800px';
    tempDiv.style.margin = '0 auto';
    tempDiv.style.backgroundColor = '#ffffff';
    tempDiv.innerHTML = element.innerHTML;
    document.body.appendChild(tempDiv);

    const opt = {
      margin: [10, 10, 10, 10],
      filename: `${quoteData.quoteNumber || 'cotizacion'}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'mm' as const, format: 'a4' as const, orientation: 'portrait' as const }
    };

    try {
      await html2pdf().from(tempDiv).set(opt as any).save();
      document.body.removeChild(tempDiv);
      
      setIsGenerating(false);
      setStep('done');
      addAgentMessage("🎉 **¡PDF generado exitosamente!**\n\nTu cotización ha sido descargada como archivo PDF.\n\n**Resumen:**\n• 📄 Número: " + quoteData.quoteNumber + "\n• 💰 Total: $" + quoteData.items.reduce((s, i) => s + i.total, 0).toLocaleString() + " + IVA\n• 📸 Imágenes incluidas: " + images.length + "\n\n¿Necesitas generar otra cotización? ¡Estoy aquí para ayudarte!");
    } catch (err) {
      document.body.removeChild(tempDiv);
      setIsGenerating(false);
      addAgentMessage("❌ Error al generar el PDF. Por favor intenta de nuevo.");
    }
  };

  const handleReset = () => {
    setStep('welcome');
    setImages([]);
    setQuoteData(defaultQuoteData);
    setJsonInput(JSON.stringify(defaultQuoteData, null, 2));
    setJsonError('');
    setMessages([]);
    msgIdRef.current = 0;
    
    setTimeout(() => {
      addAgentMessage("¡Hola! 👋 Soy tu **Agente de Cotizaciones**.\n\nTe voy a guiar paso a paso para generar tu documento PDF profesional.\n\n¿Comenzamos? Haz clic en el botón para empezar.");
    }, 300);
  };

  const markdownPreview = generateMarkdownTemplate(quoteData, images);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 text-white">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-900/50 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
              <span className="text-xl">🤖</span>
            </div>
            <div>
              <h1 className="text-lg font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
                Agente de Cotizaciones
              </h1>
              <p className="text-xs text-gray-500">Generador inteligente de PDF</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-3 py-1 rounded-full bg-green-500/10 border border-green-500/30 text-green-400 text-xs font-medium">
              ● En línea
            </span>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Step Indicator */}
        {step !== 'welcome' && step !== 'done' && <StepIndicator currentStep={step} />}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left Panel - Chat / Agent */}
          <div className="bg-gray-900/50 border border-gray-800 rounded-2xl overflow-hidden flex flex-col" style={{ minHeight: '600px' }}>
            <div className="px-4 py-3 border-b border-gray-800 bg-gray-800/30">
              <h2 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                Agente - Conversación
              </h2>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 space-y-1">
              {messages.map((msg) => (
                <ChatMessage key={msg.id} role={msg.role}>
                  <div className="prose prose-inverse prose-sm max-w-none">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {msg.content}
                    </ReactMarkdown>
                  </div>
                </ChatMessage>
              ))}
              
              {isGenerating && (
                <div className="flex justify-start mb-4">
                  <div className="bg-gray-800 border border-gray-700 rounded-2xl px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="flex gap-1">
                        <span className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                        <span className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                        <span className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                      </div>
                      <span className="text-xs text-gray-400">Procesando...</span>
                    </div>
                  </div>
                </div>
              )}
              
              <div ref={chatEndRef} />
            </div>

            {/* Action buttons based on step */}
            <div className="p-4 border-t border-gray-800 bg-gray-800/20">
              {step === 'welcome' && (
                <button 
                  onClick={handleStart}
                  className="w-full py-3 px-4 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 rounded-xl font-semibold text-sm transition-all shadow-lg shadow-blue-600/20 hover:shadow-blue-600/40"
                >
                  🚀 Comenzar Nueva Cotización
                </button>
              )}
              
              {step === 'images' && (
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <button 
                      onClick={() => fileInputRef.current?.click()}
                      className="flex-1 py-2.5 px-4 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-xl text-sm font-medium transition-all"
                    >
                      📁 Seleccionar Imágenes
                    </button>
                    <input 
                      ref={fileInputRef}
                      type="file" 
                      accept="image/*" 
                      multiple
                      onChange={handleImageUpload}
                      className="hidden"
                    />
                  </div>
                  <button 
                    onClick={handleContinueToJson}
                    className="w-full py-3 px-4 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 rounded-xl font-semibold text-sm transition-all shadow-lg shadow-blue-600/20"
                  >
                    Continuar → Paso 2
                  </button>
                </div>
              )}

              {step === 'json' && (
                <div className="space-y-3">
                  {jsonError && (
                    <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-xs">
                      {jsonError}
                    </div>
                  )}
                  <button 
                    onClick={handleValidateJson}
                    className="w-full py-3 px-4 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 rounded-xl font-semibold text-sm transition-all shadow-lg shadow-green-600/20"
                  >
                    ✅ Validar y Continuar → Preview
                  </button>
                </div>
              )}

              {step === 'preview' && !isGenerating && (
                <button 
                  onClick={handleAuthorizePDF}
                  className="w-full py-3 px-4 bg-gradient-to-r from-orange-600 to-red-600 hover:from-orange-500 hover:to-red-500 rounded-xl font-semibold text-sm transition-all shadow-lg shadow-orange-600/20"
                >
                  📄 Autorizar Generación de PDF
                </button>
              )}

              {step === 'done' && (
                <button 
                  onClick={handleReset}
                  className="w-full py-3 px-4 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 rounded-xl font-semibold text-sm transition-all shadow-lg shadow-blue-600/20"
                >
                  🔄 Generar Nueva Cotización
                </button>
              )}
            </div>
          </div>

          {/* Right Panel - Content Area */}
          <div className="bg-gray-900/50 border border-gray-800 rounded-2xl overflow-hidden flex flex-col" style={{ minHeight: '600px' }}>
            <div className="px-4 py-3 border-b border-gray-800 bg-gray-800/30">
              <h2 className="text-sm font-semibold text-gray-300">
                {step === 'welcome' && '🏠 Panel de Trabajo'}
                {step === 'images' && '📸 Gestión de Imágenes'}
                {step === 'json' && '📊 Editor de Cotización (JSON)'}
                {step === 'preview' && '👁️ Vista Previa del Documento'}
                {step === 'confirm' && '📄 Generando PDF...'}
                {step === 'done' && '✅ Completado'}
              </h2>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {/* Welcome Step */}
              {step === 'welcome' && (
                <div className="flex flex-col items-center justify-center h-full text-center py-12">
                  <div className="w-24 h-24 rounded-3xl bg-gradient-to-br from-blue-500/20 to-purple-500/20 border border-blue-500/30 flex items-center justify-center mb-6">
                    <span className="text-5xl">🤖</span>
                  </div>
                  <h3 className="text-xl font-bold mb-2 bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
                    Agente de Cotizaciones IA
                  </h3>
                  <p className="text-gray-400 text-sm max-w-sm mb-6">
                    Genera cotizaciones profesionales en PDF de forma rápida e inteligente. 
                    Sube imágenes, ingresa datos y obtén tu documento listo para enviar.
                  </p>
                  <div className="grid grid-cols-2 gap-3 w-full max-w-xs">
                    <div className="p-3 bg-gray-800/50 rounded-xl border border-gray-700">
                      <span className="text-2xl">📸</span>
                      <p className="text-xs text-gray-400 mt-1">Imágenes</p>
                    </div>
                    <div className="p-3 bg-gray-800/50 rounded-xl border border-gray-700">
                      <span className="text-2xl">📊</span>
                      <p className="text-xs text-gray-400 mt-1">JSON Data</p>
                    </div>
                    <div className="p-3 bg-gray-800/50 rounded-xl border border-gray-700">
                      <span className="text-2xl">👁️</span>
                      <p className="text-xs text-gray-400 mt-1">Preview</p>
                    </div>
                    <div className="p-3 bg-gray-800/50 rounded-xl border border-gray-700">
                      <span className="text-2xl">📄</span>
                      <p className="text-xs text-gray-400 mt-1">PDF</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Images Step */}
              {step === 'images' && (
                <div className="space-y-4">
                  <div className="border-2 border-dashed border-gray-700 rounded-xl p-8 text-center hover:border-blue-500/50 transition-colors cursor-pointer"
                    onClick={() => fileInputRef.current?.click()}>
                    <span className="text-4xl mb-3 block">📁</span>
                    <p className="text-sm text-gray-400">
                      Haz clic aquí o arrastra imágenes
                    </p>
                    <p className="text-xs text-gray-600 mt-1">PNG, JPG, WEBP - Múltiples archivos</p>
                  </div>

                  {images.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="text-sm font-medium text-gray-300">
                        Imágenes subidas ({images.length})
                      </h4>
                      <div className="grid grid-cols-2 gap-3">
                        {images.map((img, idx) => (
                          <div key={idx} className="relative group rounded-xl overflow-hidden border border-gray-700">
                            <img src={img} alt={`Imagen ${idx + 1}`} className="w-full h-32 object-cover" />
                            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                              <button 
                                onClick={() => handleRemoveImage(idx)}
                                className="px-3 py-1.5 bg-red-600 hover:bg-red-500 rounded-lg text-xs font-medium"
                              >
                                🗑️ Eliminar
                              </button>
                            </div>
                            <div className="absolute bottom-0 left-0 right-0 bg-black/70 px-2 py-1">
                              <p className="text-xs text-gray-300">Imagen {idx + 1}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {images.length === 0 && (
                    <div className="text-center py-8">
                      <p className="text-gray-500 text-sm">No hay imágenes subidas aún</p>
                      <p className="text-gray-600 text-xs mt-1">Puedes continuar sin imágenes si lo deseas</p>
                    </div>
                  )}
                </div>
              )}

              {/* JSON Step */}
              {step === 'json' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-medium text-gray-300">Editor JSON</h4>
                    <button 
                      onClick={() => setJsonInput(JSON.stringify(defaultQuoteData, null, 2))}
                      className="text-xs px-2 py-1 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-gray-400"
                    >
                      🔄 Reset ejemplo
                    </button>
                  </div>
                  <textarea
                    value={jsonInput}
                    onChange={(e) => {
                      setJsonInput(e.target.value);
                      setJsonError('');
                    }}
                    className="w-full h-[450px] bg-gray-950 border border-gray-700 rounded-xl p-4 font-mono text-xs text-green-400 resize-none focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30"
                    spellCheck={false}
                  />
                  <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl">
                    <p className="text-xs text-blue-400">
                      💡 <strong>Campos requeridos:</strong> companyName, clientName, items[] (con description, quantity, unitPrice)
                    </p>
                  </div>
                </div>
              )}

              {/* Preview Step */}
              {(step === 'preview' || step === 'confirm' || step === 'done') && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-medium text-gray-300">Documento Preview</h4>
                    <span className="text-xs px-2 py-1 bg-green-500/10 border border-green-500/30 text-green-400 rounded-full">
                      ✓ Listo
                    </span>
                  </div>
                  <div 
                    id="pdf-content"
                    className="bg-white text-gray-900 rounded-xl p-6 shadow-2xl prose prose-sm max-w-none overflow-auto"
                    style={{ maxHeight: '500px' }}
                  >
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {markdownPreview}
                    </ReactMarkdown>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
