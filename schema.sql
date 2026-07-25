-- ==============================================================================
-- Fillosophy — Supabase Database Schema (PostgreSQL) - Revised
-- ==============================================================================

-- 1. Drop existing policies if any
DROP POLICY IF EXISTS "Allow full access to profiles" ON public.profiles;
DROP POLICY IF EXISTS "Allow users to access their own profiles" ON public.profiles;

-- 2. Modify the profiles table to include user_id and update unique constraints
-- If you have existing data, we suggest running these migration statements:
--
-- ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;
-- (Manually populate user_id for any existing records here if needed)
-- ALTER TABLE public.profiles ALTER COLUMN user_id SET NOT NULL;
-- ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_name_key;
-- ALTER TABLE public.profiles ADD CONSTRAINT profiles_user_id_name_key UNIQUE (user_id, name);

-- Or recreation script (clean slate):
CREATE TABLE IF NOT EXISTS public.profiles (
    id         BIGSERIAL PRIMARY KEY,
    user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    data       JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT profiles_user_id_name_key UNIQUE (user_id, name)
);

-- 3. Create unique index on user_id and profile name for fast lookups
DROP INDEX IF EXISTS idx_profiles_name;
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_user_name ON public.profiles(user_id, name);

-- 4. Create automatic updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE 'plpgsql';

-- 5. Attach trigger to profiles table
DROP TRIGGER IF EXISTS update_profiles_updated_at ON public.profiles;
CREATE TRIGGER update_profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- 6. Enable Row Level Security (RLS) and grant access
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow users to access their own profiles" ON public.profiles
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
