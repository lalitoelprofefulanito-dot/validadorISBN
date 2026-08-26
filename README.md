# Biblioteca Viva V3 — Validación correcta de ISBN

Esta versión separa cuatro niveles:

1. Sintaxis del ISBN.
2. Dígito de control.
3. Existencia bibliográfica.
4. Correspondencia con la edición del registro.

## Dictámenes

- ISBN INVÁLIDO
- ISBN VÁLIDO MATEMÁTICAMENTE — NO LOCALIZADO EN LAS FUENTES CONSULTADAS
- ISBN EXISTENTE — EDICIÓN NO CONCLUYENTE
- ISBN VERIFICADO

## Reglas

Un ISBN solo entra en la columna `ISBN verificado` cuando:
- pasa la validación ISBN-10/ISBN-13;
- se localiza en Open Library y/o Google Books;
- y los datos disponibles son compatibles con la edición investigada (título y, cuando existen, autor, editorial y año).

Un ISBN que solo pasa el checksum NO se considera verificado.

## Fuentes técnicas

- International ISBN Agency: reglas y calculadora ISBN.
- Open Library Search / Work / Edition APIs.
- Google Books Volumes API.

## GitHub Pages

1. Crea un repositorio público, por ejemplo `biblioteca-viva-validador-isbn-v3`.
2. Sube `index.html` a la raíz.
3. Settings → Pages.
4. Deploy from a branch.
5. Branch `main`, folder `/ (root)`.
6. Save.
