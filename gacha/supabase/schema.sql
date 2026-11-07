-- DENSE クーポンガチャ 用テーブル
-- Supabase の SQL Editor にそのまま貼り付けて実行してください。
-- アクセスはサーバー（service_role キー）からだけなので、RLS を有効にしてポリシーは作りません。

create table if not exists gacha_settings (
  id          integer primary key default 1 check (id = 1),
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

create table if not exists gacha_days (
  business_day  date primary key,
  data          jsonb not null default '{}'::jsonb,
  updated_at    timestamptz not null default now()
);

create table if not exists gacha_spins (
  id            uuid primary key,
  business_day  date not null,
  nickname      text not null,
  client_id     text,
  prize_id      text not null,
  prize_name    text not null,
  prize_sub     text,
  big           boolean not null default false,
  ico           text,
  level         text not null,
  code          text not null unique,
  used          boolean not null default false,
  used_at       timestamptz,
  ip_hash       text,
  created_at    timestamptz not null default now()
);

create index if not exists gacha_spins_day_created on gacha_spins (business_day, created_at desc);
create index if not exists gacha_spins_day_client  on gacha_spins (business_day, client_id);
create index if not exists gacha_spins_day_ip      on gacha_spins (business_day, ip_hash);

alter table gacha_settings enable row level security;
alter table gacha_days     enable row level security;
alter table gacha_spins    enable row level security;
