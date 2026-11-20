# Netfix incrustado: restricciones, modo incrustado y corrección

Netfix puede funcionar dentro de otra página (por ejemplo, una aplicación de aula) con una topología de partida, una
política de restricciones y un aviso de cada cambio, y puede corregir un archivo de topología con una lista de
comprobación, en el navegador o en un servidor sin interfaz.

## Modo incrustado

```html
<div id="app" data-embed></div>
<script src="netfix.js"></script>  <!-- o el contenido de dist/netfix.html -->
<script>
  const practica = netfix.embed(document.getElementById('app'), {
    topology: archivoDeTopologia,          // opcional: sin él, área de trabajo vacía
    restrictions: { labs: [], docs: false },
    onChange: (archivo) => enviarAlServidor(archivo),
  });
  // practica.exportTopology()  → archivo de topología actual
  // practica.open(archivo, nombre) → lo abre como Importar… (pregunta si hay cambios sin guardar); true si lo abrió
  // practica.markSaved()       → la página ha guardado la red: deja de contar como cambios sin guardar
  // practica.showView('docs')  → muestra una página de Netfix: 'net', 'docs', 'settings' o 'about' (false si no puede)
  // practica.setLocale('en-GB') → cambia el idioma (la red se conserva)
  // practica.setConfirmUnsaved(false) → reemplazar trabajo sin guardar ya no pregunta
  // practica.file('new')       → Nuevo, Importar… ('import') o Exportar ('export') de la barra, para el menú Archivo de la página
  // practica.destroy()         → detiene el simulador y vacía el elemento
</script>
```

Con `data-embed` Netfix no arranca solo ni lee o escribe nada en el navegador (ni el autoguardado ni el idioma). Las
opciones se validan y una opción desconocida es un error. Un error dentro de `onChange` no afecta al simulador.

**Seguridad.** Las restricciones son de interfaz, no una frontera de seguridad: el alumno controla su navegador y puede
llamar de nuevo a `netfix.embed` sin ellas. Tampoco limitan las terminales (`sleep` avanza el reloj simulado; `man` y
`help` muestran la documentación). Por eso la nota solo vale si la calcula el servidor con el archivo recibido, la lista
de comprobación no debe llegar nunca al navegador del alumno y el archivo de `onChange` o `exportTopology()` es una
entrada no fiable que hay que volver a corregir. `detail` y `title` pueden contener texto del alumno: muéstralos con
`textContent`.

## Laboratorio libre en otra página

`netfix.lab(elemento)` monta el laboratorio completo, como la página propia de Netfix: ajustes, tema, autoguardado,
idioma y preferencias en el navegador (las mismas claves `netfix:*` del origen). No toca el título, `<html lang>` ni el
icono de la página; el tema sí necesita `<html data-theme>`, y `destroy()` lo deja como estaba, además de guardar el
trabajo y devolver el elemento vacío. No admite restricciones (para una práctica, `netfix.embed`); su única opción es
`toolbar`.

## Opciones de la página que aloja Netfix

`actions` (un elemento de la página, con `toolbar`) recibe deshacer/rehacer, el portapapeles y el zoom. Con la barra
en el menú de la página, la paleta es una barra lateral de equipos y herramientas, el reloj y el modo flotan arriba a la
derecha del área de trabajo, y la línea de ayuda es una nota sobre ella: la ayuda de cada herramienta se puede dejar
de mostrar («No volver a mostrar», o en Configuración) y los mensajes se ven unos segundos.

