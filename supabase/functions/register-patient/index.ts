// ════════════════════════════════════════════════════════════
//  MedNex — register-patient Edge Function
//
//  Mirrors register-doctor's approach. Needed because the old
//  client-side flow (sb.auth.signUp() + separate sb.from('patients')
//  .insert()) silently depended on signUp() returning an active
//  session immediately — which only happened while "Confirm email"
//  was OFF. With confirmation required, signUp() returns no session
//  until the link is clicked, so the follow-up insert ran as an
//  anonymous request and RLS correctly rejected it.
//
//  This function creates the Auth user and the patient profile row
//  together, server-side, with the service-role key — no dependency
//  on a client session existing yet, and a clean rollback if the
//  profile insert fails.
// ════════════════════════════════════════════════════════════
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const EMAIL_RE = /^[^\s@]+@([^\s@.,]+\.)+[^\s@.,]{2,}$/

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') {
    return json({ error: 'METHOD_NOT_ALLOWED', message: 'Méthode non autorisée.' }, 405)
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'VALIDATION_ERROR', message: 'Requête invalide.' }, 400)
  }

  const full_name = String(body.full_name ?? '').trim()
  const email = String(body.email ?? '').trim().toLowerCase()
  const phone = String(body.phone ?? '').trim()
  const birth_date = String(body.birth_date ?? '').trim()
  const gender = String(body.gender ?? '').trim()
  const password = String(body.password ?? '')

  // ── Server-side validation (authoritative — client-side checks are UX only) ──
  if (!full_name || full_name.length < 3) {
    return json({ error: 'VALIDATION_ERROR', message: 'Nom complet invalide (minimum 3 caractères).' }, 400)
  }
  if (!EMAIL_RE.test(email)) {
    return json({ error: 'VALIDATION_ERROR', message: 'Adresse email invalide.' }, 400)
  }
  if (!phone || phone.length < 9) {
    return json({ error: 'VALIDATION_ERROR', message: 'Numéro de téléphone invalide.' }, 400)
  }
  if (!birth_date) {
    return json({ error: 'VALIDATION_ERROR', message: 'Date de naissance requise.' }, 400)
  }
  if (!gender) {
    return json({ error: 'VALIDATION_ERROR', message: 'Sexe requis.' }, 400)
  }
  if (!password || password.length < 8) {
    return json({ error: 'VALIDATION_ERROR', message: 'Le mot de passe doit contenir au moins 8 caractères.' }, 400)
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // ── Respect the admin's registration-open toggle server-side too ──
  // (defense in depth — the client already checks this, but a direct
  // call to this function shouldn't be able to bypass it). Fails OPEN
  // if the setting row is missing/unreadable, matching the existing
  // fail-open behavior used elsewhere in the app for this same flag.
  const { data: settingRow } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'patient_registration_open')
    .maybeSingle()

  if (settingRow?.value === 'false') {
    return json({ error: 'REGISTRATION_CLOSED', message: 'Les inscriptions patients sont temporairement fermées.' }, 403)
  }

  // ── Step 1: create the Auth user (unconfirmed — same as before) ──
  const { data: createdUser, error: createError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: false,
    user_metadata: { role: 'patient', full_name },
  })

  if (createError) {
    const msg = (createError.message || '').toLowerCase()
    if (msg.includes('already') || msg.includes('registered') || msg.includes('exists')) {
      return json({ error: 'EMAIL_TAKEN', message: 'Cet email est déjà utilisé. Veuillez vous connecter.' }, 409)
    }
    console.error('[register-patient] createUser failed:', createError.message)
    return json({ error: 'SERVER_ERROR', message: 'Erreur lors de la création du compte. Veuillez réessayer.' }, 500)
  }

  const authUserId = createdUser.user.id

  // ── Step 2: create the patient profile row ──
  const { error: insertError } = await supabase.from('patients').insert([{
    auth_user_id: authUserId,
    full_name,
    email,
    phone,
    birth_date,
    gender,
  }])

  if (insertError) {
    // Roll back — actually works here, unlike the old client-side attempt,
    // because this runs server-side with the service-role key.
    const { error: rollbackError } = await supabase.auth.admin.deleteUser(authUserId)
    if (rollbackError) {
      console.error('[register-patient] ROLLBACK FAILED for orphaned user', authUserId, rollbackError.message)
    }
    console.error('[register-patient] patients insert failed:', insertError.message)
    return json({ error: 'SERVER_ERROR', message: "Erreur lors de l'inscription. Veuillez réessayer." }, 500)
  }

  // ── Step 3: send the confirmation email ──
  // admin.createUser() doesn't auto-send it — trigger explicitly using
  // the same "signup" template already configured in the project.
  const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  const { error: resendError } = await anonClient.auth.resend({ type: 'signup', email })
  if (resendError) {
    console.error('[register-patient] confirmation email resend failed:', resendError.message)
  }

  return json({ success: true }, 200)
})
