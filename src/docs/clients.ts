/** Documentación: equipos cliente (configuración IP, aplicaciones y Símbolo del sistema de Windows). */
import type { DocGroup } from './types.ts';
import { code, h, list, p, table } from './types.ts';

export const CLIENT_DOCS: DocGroup = {
  id: 'clientes',
  title: 'PC y Windows',
  pages: [
    {
      id: 'pc-ip',
      title: 'Configuración IP',
      summary: 'IP estática o por DHCP, sistema operativo, MAC y Client-ID.',
      blocks: [
        list(
          'Estática: dirección, máscara (255.255.255.0 o /24), puerta de enlace y servidor DNS.',
          'DHCP: el equipo pide la configuración (DORA) y muestra la concesión obtenida.',
          'Sistema operativo: Ubuntu o Windows. Cambia la terminal que se abre primero y el sistema que ve un cliente SSH.',
        ),
        h('Client-ID (opción 61)'),
        table(['Opción', 'Qué envía'], [
          ['«Enviar identificador de cliente» activado (por defecto)', '01 + MAC, como Windows.'],
          ['Desactivado', 'Nada: el servidor identifica al cliente por la MAC.'],
          ['Client-ID personalizado (hexadecimal)', 'Los bytes indicados, p. ej. 0100.50f0.0000.02.'],
          ['Client-ID personalizado (texto ASCII)', 'El texto como bytes, p. ej. PC-profesor.'],
        ]),
      ],
    },
    {
      id: 'pc-apps',
      title: 'Navegador y correo',
      summary: 'Aplicaciones de escritorio del PC.',
      blocks: [
        list(
          'Navegador: http://IP o http://nombre. Resuelve por DNS, sigue los enlaces y dibuja la página de forma segura, sin ejecutar scripts.',
          'Correo: cuenta con servidor entrante (POP3 o IMAP) y saliente (SMTP). Redactar, Enviar y Recibir. POP3 borra del servidor; IMAP deja copia.',
        ),
      ],
    },
    {
      id: 'windows-cmd',
      title: 'Símbolo del sistema (Windows)',
      summary: 'Órdenes de cmd.exe disponibles en PCs y servidores Windows.',
      blocks: [
        table(['Orden', 'Uso'], [
          ['ipconfig [/all]', 'Configuración IP; /all añade MAC, servidor DHCP, DNS y fechas de la concesión.'],
          ['ipconfig /release · ipconfig /renew', 'Libera o renueva la concesión DHCP.'],
          ['ping [-n N] destino', 'Eco ICMP (4 por defecto).'],
          ['arp -a · arp -d', 'Muestra o borra la caché ARP.'],
          ['nslookup nombre [servidor]', 'Consulta DNS.'],
          ['netstat -an', 'Puertos a la escucha y conexiones.'],
          ['curl [-I] URL', 'Cliente HTTP.'],
          ['ssh usuario@host', 'Cliente SSH (también a servidores Ubuntu: abre bash).'],
          ['sc query [svc] · sc start|stop svc', 'Servicios de Windows Server (W3SVC, DNS, DHCPServer, SMTPSVC, POP3Svc, sshd).'],
          ['net start [svc] · net stop svc', 'Igual que sc, con los mensajes de net.'],
          ['hostname · whoami · ver · cls · help', 'Sistema y ayuda.'],
        ]),
        code('C:\\> ipconfig /renew\nC:\\> nslookup www.aula.lab\nC:\\> ssh admin@192.168.10.2'),
        p('Los errores imitan Windows: «… is not recognized as an internal or external command», «Request timed out.», «FAILED 1060»…'),
      ],
    },
  ],
};
