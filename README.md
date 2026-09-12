# Moc Back

Backend MCP y runtime de agente para construir experiencias financieras generativas.

## Requisitos

- Node.js 22 o superior
- pnpm 10.34.5
- Un proyecto de Supabase con autenticación y RLS
- Una API key de Google Gemini

## Configuración

```bash
nvm install
nvm use
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env
```

Los archivos `.nvmrc` y `.node-version` fijan Node 22 para los gestores de runtime compatibles. Verifica el entorno con `node --version` y ejecuta `pnpm security:audit` para consultar vulnerabilidades conocidas en dependencias de producción.

Completa `.env` con las credenciales temporales del entorno. El esquema reproducible,
los usuarios sintéticos, los fixtures y las pruebas de datos están documentados en
[`supabase/README.md`](supabase/README.md).

## Desarrollo

Servidor MCP por `stdio`:

```bash
pnpm dev
```

API HTTP del agente:

```bash
pnpm api
```

Suite end-to-end orientada a los cinco escenarios del reto:

```bash
pnpm test:challenge
```

## Build y ejecución

```bash
pnpm build
pnpm api:start
```

El endpoint de estado queda disponible en `GET /api/system/status`. Las rutas de datos y agente requieren el JWT del usuario autenticado en `Authorization: Bearer <SUPABASE_ACCESS_TOKEN>`; el backend valida el token con Supabase y crea una sesión aislada para esa petición.

Para clientes web, `AGENT_API_ALLOWED_ORIGINS` debe contener una lista separada por comas de orígenes explícitos, por ejemplo `http://localhost:5173,https://app.example.com`. Si queda vacío, la API rechaza solicitudes cross-origin de navegadores; las llamadas servidor a servidor sin cabecera `Origin` siguen funcionando. No se admite `*`.

Durante la migración, un cliente que todavía use `Authorization: Bearer <AGENT_API_TOKEN>` debe enviar además `X-Supabase-Access-Token: <SUPABASE_ACCESS_TOKEN>`. El token compartido por sí solo nunca identifica a un cliente bancario.

Los límites se mantienen durante toda la vida del proceso: `AGENT_AUTH_RATE_LIMIT_PER_MINUTE` controla validaciones de JWT por dirección de red, `AGENT_API_RATE_LIMIT_PER_MINUTE` controla rutas costosas por usuario y `MCP_WRITE_RATE_LIMIT_PER_MINUTE` aplica un umbral reducido a herramientas que modifican pagos. Una respuesta limitada usa HTTP `429` y `Retry-After`.
