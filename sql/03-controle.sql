-- ═══════════════════════════════════════════════════════════════════════════
-- 03 — De controlequery's. Draai ze na ÉLKE wijziging aan de databaserechten.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Moet NUL rijen teruggeven. Staat er iets, dan is er een GRANT te ruim
--    gezet en geldt de belofte "hier kan niets verdwijnen" niet meer.
SELECT grantee, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE grantee LIKE 'mcp\_%'
  AND privilege_type IN ('DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER');

-- 2. De beschermde tabellen: verwacht ALLEEN mcp_service, en alleen SELECT
--    plus UPDATE op de kolommen entra_oid (en updated_at) van de
--    gebruikerstabel, en SELECT/INSERT/UPDATE op mcp_schrijfquota.
--    Vervang <gebruikerstabel> door de echte naam.
SELECT grantee, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE grantee LIKE 'mcp\_%'
  AND table_name IN ('<gebruikerstabel>', 'mcp_rollen', 'mcp_rechten', 'mcp_schrijfquota')
ORDER BY grantee, table_name, privilege_type;

-- 3. De volledige rechtenkaart, om te vergelijken met wat je bedoelde.
SELECT grantee, table_name, string_agg(privilege_type, ', ' ORDER BY privilege_type) AS rechten
FROM information_schema.role_table_grants
WHERE grantee LIKE 'mcp\_%'
GROUP BY grantee, table_name
ORDER BY grantee, table_name;

-- 4. Kolomrechten van de serviceverbinding op de gebruikerstabel: verwacht
--    UPDATE op entra_oid (en updated_at), nooit op mcp_rol_id of is_beheerder.
SELECT grantee, table_name, column_name, privilege_type
FROM information_schema.role_column_grants
WHERE grantee LIKE 'mcp\_%'
ORDER BY grantee, table_name, column_name;

-- 5. Let op: deze query's zien alleen TE RUIME rechten. Een ONTBREKEND recht
--    (bv. geen SELECT voor mcp_schrijver, waardoor élke UPDATE faalt) is er
--    onzichtbaar voor. Dat bewijs je met MCP_TEST_BRANCH=1 pnpm test.
