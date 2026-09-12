param(
  [string]$DatabaseUrl = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot

Push-Location $projectRoot
try {
  supabase db reset
  if ($LASTEXITCODE -ne 0) { throw "Falló supabase db reset" }

  psql $DatabaseUrl -v ON_ERROR_STOP=1 -f "supabase/tests/data_validation.sql"
  if ($LASTEXITCODE -ne 0) { throw "Falló data_validation.sql" }

  psql $DatabaseUrl -v ON_ERROR_STOP=1 -f "supabase/tests/payment_flow.sql"
  if ($LASTEXITCODE -ne 0) { throw "Falló payment_flow.sql" }

  Write-Output "Demo preparada y validada."
  Write-Output "Usuario A: 10000000-0000-4000-8000-000000000001"
  Write-Output "Cuenta principal: 20000000-0000-4000-8000-000000000001"
  Write-Output "Beneficiario de pago: 30000000-0000-4000-8000-000000000001"
} finally {
  Pop-Location
}
