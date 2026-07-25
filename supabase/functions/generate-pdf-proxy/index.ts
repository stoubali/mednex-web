// ════════════════════════════════════════════════════════════
//  MedNex — generate-pdf-proxy Edge Function
//  Replaces direct client → PDF server calls that used a
//  hardcoded X-PDF-Secret. The secret now lives ONLY here,
//  set via `supabase secrets set PDF_SERVER_SECRET=...`.
//
//  The browser calls this function with its own session JWT.
//  This function verifies the JWT, confirms the caller owns
//  the prescription being requested (is the doctor or the
//  patient on it), then forwards to the real PDF server using
//  the server-only secret.
// ════════════════════════════════════════════════════════════
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const PDF_SERVER_URL = Deno.env.get('PDF_SERVER_URL') ?? 'https://mednex-pdf-server.onrender.com/generate-pdf'
const PDF_SERVER_SECRET = Deno.env.get('PDF_SERVER_SECRET')! // server-only — never sent to the browser
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

// Tighten this to your real domain(s) before going live.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return json({ error: 'Missing Authorization header' }, 401)
    }

    // Client scoped to the CALLER's own JWT so RLS applies to any query we run.
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    })

    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) {
      return json({ error: 'Invalid or expired session' }, 401)
    }

    const body = await req.json()
    const { doctor_id, patient_id, appointment_id, ...pdfFields } = body

    if (!doctor_id || !patient_id) {
      return json({ error: 'doctor_id and patient_id are required to verify ownership' }, 400)
    }

    // Confirm the caller is either the doctor or the patient on this prescription.
    const [{ data: doctor }, { data: patient }] = await Promise.all([
      supabase.from('doctors').select('id').eq('auth_user_id', user.id).maybeSingle(),
      supabase.from('patients').select('id').eq('auth_user_id', user.id).maybeSingle(),
    ])

    const isOwnerDoctor = doctor?.id === doctor_id
    const isOwnerPatient = patient?.id === patient_id

    if (!isOwnerDoctor && !isOwnerPatient) {
      return json({ error: 'Not authorized to generate this PDF' }, 403)
    }

    // Forward to the real PDF server using the SERVER-ONLY secret.
    const pdfRes = await fetch(PDF_SERVER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-PDF-Secret': PDF_SERVER_SECRET,
      },
      body: JSON.stringify(pdfFields),
    })

    if (!pdfRes.ok) {
      const detail = await pdfRes.text()
      return json({ error: 'PDF generation failed', detail }, 502)
    }

    const pdfBytes = await pdfRes.arrayBuffer()
    return new Response(pdfBytes, {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/pdf' },
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
