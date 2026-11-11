import { useState, useRef, useCallback, useEffect, type Dispatch, type SetStateAction } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { createWorker } from 'tesseract.js';
import * as pdfjsLib from 'pdfjs-dist';
import {
  DEFAULT_THEME, PresentationCard, PresentationPanel, downloadPresentationFile, loadPresentationTheme,
  type MarketingPresentation, type PresentationTheme,
} from './presentation';

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
  presentation?: MarketingPresentation;
}

interface ExtractedDocument {
  name: string;
  type: 'pdf' | 'image';
  text: string;
}

interface MuambaProject {
  id: string;
  name: string;
  status?: string;
}

interface MuambaAttachment {
  attachmentId: string;
  name: string;
  contentType: string;
  size: number;
  category: 'PRJ' | 'INS';
  createdDate: string;
  behalfName?: string;
}

type AppView = 'cotizaciones' | 'mercadotecnia' | 'muamba';

function MarketingWorkspace({
  onNavigate,
  claudeConfigured,
  claudeModel,
  onConfigureClaude,
  messages,
  setMessages,
}: {
  onNavigate: (view: AppView) => void;
  claudeConfigured: boolean;
  claudeModel: string;
  onConfigureClaude: () => void;
  messages: ChatMessage[];
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
}) {
  const [input, setInput] = useState('');
  const [isResponding, setIsResponding] = useState(false);
  const [error, setError] = useState('');
  const [presentationOpen, setPresentationOpen] = useState(false);
  const [presentationTopic, setPresentationTopic] = useState('');
  const [presentationAudience, setPresentationAudience] = useState('');
  const [presentationObjective, setPresentationObjective] = useState('');
  const [presentationSlideCount, setPresentationSlideCount] = useState(8);
  const [isGeneratingPresentation, setIsGeneratingPresentation] = useState(false);
  const [presentationError, setPresentationError] = useState('');
  const [downloadingDeck, setDownloadingDeck] = useState<MarketingPresentation | null>(null);
  const [preview, setPreview] = useState<{ deck: MarketingPresentation; slide: number } | null>(null);
  const [theme, setTheme] = useState<PresentationTheme>(DEFAULT_THEME);
  const endRef = useRef<HTMLDivElement>(null);

  // El estilo vive en agentes/mercadotecnia/estilo.json; se vuelve a leer al generar o descargar.
  const refreshTheme = useCallback(async () => {
    const { theme: loaded, warning } = await loadPresentationTheme();
    setTheme(loaded);
    if (warning) setError(warning);
    return loaded;
  }, []);

  useEffect(() => { void refreshTheme(); }, [refreshTheme]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isResponding]);

  const openPreview = useCallback((deck: MarketingPresentation) => setPreview({ deck, slide: 0 }), []);
  const closePreview = useCallback(() => setPreview(null), []);
  const changePreviewSlide = useCallback((slide: number) => setPreview(current => current && { ...current, slide }), []);

  const addPresentationMessage = (text: string, deck: MarketingPresentation) => {
    setMessages(previous => [...previous, { role: 'agent', text, timestamp: new Date(), presentation: deck }]);
    setPreview({ deck, slide: 0 });
    void refreshTheme();
  };

  const sendMessage = async (prompt = input) => {
    const text = prompt.trim();
    if (!text || isResponding) return;
    const nextMessages = [...messages, { role: 'user' as const, text, timestamp: new Date() }];
    setMessages(nextMessages);
    setInput('');
    setIsResponding(true);
    setError('');

    // Las presentaciones viajan como JSON en el historial para que Claude pueda modificarlas.
    const conversation: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    nextMessages.slice(-20).forEach(message => {
      const role = message.role === 'user' ? 'user' : 'assistant';
      const content = message.presentation
        ? `${message.text}\n\n[Presentación generada]\n${JSON.stringify(message.presentation)}`
        : message.text;
      const previous = conversation[conversation.length - 1];
      if (previous?.role === role) previous.content += `\n\n${content}`;
      else conversation.push({ role, content });
    });
    while (conversation[0]?.role === 'assistant') conversation.shift();

    try {
      const response = await fetch('/api/claude/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent: 'marketing', messages: conversation }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'No se pudo obtener respuesta de Claude.');
      if (result.presentation) addPresentationMessage(result.reply, result.presentation as MarketingPresentation);
      else setMessages(previous => [...previous, { role: 'agent', text: result.reply, timestamp: new Date() }]);
    } catch (sendError) {
      setError((sendError as Error).message);
    } finally {
      setIsResponding(false);
    }
  };

  const createPresentation = async () => {
    if (!presentationTopic.trim() || isGeneratingPresentation) return;
    setIsGeneratingPresentation(true);
    setPresentationError('');
    try {
      const response = await fetch('/api/claude/presentation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: presentationTopic,
          audience: presentationAudience,
          objective: presentationObjective,
          slideCount: presentationSlideCount,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'No se pudo generar la presentación.');
      setPresentationOpen(false);
      setMessages(previous => [...previous, { role: 'user', text: `Crea una presentación sobre: ${presentationTopic.trim()}`, timestamp: new Date() }]);
      addPresentationMessage(
        `Preparé una presentación de ${result.slides.length} diapositivas: **${result.title}**. Revisa la vista previa y descárgala cuando esté lista; también puedes pedirme cambios aquí en el chat.`,
        result as MarketingPresentation,
      );
    } catch (generationError) {
      setPresentationError((generationError as Error).message);
    } finally {
      setIsGeneratingPresentation(false);
    }
  };

  const downloadPresentation = async (deck: MarketingPresentation) => {
    if (downloadingDeck) return;
    setDownloadingDeck(deck);
    setError('');
    try {
      await downloadPresentationFile(deck, await refreshTheme());
    } catch (downloadError) {
      setError((downloadError as Error).message || 'No se pudo crear el archivo PowerPoint.');
    } finally {
      setDownloadingDeck(null);
    }
  };

  const suggestions = [
    'Ayúdame a definir una estrategia de marketing para mi negocio',
    'Diseña una campaña para lanzar un producto nuevo',
    'Crea un calendario de contenido para redes sociales',
    'Crea una presentación PowerPoint para presentar un plan de marketing',
  ];

  return (
    <div className="h-screen flex flex-col bg-gray-950 text-gray-100">
      <header className="bg-gray-900 border-b border-gray-800 px-5 py-3 flex flex-wrap items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white font-bold text-lg">M</div>
          <div>
            <h1 className="text-lg font-bold text-gray-100">Agente de Mercadotecnia</h1>
            <p className="text-xs text-gray-500">Estrategia, campañas y contenido con Claude</p>
          </div>
        </div>
        <nav className="flex flex-wrap items-center justify-end gap-2" aria-label="Secciones">
          <button onClick={() => onNavigate('cotizaciones')} className="px-3 py-2 rounded-lg border border-gray-700 text-gray-300 hover:border-gray-500 text-sm">Cotizaciones</button>
          <button className="px-3 py-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 text-sm" aria-current="page">Mercadotecnia</button>
          <button onClick={() => onNavigate('muamba')} className="px-3 py-2 rounded-lg border border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/10 text-sm">Muamba · Anexos</button>
          <button onClick={() => { setPresentationError(''); setPresentationOpen(true); }} className="px-3 py-2 rounded-lg border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10 text-sm">Crear PowerPoint</button>
          <button onClick={onConfigureClaude} className="ml-1 px-3 py-2 rounded-lg border border-gray-700 hover:border-emerald-500/50 text-sm">Claude {claudeConfigured ? '· Conectado' : '· Configurar'}</button>
        </nav>
      </header>

      <div className="flex-1 min-h-0 flex">
        <main className="flex-1 min-w-0 min-h-0 flex flex-col items-center">
          <div className="w-full max-w-4xl flex-1 overflow-y-auto px-5 py-8 md:px-8">
            {messages.length === 0 ? (
              <div className="max-w-2xl mx-auto pt-8 md:pt-16">
                <p className="text-xs uppercase tracking-[0.22em] text-emerald-400 mb-3">Claude · {claudeModel}</p>
                <h2 className="text-3xl md:text-4xl font-semibold tracking-tight">¿Qué quieres impulsar?</h2>
                <p className="text-gray-400 mt-3 leading-relaxed">Cuéntame sobre tu negocio, audiencia y objetivo. Podemos trabajar en estrategia, campañas, redes sociales y contenido, o preparar una presentación PowerPoint.</p>
                <div className="grid gap-3 mt-8">
                  {suggestions.map(suggestion => (
                    <button key={suggestion} onClick={() => void sendMessage(suggestion)} disabled={!claudeConfigured} className="text-left p-4 rounded-xl border border-gray-800 bg-gray-900/70 hover:border-emerald-500/40 hover:bg-gray-900 disabled:opacity-50 transition-colors text-sm text-gray-300">
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="max-w-3xl mx-auto space-y-6">
                {messages.map((message, index) => (
                  <div key={`${message.timestamp.getTime()}-${index}`} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[90%] rounded-2xl px-5 py-4 text-sm leading-relaxed ${message.role === 'user' ? 'bg-emerald-600/20 border border-emerald-500/30 text-emerald-50' : 'bg-gray-900 border border-gray-800 text-gray-200'}`}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.text}</ReactMarkdown>
                      {message.presentation && (
                        <PresentationCard
                          deck={message.presentation}
                          theme={theme}
                          onOpen={() => openPreview(message.presentation!)}
                          onDownload={() => void downloadPresentation(message.presentation!)}
                          isDownloading={downloadingDeck === message.presentation}
                        />
                      )}
                      <div className="text-[10px] mt-2 text-gray-500">{message.timestamp.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}</div>
                    </div>
                  </div>
                ))}
                {isResponding && <div className="text-sm text-emerald-300 animate-pulse">Claude está preparando una respuesta...</div>}
                <div ref={endRef} />
              </div>
            )}
          </div>

          <div className="w-full max-w-4xl px-5 pb-5 md:px-8">
            {!claudeConfigured && <p className="text-xs text-amber-300 mb-2">Configura la API key de Claude para iniciar una conversación.</p>}
            {error && <p className="text-xs text-rose-300 mb-2">{error}</p>}
            <form onSubmit={event => { event.preventDefault(); void sendMessage(); }} className="flex items-end gap-3 rounded-2xl border border-gray-700 bg-gray-900 p-3 focus-within:border-emerald-500/60">
              <textarea value={input} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }} disabled={!claudeConfigured || isResponding} rows={2} placeholder="Describe tu negocio, pide una presentación o solicita cambios..." className="min-h-[52px] flex-1 resize-none bg-transparent px-2 py-2 text-sm text-gray-100 placeholder:text-gray-500 focus:outline-none disabled:opacity-50" />
              <button type="submit" disabled={!claudeConfigured || !input.trim() || isResponding} aria-label="Enviar mensaje" className="h-10 px-4 rounded-xl bg-emerald-600 text-white font-medium text-sm hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed">Enviar</button>
            </form>
            <p className="text-center text-[11px] text-gray-600 mt-2">Las respuestas pueden contener imprecisiones. Verifica los datos antes de publicar campañas.</p>
          </div>
        </main>

        {preview && (
          <PresentationPanel
            deck={preview.deck}
            theme={theme}
            slide={preview.slide}
            onSlideChange={changePreviewSlide}
            onClose={closePreview}
            onDownload={() => void downloadPresentation(preview.deck)}
            isDownloading={downloadingDeck === preview.deck}
          />
        )}
      </div>

      {presentationOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !isGeneratingPresentation) setPresentationOpen(false); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="presentation-title" className="w-full max-w-xl rounded-xl border border-gray-700 bg-gray-900 p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4 mb-5">
              <div><p className="text-xs uppercase tracking-widest text-emerald-400 mb-1">PowerPoint · 16:9</p><h2 id="presentation-title" className="text-xl font-semibold">Crear presentación</h2></div>
              <button onClick={() => setPresentationOpen(false)} disabled={isGeneratingPresentation} aria-label="Cerrar" className="text-gray-400 hover:text-white disabled:opacity-40">✕</button>
            </div>
            <div className="space-y-4">
              <label className="block text-sm text-gray-300">Tema
                <textarea autoFocus value={presentationTopic} onChange={event => setPresentationTopic(event.target.value)} rows={2} placeholder="Ej. Plan de lanzamiento para una nueva línea de café" className="mt-2 w-full resize-y rounded-lg border border-gray-700 bg-gray-950 px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-500" />
              </label>
              <label className="block text-sm text-gray-300">Audiencia
                <input value={presentationAudience} onChange={event => setPresentationAudience(event.target.value)} placeholder="Ej. Dirección y equipo comercial" className="mt-2 w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-500" />
              </label>
              <label className="block text-sm text-gray-300">Objetivo
                <input value={presentationObjective} onChange={event => setPresentationObjective(event.target.value)} placeholder="Ej. Aprobar la estrategia y el presupuesto" className="mt-2 w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-500" />
              </label>
              <label className="block text-sm text-gray-300">Número de diapositivas
                <select value={presentationSlideCount} onChange={event => setPresentationSlideCount(Number(event.target.value))} className="mt-2 w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-500">
                  {[5, 6, 8, 10, 12].map(count => <option key={count} value={count}>{count} diapositivas</option>)}
                </select>
              </label>
            </div>
            {!claudeConfigured && <p className="mt-4 text-sm text-amber-300">Configura una API key de Claude para generar la presentación.</p>}
            {presentationError && <p className="mt-4 text-sm text-rose-300">{presentationError}</p>}
            <div className="mt-6 flex justify-end gap-2">
              <button onClick={() => setPresentationOpen(false)} disabled={isGeneratingPresentation} className="px-3 py-2 rounded-lg border border-gray-700 text-sm hover:bg-gray-800 disabled:opacity-40">Cancelar</button>
              <button onClick={() => void createPresentation()} disabled={!claudeConfigured || !presentationTopic.trim() || isGeneratingPresentation} className="px-4 py-2 rounded-lg bg-emerald-600 text-sm font-medium hover:bg-emerald-500 disabled:opacity-40">
                {isGeneratingPresentation ? 'Generando contenido...' : 'Generar presentación'}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function MuambaWorkspace({ onBack }: { onBack: () => void }) {
  const [apiKey, setApiKey] = useState('');
  const [projectsUrl, setProjectsUrl] = useState('https://mcs.waspe.com/api/integration/v1/prj/projects');
  const [projects, setProjects] = useState<MuambaProject[]>([]);
  const [manualProjectId, setManualProjectId] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [attachments, setAttachments] = useState<MuambaAttachment[]>([]);
  const [category, setCategory] = useState<'PRJ' | 'INS'>('PRJ');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [behalfName, setBehalfName] = useState('');
  const [behalfContactType, setBehalfContactType] = useState<'Email' | 'WhatsApp'>('Email');
  const [behalfContact, setBehalfContact] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const request = async (url: string, options: RequestInit = {}) => {
    if (!apiKey.trim()) throw new Error('Captura la API Key para continuar.');
    const response = await fetch(url, {
      ...options,
      headers: { 'X-Api-Key': apiKey.trim(), ...(options.headers || {}) },
    });
    if (!response.ok) throw new Error(`Muamba respondió ${response.status}. Verifica permisos, URL y API Key.`);
    return response;
  };

  const loadProjects = async () => {
    setIsBusy(true);
    setError('');
    setStatus('Consultando proyectos...');
    try {
      const response = await request(projectsUrl);
      const data = await response.json();
      const source = Array.isArray(data) ? data : data.projects || data.items || [];
      const normalized = source.map((project: any) => ({
        id: String(project.projectId || project.id || project.code || ''),
        name: String(project.name || project.projectName || project.title || project.projectId || project.id || 'Proyecto sin nombre'),
        status: project.status || project.projectStatus,
      })).filter((project: MuambaProject) => project.id);
      setProjects(normalized);
      setStatus(`${normalized.length} proyecto(s) disponible(s).`);
    } catch (loadError) {
      setError((loadError as Error).message);
      setStatus('');
    } finally {
      setIsBusy(false);
    }
  };

  const selectProject = async (projectId: string) => {
    setSelectedProjectId(projectId);
    if (!projectId) return;
    setIsBusy(true);
    setError('');
    setStatus('Cargando documentos...');
    try {
      const response = await request(`${projectsUrl.replace(/\/$/, '')}/${encodeURIComponent(projectId)}/attachments`);
      const data = await response.json();
      setAttachments(Array.isArray(data) ? data : []);
      setStatus('Documentos actualizados.');
    } catch (loadError) {
      setError((loadError as Error).message);
      setAttachments([]);
    } finally {
      setIsBusy(false);
    }
  };

  const addManualProject = () => {
    const id = manualProjectId.trim();
    if (!id) return;
    const project = { id, name: id };
    setProjects(previous => previous.some(item => item.id === id) ? previous : [...previous, project]);
    setManualProjectId('');
    void selectProject(id);
  };

  const uploadAttachment = async () => {
    if (!selectedProjectId || !selectedFile || !behalfName.trim() || !behalfContact.trim()) {
      setError('Selecciona un proyecto, archivo, nombre y contacto de la persona que origina el documento.');
      return;
    }
    if (selectedFile.size > 20 * 1024 * 1024) {
      setError('El archivo no puede superar 20 MB.');
      return;
    }
    setIsBusy(true);
    setError('');
    setStatus('Enviando documento...');
    try {
      const body = new FormData();
      body.append('file', selectedFile);
      body.append('behalfName', behalfName.trim());
      body.append('behalfContactType', behalfContactType);
      body.append('behalfContact', behalfContact.trim());
      body.append('category', category);
      await request(`${projectsUrl.replace(/\/$/, '')}/${encodeURIComponent(selectedProjectId)}/attachments`, { method: 'POST', body });
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setStatus('Documento enviado correctamente.');
      await selectProject(selectedProjectId);
    } catch (uploadError) {
      setError((uploadError as Error).message);
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#101416] text-slate-100 p-6 md:p-10">
      <div className="max-w-6xl mx-auto">
        <header className="flex flex-wrap items-start justify-between gap-4 mb-8">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-cyan-400 mb-2">Muamba / documentos</p>
            <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">Anexos de proyectos</h1>
            <p className="text-slate-400 mt-2">Selecciona un proyecto y envía sus documentos a la API.</p>
          </div>
          <button onClick={onBack} className="px-4 py-2 rounded-lg border border-slate-700 text-slate-300 hover:border-cyan-500 hover:text-cyan-300 transition-colors">Volver a cotizaciones</button>
        </header>

        <section className="bg-[#171d20] border border-slate-700/70 rounded-xl p-5 mb-6">
          <div className="grid md:grid-cols-[1fr_2fr_auto] gap-3 items-end">
            <label className="text-sm text-slate-300">API Key
              <input type="password" value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder="X-Api-Key" className="mt-2 w-full bg-[#0e1214] border border-slate-700 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-cyan-500" />
            </label>
            <label className="text-sm text-slate-300">Endpoint de proyectos
              <input value={projectsUrl} onChange={event => setProjectsUrl(event.target.value)} className="mt-2 w-full bg-[#0e1214] border border-slate-700 rounded-lg px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-cyan-500" />
            </label>
            <button onClick={() => void loadProjects()} disabled={isBusy} className="px-4 py-2.5 rounded-lg bg-cyan-500 text-[#071014] font-semibold hover:bg-cyan-400 disabled:opacity-50">Listar proyectos</button>
          </div>
          <div className="mt-4 flex flex-wrap gap-2 items-center">
            <input value={manualProjectId} onChange={event => setManualProjectId(event.target.value)} onKeyDown={event => event.key === 'Enter' && addManualProject()} placeholder="O agrega un projectId manualmente" className="flex-1 min-w-60 bg-[#0e1214] border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-cyan-500" />
            <button onClick={addManualProject} className="px-3 py-2 rounded-lg border border-slate-600 text-sm hover:border-cyan-500">Agregar proyecto</button>
          </div>
          {status && <p className="text-sm text-cyan-300 mt-3">{status}</p>}
          {error && <p className="text-sm text-rose-300 mt-3">{error}</p>}
        </section>

        <div className="grid lg:grid-cols-[280px_1fr] gap-6">
          <aside className="bg-[#171d20] border border-slate-700/70 rounded-xl p-4 h-fit">
            <div className="flex items-center justify-between mb-3"><h2 className="font-semibold">Proyectos</h2><span className="text-xs text-slate-500">{projects.length}</span></div>
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {projects.map(project => <button key={project.id} onClick={() => void selectProject(project.id)} className={`w-full text-left p-3 rounded-lg border transition-colors ${selectedProjectId === project.id ? 'border-cyan-400 bg-cyan-400/10' : 'border-slate-700 hover:border-slate-500'}`}><span className="block text-sm truncate">{project.name}</span><span className="block text-xs text-slate-500 mt-1 font-mono truncate">{project.id}</span>{project.status && <span className="block text-xs text-slate-400 mt-1">{project.status}</span>}</button>)}
              {projects.length === 0 && <p className="text-sm text-slate-500 py-4">Lista vacía. Consulta la API o agrega un ID.</p>}
            </div>
          </aside>

          <main className="space-y-6">
            <section className="bg-[#171d20] border border-slate-700/70 rounded-xl p-5">
              <div className="flex flex-wrap justify-between gap-3 mb-4"><div><h2 className="font-semibold">Enviar documento</h2><p className="text-sm text-slate-500 mt-1">Proyecto seleccionado: {selectedProjectId || 'ninguno'}</p></div><select value={category} onChange={event => setCategory(event.target.value as 'PRJ' | 'INS')} className="bg-[#0e1214] border border-slate-700 rounded-lg px-3 py-2 text-sm"><option value="PRJ">PRJ · Documentos</option><option value="INS">INS · Documentos Instalación</option></select></div>
              <div className="grid md:grid-cols-2 gap-3">
                <input value={behalfName} onChange={event => setBehalfName(event.target.value)} placeholder="Nombre de quien origina el documento" className="bg-[#0e1214] border border-slate-700 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-cyan-500" />
                <input value={behalfContact} onChange={event => setBehalfContact(event.target.value)} placeholder={behalfContactType === 'Email' ? 'Correo electrónico' : 'Número de WhatsApp'} className="bg-[#0e1214] border border-slate-700 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-cyan-500" />
                <select value={behalfContactType} onChange={event => setBehalfContactType(event.target.value as 'Email' | 'WhatsApp')} className="bg-[#0e1214] border border-slate-700 rounded-lg px-3 py-2.5 text-sm"><option value="Email">Contacto por Email</option><option value="WhatsApp">Contacto por WhatsApp</option></select>
                <input ref={fileInputRef} type="file" onChange={event => setSelectedFile(event.target.files?.[0] || null)} className="block w-full text-sm text-slate-400 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-700 file:px-3 file:py-2 file:text-slate-200" />
              </div>
              <button onClick={() => void uploadAttachment()} disabled={isBusy || !selectedProjectId} className="mt-4 px-4 py-2.5 rounded-lg bg-emerald-500 text-[#07140e] font-semibold hover:bg-emerald-400 disabled:opacity-50">Enviar anexo</button>
            </section>

            <section className="bg-[#171d20] border border-slate-700/70 rounded-xl p-5"><div className="flex justify-between items-center mb-4"><div><h2 className="font-semibold">Documentos anexos</h2><p className="text-sm text-slate-500 mt-1">{attachments.length} documento(s) en el proyecto</p></div>{selectedProjectId && <button onClick={() => void selectProject(selectedProjectId)} className="text-sm text-cyan-300 hover:text-cyan-200">Actualizar</button>}</div><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-left text-xs uppercase tracking-wider text-slate-500"><tr><th className="pb-3">Nombre</th><th className="pb-3">Categoría</th><th className="pb-3">Tamaño</th><th className="pb-3">Fecha</th></tr></thead><tbody>{attachments.map(attachment => <tr key={attachment.attachmentId} className="border-t border-slate-800"><td className="py-3 pr-4">{attachment.name}<span className="block text-xs text-slate-600 font-mono mt-1">{attachment.attachmentId}</span></td><td className="py-3 text-slate-400">{attachment.category}</td><td className="py-3 text-slate-400">{(attachment.size / 1024).toFixed(1)} KB</td><td className="py-3 text-slate-400">{new Date(attachment.createdDate).toLocaleDateString('es-MX')}</td></tr>)}{attachments.length === 0 && <tr><td colSpan={4} className="py-8 text-center text-slate-500">Selecciona un proyecto para ver sus anexos.</td></tr>}</tbody></table></div></section>
          </main>
        </div>
      </div>
    </div>
  );
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
  const [view, setView] = useState<AppView>('cotizaciones');
  const [claudeSettingsOpen, setClaudeSettingsOpen] = useState(false);
  const [settingsReturnView, setSettingsReturnView] = useState<AppView>('cotizaciones');
  const [claudeConfigured, setClaudeConfigured] = useState(false);
  const [claudeApiKey, setClaudeApiKey] = useState('');
  const [claudeModel, setClaudeModel] = useState('claude-sonnet-4-5');
  const [claudeError, setClaudeError] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [isClaudeResponding, setIsClaudeResponding] = useState(false);
  const [marketingMessages, setMarketingMessages] = useState<ChatMessage[]>([]);
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
  const [pdfError, setPdfError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const extractorInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    fetch('/api/claude/settings')
      .then(response => response.json())
      .then(settings => {
        setClaudeConfigured(Boolean(settings.configured));
        if (settings.model) setClaudeModel(settings.model);
      })
      .catch(() => setClaudeConfigured(false));
  }, []);

  // Agregar mensaje del agente
  const addAgentMessage = useCallback((text: string) => {
    setMessages(prev => [...prev, { role: 'agent', text, timestamp: new Date() }]);
  }, []);

  const addUserMessage = useCallback((text: string) => {
    setMessages(prev => [...prev, { role: 'user', text, timestamp: new Date() }]);
  }, []);

  const openClaudeSettings = (returnView: AppView) => {
    setClaudeError('');
    setSettingsReturnView(returnView);
    setView('cotizaciones');
    setClaudeSettingsOpen(true);
  };

  const closeClaudeSettings = () => {
    setClaudeSettingsOpen(false);
    setView(settingsReturnView);
  };

  const saveClaudeSettings = async () => {
    setClaudeError('');
    try {
      const response = await fetch('/api/claude/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: claudeApiKey, model: claudeModel }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'No se pudo guardar la configuración.');
      setClaudeConfigured(true);
      setClaudeApiKey('');
      setClaudeSettingsOpen(false);
      setView(settingsReturnView);
    } catch (error) {
      setClaudeError((error as Error).message);
    }
  };

  const clearClaudeSettings = async () => {
    setClaudeError('');
    try {
      const response = await fetch('/api/claude/settings', { method: 'DELETE' });
      if (!response.ok) throw new Error('No se pudo borrar la configuración.');
      setClaudeConfigured(false);
      setClaudeApiKey('');
    } catch (error) {
      setClaudeError((error as Error).message);
    }
  };

  const sendMessageToClaude = async () => {
    const text = chatInput.trim();
    if (!text || isClaudeResponding) return;
    addUserMessage(text);
    setChatInput('');
    setIsClaudeResponding(true);
    setClaudeError('');

    const history = [...messages.slice(-20), { role: 'user' as const, text, timestamp: new Date() }];
    const conversation: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    history.forEach(message => {
      const role = message.role === 'user' ? 'user' : 'assistant';
      const previous = conversation[conversation.length - 1];
      if (previous?.role === role) previous.content += `\n\n${message.text}`;
      else conversation.push({ role, content: message.text });
    });

    try {
      const response = await fetch('/api/claude/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: conversation }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'No se pudo obtener respuesta de Claude.');
      addAgentMessage(result.reply);
    } catch (error) {
      setClaudeError((error as Error).message);
    } finally {
      setIsClaudeResponding(false);
    }
  };

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

  const handleAuthorizePDF = async () => {
    addUserMessage('✅ Autorizo la generación del PDF');
    setPdfError('');
    addAgentMessage(
      '¡Perfecto! Generando tu PDF... 📑\n\n' +
      'Tu cotización ha sido procesada exitosamente.\n' +
      'El PDF está listo para descarga.'
    );
    setStep('confirm');

    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    await generatePDF();
  };

  const generatePDF = async () => {
    try {
      const html2pdfModule = await import('html2pdf.js');
      const html2pdf = html2pdfModule.default || html2pdfModule;
      const element = document.getElementById('pdf-content');
      if (!element) throw new Error('No se encontró el contenido del documento.');

      await document.fonts?.ready;
      await Promise.all(Array.from(element.querySelectorAll('img')).map(image => {
        if (image.complete) return Promise.resolve();
        return new Promise<void>(resolve => {
          image.addEventListener('load', () => resolve(), { once: true });
          image.addEventListener('error', () => resolve(), { once: true });
        });
      }));

      const opt = {
        margin: [10, 10, 10, 10],
        filename: `cotizacion_${Date.now()}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff', logging: false },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' as const },
      };

      await (html2pdf as any)().set(opt).from(element).save();
      setStep('done');
      addAgentMessage(
        '✅ **¡PDF generado y descargado!**\n\n' +
        'Tu cotización ha sido exportada exitosamente.\n\n' +
        '¿Deseas generar otra cotización? Puedes reiniciar el proceso.'
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error desconocido al generar el PDF.';
      setPdfError(message);
      setStep('preview');
      addAgentMessage(`❌ No pude generar el PDF: ${message}`);
    }
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

  if (view === 'muamba') {
    return <MuambaWorkspace onBack={() => setView('cotizaciones')} />;
  }

  if (view === 'mercadotecnia') {
    return (
      <MarketingWorkspace
        onNavigate={setView}
        claudeConfigured={claudeConfigured}
        claudeModel={claudeModel}
        messages={marketingMessages}
        setMessages={setMarketingMessages}
        onConfigureClaude={() => openClaudeSettings('mercadotecnia')}
      />
    );
  }

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

        <div className="flex items-center gap-2">
          <button
            onClick={() => openClaudeSettings('cotizaciones')}
            className="px-3 py-2 rounded-lg border border-gray-700 hover:border-emerald-500/50 text-sm transition-colors"
          >
            Claude {claudeConfigured ? '· Conectado' : '· Configurar'}
          </button>
          <button
            onClick={() => setView('mercadotecnia')}
            className="px-3 py-2 rounded-lg border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10 text-sm transition-colors"
          >
            Agente de Mercadotecnia
          </button>
          <button
            onClick={() => setView('muamba')}
            className="px-3 py-2 rounded-lg border border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/10 text-sm transition-colors"
          >
            Muamba · Anexos
          </button>
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

          <form
            onSubmit={event => { event.preventDefault(); void sendMessageToClaude(); }}
            className="p-3 border-t border-gray-800 flex gap-2"
          >
            <input
              value={chatInput}
              onChange={event => setChatInput(event.target.value)}
              disabled={isClaudeResponding}
              placeholder={claudeConfigured ? 'Escribe a Claude...' : 'Configura Claude para conversar'}
              className="min-w-0 flex-1 bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={!claudeConfigured || !chatInput.trim() || isClaudeResponding}
              title="Enviar mensaje a Claude"
              className="px-3 rounded-lg bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isClaudeResponding ? '...' : 'Enviar'}
            </button>
          </form>
          {claudeError && <p className="px-4 pb-3 text-xs text-rose-300">{claudeError}</p>}
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
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      urlTransform={(url) => url}
                      components={{
                        img: ({ src, alt }) => <img src={src} alt={alt || ''} />
                      }}
                    >
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
              {pdfError && (
                <div className="mx-6 mt-4 flex items-center justify-between gap-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                  <span>⚠️ No se pudo descargar el PDF: {pdfError}</span>
                  <button onClick={handleAuthorizePDF} className="shrink-0 rounded-lg border border-red-400/30 px-3 py-1.5 text-xs hover:bg-red-500/20 transition-all">
                    Reintentar
                  </button>
                </div>
              )}
              <div className="flex-1 overflow-y-auto bg-gray-800/30 p-8 flex justify-center">
                <div className="w-full max-w-[800px]">
                  <div 
                    id="pdf-content"
                    className="bg-white text-gray-900 rounded-lg shadow-2xl p-12 markdown-preview-pdf"
                  >
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      urlTransform={(url) => url}
                      components={{
                        img: ({ src, alt }) => <img src={src} alt={alt || ''} />
                      }}
                    >
                      {processedMarkdown}
                    </ReactMarkdown>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {claudeSettingsOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) closeClaudeSettings(); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="claude-settings-title" className="w-full max-w-lg bg-gray-900 border border-gray-700 rounded-xl shadow-2xl p-6">
            <div className="flex items-start justify-between gap-4 mb-5">
              <div>
                <p className="text-xs uppercase tracking-widest text-emerald-400 mb-1">Proveedor de respuestas</p>
                <h2 id="claude-settings-title" className="text-xl font-semibold">Configurar Claude</h2>
              </div>
              <button onClick={closeClaudeSettings} aria-label="Cerrar configuración" className="text-gray-400 hover:text-white">✕</button>
            </div>
            <label className="block text-sm text-gray-300 mb-4">API key de Anthropic
              <input
                type="password"
                autoComplete="new-password"
                value={claudeApiKey}
                onChange={event => setClaudeApiKey(event.target.value)}
                placeholder={claudeConfigured ? 'Configurada; escribe otra para reemplazarla' : 'sk-ant-...'}
                className="mt-2 w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2.5 font-mono text-sm focus:outline-none focus:border-emerald-500"
              />
            </label>
            <label className="block text-sm text-gray-300">Modelo
              <select value={claudeModel} onChange={event => setClaudeModel(event.target.value)} className="mt-2 w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-500">
                <option value="claude-sonnet-4-5">Claude Sonnet 4.5</option>
                <option value="claude-haiku-4-5">Claude Haiku 4.5</option>
                <option value="claude-opus-4-1">Claude Opus 4.1</option>
              </select>
            </label>
            <p className="mt-4 text-xs leading-relaxed text-gray-500">La API key se conserva sólo en la memoria del backend local y se borra al reiniciar el servidor. El uso de API se factura en la cuenta de Anthropic asociada a esa key.</p>
            {claudeError && <p className="mt-3 text-sm text-rose-300">{claudeError}</p>}
            <div className="mt-6 flex justify-between gap-3">
              {claudeConfigured && <button onClick={() => void clearClaudeSettings()} className="px-3 py-2 text-sm text-rose-300 hover:text-rose-200">Desconectar</button>}
              <div className="ml-auto flex gap-2">
                <button onClick={closeClaudeSettings} className="px-3 py-2 rounded-lg border border-gray-700 text-sm hover:bg-gray-800">Cancelar</button>
                <button onClick={() => void saveClaudeSettings()} disabled={!claudeApiKey.trim()} className="px-4 py-2 rounded-lg bg-emerald-600 text-sm font-medium hover:bg-emerald-500 disabled:opacity-40">Guardar API key</button>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
