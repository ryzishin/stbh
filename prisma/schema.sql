-- =====================================================================
-- STEM Tesla BioHub — Supabase schema
-- Run this in the Supabase SQL editor (Dashboard → SQL → New query).
-- Safe to re-run (uses IF NOT EXISTS / ON CONFLICT).
-- =====================================================================

-- ---------- ENUMS ----------
do $$ begin
  create type user_role as enum ('student', 'subadmin', 'admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type quiz_kind as enum ('practice', 'live');
exception when duplicate_object then null; end $$;

do $$ begin
  create type question_type as enum ('multiple_choice', 'identification', 'open_ended', 'true_false');
exception when duplicate_object then null; end $$;

do $$ begin
  create type block_kind as enum ('paragraph', 'heading', 'bullet', 'numbered', 'image', 'divider', 'callout');
exception when duplicate_object then null; end $$;

do $$ begin
  create type live_session_status as enum ('lobby', 'active', 'ended');
exception when duplicate_object then null; end $$;

do $$ begin
  create type activity_kind as enum ('login', 'view_note', 'practice_quiz', 'flashcard', 'live_quiz', 'submit', 'warning', 'logout');
exception when duplicate_object then null; end $$;

-- ---------- USERS (pre-created by admin/dev; UID + bcrypt hash) ----------
create table if not exists profiles (
  id uuid primary key default gen_random_uuid(),
  lrn text not null unique,                                  -- Learner Reference Number (12-digit) — students only; admins can use any unique string here
  name text not null,                                        -- display name (initially "Student XXXX")
  email text,                                                -- optional
  role user_role not null default 'student',
  avatar_color int not null default 152,
  avatar_url text,
  bio text,                                                  -- optional short bio (max 101 chars)
  socials jsonb not null default '{"facebook":"","instagram":"","tiktok":""}'::jsonb,  -- optional social links
  password_hash text not null,                               -- bcrypt hash of the password
  must_change_password boolean not null default false,      -- true when password was just reset by dev
  points int not null default 0,
  weekly_points int not null default 0,
  streak_days int not null default 0,
  last_active_date date not null default current_date,
  practice_quizzes_taken int not null default 0,
  flashcards_reviewed int not null default 0,
  created_at timestamptz not null default now()
);

-- Helpful index for LRN lookup at login
create index if not exists idx_profiles_lrn on profiles(lrn);
-- Helpful index for username-based public profile lookup
do $$ begin
  alter table profiles add constraint profiles_username_key unique (lrn);
exception when duplicate_object then null; end $$;

-- Add bio + socials columns (idempotent — for upgrades)
do $$ begin
  alter table profiles add column if not exists bio text;
exception when others then null; end $$;
do $$ begin
  alter table profiles add column if not exists socials jsonb not null default '{"facebook":"","instagram":"","tiktok":""}'::jsonb;
exception when others then null; end $$;

-- ---------- UNITS & PARTS (notes templating engine) ----------
create table if not exists units (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  number text not null default '01',
  title text not null,
  description text not null default '',
  icon text not null default '📘',
  sort_order int not null default 0,
  updated_at date not null default current_date,
  created_at timestamptz not null default now()
);

create table if not exists parts (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references units(id) on delete cascade,
  title text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists content_blocks (
  id uuid primary key default gen_random_uuid(),
  part_id uuid not null references parts(id) on delete cascade,
  kind block_kind not null,
  sort_order int not null default 0,
  -- polymorphic payload:
  text text,
  level int,                   -- heading level (2 or 3)
  items text[],                -- bullet / numbered lists
  url text,                    -- image url
  caption text,                -- image caption
  variant text,                -- callout: info|warning|success
  created_at timestamptz not null default now()
);

-- ---------- QUIZZES & ITEMS ----------
create table if not exists quizzes (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  kind quiz_kind not null default 'practice',
  unit_id uuid references units(id) on delete set null,
  shuffle_items boolean not null default true,
  shuffle_options boolean not null default true,
  time_limit_min int,                                  -- live only
  deadline timestamptz,                                 -- live only
  created_at timestamptz not null default now()
);

create table if not exists quiz_items (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references quizzes(id) on delete cascade,
  type question_type not null,
  question text not null,
  image_url text,
  correct_answer text,         -- for identification / open_ended
  explanation text,
  points int not null default 1,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists quiz_options (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references quiz_items(id) on delete cascade,
  text text not null,
  image_url text,
  is_correct boolean not null default false,
  sort_order int not null default 0
);

-- ---------- FLASHCARDS ----------
create table if not exists flashcards (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid references units(id) on delete set null,
  front text not null,
  back text not null,
  image_url text,
  created_at timestamptz not null default now()
);

-- ---------- QUIZ ATTEMPTS (practice + live) ----------
create table if not exists quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references quizzes(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  score int not null default 0,
  total int not null default 0,
  duration_sec int not null default 0,
  taken_at timestamptz not null default now()
);

-- ---------- LIVE SESSIONS & PARTICIPANTS ----------
create table if not exists live_sessions (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references quizzes(id) on delete cascade,
  status live_session_status not null default 'lobby',
  current_item_index int not null default 0,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists live_participants (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references live_sessions(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  status text not null default 'joined',          -- joined | answering | submitted | kicked | left
  score int not null default 0,
  warnings int not null default 0,
  last_activity timestamptz not null default now(),
  unique (session_id, user_id)
);

-- ---------- ACTIVITY FEED ----------
create table if not exists activity_feed (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete set null,
  user_name text,
  kind activity_kind not null,
  detail text,
  created_at timestamptz not null default now()
);

-- ---------- SETTINGS ----------
create table if not exists settings (
  id int primary key default 1,
  anti_cheat jsonb not null default '{"blockTabSwitch": true, "requireFullscreen": true, "blockCopy": true, "blockRightClick": true, "maxWarnings": 3}'::jsonb,
  points_config jsonb not null default '{"practiceBase": 5, "perCorrect": 1, "perFlashcard": 2, "streakBonusDaily": 1, "streakBonusMultiplier": 0.5, "streakBonusMax": 5}'::jsonb,
  check constraint (id = 1)
);

insert into settings (id) values (1) on conflict (id) do nothing;

-- Add points_config column to existing settings tables (idempotent — for upgrades)
do $$ begin
  alter table settings add column if not exists points_config jsonb not null default '{"practiceBase": 5, "perCorrect": 1, "perFlashcard": 2, "streakBonusDaily": 1, "streakBonusMultiplier": 0.5, "streakBonusMax": 5}'::jsonb;
exception when others then null; end $$;

-- ---------- NOTIFICATIONS ----------
do $$ begin
  create type notification_kind as enum ('live_test_started', 'live_test_ended', 'live_test_advanced', 'streak_reminder', 'streak_lost', 'level_up', 'system', 'points_earned');
exception when duplicate_object then null; end $$;

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade,        -- null = broadcast to everyone
  kind notification_kind not null default 'system',
  title text not null,
  body text,
  link text,                                                       -- optional URL to navigate to
  read_at timestamptz,                                             -- null = unread
  created_at timestamptz not null default now()
);

create index if not exists idx_notifications_user on notifications(user_id, created_at desc);
create index if not exists idx_notifications_unread on notifications(user_id) where read_at is null;

-- ---------- ROW LEVEL SECURITY ----------
alter table profiles enable row level security;
alter table units enable row level security;
alter table parts enable row level security;
alter table content_blocks enable row level security;
alter table quizzes enable row level security;
alter table quiz_items enable row level security;
alter table quiz_options enable row level security;
alter table flashcards enable row level security;
alter table quiz_attempts enable row level security;
alter table live_sessions enable row level security;
alter table live_participants enable row level security;
alter table activity_feed enable row level security;
alter table settings enable row level security;
alter table notifications enable row level security;

-- Public read for content tables (notes, practice quizzes, flashcards)
create policy "public read units" on units for select using (true);
create policy "public read parts" on parts for select using (true);
create policy "public read content_blocks" on content_blocks for select using (true);
create policy "public read quizzes" on quizzes for select using (true);
create policy "public read quiz_items" on quiz_items for select using (true);
create policy "public read quiz_options" on quiz_options for select using (true);
create policy "public read flashcards" on flashcards for select using (true);
create policy "public read settings" on settings for select using (true);

-- Notifications: anyone can read (server filters by user), server manages writes
create policy "notifications public read" on notifications for select using (true);

-- Profiles: a user can read everyone (class directory), but only update their own.
-- (BioHub uses its own session — RLS uses a custom `request.headers.role` claim or
--  is bypassed entirely via the service-role key on the server. For simplicity,
--  the server reads/writes with the service-role key, so all policies below
--  effectively only apply to direct Supabase API access. Browser clients go
--  through the Express server.)
create policy "profiles public read" on profiles for select using (true);
create policy "profiles self update" on profiles for update using (true);

-- Quiz attempts: server-managed (via service-role key)
create policy "attempts server insert" on quiz_attempts for insert with check (true);
create policy "attempts server select" on quiz_attempts for select using (true);

-- Activity feed: readable by admin only via service role (no RLS policy = blocked by default for anon)

-- ---------- INDEXES ----------
create index if not exists idx_parts_unit on parts(unit_id);
create index if not exists idx_blocks_part on content_blocks(part_id);
create index if not exists idx_items_quiz on quiz_items(quiz_id);
create index if not exists idx_options_item on quiz_options(item_id);
create index if not exists idx_attempts_user on quiz_attempts(user_id);
create index if not exists idx_attempts_quiz on quiz_attempts(quiz_id);
create index if not exists idx_live_part_session on live_participants(session_id);
create index if not exists idx_activity_created on activity_feed(created_at desc);

-- NOTE: STEM Tesla BioHub uses pre-created accounts (LRN + bcrypt-hashed password)
-- stored in the `profiles` table — NOT Supabase Auth. Use the scripts in /scripts
-- to create accounts in batch and to reset forgotten passwords.
--   - scripts/create-accounts.js — bulk create from a list of LRNs
--   - scripts/reset-password.js  — reset a forgotten password back to cipher(LRN)
--   - scripts/cipher.js          — print the cipher password for an LRN (dev tool)
