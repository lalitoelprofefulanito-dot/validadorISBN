/**
 * MOTOR 5 — Clasificación SEP automática vía Catálogo Histórico de Libros del Rincón
 * ============================================================
 * Módulo independiente (misma arquitectura que importacion.js). Depende de:
 *   - window.Validador → API pública expuesta por validador_de_titulos.html
 *   - fetch a un JSON público en GitHub (Catálogo Histórico Consolidado, ~3200
 *     títulos con su Grado/Serie/Género/Categoría oficial SEP)
 *
 * Flujo: Carga en segundo plano (una sola vez) el catálogo histórico → construye
 *        un índice de búsqueda por título normalizado → al pulsar el botón,
 *        recorre los registros YA VALIDADOS o PARA REVISAR en la tabla y, cuando
 *        encuentra una coincidencia de título con confianza suficiente, rellena
 *        SOLO los campos de clasificación SEP que sigan vacíos (Procedencia,
 *        Grado, Género SEP, Categoría SEP, Serie) usando mergeManualFields —
 *        la misma función que ya usa el Motor 3, así que nunca pisa una
 *        clasificación que el maestro ya haya puesto a mano.
 *
 * Sobre el vocabulario controlado:
 *   - Procedencia siempre se propone como "Rincón": todo lo que aparece en este
 *     catálogo histórico es, por definición, un Libro del Rincón oficial.
 *   - Grado y Género SEP se validan contra las mismas listas fijas que usa el
 *     resto de la app (GRADO_OPTIONS / GENERO_OPTIONS): un valor del catálogo
 *     histórico que no calce con esas listas simplemente no se propone.
 *   - Categoría SEP y Serie NO se validan aquí contra la plantilla en vivo
 *     (classifierDataCache no está expuesto en window.Validador, igual que le
 *     pasa a importacion.js) — se aplican tal cual y quedan visibles en los
 *     <select> del Motor 4 para que el maestro las confirme con un vistazo.
 */
