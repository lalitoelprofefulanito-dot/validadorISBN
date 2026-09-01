# Validador Masivo de Títulos de Libros

Herramienta de escritorio/navegador para validar, enriquecer y consolidar inventarios bibliográficos escolares en lotes de hasta 1,000 títulos — sin backend, sin instalación, sin costo. Nació para automatizar la captura del proyecto **Biblioteca Viva** (Escuela Primaria Molino de Rosas), pero funciona para cualquier inventario que use un identificador ISBN.

## ¿Qué hace?

La app cruza tu lista de libros contra **3 fuentes públicas** (OpenLibrary, Google Books e Internet Archive) para recuperar autor, editorial, año e ISBN oficial, valida cada coincidencia por similitud de texto (para no aceptar el libro equivocado) y te entrega un reporte listo para exportar — sin inventar nunca un dato que ninguna fuente pueda verificar.

### Los 3 motores

| Motor | Entrada | Qué hace |
|---|---|---|
| **1 — Títulos** | Lista de títulos, uno por línea | Busca cada título en las 3 fuentes, valida la coincidencia por similitud y rellena huecos (autor/editorial/año/ISBN) cruzando las fuentes que no ganaron la búsqueda inicial |
| **2 — ISBN** | Lista de ISBN, uno por línea | Compara cada ISBN contra lo ya validado: si coincide, completa campos faltantes; si no existe, lo agrega como registro nuevo — nunca duplica |
| **3 — Archivos** | Varios `.xlsx`/`.csv` (arrastrar y soltar) | Mapea las cabeceras de cada archivo contra los campos oficiales (con confirmación manual), consolida los archivos entre sí resolviendo conflictos por completitud de datos, integra todo sin duplicados y solo busca en la web lo que sigue faltando tras consolidar |

Los tres motores comparten los mismos índices de deduplicación (por ISBN y por título), así que un libro nunca aparece dos veces sin importar por qué motor haya entrado.

### Registro de Auditoría

Cada corrección automática, fusión de duplicados o campo que ninguna fuente pudo verificar queda documentado en un panel de auditoría, en tiempo real — nada se completa ni se descarta en silencio.

### Exportación

- **CSV** — reporte completo con fuente, similitud, estado y motor de origen de cada registro.
- **Excel "Inventario Biblioteca Viva"** — exporta directo a la plantilla oficial de la escuela (fórmulas, listas desplegables y rangos con nombre intactos, incluso en lotes de más de 400 títulos), dejando en blanco a propósito los campos que requieren inspección física del ejemplar (portada, estado físico, procedencia, grado, categoría SEP).

## Cómo usarlo

1. Descarga **ambos archivos** de este repositorio y guárdalos en la misma carpeta:
   - `validador_de_titulos.html`
   - `importacion.js`
2. Abre `validador_de_titulos.html` con doble clic (funciona en cualquier navegador moderno, sin servidor ni instalación).
3. Pega tu lista de títulos y/o ISBN, o arrastra tus archivos Excel/CSV al Motor 3.
4. Exporta el resultado en CSV o directo a la plantilla de inventario.

> ⚠️ Los dos archivos deben mantenerse juntos. Si abres el HTML sin `importacion.js` al lado, todo lo demás funciona normal — solo el Motor 3 (consolidación de archivos) queda inactivo.

## Arquitectura

- **Sin backend**: todo corre en el navegador del usuario. Las únicas llamadas de red son a las APIs públicas de OpenLibrary, Google Books e Internet Archive (para buscar libros) — ningún dato del inventario se envía a un servidor propio, porque no existe.
- **`validador_de_titulos.html`** — interfaz, los 3 motores de búsqueda/validación, deduplicación, auditoría y exportación.
- **`importacion.js`** — Motor 3 (lectura y consolidación de archivos subidos), aislado en su propio módulo y conectado al resto mediante una API pública explícita (`window.Validador`) para no acoplar el código.

### Librerías

| Uso | Librería |
|---|---|
| Lectura de `.xlsx`/`.csv` subidos | [SheetJS Community Edition](https://sheetjs.com/) |
| Exportación a la plantilla Excel oficial (preserva fórmulas y listas desplegables) | [xlsx-populate](https://github.com/dtjohnson/xlsx-populate) |
| Estilos | [Tailwind CSS](https://tailwindcss.com/) (vía CDN) |

## Límites honestos

- Hasta 1,000 registros por lote (ampliable, pero pensado para inventarios escolares, no para catálogos masivos).
- Si un libro no existe en ninguna de las 3 fuentes, la app **no inventa** autor, editorial ni año — lo deja en blanco y lo marca como pendiente de revisión manual en el Registro de Auditoría.
- La exportación a la plantilla oficial nunca llena Portada, Estado físico, Procedencia, Grado, Serie ni Categoría SEP: son datos que requieren tener el libro físico en mano.

## Licencia

Sin licencia definida todavía — agrega aquí la que corresponda a tu proyecto (por ejemplo, MIT) si planeas compartir el repositorio públicamente.
