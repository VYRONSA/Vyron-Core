SELECT
  -- object counts
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r') AS tables,
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='v') AS views,
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public') AS functions,
  (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT t.tgisinternal AND n.nspname='public') AS triggers,
  (SELECT count(*) FROM pg_indexes WHERE schemaname='public') AS indexes,
  (SELECT count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public') AS constraints,
  (SELECT count(*) FROM pg_policies WHERE schemaname='public') AS policies_public,
  (SELECT count(*) FROM pg_policies WHERE schemaname='storage') AS policies_storage,
  (SELECT count(*) FROM storage.buckets) AS buckets,
  (SELECT count(*) FROM storage.objects) AS storage_objects,

  -- SCHEMA fingerprint: every column of every table/view in public
  (SELECT md5(string_agg(t||'.'||c||':'||d||':'||nl||':'||coalesce(df,'-'), '|' ORDER BY t,c))
     FROM (SELECT table_name t, column_name c, data_type d, is_nullable nl, column_default df
             FROM information_schema.columns WHERE table_schema='public') x) AS fp_schema,

  -- CONSTRAINT fingerprint
  (SELECT md5(string_agg(conname||':'||pg_get_constraintdef(c.oid), '|' ORDER BY conname))
     FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public') AS fp_constraints,

  -- INDEX fingerprint
  (SELECT md5(string_agg(indexname||':'||indexdef, '|' ORDER BY indexname))
     FROM pg_indexes WHERE schemaname='public') AS fp_indexes,

  -- TRIGGER fingerprint
  (SELECT md5(string_agg(pg_get_triggerdef(t.oid), '|' ORDER BY t.oid))
     FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE NOT t.tgisinternal AND n.nspname='public') AS fp_triggers,

  -- FUNCTION fingerprint
  (SELECT md5(string_agg(p.proname||':'||md5(pg_get_functiondef(p.oid)), '|' ORDER BY p.proname, p.oid))
     FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public') AS fp_functions,

  -- POLICY fingerprint (public + storage)
  (SELECT md5(string_agg(schemaname||'.'||tablename||'.'||policyname||':'||cmd||':'||roles::text||':'||coalesce(qual,'-')||':'||coalesce(with_check,'-'), '|' ORDER BY schemaname,tablename,policyname))
     FROM pg_policies WHERE schemaname IN ('public','storage')) AS fp_policies,

  -- GRANT fingerprint (public schema, the three API roles)
  (SELECT md5(string_agg(grantee||':'||table_name||':'||privilege_type, '|' ORDER BY grantee,table_name,privilege_type))
     FROM information_schema.role_table_grants
     WHERE table_schema='public' AND grantee IN ('anon','authenticated','service_role')) AS fp_grants_table,
  (SELECT md5(string_agg(grantee||':'||routine_name||':'||privilege_type, '|' ORDER BY grantee,routine_name,privilege_type))
     FROM information_schema.role_routine_grants
     WHERE routine_schema='public' AND grantee IN ('anon','authenticated','service_role')) AS fp_grants_function,

  -- DATA fingerprint (all business rows that exist)
  (SELECT md5(
      coalesce((SELECT string_agg(c.id::text||c.name||coalesce(c.status,''),'|' ORDER BY c.id) FROM companies c),'') ||
      coalesce((SELECT string_agg(cu.id::text||cu.user_email||coalesce(cu.user_id::text,'-')||cu.role||cu.status,'|' ORDER BY cu.id) FROM company_users cu),'') ||
      coalesce((SELECT string_agg(e.id::text||coalesce(e.first_name,'')||coalesce(e.last_name,'')||e.company_id::text,'|' ORDER BY e.id) FROM employees e),'')
    )) AS fp_business_data,
  (SELECT md5(string_agg(o.id::text||o.bucket_id||o.name,'|' ORDER BY o.id)) FROM storage.objects o) AS fp_storage_objects,
  (SELECT md5(string_agg(b.id||b.public::text,'|' ORDER BY b.id)) FROM storage.buckets b) AS fp_buckets,
  (SELECT md5(string_agg(u.id::text||coalesce(u.email,''),'|' ORDER BY u.id)) FROM auth.users u) AS fp_auth_users,

  (SELECT count(*) FROM companies) AS n_companies,
  (SELECT count(*) FROM company_users) AS n_company_users,
  (SELECT count(*) FROM employees) AS n_employees,
  (SELECT count(*) FROM auth.users) AS n_auth_users;