(function () {
    'use strict';

    if (!window.Validador) {
        console.error('catalogo_historico.js requiere que validador_de_titulos.html se cargue primero (window.Validador no está disponible).');
        return;
    }
    const V = window.Validador;

    const CATALOGO_URL = 'https://raw.githubusercontent.com/lalitoelprofefulanito-dot/catalogo-rincon/refs/heads/main/catalogo.json';
    const TIEMPO_LIMITE_MS = 15000;

    const GRADO_OPTIONS = ['1°', '2°', '3°', '4°', '5°', '6°'];
    const GENERO_OPTIONS = ['Informativo', 'Literario'];

    // Umbral más estricto que los de la app (0.30 / 0.60): aquí una coincidencia
    // equivocada no solo trae un dato de más, decide Grado/Serie/Categoría, que
    // alimentan directamente el inventario oficial exportado.
    const AUTO_APPLY_THRESHOLD = 0.85;
    const SUGGEST_THRESHOLD = 0.65; // por debajo de esto, ni se registra como sugerencia

    let catalogEntries = null;   // arreglo completo, tal cual llega el JSON
    let exactIndex = null;       // Map<tituloNormalizado, entry[]>
    let loadPromise = null;

    // ============================================================
    // Carga del catálogo histórico (una sola vez, en segundo plano)
    // ============================================================
    function loadCatalog() {
        if (loadPromise) return loadPromise;
        loadPromise = (async () => {
            const controlador = new AbortController();
            const temporizador = setTimeout(() => controlador.abort(), TIEMPO_LIMITE_MS);
            try {
                const resp = await fetch(CATALOGO_URL, { signal: controlador.signal, cache: 'default' });
                if (!resp.ok) throw new Error(`El servidor respondió con estado ${resp.status}`);
                const data = await resp.json();
                if (!Array.isArray(data)) throw new Error('El JSON del catálogo histórico no tiene el formato esperado.');

                catalogEntries = data.filter((e) => e && e['Título']);
                exactIndex = new Map();
                catalogEntries.forEach((entry) => {
                    const key = V.normalizeText(entry['Título']);
                    if (!key) return;
                    if (!exactIndex.has(key)) exactIndex.set(key, []);
                    exactIndex.get(key).push(entry);
                });

                setStatus(`Catálogo histórico listo (${catalogEntries.length} títulos).`);
                setButtonEnabled(true);
            } catch (err) {
                console.error('No se pudo cargar el catálogo histórico:', err);
                setStatus('No se pudo cargar el catálogo histórico (revisa tu conexión). Pulsa el botón para reintentar.', true);
                setButtonEnabled(true); // el clic vuelve a intentar loadCatalog()
                loadPromise = null;
            } finally {
                clearTimeout(temporizador);
            }
        })();
        return loadPromise;
    }

    // ============================================================
    // Búsqueda de la mejor coincidencia para un título dado
    // ============================================================
    function findBestMatch(title) {
        const norm = V.normalizeText(title);
        if (!norm) return null;

        // Coincidencia exacta primero: la mayoría de los títulos bien capturados caen aquí.
        const exact = exactIndex.get(norm);
        if (exact && exact.length > 0) {
            return { entry: pickAmongDuplicates(exact), similarity: 1 };
        }

        // Fallback difuso, acotado por longitud para no comparar contra los ~3200 registros completos.
        let best = null, bestSim = 0;
        const normLen = norm.length;
        for (const entry of catalogEntries) {
            const entryNorm = V.normalizeText(entry['Título']);
            if (Math.abs(entryNorm.length - normLen) > Math.max(6, normLen * 0.35)) continue;
            const sim = V.similarityRatio(title, entry['Título']);
            if (sim > bestSim) { bestSim = sim; best = entry; }
        }
        return best ? { entry: best, similarity: bestSim } : null;
    }

    // Cuando el mismo título aparece en varias generaciones del catálogo, se prefiere
    // la entrada más reciente (Ciclo_Escolar más alto): es la que con más probabilidad
    // refleja la clasificación vigente si en algún momento cambió de serie o categoría.
    function pickAmongDuplicates(entries) {
        return entries.slice().sort((a, b) =>
            String(b.Ciclo_Escolar || '').localeCompare(String(a.Ciclo_Escolar || ''))
        )[0];
    }

    // ============================================================
    // Construcción de manualFields candidatos a partir de una entrada del catálogo
    // ============================================================
    function buildCandidateFields(entry) {
        const candidate = { procedencia: 'Rincón' };
        if (entry.Grado && GRADO_OPTIONS.includes(entry.Grado)) candidate.grado = entry.Grado;
        if (entry['Género'] && GENERO_OPTIONS.includes(entry['Género'])) candidate.generoSEP = entry['Género'];
        if (entry['Categoría']) candidate.categoriaSEP = entry['Categoría'];
        if (entry.Serie_Lectora) candidate.serie = entry.Serie_Lectora;
        return candidate;
    }

    // ============================================================
    // Orquestación del botón — recorre los registros ya validados/para revisar
    // ============================================================
    async function runMatchPipeline() {
        const btn = document.getElementById('catalogoHistoricoBtn');
        const originalLabel = btn.textContent;
        btn.disabled = true;

        await loadCatalog();
        if (!catalogEntries) {
            btn.disabled = false;
            btn.textContent = originalLabel;
            return;
        }

        const records = V.getRecords().filter((r) => r.status === 'valid' || r.status === 'review');
        if (records.length === 0) {
            V.showToast('No hay registros validados en la tabla todavía.', 'info');
            btn.disabled = false;
            btn.textContent = originalLabel;
            return;
        }

        let applied = 0, suggested = 0;
        for (let i = 0; i < records.length; i++) {
            const record = records[i];
            if (i % 40 === 0) {
                btn.textContent = `Buscando... (${i}/${records.length})`;
                await new Promise((r) => setTimeout(r, 0)); // cede el hilo para no congelar la interfaz
            }

            const title = (record.apiData && record.apiData.title) || record.originalTitle;
            if (!title) continue;

            const match = findBestMatch(title);
            if (!match || match.similarity < SUGGEST_THRESHOLD) continue;

            if (match.similarity >= AUTO_APPLY_THRESHOLD) {
                const candidate = buildCandidateFields(match.entry);
                const filled = V.mergeManualFields(record, candidate);
                if (filled.length > 0) {
                    applied++;
                    V.logAudit('completado', `"${title}": clasificación SEP autocompletada desde el catálogo histórico (${match.entry.Ciclo_Escolar}, coincidencia ${Math.round(match.similarity * 100)}%). Campos: ${filled.join(', ')}.`);
                }
            } else {
                suggested++;
                V.logAudit('pendiente', `"${title}": posible coincidencia en el catálogo histórico ("${match.entry['Título']}", ${match.entry.Ciclo_Escolar}, ${Math.round(match.similarity * 100)}%) — similitud insuficiente para aplicarla sola. Revísala a mano si corresponde.`);
            }
        }

        V.updateStats();
        V.applyFilters();
        V.showToast(
            `Catálogo histórico: ${applied} registro(s) clasificado(s) automáticamente, ${suggested} sugerencia(s) para revisar a mano.`,
            applied > 0 ? 'success' : 'info'
        );

        btn.disabled = false;
        btn.textContent = originalLabel;
    }

    // ============================================================
    // UI: estado del botón mientras carga el catálogo en segundo plano
    // ============================================================
    function setStatus(text, isError) {
        const el = document.getElementById('catalogoHistoricoStatus');
        if (!el) return;
        el.textContent = text;
        el.classList.toggle('text-rose-600', !!isError);
        el.classList.toggle('text-slate-500', !isError);
    }

    function setButtonEnabled(enabled) {
        const btn = document.getElementById('catalogoHistoricoBtn');
        if (btn) btn.disabled = !enabled;
    }

    // ============================================================
    // Eventos y arranque
    // ============================================================
    document.getElementById('catalogoHistoricoBtn').addEventListener('click', () => {
        if (V.isProcessing) {
            V.showToast('Espera a que termine el proceso actual antes de usar el catálogo histórico.', 'error');
            return;
        }
        runMatchPipeline();
    });

    // Empieza a descargar el catálogo apenas carga la página, para que ya esté
    // listo (o el botón habilitado para reintentar) cuando el maestro llegue a usarlo.
    loadCatalog();

})();
