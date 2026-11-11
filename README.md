# IAgenteDemo
Agente de Extracción y Generación de Informes

## Chat con Claude

1. Inicia la aplicación con `npm run dev`.
2. En la aplicación, abre **Claude · Configurar**.
3. Ingresa una API key creada en la cuenta de Anthropic que quieres usar y selecciona el modelo.
4. Guarda la configuración y escribe en el chat de la izquierda.

La API key se conserva en memoria dentro del proceso local de Vite; no se guarda en el navegador ni en un archivo, y se elimina al reiniciar el servidor. El consumo se factura a la cuenta de Anthropic asociada a la key. Esta implementación es para desarrollo local: `vite preview` no incluye el backend ni sus rutas de Claude. Para desplegarla, se deben alojar esas rutas en un backend protegido y con almacenamiento de secretos adecuado.

## Agentes

- **Agente de Cotizaciones** conserva el flujo de plantilla, imágenes, datos JSON y exportación PDF.
- **Agente de Mercadotecnia** ofrece una conversación separada para estrategia, campañas y contenido. Usa la misma cuenta y modelo Claude configurados, pero un prompt especializado; cada sección mantiene su propio hilo mientras está abierta. Desde el mismo chat se le puede pedir una presentación ("crea un PowerPoint con esta estrategia") o cambios a una existente ("agrega una diapositiva de presupuesto"). La presentación aparece en la conversación como una tarjeta con miniatura; al abrirla se muestra un panel lateral con la vista previa de cada diapositiva, miniaturas, notas del presentador y el botón para descargar el `.pptx` (16:9). El botón **Crear PowerPoint** sigue disponible como formulario rápido y su resultado también se agrega al chat.
- **Muamba · Anexos** permite seleccionar proyectos y enviar documentos a la API de Muamba.

La generación del PowerPoint requiere una API key configurada en el panel de Claude. El contenido se genera en el backend local y `pptxgenjs` compone el archivo en el navegador; no se necesita instalar PowerPoint.

## Documentos de referencia del Agente de Mercadotecnia

Los archivos `.md` de [`agentes/mercadotecnia/`](agentes/mercadotecnia/) se agregan a las instrucciones del agente en el chat y en **Crear PowerPoint**. Por ejemplo, `metodologia_smart.md` hace que los objetivos propuestos sigan el método SMART. Se leen en cada mensaje, así que puedes agregar, editar o quitar archivos sin reiniciar `npm run dev`. El límite total es de 200 KB.

Solo se usa el texto: si una skill de claude.ai incluye scripts o plantillas, esas partes no se ejecutan aquí. Esta carpeta es independiente de `.github/agents/`, que usa GitHub Copilot en VS Code.

## Formato del PowerPoint

Claude elige para cada diapositiva uno de estos diseños: portada, separador de sección, viñetas, cifras clave (KPIs), columnas, comparación, línea de tiempo, gráfica (barras, línea o dona, editables en PowerPoint), tabla (por ejemplo, comparación de planes), cita y cierre. Puedes pedirlo en el chat, por ejemplo: "pon los objetivos en una línea de tiempo" o "convierte la diapositiva 4 en una comparación".

Los colores, las fuentes, el logo y los textos fijos se configuran en [`agentes/mercadotecnia/estilo.json`](agentes/mercadotecnia/estilo.json):

| Campo | Uso |
| --- | --- |
| `diseño` | `minimalista` (fondo blanco, títulos grandes y números destacados en el color primario) o `moderno` (portada oscura, tarjetas y círculos). |
| `colores.primario`, `secundario`, `acento` | Color de marca, color de apoyo y color de resalte (#RRGGBB). |
| `colores.oscuro`, `fondo`, `superficie` | Fondo de portada y cierre, fondo de las diapositivas de contenido y fondo de las tarjetas. |
| `colores.texto`, `textoSuave`, `textoClaro`, `borde` | Texto principal, texto secundario, texto sobre fondos oscuros y líneas. |
| `colores.alterno` | Fondo de las filas alternas de las tablas. |
| `fuentes.titulos`, `fuentes.texto` | Deben estar instaladas en la computadora que abra el archivo. |
| `etiqueta` | Texto pequeño de la portada y del encabezado de cada diapositiva. |
| `pie` | Texto del pie de página (por ejemplo, el nombre de la empresa). Si está vacío se usa el título. |
| `logo` | Nombre de un archivo `.png` o `.jpg` (máx. 2 MB) guardado en la misma carpeta. Se recomienda PNG con fondo transparente. |

Los cambios se aplican la próxima vez que se genere o descargue una presentación, sin reiniciar el servidor.
