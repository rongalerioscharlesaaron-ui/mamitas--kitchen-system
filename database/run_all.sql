-- Builds the whole schema in one transaction. Run from the repository root:
--   psql -U postgres -h localhost -d mamitas_kitchen -f database/run_all.sql
\set ON_ERROR_STOP on

BEGIN;
\ir schema/01_types.sql
\ir schema/02_tables.sql
\ir schema/03_indexes.sql
\ir functions/01_functions_and_triggers.sql
\ir views/01_views.sql
\ir security/01_grants.sql
\ir migrations/001_orders_client_request_id.sql
\ir migrations/002_allow_adjustment_quantities.sql
\ir migrations/003_menu_daily_servings.sql
COMMIT;