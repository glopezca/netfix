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

## Restricciones

Todo lo que no se indica queda permitido.

| Campo | Valor | Efecto |
|---|---|---|
| `labs` | lista de ids (`basico`, `dns-reenvio`…) | Laboratorios que se pueden abrir (`[]`: ninguno). `blanco` ya no existe desde v0.22.1: es **Nuevo** (`fileNew`) |
| `devices` | `pc`, `server`, `switch`, `router`, `linuxrouter`, `cloud` | Equipos de la paleta |
| `tabs` | `{ tipo: [pestañas] }` | Pestañas de la ventana de cada tipo de equipo; la primera (Equipo, o ISP en la nube) se mantiene |
| `docs` | `true` / `false` | Vista Ayuda |
| `fileNew`, `fileOpen`, `fileSave` | `true` / `false` | Botones Nuevo, Abrir y Guardar (y Ctrl+S) |
| `simulation` | `true` / `false` | Modo simulación |
| `clock` | `true` / `false` | Adelantar el reloj |
| `drawing` | `true` / `false` | Barra de dibujo |
| `editTopology` | `true` / `false` | Colocar, cablear y borrar equipos o cables |
| `timestampPrompt` | `"free"` / `"on"` / `"off"` | Casilla «Prompt con marca de fecha y hora» de las terminales: `"free"` (por defecto) la deja a cada equipo; `"on"`/`"off"` la fija marcada o desmarcada en todos los equipos y sesiones SSH, desactivada y con el aviso «bloqueado por el profesor» |

Pestañas: `host`, `ifaces`, `cli`, `web` (gestión web IOS o navegador del PC), `ip`, `svc`, `mail`, `ssh`, `sftp`,
`linux`, `windows`, `isp`, `lines`.

## Corrección

`netfix.evaluate(archivo, lista)` en el navegador, o `evaluate(archivo, parseChecklist(lista))` de
`src/classroom/evaluate.ts` en un servidor. Devuelve `{ score, max, items: [{ id, weight, passed, detail }] }`.

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
