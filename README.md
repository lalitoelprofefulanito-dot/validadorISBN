# Validador Masivo de Títulos de Libros

**▶ Úsalo aquí: https://lalitoelprofefulanito-dot.github.io/validadorISBN/**

Herramienta de navegador para validar, enriquecer y consolidar inventarios bibliográficos escolares en lotes de hasta 1,000 títulos — sin backend, sin instalación, sin costo. Nació para automatizar la captura del proyecto **Biblioteca Viva** (Escuela Primaria Molino de Rosas), pero está construida para que cualquier escuela pueda usarla con su propia plantilla y su propio catálogo, sin tocar el código.

Todo el procesamiento ocurre en el navegador de quien la usa. No hay servidor propio, no hay cuenta que crear y ningún dato del inventario sale hacia una base de datos ajena: las únicas conexiones son a las APIs públicas de consulta bibliográfica.

## Qué hace

Cruza tu lista de libros contra **4 fuentes públicas**, valida cada coincidencia por similitud de título para no aceptar el libro equivocado, y te entrega un reporte listo para exportar — sin inventar nunca un dato que ninguna fuente pueda verificar.

### Los 5 motores

| Motor | Entrada | Qué hace |
|---|---|---|
| **1 — Títulos** | Lista de títulos, uno por línea | Consulta las 4 fuentes, se queda con la mejor coincidencia por similitud y rellena los huecos (autor/editorial/año/ISBN/portada/reseña) con las fuentes que no ganaron |
| **2 — ISBN** | Lista de ISBN, uno por línea | Compara cada ISBN contra lo ya validado: si coincide, completa campos faltantes; si no existe, lo agrega como registro nuevo — nunca duplica |
| **3 — Archivos** | Varios `.xlsx`/`.csv` (arrastrar y soltar) | Mapea las cabeceras contra los campos oficiales, consolida los archivos entre sí resolviendo conflictos por completitud, integra sin duplicados y solo busca en la web lo que sigue faltando |
| **4 — Clasificación SEP** | La propia tabla | Agrega 6 columnas (Procedencia, Grado, Género, Categoría, Serie, Estado físico) con las listas **oficiales leídas en vivo de la plantilla**, más relleno rápido hacia abajo |
| **5 — Catálogo histórico** | La propia tabla | Compara los títulos validados contra el Catálogo Histórico de Libros del Rincón y rellena la clasificación SEP cuando la coincidencia es inequívoca |

Los cinco motores comparten los mismos índices de deduplicación (por ISBN y por título), así que un libro nunca aparece dos veces sin importar por qué motor haya entrado.

### Las 4 fuentes

| Fuente | Clave | Notas |
|---|---|---|
| **ISBNdb** | Sí, obligatoria para activarla | La mejor cobertura de ediciones mexicanas y en español (FCE, SEP, Castillo, El Naranjo). Es la única que devuelve **reseña**. Límites: 60 consultas/minuto, 5,000/día — la app los respeta sola. Sin clave, esta fuente simplemente no participa y las otras tres siguen funcionando |
| **OpenLibrary** | No | Cobertura amplia en inglés, irregular en español |
| **Google Books** | Opcional | Sin clave usa una cuota anónima compartida que se agota rápido en lotes grandes |
| **Internet Archive** | No | Solo materiales de texto |

Las cuatro se consultan **compitiendo por similitud**, no en cascada: que una responda primero no impide que otra aporte una coincidencia mejor. Si alguna alcanza el 92% de similitud, se corta ahí para no gastar cuota de más.

### Cómo se decide si una coincidencia es buena

La similitud no es una comparación carácter por carácter. Combina tres señales sobre las palabras de contenido del título (sin artículos ni preposiciones):

- **cobertura** — qué parte del título corto aparece en el largo; es lo que rescata subtítulos y menciones de edición
- **jaccard** — cuánto se solapan los dos vocabularios; es lo que separa "El libro salvaje" de "El libro vaquero"
- **levenshtein** — desempate fino para erratas de captura

Por encima de **62%** el registro se marca **Validado**; entre **38% y 62%**, **Revisar**; por debajo se descarta. En cualquiera de los dos casos la fila es editable: la corrección humana es la última línea de defensa del inventario, y el algoritmo no puede bloquearla.

### Registro de Auditoría

Cada corrección automática, fusión de duplicados, coincidencia ambigua o campo que ninguna fuente pudo verificar queda documentado en un panel de auditoría, en tiempo real — nada se completa ni se descarta en silencio.

### Exportación

- **CSV** — reporte completo con reseña, fuente, similitud, estado y motor de origen de cada registro.
- **Reporte con Portadas (Word)** y **copiado directo** a Word o a Excel 365/Sheets.
- **Excel "Inventario Biblioteca Viva"** — exporta a la plantilla oficial (fórmulas, listas desplegables y rangos con nombre intactos, incluso en lotes de más de 400 títulos), dejando en blanco a propósito los campos que requieren inspección física del ejemplar. Las columnas auxiliares van en ámbar, para que se distingan a simple vista de las oficiales.

## Cómo usarlo

### Opción 1 — Abrir el enlace (recomendada)

