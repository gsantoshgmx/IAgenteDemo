# Documentos Anexos a Proyecto · Referencia de API

Muamba

Lectura, descarga y alta de documentos anexos de proyectos mediante API Key.

---

## Autenticación

Toda petición lleva la API Key en el header `X-Api-Key`. Dicha llave se entrega por Waspe y sólo habilita las rutas y métodos que tenga asignados.

```
X-Api-Key: {llave}
```

| Código | Causa |
|---|---|
| 401 | Falta la llave, o es inválida, está inactiva, expiró o la IP no está permitida |
| 403 | La llave es válida pero no tiene permiso sobre esa ruta y método |

---

## Convenciones

| Concepto | Valor |
|---|---|
| `projectId` | Id del Proyecto, tal como aparece en Muamba |
| `category` | `PRJ` — pestaña «Documentos»<br>`INS` — pestaña «Documentos Instalación» |
| `attachmentId` | Identificador único del documento, devuelto por el servicio de "Listar documentos de un proyecto" |
| Fechas | ISO 8601 con el desplazamiento de la zona horaria de la llave, por ejemplo `-06:00`. |

---

## Listar documentos de un proyecto

```
GET https://mcs.waspe.com/api/integration/v1/prj/projects/{projectId}/attachments
```

Devuelve los documentos anexos del proyecto, sin el contenido de los archivos.

| Parámetro | Descripción |
|---|---|
| `projectId` — **ruta** | Id del Proyecto |
| `category` — *query, opcional* | `PRJ` o `INS`. Omitido, devuelve ambas categorías |

### Respuesta 200

```json
[
  {
    "attachmentId": "8f3c1d24-95b0-4a17-b6e2-0d7c4f1a9e33",
    "name": "Plano electrico R2.pdf",
    "contentType": "application/pdf",
    "size": 481233,
    "category": "PRJ",
    "createdDate": "2026-08-24T12:12:44-06:00",
    "createdByUserName": "Integración MCS",
    "behalfName": "Juan Perez",
    "behalfContact": "juan.perez@mcs.com",
    "behalfContactType": "Email"
  }
]
```

**Dos datos distintos de autoría.** `createdByUserName` es el usuario de Muamba con el que se dio de alta el documento —para lo que sube esta API, siempre es el usuario de servicio de la llave—. Los campos `behalf*` identifican a la persona real que lo originó y sólo existen en lo que entra por esta API: vienen vacíos en todo lo que se subió desde Muamba.

### Ejemplo

```bash
curl -H "X-Api-Key: LLAVE" "https://mcs.waspe.com/api/integration/v1/prj/projects/PRY-260101-00001/attachments?category=INS"
```

---

## Descargar un documento

```
GET https://mcs.waspe.com/api/integration/v1/prj/projects/{projectId}/attachments/{attachmentId}
```

Devuelve el archivo con su tipo MIME y nombre originales.

| Parámetro | Descripción |
|---|---|
| `projectId` — **ruta** | Id del Proyecto |
| `attachmentId` — **ruta** | Identificador devuelto por el listado |

### Respuesta 200

Contenido binario. `Content-Type` el del archivo y `Content-Disposition` con su nombre.

### Ejemplo

```bash
curl -H "X-Api-Key: LLAVE" -OJ "https://mcs.waspe.com/api/integration/v1/prj/projects/PRY-260101-00001/attachments/8f3c1d24-95b0-4a17-b6e2-0d7c4f1a9e33"
```

---

## Descargar todos los documentos

```
GET https://mcs.waspe.com/api/integration/v1/prj/projects/{projectId}/attachments/download
```

Devuelve todos los documentos del proyecto en un ZIP.

| Parámetro | Descripción |
|---|---|
| `projectId` — **ruta** | Id del Proyecto |
| `category` — *query, opcional* | `PRJ` o `INS`. Omitido, incluye ambas categorías |

### Respuesta 200

`application/zip`. La respuesta se envía en *chunked transfer encoding*, así que **no incluye `Content-Length`**: el cliente debe leer hasta el fin del stream. Si el proyecto no tiene documentos, el ZIP viene vacío.

### Ejemplo

```bash
curl -H "X-Api-Key: LLAVE" -o documentos.zip "https://mcs.waspe.com/api/integration/v1/prj/projects/PRY-260101-00001/attachments/download"
```

---

## Subir un documento

```
POST https://mcs.waspe.com/api/integration/v1/prj/projects/{projectId}/attachments
```

Agrega un documento al proyecto. El cuerpo va como `multipart/form-data`.

| Campo | Descripción |
|---|---|
| `file` — **obligatorio** | El archivo |
| `behalfName` — **obligatorio** | Nombre de la persona que origina el documento |
| `behalfContactType` — **obligatorio** | `Email` o `WhatsApp` |
| `behalfContact` — **obligatorio** | Correo o número, según el tipo declarado. Se valida el formato |
| `category` — *opcional* | `PRJ` o `INS`. Por omisión `PRJ`. Va en el cuerpo, como los demás campos: enviarla en la dirección devuelve **400** |

El documento queda registrado en Muamba a nombre del usuario de servicio de la llave; los campos `behalf*` conservan a la persona real y se devuelven en el listado.

### Respuesta 200

```json
{
  "attachmentId": "1b90ec55-7a42-4c8e-9d31-56f2a0bb7c19",
  "name": "Acta de entrega.pdf",
  "contentType": "application/pdf",
  "size": 205118,
  "category": "PRJ",
  "createdDate": "2026-08-26T08:03:09-06:00",
  "createdByUserName": "Integración MCS",
  "behalfName": "Maria Lopez",
  "behalfContact": "+52 55 1234 5678",
  "behalfContactType": "WhatsApp"
}
```

### Ejemplo

```bash
curl -H "X-Api-Key: LLAVE" -F "file=@acta-de-entrega.pdf" -F "behalfName=Maria Lopez" -F "behalfContactType=WhatsApp" -F "behalfContact=+52 55 1234 5678" -F "category=PRJ" "https://mcs.waspe.com/api/integration/v1/prj/projects/PRY-260101-00001/attachments"
```

---

## Condiciones para subir

El alta se rechaza con **400** si no se cumple alguna:

- El proyecto está activo y no ha sido borrado.
- Su estatus es **Edición**, **Solicitado**, **Autorizado** o **Rechazado**. La respuesta indica el estatus actual cuando no es así.
- El archivo no rebasa el tamaño máximo configurado en la instancia — **20 MB**.
- Nombre, tipo de contacto y contacto vienen presentes y el contacto corresponde al tipo declarado.
- El nombre no contiene los caracteres `<` ni `>`.

---

## Errores

| Código | Causa |
|---|---|
| 400 | Parámetro inválido o alguna condición de alta no se cumple |
| 401 | Llave ausente, inválida, inactiva, expirada, o IP no permitida |
| 403 | La llave no tiene permiso sobre esa ruta y método |
| 404 | El proyecto o el documento no existe |

---

Todas las peticiones que presentan una API Key quedan registradas en la bitácora de consumo de la instancia, aceptadas o rechazadas.