`netfix.lab` y `netfix.embed` admiten además `locale` (`'es-ES'` o `'en-GB'`: el idioma lo elige la página, y Netfix
no lo guarda) y `confirmUnsaved` (`true`/`false`: si reemplazar trabajo sin guardar pregunta antes; sin ella, la
preferencia de este navegador). Con `toolbar`, `palette: 'bottom'` deja la paleta debajo del área de trabajo, como en la
página de Netfix; sin ella (`'side'`), es la barra lateral, con el nombre de cada equipo a la derecha de su icono. `piles` (`true`/`false`)
apila los equipos parecidos en un botón (Router: IOS o GNU/Linux; PC: Windows, GNU/Linux o ambos); sin ella, la preferencia
de este navegador, desmarcada de serie.
Una extensión puede añadir opciones propias con `registerHostOption` (PUBLIC-API.md §3.3). Desde 0.71.0 la LAN de
clase (`classroomLan`) y el terminal de Codefix (`netfix.code`) no están en Netfix: son de Netfix Classroom.

## La barra en el menú de la página (`toolbar`)

`netfix.lab(elemento, { toolbar })` y `netfix.embed(elemento, { …, toolbar })` ponen la barra superior de Netfix (vistas,
Nuevo, Importar…, Exportar, laboratorios, reloj y modo) en `toolbar`, un elemento de la página (su menú
desplegable, por ejemplo), sin el logotipo ni el menú del móvil: la página muestra el nombre de Netfix y abre y cierra
su menú. La página es entonces la dueña del idioma, el tema, la Ayuda, Acerca de, la Configuración y la pregunta de
cambios sin guardar: la barra no tiene selector de idioma ni más vista que la red (las demás páginas se abren con
`showView`), Netfix no aplica su tema y su Configuración no muestra idioma, tema ni esa pregunta. Donaciones no se
ofrece. El área de trabajo ocupa entonces todo el elemento montado. `toolbar` no puede estar dentro de ese elemento
ni contenerlo; `destroy()` lo devuelve vacío y sin clases de Netfix. El logotipo está en `@glopezca/netfix/ui/logo.webp`.

## Restricciones

Todo lo que no se indica queda permitido.

| Campo | Valor | Efecto |
|---|---|---|
| `labs` | lista de ids (`basico`, `dns-reenvio`…) | Laboratorios que se pueden abrir (`[]`: ninguno). `blanco` ya no existe desde v0.22.1: es **Nuevo** (`fileNew`) |
| `devices` | `pc`, `server`, `switch`, `router`, `linuxrouter`, `cloud` | Equipos de la paleta |
| `tabs` | `{ tipo: [pestañas] }` | Pestañas de la ventana de cada tipo de equipo; la primera (Equipo, o ISP en la nube) se mantiene |
| `docs` | `true` / `false` | Vista Ayuda |
| `missionCheck` | `true` / `false` | Botón **Comprobar** del panel Misión (la nota de clase sigue siendo `evaluate` en el servidor) |
| `hints` | `true` / `false` | Botones de pistas del panel Misión (las ya vistas se siguen mostrando) |
| `solution` | `true` / `false` | Botón **Ver solución** del panel Misión |
| `fileNew`, `fileOpen`, `fileSave` | `true` / `false` | Botones Nuevo, Abrir y Guardar (y Ctrl+S) |
| `simulation` | `true` / `false` | Modo simulación |
| `clock` | `true` / `false` | Adelantar el reloj |
| `drawing` | `true` / `false` | Barra de dibujo |
| `editTopology` | `true` / `false` | Colocar, cablear y borrar equipos o cables |
| `timestampPrompt` | `"free"` / `"on"` / `"off"` | Casilla «Prompt con marca de fecha y hora» de las terminales: `"free"` (por defecto) la deja al alumno (ajuste general); `"on"`/`"off"` la fija marcada o desmarcada en todos los equipos y sesiones SSH, desactivada y con el aviso «bloqueado por el profesor» |

Pestañas: `host`, `ifaces`, `cli`, `web` (gestión web IOS o navegador del PC), `ip`, `svc`, `mail`, `ssh`, `sftp`,
`linux`, `windows`, `apps` (pestaña Configuración del equipo, v0.25), `isp`, `lines`.

## Corrección