1. Entra a **https://lalitoelprofefulanito-dot.github.io/validadorISBN/**
2. Abre el panel **Configuración** (arriba a la izquierda, con el ícono de engrane). Viene desplegado hasta que pegues tu clave de ISBNdb.
3. Pega tu clave de ISBNdb en el primer campo. Se guarda en tu navegador, así que solo se hace una vez por equipo. Si no tienes clave, salta este paso: la app funciona con las otras 3 fuentes.
4. Pega tu lista de títulos y/o ISBN, o arrastra tus archivos Excel/CSV al Motor 3.
5. Clasifica con el Motor 4 (o deja que el Motor 5 proponga lo que pueda) y exporta.

No hay nada que descargar ni instalar. La página se actualiza sola cada vez que se publica una mejora.

### Opción 2 — Descargar los archivos (para trabajar sin internet)

Útil si vas a capturar en un aula sin conexión. Ten en cuenta que las consultas bibliográficas sí requieren internet; sin él funcionan la captura, el Motor 4 y la exportación.

1. Descarga **los cuatro archivos** de este repositorio y guárdalos en la **misma carpeta**:
   - `index.html`
   - `importacion.js`
   - `catalogo_historico.js`
   - `README.md` (este archivo, opcional)
2. Abre `index.html` con doble clic. Funciona en cualquier navegador moderno, sin servidor.
3. Continúa desde el paso 2 de la Opción 1.

> Los archivos deben mantenerse juntos. Si abres el HTML sin `importacion.js` al lado, el Motor 3 queda inactivo; sin `catalogo_historico.js`, el Motor 5. Todo lo demás sigue funcionando, pero sin aviso de que falta algo — por eso la Opción 1 es más segura para quien no vaya a revisar carpetas.

## Para usarlo en otra escuela

Nada de esto exige editar código. Todo vive en el panel **Configuración**:

- **Plantilla propia** — sube tu `.xlsx`. Debe tener una hoja `Inventario`, una `Clasificador SEP` y una `Clasificador SEP - Rincón`. A partir de ahí, tanto las listas desplegables del Motor 4 como la exportación salen de tu archivo.
- **Catálogo histórico propio** — cambia la URL del JSON. Cada entrada necesita al menos `Título`, y opcionalmente `Grado`, `Género`, `Categoría`, `Serie_Lectora` y `Ciclo_Escolar`.
- **Claves de API** — se guardan en el navegador (`localStorage`), **nunca dentro del archivo HTML**. Puedes publicar o compartir tu copia sin filtrar credenciales. Aun así, conviene restringir las claves por dominio en el panel de cada proveedor.

## Límites honestos

- Hasta 1,000 registros por lote (ampliable, pero pensado para inventarios escolares).
- Si un libro no existe en ninguna de las 4 fuentes, la app **no inventa** autor, editorial ni año: lo deja en blanco y lo marca como pendiente de revisión manual.
- La exportación nunca llena Portada, Estado físico, Procedencia, Grado, Serie ni Categoría SEP por su cuenta: requieren tener el libro físico en mano, o pasar por el Motor 4 o el 5.
- El Motor 5 **no clasifica cuando el catálogo se contradice**. Alrededor de 198 títulos del catálogo histórico aparecen en varias generaciones y 187 de ellos clasifican distinto entre una y otra ("La selva" es 1° en un ciclo y 4° en otro). En esos casos no elige: registra las dos opciones en la Bitácora y te deja decidir.
- La columna de portada del XLSX usa `=IMAGE()`, que requiere Excel 365 o 2024+. En versiones anteriores mostrará `#NAME?`.
- Las imágenes del reporte Word quedan **enlazadas**, no incrustadas: Word las descarga al abrir el archivo, así que requiere internet en ese momento.

## Arquitectura

- **Sin backend**: todo corre en el navegador. Las únicas llamadas de red son a las APIs públicas de las 4 fuentes y al JSON del catálogo histórico. Ningún dato de tu inventario se envía a un servidor propio, porque no existe.
- **`index.html`** — interfaz, Motores 1, 2 y 4, deduplicación, auditoría y exportación.
- **`importacion.js`** — Motor 3, aislado en su propio módulo.
- **`catalogo_historico.js`** — Motor 5, también aislado.

Los dos módulos externos se conectan al núcleo por una API pública explícita (`window.Validador`) y nunca tocan su estado interno directamente. Para agregar un motor nuevo basta con un archivo más que consuma esa API.

### Librerías

| Uso | Librería |
|---|---|
| Lectura de `.xlsx`/`.csv` subidos | [SheetJS Community Edition](https://sheetjs.com/) |
| Exportación a la plantilla Excel (preserva fórmulas y listas desplegables) | [xlsx-populate](https://github.com/dtjohnson/xlsx-populate) 1.21.0 |
| Estilos | [Tailwind CSS](https://tailwindcss.com/) (vía CDN) |

> `xlsx-populate` se usa en una versión fija a propósito. La exportación construye a mano un nodo interno (`_dataValidations`) para extender las listas desplegables más allá de la fila 401, porque el método público tiene un error que genera XML inválido. Si algún día se actualiza la librería, esa parte es lo primero que hay que volver a probar.

## Licencia

[MIT](LICENSE) — © 2026 Eduardo Kantún Martínez.

Puedes usar, copiar, modificar y distribuir esta herramienta libremente, incluso adaptándola a tu escuela, siempre que conserves el aviso de copyright. Si la mejoras, la comunidad docente agradecerá que compartas el resultado.
