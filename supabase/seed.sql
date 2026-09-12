-- Calendario fijo de demo: junio-agosto de 2026. Contraseña sintética: DemoMoc2026!
-- Los UUID son públicos y exclusivos del entorno de demostración.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values
  ('00000000-0000-0000-0000-000000000000','10000000-0000-4000-8000-000000000001','authenticated','authenticated','demo.a@example.invalid',crypt('DemoMoc2026!',gen_salt('bf')),'2026-06-01T12:00:00Z',' {"provider":"email","providers":["email"]}'::jsonb,'{}','2026-06-01T12:00:00Z','2026-06-01T12:00:00Z','','','',''),
  ('00000000-0000-0000-0000-000000000000','10000000-0000-4000-8000-000000000002','authenticated','authenticated','demo.b@example.invalid',crypt('DemoMoc2026!',gen_salt('bf')),'2026-06-01T12:00:00Z',' {"provider":"email","providers":["email"]}'::jsonb,'{}','2026-06-01T12:00:00Z','2026-06-01T12:00:00Z','','','',''),
  ('00000000-0000-0000-0000-000000000000','10000000-0000-4000-8000-000000000003','authenticated','authenticated','demo.c@example.invalid',crypt('DemoMoc2026!',gen_salt('bf')),'2026-06-01T12:00:00Z',' {"provider":"email","providers":["email"]}'::jsonb,'{}','2026-06-01T12:00:00Z','2026-06-01T12:00:00Z','','','','')
on conflict (id) do update set email = excluded.email,
  email_confirmed_at = excluded.email_confirmed_at, updated_at = excluded.updated_at;

insert into auth.identities(provider_id,user_id,identity_data,provider,last_sign_in_at,created_at,updated_at,id)
select u.id::text, u.id, jsonb_build_object('sub',u.id::text,'email',u.email), 'email',
  '2026-06-01T12:00:00Z','2026-06-01T12:00:00Z','2026-06-01T12:00:00Z',
  md5('identity-' || u.id::text)::uuid
from auth.users u where u.id in (
  '10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003'
) on conflict (provider_id, provider) do update set identity_data = excluded.identity_data, updated_at = excluded.updated_at;

insert into public.profiles(user_id,display_name,locale,preferred_currency,created_at,updated_at) values
 ('10000000-0000-4000-8000-000000000001','Andrea Demo','es-MX','MXN','2026-06-01T12:00:00Z','2026-06-01T12:00:00Z'),
 ('10000000-0000-4000-8000-000000000002','Bruno Aislamiento','es-MX','MXN','2026-06-01T12:00:00Z','2026-06-01T12:00:00Z'),
 ('10000000-0000-4000-8000-000000000003','Carla Errores','es-MX','MXN','2026-06-01T12:00:00Z','2026-06-01T12:00:00Z')
on conflict (user_id) do update set display_name=excluded.display_name, locale=excluded.locale,
 preferred_currency=excluded.preferred_currency, updated_at=excluded.updated_at;

insert into public.accounts(id,user_id,type,status,name,currency,balance,masked_identifier,created_at,updated_at) values
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','checking','active','Cuenta principal','MXN',22500.00,'******4821','2026-06-01T12:00:00Z','2026-06-01T12:00:00Z'),
 ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','savings','active','Ahorro','MXN',18000.00,'******1139','2026-06-01T12:00:00Z','2026-06-01T12:00:00Z'),
 ('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','credit_card','active','Tarjeta de crédito','MXN',8400.00,'********7712','2026-06-01T12:00:00Z','2026-06-01T12:00:00Z'),
 ('20000000-0000-4000-8000-000000000011','10000000-0000-4000-8000-000000000002','checking','active','Cuenta B','MXN',9000.00,'******2202','2026-06-01T12:00:00Z','2026-06-01T12:00:00Z'),
 ('20000000-0000-4000-8000-000000000021','10000000-0000-4000-8000-000000000003','checking','active','Cuenta de saldo bajo','MXN',500.00,'******3303','2026-06-01T12:00:00Z','2026-06-01T12:00:00Z')
on conflict (id) do update set status=excluded.status,name=excluded.name,currency=excluded.currency,
 balance=excluded.balance,masked_identifier=excluded.masked_identifier,updated_at=excluded.updated_at;

insert into public.beneficiaries(id,user_id,name,institution,account_type,masked_account,currency,status,created_at,updated_at) values
 ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Servicios del Hogar','Banco Demo','checking','******9044','MXN','active','2026-06-01T12:00:00Z','2026-06-01T12:00:00Z'),
 ('30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','Ahorro Familiar','Banco Demo','savings','******1288','MXN','active','2026-06-01T12:00:00Z','2026-06-01T12:00:00Z'),
 ('30000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','Beneficiario inactivo','Banco Demo','checking','******7777','MXN','blocked','2026-06-01T12:00:00Z','2026-06-01T12:00:00Z'),
 ('30000000-0000-4000-8000-000000000011','10000000-0000-4000-8000-000000000002','Beneficiario privado B','Banco Demo','checking','******2211','MXN','active','2026-06-01T12:00:00Z','2026-06-01T12:00:00Z'),
 ('30000000-0000-4000-8000-000000000021','10000000-0000-4000-8000-000000000003','Beneficiario bloqueado','Banco Demo','checking','******3030','MXN','blocked','2026-06-01T12:00:00Z','2026-06-01T12:00:00Z')
on conflict (id) do update set name=excluded.name,institution=excluded.institution,account_type=excluded.account_type,
 masked_account=excluded.masked_account,currency=excluded.currency,status=excluded.status,updated_at=excluded.updated_at;

