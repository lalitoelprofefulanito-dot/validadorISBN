/**
 * MOTOR 5 — Clasificación SEP automática vía Catálogo Histórico de Libros del Rincón
 * ============================================================
 * Módulo independiente (misma arquitectura que importacion.js). Depende de:
 *   - window.Validador → API pública expuesta por index.html
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
        console.error('catalogo_historico.js requiere que index.html se cargue primero (window.Validador no está disponible).');
        return;
    }
    const V = window.Validador;

    // La URL ya no está cableada aquí: la lee del panel de configuración (con la de
    // Molino de Rosas como predeterminada), para que otra escuela pueda apuntar a su
    // propio catálogo sin editar este archivo.
    const TIEMPO_LIMITE_MS = 15000;

    const GRADO_OPTIONS = ['1°', '2°', '3°', '4°', '5°', '6°'];
    const GENERO_OPTIONS = ['Informativo', 'Literario'];

    // Umbral más estricto que los de la app (0.38 / 0.62): aquí una coincidencia
    // equivocada no solo trae un dato de más, decide Grado/Serie/Categoría, que
    // alimentan directamente el inventario oficial exportado.
    const AUTO_APPLY_THRESHOLD = 0.85;
    const SUGGEST_THRESHOLD = 0.65; // por debajo de esto, ni se registra como sugerencia
    // Margen de ambigüedad: si el segundo mejor candidato queda a menos de esto del
    // primero Y clasifica distinto, no se aplica nada. Medido contra el catálogo real:
    // ~2.7% de los títulos tienen un vecino por encima de 0.85 ("El clima" 2° vs "Clima"
    // 4°, "El agua" 1° vs "Agua" 3°), y elegir al azar entre ellos metería el grado
    // equivocado en la plantilla oficial. Ante la duda, no se decide sola: se documenta.
    const AMBIGUITY_MARGIN = 0.10;

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
                const resp = await fetch(V.getCatalogoUrl(), { signal: controlador.signal, cache: 'default' });
                if (!resp.ok) throw new Error(`El servidor respondió con estado ${resp.status}`);
                const data = await resp.json();
                if (!Array.isArray(data)) throw new Error('El JSON del catálogo histórico no tiene el formato esperado.');

                // Se normaliza UNA sola vez por entrada y se guarda junto a ella (_norm,
                // _tokens). Antes, el fallback difuso normalizaba cada uno de los ~3,200
                // títulos del catálogo en CADA comparación, y similarityRatio volvía a
                // normalizar ambos por dentro: para 700 registros eran millones de
                // normalizaciones repetidas y el navegador se quedaba congelado. El
                // `await` que cede el hilo cada 40 registros no ayudaba, porque el bloqueo
                // ocurría dentro del procesamiento de un solo registro.
                catalogEntries = data.filter((e) => e && e['Título']);
                exactIndex = new Map();
                catalogEntries.forEach((entry) => {
                    const key = V.normalizeText(entry['Título']);
                    entry._norm = key;
                    entry._tokens = key ? new Set(key.split(' ').filter(Boolean)) : new Set();
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

    function findBestMatch(title) {
        const norm = V.normalizeText(title);
        if (!norm) return null;

        // Coincidencia exacta primero: la mayoría de los títulos bien capturados caen aquí.
        // OJO: el catálogo tiene 198 títulos repetidos en varias generaciones, y 187 de
        // ellos clasifican DISTINTO entre una y otra ("La selva" es 1° en un ciclo y 4° en
        // otro, con serie y categoría distintas). No es un error del catálogo: la SEP
        // reasignó esos títulos. Pero significa que "coincidencia exacta" no equivale a
        // "clasificación inequívoca", así que el competidor se arrastra igual que en el
        // camino difuso, para que la guarda de ambigüedad pueda frenarlo.
        const exact = exactIndex.get(norm);
        if (exact && exact.length > 0) {
            const ordenadas = ordenarPorCicloReciente(exact);
            return { entry: ordenadas[0], similarity: 1, second: ordenadas[1] || null, secondSimilarity: ordenadas[1] ? 1 : 0 };
        }

        // Fallback difuso. Dos filtros baratos antes de pagar el cálculo caro:
        //   1) longitud parecida (como antes, pero sin renormalizar);
        //   2) al menos una palabra en común — si no comparten ni una, la similitud no va
        //      a alcanzar el umbral mínimo y comparar carácter por carácter es tiempo tirado.
        // Lo que queda se compara con similarityFromNormalized, que recibe los textos ya
        // normalizados y se salta ese trabajo repetido.
        const queryTokens = new Set(norm.split(' ').filter(Boolean));
        let best = null, bestSim = 0;      // mejor candidato
        let second = null, secondSim = 0;  // segundo mejor, para medir ambigüedad
        const normLen = norm.length;
        for (const entry of catalogEntries) {
            const entryNorm = entry._norm;
            if (!entryNorm) continue;
            if (Math.abs(entryNorm.length - normLen) > Math.max(6, normLen * 0.35)) continue;

            let comparteAlgo = false;
            for (const t of entry._tokens) {
                if (queryTokens.has(t)) { comparteAlgo = true; break; }
            }
            if (!comparteAlgo) continue;

            const sim = V.similarityFromNormalized(norm, entryNorm);
            if (sim > bestSim) {
                second = best; secondSim = bestSim;
                best = entry; bestSim = sim;
            } else if (sim > secondSim) {
                second = entry; secondSim = sim;
            }
        }
        return best ? { entry: best, similarity: bestSim, second, secondSimilarity: secondSim } : null;
    }

    // Cuando el mismo título aparece en varias generaciones, se ordenan por Ciclo_Escolar
    // descendente: la más reciente es la que con más probabilidad refleja la clasificación
    // vigente. Antes esta función ELEGÍA una y descartaba el resto en silencio; ahora solo
    // ordena, y quien decide si esa preferencia basta es la guarda de ambigüedad.
    function ordenarPorCicloReciente(entries) {
        return entries.slice().sort((a, b) =>
            String(b.Ciclo_Escolar || '').localeCompare(String(a.Ciclo_Escolar || ''))
        );
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

    // ¿Hay otra entrada del catálogo casi igual de parecida que clasifica DISTINTO?
    // Si la hay, ninguna de las dos puede aplicarse sola: el catálogo tiene títulos
    // casi idénticos con grados distintos ("El clima" 2° vs "Clima" 4°), y elegir por
    // centésimas de similitud metería el grado equivocado en el inventario oficial.
    function esAmbiguo(match) {
        if (!match.second) return false;
        if (match.similarity - match.secondSimilarity > AMBIGUITY_MARGIN) return false;
        const a = buildCandidateFields(match.entry);
        const b = buildCandidateFields(match.second);
        return ['grado', 'generoSEP', 'categoriaSEP', 'serie'].some(f => (a[f] || '') !== (b[f] || ''));
    }

    // ============================================================
    // Fuente primaria — se consulta ANTES que las APIs web
    // ============================================================
    // QUÉ APORTA Y QUÉ NO, y por qué.
    //
    // Aporta: la CERTEZA de que el título pertenece al acervo Rincón, su RESEÑA oficial y
    // su CLASIFICACIÓN SEP. Ninguna API web puede saber esas tres cosas.
    //
    // NO aporta autor, editorial, año ni ISBN, aunque el catálogo los tenga. El motivo está
    // medido, no supuesto: en el JSON actual el bloque de datos de edición está CORRIDO
    // respecto a la columna de títulos, con un desfase variable de 1 a 2 filas. Verificado
    // contra ISBNdb sobre una muestra de 30 fichas, 20 de los 26 ISBN resolubles devolvían
    // un libro distinto, y el título correcto aparecía en una fila vecina: el ISBN de la
    // fila "Las semillas de calabaza" es en realidad el de "Stelaluna", que está una fila
    // arriba. Adoptar esos campos metería datos equivocados al inventario oficial.
    // Título, Reseña, Grado, Género, Categoría y Serie SÍ están alineados entre sí, y son
    // los únicos campos que este módulo entrega.
    //
    // Si el catálogo se corrige en el origen, basta devolver aquí también los campos
    // bibliográficos: el núcleo ya está preparado para recibirlos.
    const PRIMARIA_THRESHOLD = 0.90; // afirmar "esto es del acervo Rincón" exige coincidencia alta

    async function fuentePrimaria(title) {
        // Si el catálogo aún no terminó de descargarse, se espera: vale más un segundo de
        // espera que resolver el libro sin saber si pertenece al acervo.
        if (!catalogEntries.length) {
            try { await loadCatalog(); } catch (e) { return null; }
        }
        if (!catalogEntries.length) return null;

        const match = findBestMatch(title);
        if (!match || match.similarity < PRIMARIA_THRESHOLD) return null;

        V.logAudit('completado', `"${title}": localizado en el catálogo oficial SEP (ciclo ${match.entry.Ciclo_Escolar || 'sin dato'}, coincidencia ${Math.round(match.similarity * 100)}%). De ahí se toman su reseña y su clasificación oficiales.`);

        return {
            title: match.entry['Título'],
            synopsis: match.entry['Reseña'] || null,
            similarity: match.similarity,
            // La clasificación viaja salvo que dos fichas en competencia se contradigan
            // (la misma guarda de ambigüedad que usa el botón del Motor 5).
            clasificacion: esAmbiguo(match) ? null : buildCandidateFields(match.entry)
        };
    }

    V.registerPrimarySource(fuentePrimaria);

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

        let applied = 0, suggested = 0, ambiguos = 0;
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
                if (esAmbiguo(match)) {
                    ambiguos++;
                    V.logAudit('pendiente', `"${title}": el catálogo histórico tiene DOS entradas casi igual de parecidas que clasifican distinto — "${match.entry['Título']}" (${match.entry.Grado || 'sin grado'}, ${match.entry['Categoría'] || 'sin categoría'}) y "${match.second['Título']}" (${match.second.Grado || 'sin grado'}, ${match.second['Categoría'] || 'sin categoría'}). No se aplicó ninguna: elige tú cuál corresponde en las columnas del Motor 4.`);
                    continue;
                }
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
        // Sin esto, toda la clasificación aplicada por este motor se perdía al recargar la
        // pestaña: era el único motor que modificaba registros sin pasar nunca por
        // processBatch, que es quien venía disparando el autoguardado.
        if (applied > 0) V.saveSessionToStorage();
        V.showToast(
            `Catálogo histórico: ${applied} registro(s) clasificado(s) automáticamente, ${suggested} sugerencia(s) para revisar a mano` +
            (ambiguos > 0 ? `, ${ambiguos} caso(s) ambiguo(s) sin decidir (revisa la Bitácora).` : '.'),
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
