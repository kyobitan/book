create table books (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  title text not null,
  author text,
  publisher text,
  isbn text,
  url text,
  memo text,
  country text,                       -- ISO 3166-1 alpha-2 (例: JP, US)。空なら未分類
  status text not null default '読みたい',
  added timestamptz not null default now()
);

alter table books enable row level security;

create policy "own books" on books
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
