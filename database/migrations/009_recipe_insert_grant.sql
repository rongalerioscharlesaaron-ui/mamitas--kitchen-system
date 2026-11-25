DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mk_app') THEN
    GRANT INSERT ON recipe_ingredients TO mk_app;
  END IF;
END
$$;