-- Elimina únicamente efectos de pagos interactivos de Usuario A al restablecer la demo.
delete from public.payment_audit_log where user_id = '10000000-0000-4000-8000-000000000001'
  and payment_intent_id not in ('40000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000002');
delete from public.payments where user_id = '10000000-0000-4000-8000-000000000001';
delete from public.transactions where user_id = '10000000-0000-4000-8000-000000000001' and reference_id like 'PAY-%';
delete from public.payment_intents where user_id = '10000000-0000-4000-8000-000000000001'
  and id not in ('40000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000002');

with months(month_start, restaurant_amount, entertainment_regular, entertainment_anomaly) as (values
  ('2026-06-01'::date,350.00::numeric,400.00::numeric,400.00::numeric),
  ('2026-07-01'::date,500.00::numeric,600.00::numeric,600.00::numeric),
  ('2026-08-01'::date,750.00::numeric,400.00::numeric,6000.00::numeric)
), entries(idx,day_no,type,category,description,amount_key) as (values
  (1,1,'income','income','Nómina quincenal','salary'),(2,15,'income','income','Nómina quincenal','salary'),
  (3,2,'expense','housing','Renta mensual','rent'),
  (4,3,'expense','transport','Transporte','transport'),(5,7,'expense','transport','Transporte','transport'),
  (6,11,'expense','transport','Transporte','transport'),(7,16,'expense','transport','Transporte','transport'),
  (8,21,'expense','transport','Transporte','transport'),(9,26,'expense','transport','Transporte','transport'),
  (10,4,'expense','groceries','Supermercado','groceries'),(11,10,'expense','groceries','Supermercado','groceries'),
  (12,18,'expense','groceries','Supermercado','groceries'),(13,25,'expense','groceries','Supermercado','groceries'),
  (14,5,'expense','restaurants','Restaurante','restaurant'),(15,8,'expense','restaurants','Restaurante','restaurant'),
  (16,12,'expense','restaurants','Restaurante','restaurant'),(17,17,'expense','restaurants','Restaurante','restaurant'),
  (18,22,'expense','restaurants','Restaurante','restaurant'),(19,27,'expense','restaurants','Restaurante','restaurant'),
  (20,28,'expense','restaurants','Restaurante','restaurant'),
  (21,9,'expense','entertainment','Entretenimiento','ent_regular'),
  (22,24,'expense','entertainment','Compra especial de entretenimiento','ent_anomaly'),
  (23,6,'expense','subscriptions','Suscripciones','subscriptions'),
  (24,20,'expense','health','Farmacia','health'),(25,23,'expense','education','Curso en línea','education'),
  (26,19,'transfer','transfers','Transferencia recurrente a ahorro','transfer')
), rows as (
 select md5('demo-a-'||m.month_start::text||'-'||e.idx::text)::uuid id,
  '20000000-0000-4000-8000-000000000001'::uuid account_id,
  '10000000-0000-4000-8000-000000000001'::uuid user_id,e.type,e.category,e.description,
  case e.amount_key when 'salary' then 15000.00 when 'rent' then 8500.00 when 'transport' then 400.00
    when 'groceries' then 900.00 when 'restaurant' then m.restaurant_amount
    when 'ent_regular' then m.entertainment_regular when 'ent_anomaly' then m.entertainment_anomaly
    when 'subscriptions' then 450.00 when 'health' then 600.00 when 'transfer' then 2000.00
    else 400.00 end::numeric amount,
  m.month_start + (e.day_no - 1) transaction_date
 from months m cross join entries e
)
insert into public.transactions(id,account_id,user_id,type,amount,currency,description,category,reference_id,transaction_date,created_at)
select id,account_id,user_id,type,amount,'MXN',description,category,null,transaction_date,transaction_date::timestamptz + interval '18 hours' from rows
on conflict (id) do update set amount=excluded.amount,description=excluded.description,category=excluded.category,
 transaction_date=excluded.transaction_date,created_at=excluded.created_at;

insert into public.transactions(id,account_id,user_id,type,amount,currency,description,category,transaction_date,created_at) values
 ('50000000-0000-4000-8000-000000000011','20000000-0000-4000-8000-000000000011','10000000-0000-4000-8000-000000000002','income',12000,'MXN','Nómina B','income','2026-08-15','2026-08-15T18:00:00Z'),
 ('50000000-0000-4000-8000-000000000012','20000000-0000-4000-8000-000000000011','10000000-0000-4000-8000-000000000002','expense',5000,'MXN','Renta B','housing','2026-08-16','2026-08-16T18:00:00Z'),
 ('50000000-0000-4000-8000-000000000021','20000000-0000-4000-8000-000000000021','10000000-0000-4000-8000-000000000003','expense',200,'MXN','Compra pequeña','other','2026-08-10','2026-08-10T18:00:00Z')
on conflict (id) do update set amount=excluded.amount,transaction_date=excluded.transaction_date;

insert into public.payment_intents(id,user_id,source_account_id,beneficiary_id,amount,currency,concept,fee,estimated_balance_after,status,idempotency_key,expires_at,created_at,updated_at) values
 ('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',1000,'MXN','Intent expirado',0,21500,'expired','41000000-0000-4000-8000-000000000001','2026-08-01T00:00:00Z','2026-07-31T23:00:00Z','2026-08-01T00:00:00Z'),
 ('40000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002',800,'MXN','Intent cancelado',0,21700,'cancelled','41000000-0000-4000-8000-000000000002','2026-08-02T00:00:00Z','2026-08-01T22:00:00Z','2026-08-01T22:30:00Z')
on conflict (id) do update set status=excluded.status,expires_at=excluded.expires_at,updated_at=excluded.updated_at;
