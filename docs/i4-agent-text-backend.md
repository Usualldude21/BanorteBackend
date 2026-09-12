# I4 — Correcciones backend para Agent API en modo texto

Fecha: 2026-09-12  
Estado: **validado**  
Alcance: clasificación financiera, respuesta textual y cancelación HTTP. No se modificaron contratos, herramientas MCP, pagos, autenticación ni generación `complete-ui`.

## Modificaciones

### Clasificación del prompt de gastos

`src/agent/security/financial-scope-policy.ts` ahora reconoce `gaste`, que es la forma que produce la normalización de `gasté`. Esto permite la pregunta requerida:

```text
¿En qué gasté más este mes?
```

La ampliación está limitada a la familia financiera `gast-`; las reglas de prompt injection y contenido fuera de alcance permanecen sin cambios.

### Separación estricta del modo texto

`src/integration/text-agent-service.ts` ignora los estados de generación/render UI y los eventos internos `ui-snapshot` y `ui-patch` cuando `responseMode` no es `complete-ui`.

El modo texto conserva:

- eventos de estado;
- resultados MCP como `data-patch`;
- fragmentos `text-delta`;
- persistencia y liberación de sesión;
- evento terminal `completed`, `cancelled` o `error`.

No entrega `ui-started`, `ui-patch` ni `ui-completed`. El comportamiento de `complete-ui` no cambió.

### Cancelación por desconexión del consumidor

`src/http/system-api.ts` mantiene la escucha de `request.aborted` y añade `response.close` para detectar que el consumidor cerró un stream después de enviar completamente el body.

La señal sólo se aborta si la respuesta aún no terminó. Los listeners se eliminan en `finally`, evitando marcar como canceladas las respuestas normales.

## Pruebas añadidas

`tests/i4-agent-text-integration.test.ts` comprueba que:

1. el prompt exacto ejecuta `get_spending_by_category`;
2. el modo texto entrega datos MCP y texto sin eventos UI;
3. cerrar el consumidor HTTP propaga la señal y termina el stream con `aborted:true`.

`tests/financial-scope-policy.test.ts` incluye el prompt exacto como caso financiero permitido.

Comando dedicado:

```bash
pnpm test:i4
```

## Evidencia E2E real

Flujo probado:

```text
Frontend useChat
  → Next /api/integration/agent-text
  → Backend /api/agent
  → Agent
  → MCP
  → Supabase
  → stream textual
```

- `¿En qué gasté más este mes?`: correlation ID `5547b521-cdb1-45e6-b1d1-d0836d3ff15b`, dos resultados MCP, respuesta observada y cero eventos UI.
- `¿Cuánto tengo disponible?`: correlation ID `4f0dfb70-b91b-4a8a-9584-f6f4f044ec83`, un resultado MCP, `$40,499.00 MXN` en depósitos y cero eventos UI.
- Cancelación: correlation ID `f9be39d4-ca9c-4430-ac29-3d6f59a94307`; el frontend cerró en aproximadamente 0.7 segundos y el backend registró `aborted:true`.

## Regresión

- `pnpm typecheck`: aprobado.
- `node --import tsx --test tests/*.test.ts`: 47/47 aprobadas.
- `pnpm test:challenge`: 5/5 aprobadas.
- `pnpm build`: aprobado.
- Prueba visual integrada: aprobada y sin errores de consola.