`netfix.evaluate(archivo, lista)` en el navegador, o `evaluate(archivo, parseChecklist(lista))` de
`src/classroom/evaluate.ts` en un servidor. Devuelve `{ score, max, items: [{ id, weight, passed, detail }], mission? }`. Si el archivo es una misión
(laboratorio guiado), `mission` es `{ id, hints, solution }`: el laboratorio, cuántas pistas vio el alumno y si cargó la
solución. Las pistas no cambian la nota; el profesor decide qué hacer con ese dato. El archivo lo escribe el alumno, así
que `mission` es informativo, no una prueba.

```json
[
  { "id": "cable", "check": { "type": "link", "a": "PC0", "b": "Switch0" } },
  { "id": "dhcp", "weight": 2, "check": { "type": "ip", "device": "PC0", "mode": "dhcp", "network": "192.168.10.0/24" } },
  { "id": "pool", "weight": 3, "check": { "type": "config", "device": "Router0", "lines": ["ip dhcp pool LAN"] } },
  { "id": "web", "check": { "type": "http", "from": "PC0", "url": "http://www.empresa.lan/", "contains": "Bienvenido" } }
]
```

| Tipo | Campos | Aprueba si |
|---|---|---|
| `device` | `device`, `kind?` | existe el equipo (de ese tipo) |
| `link` | `a`, `b` | hay un cable entre ambos |
| `ip` | `device`, `mode?`, `ip?`, `network?` (red/prefijo), `gateway?`, `dns?` | la configuración IP del PC o servidor coincide |
| `ping` | `from`, `to` (IP o nombre), `expect?` (`success`/`fail`) | llega alguno de 3 pings; con `fail`, salen y no llega ninguno (sin dirección, ruta o nombre no cuenta como bloqueo) |
| `dns` | `from`, `name` (no una IP), `ip?` | el equipo resuelve el nombre **por DNS** (una entrada de /etc/hosts no cuenta) |
| `http` | `from`, `url` (http://), `status?`, `contains?` | la respuesta tiene ese código (o no es error) y contiene el texto |
| `file` | `device`, `path`, `contains?` | existe el archivo en el sistema Linux del equipo y contiene el texto |
| `config` | `device`, `section?`, `lines` | cada línea está en la configuración en ejecución del router o switch (dentro de `section`, p. ej. `interface GigabitEthernet0/0`, si se indica); se ignoran los espacios de los extremos |

Los textos se comparan literalmente, sin expresiones regulares. La lista admite hasta 200 elementos con id único y peso
entero de 0 a 100 (1 por defecto). Una comprobación nunca lanza excepción: falla con su motivo en `detail` (también si
la etiqueta del equipo es ambigua). Las comprobaciones que no generan tráfico se ejecutan primero y después `ping`,
`dns` y `http`, así que el orden de la lista no cambia la nota; los resultados salen en el orden de la lista.

Antes de cargar, `evaluate` mira el archivo (`src/classroom/budget.ts`): más de 60 equipos o de 6000 líneas de
configuración IOS en total se rechazan, porque arrancar equipos y aplicar configuración cuesta CPU y memoria que el
límite de la simulación no cuenta (`checkMarkingBudget` se puede llamar por separado, p. ej. al subir una topología).
Los textos de la lista (etiquetas, títulos, líneas) no admiten caracteres de control, de formato (cambios de dirección,
ancho cero) ni separadores de línea. Un error interno al cargar no se describe al llamante.

`evaluate` lanza una excepción si el archivo no es una topología válida o si simularlo supera el límite de cálculo
(`WORK_LIMIT`, 50 000 tareas; un laboratorio completo usa unos cientos): así un bucle entre switches, que sin árbol de
expansión inunda la red sin fin, se rechaza en menos de un segundo. `ip`, `link`, `file` y `config` leen el archivo
entregado, que el alumno podría escribir a mano; si importa, apoya la nota en `ping`, `dns` y `http`.
