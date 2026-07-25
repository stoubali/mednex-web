// ════════════════════════════════════════════════════════════
//  MedNex — register-push-proxy Edge Function
//  Replaces the direct client → push server call that used a
//  hardcoded X-PDF-Secret. The secret now lives ONLY here.
//
//  Recipient type/id are resolved SERVER-SIDE from the caller's
//  JWT — the client no longer gets to just assert who it is.
// ════════════════════════════════════════════════════════════
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const PUSH_SERVER_URL = Deno.env.get('PUSH_SERVER_URL') ?? 'https://push-service-szey.onrender.com/register-push'
const PUSH_SERVER_SECRET = Deno.env.get('PUSH_SERVER_SECRET')! // server-only
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Missing Authorization header' }, 401)

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    })

    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) return json({ error: 'Invalid or expired session' }, 401)

    // Resolve recipient identity ourselves — never trust a client-supplied type/id.
    const [{ data: doctor }, { data: patient }, { data: admin }] = await Promise.all([
      supabase.from('doctors').select('id').eq('auth_user_id', user.id).maybeSingle(),
      supabase.from('patients').select('id').eq('auth_user_id', user.id).maybeSingle(),
      supabase.from('admin_users').select('id').eq('auth_user_id', user.id).maybeSingle(),
    ])

    let recipient_type: string | null = null
    let recipient_id: string | null = null
    if (doctor) { recipient_type = 'doctor'; recipient_id = doctor.id }
    else if (patient) { recipient_type = 'patient'; recipient_id = patient.id }
    else if (admin) { recipient_type = 'admin'; recipient_id = admin.id }

    if (!recipient_type || !recipient_id) {
      return json({ error: 'No matching profile for this account' }, 403)
    }

    const { subscription } = await req.json()
    if (!subscription?.endpoint || !subscription?.keys) {
      return json({ error: 'Invalid subscription payload' }, 400)
    }

    const pushRes = await fetch(PUSH_SERVER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-PDF-Secret': PUSH_SERVER_SECRET, // matches push_server.py's existing check_secret()
      },
      body: JSON.stringify({ recipient_type, recipient_id, subscription }),
    })

    const resultBody = await pushRes.text()
    return new Response(resultBody, {
      status: pushRes.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Unexpected error' }, 500)
  }
})

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
