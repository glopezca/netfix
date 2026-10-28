/** Documentación: spanning tree (PVST+) en los switch 2960, en estilo guiado. */
import type { DocPage } from './types.ts';
import { check, exercise, figure, h, list, p, steps, table, term, tip, warn } from './types.ts';

const MD = 'https://github.com/infogerman/netfix/blob/main/';

export const STP_DOCS: readonly DocPage[] = [
  {
    id: 'ios-stp',
    title: 'Spanning tree',
    summary: 'Por qué dos caminos entre switches forman un bucle, cómo elige STP la raíz y qué puerto bloquea, y cómo cambiarlo.',
    markdownBase: MD,
    blocks: [
      p('Dos switches unidos por dos caminos forman un **bucle**: una trama de difusión (un ARP, un DHCP DISCOVER) daría vueltas para siempre y saturaría la red. **Spanning tree** (STP, IEEE 802.1D) lo evita: los switch eligen un árbol sin bucles y **bloquean** los puertos que sobran. Si un enlace del árbol cae, un puerto bloqueado pasa a reenviar. Los 2960 ejecutan **PVST+**: un árbol por cada VLAN.'),
      figure({
        type: 'topology',
          nodes: [
            { id: 'gw', kind: 'router', label: 'GW', x: 40, y: 0 },
            { id: 'core', kind: 'switch', label: 'SW-CORE', x: 40, y: 18, note: 'raíz' },
            { id: 'a', kind: 'switch', label: 'SW-A', x: 15, y: 36 },
            { id: 'b', kind: 'switch', label: 'SW-B', x: 65, y: 36 },
            { id: 'pc0', kind: 'pc', label: 'PC0', x: 15, y: 54 },
            { id: 'pc1', kind: 'pc', label: 'PC1', x: 65, y: 54 },
          ],
          links: [{ a: 'gw', b: 'core' }, { a: 'core', b: 'a', label: 'Gi0/1' }, { a: 'core', b: 'b', label: 'Gi0/2' }, { a: 'a', b: 'b', label: 'Gi0/2 · bloquea en SW-A' }, { a: 'a', b: 'pc0' }, { a: 'b', b: 'pc1' }],
      }, 'El laboratorio «Spanning tree: tres switches en triángulo». SW-CORE es la raíz; el enlace entre SW-A y SW-B bloquea en SW-A (luz ámbar).'),
      h('Cómo se elige el árbol'),
      steps(
        ['La raíz', 'Gana el **identificador de puente** más bajo: la prioridad (32768 por defecto, más el número de VLAN) y, si empatan, la MAC más baja.'],
        ['El puerto raíz', 'Cada switch que no es raíz se queda con el puerto de menor **coste** hasta la raíz (FastEthernet 19, GigabitEthernet 4). Si empatan: el del vecino con menor identificador y, después, el puerto de número menor.'],
        ['El designado', 'En cada enlace, reenvía el extremo con menor coste hasta la raíz (en la raíz, todos sus puertos).'],
        ['El resto bloquea', 'Un puerto que no es raíz ni designado queda **Altn BLK**: no reenvía tramas ni aprende direcciones MAC.'],
      ),
      check('Compruébalo', '`show spanning-tree` muestra la raíz (o «This bridge is the root») y el papel y estado de cada puerto.'),
      term('ios', 'SW-A#show spanning-tree\nVLAN0001\n  Spanning tree enabled protocol ieee\n  Root ID    Priority    32769\n             Address     001a.6c86.ef5f\n             Cost        4\n             Port        25 (GigabitEthernet0/1)\n             Hello Time   2 sec  Max Age 20 sec  Forward Delay 15 sec\n\n  Bridge ID  Priority    32769  (priority 32768 sys-id-ext 1)\n             Address     00b3.648a.2322\n             Hello Time   2 sec  Max Age 20 sec  Forward Delay 15 sec\n             Aging Time  300 sec\n\nInterface           Role Sts Cost      Prio.Nbr Type\n------------------- ---- --- --------- -------- --------------------------------\nFa0/1               Desg FWD 19        128.1    P2p\nGi0/1               Root FWD 4         128.25   P2p\nGi0/2               Altn BLK 4         128.26   P2p'),
      h('Cambiar la raíz'),
      p('La raíz debe ser el switch central, no el que tenga la MAC más baja por casualidad. Se baja su prioridad (en múltiplos de 4096) o se deja que IOS la calcule con `root primary`.'),
      table(['Orden', 'Uso'], [
        ['spanning-tree vlan 1 priority 4096', 'Prioridad del puente para esas VLAN (1,10,20 o 10-20). Un valor que no es múltiplo de 4096 muestra los permitidos.'],
        ['spanning-tree vlan 1 root primary|secondary', 'Raíz: 24576, o 4096 menos que la raíz actual; secundaria: 28672.'],
        ['no spanning-tree vlan 1', 'Apaga STP en esa VLAN (vuelve el bucle).'],
        ['spanning-tree mode pvst|rapid-pvst', 'Variante de STP (rapid-pvst: «protocol rstp»).'],
        ['spanning-tree cost N · spanning-tree port-priority N', 'En la interfaz: coste del puerto y prioridad (múltiplos de 16, 128 por defecto).'],
        ['spanning-tree portfast · spanning-tree bpduguard enable', 'Puertos de un solo equipo (PC, servidor): «P2p Edge».'],
        ['spanning-tree portfast bpduguard default', 'BPDU guard en todos los puertos con portfast.'],
        ['show interfaces status [err-disabled]', 'Estado de cada puerto: connected, notconnect, disabled o err-disabled.'],
        ['show spanning-tree [vlan N | interface IF | summary]', 'El árbol de cada VLAN, un puerto en todas sus VLAN o el resumen.'],
      ]),
      tip('La luz ámbar', 'Como en Packet Tracer, el triángulo del extremo de un cable se pinta ámbar en un puerto que bloquea en todas sus VLAN.'),
      list(
        'En Netfix la convergencia es inmediata: un 2960 real tarda 30 s (Listening y Learning, 15 s cada uno) en poner un puerto a reenviar, salvo con portfast.',
        'Cuando el árbol cambia, el switch vacía su tabla de direcciones MAC, como al recibir un aviso de cambio de topología.',
        '**BPDU guard** protege los puertos de un solo equipo: si por uno con `spanning-tree bpduguard enable` (o con portfast y `spanning-tree portfast bpduguard default`) llegan BPDU de un switch, el puerto pasa a **err-disabled** (%SPANTREE-2-BLOCK_BPDUGUARD) y el enlace cae. `show interfaces status err-disabled` lo muestra; se recupera con `shutdown` y `no shutdown` una vez quitado el switch.',
      ),
      warn('Errores habituales', '`no spanning-tree vlan 1` con dos caminos entre switches: la red se satura y deja de responder. Una prioridad que no es múltiplo de 4096. Esperar que el switch con más puertos sea la raíz: decide la prioridad y, a igualdad, la MAC.'),
      exercise('Otra raíz', 'En el laboratorio «Spanning tree: tres switches en triángulo», haz raíz a SW-A. ¿Qué puerto bloquea ahora?', 'En SW-A: `enable`, `conf t`, `spanning-tree vlan 1 root primary` (prioridad 24576). SW-B llega a SW-A directamente por Gi0/2 (coste 4) y SW-CORE por Gi0/1. En el enlace SW-CORE–SW-B los dos están a coste 4 de la raíz y gana la MAC más baja (SW-CORE), así que bloquea **Gi0/1 de SW-B**: `show spanning-tree` en SW-B muestra «Gi0/1 Altn BLK». El ping de PC0 a PC1 sigue funcionando.'),
    ],
  },
];
