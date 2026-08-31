/**
 * MOTOR 3 — Consolidación de Inventario vía Excel/CSV
 * ============================================================
 * Módulo independiente (arquitectura elegida: archivo separado). Depende de:
 *   - window.Validador  → API pública expuesta por validador_de_titulos.html
 *   - window.XLSX       → SheetJS Community Edition (solo LECTURA de archivos subidos;
 *                          la exportación sigue usando xlsx-populate sobre la plantilla oficial)
 *
 * Flujo: Carga múltiple → Mapeo de cabeceras (confirmado por el usuario) →
 *        Consolidación entre archivos (conflicto: gana la fila con más campos llenos) →
 *        Integración en la tabla en vivo (misma regla 3.1-3.3 del Motor 2, sin duplicados) →
 *        Smart Fetching (solo busca en las 3 fuentes lo que SIGUE faltando tras consolidar).
 */
(function () {
    'use strict';

    if (!window.Validador) {
        console.error('importacion.js requiere que validador_de_titulos.html se cargue primero (window.Validador no está disponible).');
        return;
    }
    const V = window.Validador;

    // ============================================================
    // Diccionario de sinónimos de cabecera → campo canónico
    // ============================================================
    const CANONICAL_FIELDS = {
        titulo: ['titulo', 'título', 'title', 'nombre del libro', 'nombre', 'obra', 'book title'],
        autor: ['autor', 'autores', 'author', 'authors', 'writer', 'escritor'],
        editorial: ['editorial', 'publisher', 'edicion', 'edición', 'editora', 'casa editorial', 'sello'],
        anio: ['año', 'ano', 'anio', 'year', 'fecha de publicacion', 'fecha de publicación', 'publishyear', 'publish year', 'anio de publicacion'],
        isbn: ['isbn', 'isbn13', 'isbn-13', 'isbn10', 'isbn-10', 'codigo isbn', 'código isbn']
    };
    const FIELD_ORDER = ['titulo', 'autor', 'editorial', 'anio', 'isbn'];
    const FIELD_DISPLAY = { titulo: 'Título', autor: 'Autor', editorial: 'Editorial', anio: 'Año', isbn: 'ISBN' };
    const HEADER_MATCH_THRESHOLD = 0.72; // similitud mínima para sugerir un mapeo por coincidencia difusa

    let pendingFiles = []; // [{ name, headers: string[], rows: any[][], mapping: (string|null)[] }]

    // ============================================================
    // Mapeo de cabeceras: coincidencia exacta primero, difusa como respaldo.
    // El resultado siempre se muestra al usuario para confirmar/corregir —
    // nunca se importa una columna sin que quede visible cómo se interpretó.
    // ============================================================
    function guessFieldForHeader(header) {
        const norm = V.normalizeText(header);
        if (!norm) return null;
        for (const field of FIELD_ORDER) {
            if (CANONICAL_FIELDS[field].some(syn => V.normalizeText(syn) === norm)) return field;
        }
        let best = null, bestSim = 0;
        FIELD_ORDER.forEach(field => {
            CANONICAL_FIELDS[field].forEach(syn => {
                const sim = V.similarityRatio(header, syn);
                if (sim > bestSim) { bestSim = sim; best = field; }
            });
        });
        return bestSim >= HEADER_MATCH_THRESHOLD ? best : null;
    }

    // ============================================================
    // Lectura de archivos (SheetJS) — solo extrae valores de celda, nunca
    // ejecuta fórmulas ni macros del archivo de origen.
    // ============================================================
    function readFileAsRows(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = new Uint8Array(e.target.result);
                    const wb = XLSX.read(data, { type: 'array' });
                    const sheetName = wb.SheetNames[0];
                    const ws = wb.Sheets[sheetName];
                    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
                    resolve(rows);
                } catch (err) {
                    reject(err);
                }
            };
            reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
            reader.readAsArrayBuffer(file);
        });
    }

    async function handleFiles(fileList) {
        const files = Array.from(fileList).filter(f => /\.(xlsx|xls|csv)$/i.test(f.name));
        if (files.length === 0) {
            V.showToast('Ningún archivo .xlsx/.csv válido en la selección.', 'error');
            return;
        }

        pendingFiles = [];
        for (const file of files) {
            try {
                const rows = await readFileAsRows(file);
                if (!rows || rows.length < 2) {
                    V.logAudit('pendiente', `Archivo "${file.name}": no tiene filas de datos (solo encabezado o vacío) — se omitió.`);
                    continue;
                }
                const headers = rows[0].map(h => String(h || '').trim());
                let dataRows = rows.slice(1);
                if (dataRows.length > V.MAX_TITLES) {
                    V.logAudit('pendiente', `Archivo "${file.name}": truncado a ${V.MAX_TITLES} filas (tenía ${dataRows.length}).`);
                    dataRows = dataRows.slice(0, V.MAX_TITLES);
                }
                const mapping = headers.map(h => guessFieldForHeader(h));
                pendingFiles.push({ name: file.name, headers, rows: dataRows, mapping });
            } catch (err) {
                V.logAudit('pendiente', `Archivo "${file.name}" no se pudo leer (¿formato dañado o no soportado?) — se omitió. Detalle: ${err.message}`);
            }
        }

        if (pendingFiles.length === 0) {
            V.showToast('No se pudo leer ningún archivo válido.', 'error');
            return;
        }
        renderMappingPanel();
    }

    // ============================================================
    // Panel de confirmación de mapeo — el maestro revisa/corrige ANTES de
    // que se importe una sola fila. Un mapeo automático equivocado en
    // silencio metería datos en la columna incorrecta.
    // ============================================================
    function renderMappingPanel() {
        const panel = document.getElementById('importMappingPanel');
        const confirmBtn = document.getElementById('importConfirmBtn');
        panel.innerHTML = '';
        panel.classList.remove('hidden');
        confirmBtn.classList.remove('hidden');

        pendingFiles.forEach((fileEntry, fileIdx) => {
            const box = document.createElement('div');
            box.className = 'border border-purple-200 bg-purple-50/40 rounded-lg p-3 text-xs';

            const title = document.createElement('div');
            title.className = 'font-bold text-purple-800 mb-2 flex items-center justify-between gap-2';
            title.innerHTML = `<span class="truncate">${V.escapeHtml(fileEntry.name)}</span><span class="font-normal text-purple-500 shrink-0">${fileEntry.rows.length} fila(s)</span>`;
            box.appendChild(title);

            const grid = document.createElement('div');
            grid.className = 'space-y-1.5';
            fileEntry.headers.forEach((header, colIdx) => {
                const row = document.createElement('div');
                row.className = 'flex items-center gap-2';

                const label = document.createElement('span');
                label.className = 'flex-1 truncate text-slate-600';
                label.title = header;
                label.textContent = header || `(columna ${colIdx + 1})`;

                const select = document.createElement('select');
                select.className = 'text-xs border border-slate-300 rounded px-1.5 py-1 bg-white shrink-0';
                const options = [['', 'Ignorar columna']].concat(FIELD_ORDER.map(f => [f, FIELD_DISPLAY[f]]));
                options.forEach(([value, text]) => {
                    const opt = document.createElement('option');
                    opt.value = value;
                    opt.textContent = text;
                    if ((fileEntry.mapping[colIdx] || '') === value) opt.selected = true;
                    select.appendChild(opt);
                });
                select.addEventListener('change', () => {
                    pendingFiles[fileIdx].mapping[colIdx] = select.value || null;
                });

                row.appendChild(label);
                row.appendChild(select);
                grid.appendChild(row);
            });
            box.appendChild(grid);
            panel.appendChild(box);
        });
    }

    // ============================================================
    // Extracción de filas normalizadas según el mapeo confirmado
    // ============================================================
    function extractRows(fileEntry) {
        const out = [];
        fileEntry.rows.forEach(rawRow => {
            const rec = {};
            fileEntry.mapping.forEach((field, colIdx) => {
                if (!field) return;
                const val = rawRow[colIdx];
                if (val === undefined || val === null) return;
                const str = String(val).trim();
                if (str) rec[field] = str;
            });
            if (rec.titulo || rec.isbn) out.push(rec);
        });
        return out;
    }

    function countFilled(rec) {
        return FIELD_ORDER.filter(f => rec[f]).length;
    }

    // ============================================================
    // Consolidación ENTRE archivos: agrupa por ISBN válido (o por título
    // normalizado si no hay ISBN utilizable), y ante un choque entre archivos
    // distintos, gana la fila con más campos llenos (regla elegida por el
    // usuario) — lo que le falte a la ganadora se completa con la perdedora.
    // ============================================================
    function consolidateRows(allRowsWithSource) {
        const clusters = new Map();

        allRowsWithSource.forEach(({ rec, fileName }) => {
            let key = null;
            if (rec.isbn) {
                const normIsbn = V.normalizeIsbn(rec.isbn);
                if (V.isValidIsbn(normIsbn)) {
                    rec.isbn = normIsbn;
                    key = 'isbn:' + normIsbn;
                } else {
                    V.logAudit('pendiente', `Archivo "${fileName}": el ISBN "${rec.isbn}" no pasa la validación del dígito verificador — se ignoró ese ISBN para esta fila.`);
                    delete rec.isbn;
                }
            }
            if (!key && rec.titulo) key = 'titulo:' + V.normalizeText(rec.titulo);
            if (!key) return; // fila sin título ni ISBN utilizable: no se puede procesar

            if (!clusters.has(key)) clusters.set(key, []);
            clusters.get(key).push({ rec, fileName });
        });

        const consolidated = [];
        clusters.forEach(entries => {
            if (entries.length === 1) {
                consolidated.push(entries[0].rec);
                return;
            }
            entries.sort((a, b) => countFilled(b.rec) - countFilled(a.rec));
            const winner = Object.assign({}, entries[0].rec);
            const winnerFile = entries[0].fileName;
            const filledFromOthers = [];
            for (let i = 1; i < entries.length; i++) {
                FIELD_ORDER.forEach(f => {
                    if (!winner[f] && entries[i].rec[f]) {
                        winner[f] = entries[i].rec[f];
                        filledFromOthers.push(`${FIELD_DISPLAY[f]} (de "${entries[i].fileName}")`);
                    }
                });
            }
            V.logAudit('fusion', `Conflicto entre ${entries.length} archivos para "${winner.titulo || winner.isbn}": ganó "${winnerFile}" (más campos completos)${filledFromOthers.length ? '; se completó ' + filledFromOthers.join(', ') + ' desde otro archivo' : ''}.`);
            consolidated.push(winner);
        });
        return consolidated;
    }

    // ============================================================
    // Integración en la tabla EN VIVO — misma regla 3.1-3.3 que ya usa el
    // Motor 2: ISBN existente → enriquecer; título similar sin ISBN →
    // unificar; si no, registro nuevo. Nunca se crea un duplicado.
    // ============================================================
    function integrateConsolidatedRow(rec) {
        const sourceFields = {
            authors: rec.autor || null,
            publisher: rec.editorial || null,
            publishYear: rec.anio || null,
            isbn: rec.isbn || null
        };

        if (sourceFields.isbn && V.isbnIndex.has(sourceFields.isbn)) {
            const existing = V.isbnIndex.get(sourceFields.isbn);
            const filled = V.mergeFieldsIntoRecord(existing, sourceFields);
            if (filled.length > 0) {
                V.logAudit('completado', `Archivo: ISBN ${sourceFields.isbn} coincide con "${existing.apiData.title}": completó ${filled.join(', ')} (Motor 3).`);
            } else {
                V.logAudit('descartado', `Archivo: ISBN ${sourceFields.isbn} ya existe en el inventario ("${existing.apiData.title}") y no tenía campos pendientes — se descartó (evita duplicado).`);
            }
            return existing;
        }

        if (rec.titulo) {
            let bestMatch = null, bestSim = 0;
            V.titleIndex.forEach(existing => {
                if (existing.apiData && existing.apiData.found && !existing.apiData.isbn) {
                    const sim = V.similarityRatio(rec.titulo, existing.apiData.title);
                    if (sim > bestSim) { bestSim = sim; bestMatch = existing; }
                }
            });
            if (bestMatch && bestSim >= V.STRONG_SIMILARITY) {
                const filled = V.mergeFieldsIntoRecord(bestMatch, sourceFields);
                V.logAudit('fusion', `Archivo: "${rec.titulo}" se unificó con el registro existente "${bestMatch.apiData.title}" (${Math.round(bestSim * 100)}% de coincidencia de título) — se evitó un duplicado. Completó: ${filled.length ? filled.join(', ') : 'nada nuevo'}.`);
                return bestMatch;
            }
            // Zona gris (30%-60%): no fusiona sola, pero se documenta como alerta explícita
            // en vez de crear un registro nuevo en silencio.
            if (bestMatch && bestSim >= V.MIN_ACCEPTABLE_SIMILARITY && bestSim < V.STRONG_SIMILARITY) {
                V.logAudit('pendiente', `Posible duplicado, revisar a mano: Archivo "${rec.titulo}" se parece ${Math.round(bestSim * 100)}% a "${bestMatch.apiData.title}" (ya existente en la tabla) — no es suficiente para unificarlo automáticamente.`);
            }
        }

        const found = !!rec.titulo;
        const apiData = found ? {
            found: true,
            title: rec.titulo,
            authors: sourceFields.authors,
            publisher: sourceFields.publisher,
            publishYear: sourceFields.publishYear,
            isbn: sourceFields.isbn,
            source: 'Archivo importado',
            similarity: 1,
            confidence: 'valid',
            coverUrl: null
        } : { found: false, networkError: false };

        const newRecord = V.insertNewRecord({
            originalTitle: rec.titulo || `ISBN sin título: ${rec.isbn}`,
            apiData,
            status: found ? 'valid' : 'notfound',
            rowEl: null,
            searchIndex: '',
            origin: 'importacion'
        });
        V.logAudit('completado', `Archivo: "${rec.titulo || rec.isbn}" agregado como registro nuevo (Motor 3).`);
        return newRecord;
    }

    // ============================================================
    // Smart Fetching — solo para registros que, TRAS consolidar los archivos,
    // sigan con campos vacíos. Ningún ISBN ya completo vuelve a tocar la red.
    // ============================================================
    async function smartFetchMissingFields(touchedRecords) {
        const withGaps = touchedRecords.filter(r => r.apiData && r.apiData.found &&
            (!r.apiData.authors || !r.apiData.publisher || !r.apiData.isbn || !r.apiData.publishYear));
        if (withGaps.length === 0) return;

        V.setProcessingUI(true, `Consolidación completa. Buscando en las 3 fuentes solo lo que sigue faltando (${withGaps.length} registro(s))...`);
        const signal = V.createAbortController().signal;
        try {
            await V.processBatch(withGaps, signal, async (record, sig) => {
                await V.fillMissingFields(record, sig);
                const stillMissing = ['authors', 'publisher', 'isbn', 'publishYear'].filter(f => !record.apiData[f]);
                if (stillMissing.length > 0) {
                    V.logAudit('pendiente', `"${record.apiData.title}": tras consolidar los archivos, no fue posible verificar ${stillMissing.map(f => V.FIELD_LABELS[f]).join(', ')} en ninguna de las 3 fuentes.`);
                }
                V.indexRecord(record);
                V.renderRow(record);
            });
        } finally {
            V.setProcessingUI(false);
        }
    }

    // ============================================================
    // Orquestación completa del botón "Confirmar mapeo y consolidar"
    // ============================================================
    async function runImportPipeline() {
        const confirmBtn = document.getElementById('importConfirmBtn');
        confirmBtn.disabled = true;
        const originalLabel = confirmBtn.textContent;
        confirmBtn.textContent = 'Consolidando...';

        try {
            const allRowsWithSource = [];
            pendingFiles.forEach(fileEntry => {
                if (!fileEntry.mapping.some(Boolean)) {
                    V.logAudit('pendiente', `Archivo "${fileEntry.name}": ninguna columna quedó mapeada — se omitió por completo.`);
                    return;
                }
                extractRows(fileEntry).forEach(rec => allRowsWithSource.push({ rec, fileName: fileEntry.name }));
            });

            if (allRowsWithSource.length === 0) {
                V.showToast('No se extrajo ninguna fila válida — revisa el mapeo de columnas.', 'error');
                return;
            }

            const totalBefore = V.getRecords().length;
            const consolidated = consolidateRows(allRowsWithSource);
            if (totalBefore + consolidated.length > V.MAX_TITLES) {
                V.showToast(`Atención: vas a superar el límite recomendado de ${V.MAX_TITLES} registros totales.`, 'info');
            }

            const touched = consolidated.map(rec => integrateConsolidatedRow(rec));
            V.updateStats();
            V.applyFilters();
            V.showToast(`Consolidación completa: ${consolidated.length} registro(s) único(s) de ${pendingFiles.length} archivo(s).`, 'success');

            await smartFetchMissingFields(touched);
            V.logFinalAuditSummary('Motor 3 (Archivos)');
            V.updateStats();
            V.applyFilters();

            pendingFiles = [];
            document.getElementById('importMappingPanel').innerHTML = '';
            document.getElementById('importMappingPanel').classList.add('hidden');
            confirmBtn.classList.add('hidden');
            document.getElementById('importFileInput').value = '';
        } catch (err) {
            console.error(err);
            V.showToast('Ocurrió un error durante la consolidación de archivos.', 'error');
        } finally {
            confirmBtn.disabled = false;
            confirmBtn.textContent = originalLabel;
        }
    }

    // ============================================================
    // Eventos de interfaz (dropzone + selector de archivos)
    // ============================================================
    const dropzone = document.getElementById('importDropzone');
    const fileInput = document.getElementById('importFileInput');
    const confirmBtn = document.getElementById('importConfirmBtn');

    dropzone.addEventListener('click', () => fileInput.click());

    dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('border-purple-500', 'bg-purple-50');
    });
    dropzone.addEventListener('dragleave', () => {
        dropzone.classList.remove('border-purple-500', 'bg-purple-50');
    });
    dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('border-purple-500', 'bg-purple-50');
        if (V.isProcessing) {
            V.showToast('Espera a que termine el proceso actual antes de cargar archivos.', 'error');
            return;
        }
        handleFiles(e.dataTransfer.files);
    });

    fileInput.addEventListener('change', () => {
        if (V.isProcessing) {
            V.showToast('Espera a que termine el proceso actual antes de cargar archivos.', 'error');
            return;
        }
        if (fileInput.files.length > 0) handleFiles(fileInput.files);
    });

    confirmBtn.addEventListener('click', () => {
        if (V.isProcessing) return;
        runImportPipeline();
    });

})();
