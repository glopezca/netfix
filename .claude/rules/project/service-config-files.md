# Ficheros de configuración de los servicios (Netfix)

Regla propia del proyecto (no forma parte de ECC). Desde la Fase 59 los ficheros que un servicio genera desde el modelo
(kea-dhcp4.conf, /etc/bind, main.cf, dovecot.conf) son **editables por root**: root, 644, se guardan con el
laboratorio, guardar no aplica nada y la unidad los comprueba e importa al arrancar, reiniciar o recargar. Un fichero
con errores deja la unidad **failed** (el error al journal); un reload con errores conserva lo que corría.

## Un servicio nuevo con ficheros generados

1. **Regístralos** en `EDITABLE_CONFIGS` (`src/shells/editable-configs.ts`): `unit`, `owns` (las rutas), `dirs` (los
   directorios encima, que un laboratorio no puede sustituir), `model` (la parte del modelo de la que se escriben; que
   la unidad corra no cuenta) y `check` (comprobador + importador: devuelve un `UnitCheck` con las líneas del journal
   y `apply`, que lleva el fichero al modelo). Nada más: host-system.ts y hand-edits.ts leen el registro.
2. **Comprobador manual**: la orden real de Ubuntu (`kea-dhcp4 -t`, `named-checkconf`, `postfix check`, `doveconf -n`…)
   con los mensajes literales y su entrada en `src/docs/utils.ts` (y `src/docs/en/utils.ts`).
3. **Documentación**: la fila del fichero en la tabla de `src/docs/linux.ts` (y en inglés) con su comprobador, y un
   bloque «Editar … a mano» en la página del servicio (es y en, misma estructura) con un `term()` de un fallo.
4. **e2e**: un caso en `scripts/e2e-service-files.mjs` (error, unidad failed, arreglo, el panel lo muestra).
5. Un fichero del «Ficheros» (`src/services/config-files.ts`) que no se registre va en `UNREGISTERED` de
   `tests/shells/editable-configs.test.ts` con su motivo: el test falla si falta.

## Seguridad (VFS)

Lo garantiza el registro para todas las entradas: el fichero editado solo cuenta si es de root, sin escritura para
grupo u otros y sin enlaces encima; al cargar un laboratorio vuelve como root 644 sin importar lo que diga el registro
guardado, y sus directorios no pueden llegar como enlaces. Revisa los cambios con `security-reviewer` (opus).
