# StudyPilot AI

StudyPilot AI is a Next.js App Router project for a secure student workspace with Supabase-backed uploads, notes, files, summaries, quizzes, and protected routes.

## Environment

Create `.env.local` with:

```bash
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=your_gemini_model
```

Do not put service role keys in `.env.local` for the browser app.

## Supabase Manual Setup

Run the database schema first, then storage.

### 1. Run the database schema

1. Open `supabase/schema.sql` in VS Code.
2. Select the full file content.
3. Copy the selected SQL.
4. Open your Supabase project.
5. Go to SQL Editor.
6. Paste the copied SQL into the SQL Editor.
7. Click Run.

Do not paste the text `supabase/schema.sql` into Supabase SQL Editor.
Do not paste PowerShell commands into Supabase SQL Editor.

### 2. Run the storage setup

1. Open `supabase/storage.sql` in VS Code.
2. Select the full file content.
3. Copy the selected SQL.
4. Open your Supabase project.
5. Go to SQL Editor.
6. Paste the copied SQL into the SQL Editor.
7. Click Run.

Do not paste the text `supabase/storage.sql` into Supabase SQL Editor.
Do not paste PowerShell commands into Supabase SQL Editor.

## Verification SQL

After running `supabase/schema.sql`, verify the public tables:

```sql
select table_name
from information_schema.tables
where table_schema = 'public'
and table_name in (
  'files',
  'notes',
  'ai_outputs',
  'quizzes',
  'revision_plans',
  'assistant_questions'
);
```

After running `supabase/storage.sql`, verify the private storage bucket:

```sql
select id, name, public
from storage.buckets
where id = 'study-files';
```

The `public` column should be `false`.

## Development

Run the development server:

```bash
npm run dev
```

Open the local URL printed by Next.js, usually [http://localhost:3000](http://localhost:3000).

## Checks

Run:

```bash
npm run lint
npm run build
```
