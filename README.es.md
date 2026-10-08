# proto-handoff

**De prototipo HTML a archivo de diseño editable en Figma, y siempre al día.**

[![Licencia: MIT](https://img.shields.io/badge/licencia-MIT-blue.svg)](LICENSE)
[![Versión](https://img.shields.io/badge/versi%C3%B3n-0.1.0-informational.svg)](CHANGELOG.md)
[![Agent Skill](https://img.shields.io/badge/Agent%20Skill-SKILL.md-8A2BE2.svg)](https://agentskills.io/specification)

[English](README.md)

proto-handoff es una [Agent Skill](https://agentskills.io) que toma un prototipo HTML de un solo
archivo (de [Open Design](https://github.com/nexu-io/open-design) o de cualquier builder de IA) y
lo reconstruye en Figma como diseño de verdad, no como capturas:

- **Variables** con modo claro y oscuro, cada una ligada a su variable CSS.
- **Componentes para todo lo que se repite**, contenedores incluidos (barra lateral, encabezado,
  paneles), con variantes, propiedades y slots para las filas de las tablas y el contenido de los
  contenedores.
- **Íconos como componentes**, **pantallas hechas de instancias** y **prototipo navegable**.
- **Páginas de documentación**: portada, foundations, componentes por categoría, pantallas por app
  y **mapa de flujos**.
- **Una auditoría propia** que mide cada pantalla contra el navegador y avisa cuando algo falla.
- **Actualizaciones seguras**: cuando cambia el prototipo, muestra qué va a cambiar, detecta lo que
  se editó a mano en Figma, pregunta antes de sobrescribirlo, hace un respaldo y toca solo lo que
  cambió.

> Proyecto independiente. No está afiliado, respaldado ni patrocinado por Figma, Inc. ni por Open Design.

## Requisitos

| Requisito | Para qué | Si falta |
|---|---|---|
| Una herramienta de IA que ejecute código y lea y escriba archivos | La skill maneja scripts de Node | **No funciona** |
| Node.js 18 o superior | Captura, migración, sincronización y auditoría | **No funciona** |
| Google Chrome o Chromium | Dibuja cada pantalla para capturarla y medirla | **No funciona** |
| El servidor MCP de Figma con `use_figma` y `generate_figma_design` | Escribir en el archivo y capturar pantallas | **Modo solo análisis**: tokens, inventario de componentes, migración, capturas de referencia y reportes de cambios, sin escribir nada en Figma |
| Un **puesto Full** de Figma con permiso de edición en el archivo | Figma lo exige para `use_figma` | Modo solo análisis |
| Acceso a internet hacia Figma | Las capturas cargan el script de captura de Figma | Modo solo análisis |
| Ventana de contexto amplia | Prototipos grandes (80 pantallas o más) | Funciona, en lotes más pequeños |

La skill revisa todo esto antes de empezar (`node scripts/doctor.mjs`) y te dice en qué modo puede
trabajar. Nunca falla en silencio ni deja el trabajo a medias.

> Las herramientas de Figma para escribir en el lienzo son gratis durante su beta; Figma anunció que
> pasarán a cobrarse por uso, y las de lectura tienen límites según el plan. Revisa
> [los accesos y límites del MCP de Figma](https://developers.figma.com/docs/figma-mcp-server/rate-limits-access/).

## Herramientas de IA compatibles

| Herramienta | Carga skills | `use_figma` | `generate_figma_design` | Modo esperado |
|---|---|---|---|---|
| Claude Code | sí | sí | sí | Completo (probado) |
| OpenAI Codex | sí | sí | sí | Completo (sin probar aún) |
| Cursor | sí | sí | sí | Completo (sin probar aún) |
| VS Code con GitHub Copilot | sí | sí | sí | Completo (sin probar aún) |
| GitHub Copilot CLI | sí | sí | no | Solo variables + análisis |
| Gemini CLI | sí | no está en el catálogo de Figma | no está en el catálogo de Figma | Solo análisis |
| Claude Desktop / claude.ai | sí | sí | no | No compatible (no ejecuta Node local) |

Datos a septiembre de 2026, según el [catálogo MCP de Figma](https://www.figma.com/mcp-catalog/).
Si la usas en otra herramienta, [cuéntanos cómo te fue](https://github.com/juanvelasco1/proto-handoff/issues).

## Instalación

**Claude Code** (como plugin):

```sh
claude plugin marketplace add juanvelasco1/proto-handoff
claude plugin install proto-handoff@proto-handoff
```

**Cualquier herramienta** (con el [CLI de skills](https://skills.sh)):

```sh
npx skills add juanvelasco1/proto-handoff
```

**A mano**: copia `skills/proto-handoff` en la carpeta de skills de tu herramienta
(`~/.claude/skills/` en Claude Code; `~/.agents/skills/` en Codex, Cursor, Gemini CLI y VS Code).

Después, una sola vez:

```sh
cd <carpeta de skills>/proto-handoff/scripts
npm install          # tu agente puede hacerlo por ti
node setup.mjs       # opcional: crea tu configuración
node doctor.mjs      # revisa que todo esté listo
```

También necesitas el [servidor MCP de Figma](https://developers.figma.com/docs/figma-mcp-server/)
conectado en tu herramienta de IA.

## Uso

Pídeselo a tu agente, en el idioma que quieras:

> Pasa `./mi-prototipo.html` a Figma: https://www.figma.com/design/…

> Cambió el prototipo (`./mi-prototipo-v2.html`). Actualiza el archivo de Figma.

Para prototipos nuevos, genéralos listos para Figma con la skill complementaria de
[`open-design/proto-handoff-prototype`](open-design/proto-handoff-prototype/). Los que ya existen se
migran sin reescribirlos.

## Configuración

Tu configuración vive en **un solo archivo fuera de la skill**: `~/.proto-handoff/config.jsonc` (lo
crea `node scripts/setup.mjs`; cada campo está explicado en
[`config.example.jsonc`](skills/proto-handoff/config.example.jsonc)). Actualizar la skill nunca lo
sobrescribe. Todo es opcional; un valor inválido detiene la skill con un mensaje claro.

| Puedes configurar | Fijo a propósito (para que un ajuste no rompa la skill) |
|---|---|
| Idioma de la conversación y del texto que se escribe en Figma (`en` / `es`) | El contrato `data-ui` y las etiquetas de captura |
| Dónde viven las carpetas de trabajo y el puerto del servidor | El orden de los scripts |
| Tamaño de pantalla (escritorio, tableta, teléfono) | La idempotencia y el ciclo de auditoría |
| Nombres de las páginas | El esquema de `state.json` |
| Qué generar: portada, foundations, mapa de flujos, pantallas oscuras, enlaces del prototipo | Los nombres de modo Light/Dark y de los slots |
| Colores de las páginas de documentación | |
| Qué tan estricta es la auditoría | |
| Ruta de Chrome y si se usan subagentes | |

Sin tokens ni contraseñas: la skill llega a Figma solo a través de la conexión con Figma de tu
herramienta de IA.

## Actualizar el archivo cuando cambia el prototipo

1. **Revisar**: un reporte legible de pantallas nuevas, modificadas, eliminadas y sin cambios,
   tokens y componentes. No se escribe nada en Figma.
2. **Revisar ediciones a mano**: compara el archivo con una huella tomada después de la última
   actualización y lista lo que se editó en Figma desde entonces, marcando lo que la actualización
   sobrescribiría. Tú decides cada caso.
3. **Aplicar**, solo después de que confirmes, tocando únicamente lo que cambió.
4. **Auditoría como filtro**: si la auditoría falla, la actualización no se da por buena. Antes se
   hace un respaldo local.
5. **Deshacer**: `update.mjs rollback` restaura el estado local; el historial de versiones de Figma
   deshace los cambios en el archivo.

## Privacidad y datos

- **Qué sale de tu computador**: las pantallas del prototipo ya dibujadas (textos, imágenes,
  estilos) se suben a Figma por su servicio de captura, dentro de tu archivo. Los scripts que editan
  el archivo corren dentro de Figma a través de la conexión de tu herramienta de IA. El proveedor de
  tu herramienta de IA procesa lo que el agente lee, según sus propios términos.
- **Qué nunca sale**: nada se envía al autor de esta skill. Sin telemetría, sin analítica, sin
  rastreo.
- **Qué queda en tu computador**: `~/.proto-handoff/` (la configuración y, por proyecto, una copia del
  prototipo, capturas, mapas, la clave del archivo de Figma y los respaldos). Borra esa carpeta para
  eliminarlo todo. No guardes las carpetas de trabajo dentro de un repositorio git.
- **El servidor local** solo escucha en `127.0.0.1` y solo entrega archivos web (nunca `state.json`
  ni registros).
- No pongas datos personales reales ni confidenciales en los prototipos que vas a capturar: usa
  datos de ejemplo.

## Seguridad

Reporta las vulnerabilidades en privado; mira [SECURITY.md](SECURITY.md).

## Qué NO hace

- No diseña desde cero ni cambia el estilo de tu prototipo: el archivo refleja lo que el prototipo
  dibuja.
- No trabaja directamente con apps de varios archivos ni frameworks: recibe un HTML autocontenido.
- No captura estados hover ni focus.
- No reemplaza el criterio del diseñador: los conflictos entre ediciones a mano y el prototipo los
  decides tú.
- No deshace cambios en Figma: para eso está el historial de versiones de Figma.
- Las pantallas móviles las soporta el contrato, pero se han probado menos que las de escritorio.

## Contribuir

Los issues y pull requests son bienvenidos; lee [CONTRIBUTING.md](CONTRIBUTING.md) y el
[Código de conducta](CODE_OF_CONDUCT.md). Nunca adjuntes prototipos reales de clientes, archivos
`state.json` ni enlaces a archivos privados de Figma.

## Licencia

[MIT](LICENSE) © 2026 juanvelasco1.

Figma es una marca registrada de Figma, Inc. Open Design es un proyecto de sus respectivos autores.
Se mencionan aquí solo para describir la compatibilidad.
