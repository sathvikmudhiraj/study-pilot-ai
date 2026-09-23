const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running this diagnostic.');
}

async function queryFiles() {
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const userId = '1d2c6398-0417-4131-9ea2-32af2a29aeb7';
  const { data, error } = await supabase
    .from('files')
    .select('id, file_name, content_type, extracted_text, processing_status')
    .eq('user_id', userId);
  
  if (error) {
    console.error('Error:', error);
    return;
  }
  
  console.log('Files:', JSON.stringify(data, null, 2));
}

queryFiles();
