// ════════════════════════════════════════════════════════════
//  MedNex — register-doctor Edge Function
//
//  Replaces the old client-side flow (sb.auth.signUp() + separate
//  sb.from('doctors').insert()), which could leave an orphaned
//  Auth user behind if the insert failed, because the rollback
//  call (auth.admin.deleteUser) requires a service-role key that
//  the browser never has.
//
//  This function holds the service-role key server-side ONLY.
//  It creates the Auth user, then the doctor profile row; if the
//  profile insert fails for any reason, it deletes the Auth user
//  it just created before returning an error — so the client only
//  ever sees a clean "success" or a clean "failed, try again."
//
//  Called unauthenticated (no user is logged in yet at registration
//  time) — the Supabase gateway accepts the anon key itself as a
//  valid JWT, which is what supabase-js sends automatically via
//  sb.functions.invoke() when there's no active session.
// ════════════════════════════════════════════════════════════
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
// SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are
// auto-provided by the Supabase Edge Function runtime — no need to
// `supabase secrets set` them manually, unlike PDF_SERVER_SECRET etc.

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
  const phone = body.phone ? String(body.phone).trim() : null
  const specialty = String(body.specialty ?? '').trim()
  const license_number = String(body.license_number ?? '').trim()
  const city = body.city ? String(body.city).trim() : null
  const clinic_address = body.clinic_address ? String(body.clinic_address).trim() : null
  const description = body.description ? String(body.description).trim() : null
  const password = String(body.password ?? '')

  // ── Server-side validation (authoritative — client-side checks are UX only) ──
  if (!full_name || full_name.length < 3) {
    return json({ error: 'VALIDATION_ERROR', message: 'Nom complet invalide (minimum 3 caractères).' }, 400)
  }
  if (!EMAIL_RE.test(email)) {
    return json({ error: 'VALIDATION_ERROR', message: 'Adresse email invalide.' }, 400)
  }
  if (!specialty) {
    return json({ error: 'VALIDATION_ERROR', message: 'Spécialité requise.' }, 400)
  }
  if (!license_number) {
    return json({ error: 'VALIDATION_ERROR', message: 'Numéro de licence requis.' }, 400)
  }
  if (!password || password.length < 8) {
    return json({ error: 'VALIDATION_ERROR', message: 'Le mot de passe doit contenir au moins 8 caractères.' }, 400)
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // ── Step 1: create the Auth user (unconfirmed — matches the previous behavior) ──
  const { data: createdUser, error: createError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: false,
    user_metadata: { role: 'doctor', full_name },
  })

  if (createError) {
    const msg = (createError.message || '').toLowerCase()
    if (msg.includes('already') || msg.includes('registered') || msg.includes('exists')) {
      return json({ error: 'EMAIL_TAKEN', message: 'Cet email est déjà utilisé. Veuillez vous connecter.' }, 409)
    }
    console.error('[register-doctor] createUser failed:', createError.message)
    return json({ error: 'SERVER_ERROR', message: 'Erreur lors de la création du compte. Veuillez réessayer.' }, 500)
  }

  const authUserId = createdUser.user.id

  // ── Step 2: create the doctor profile row ──
  const { error: insertError } = await supabase.from('doctors').insert([{
    auth_user_id: authUserId,
    full_name,
    email,
    phone,
    specialty,
    license_number,
    city,
    clinic_address,
    description,
    status: 'pending',
  }])

  if (insertError) {
    // Roll back — this now actually works, because we're server-side
    // with the service-role key, unlike the old client-side attempt.
    const { error: rollbackError } = await supabase.auth.admin.deleteUser(authUserId)
    if (rollbackError) {
      console.error('[register-doctor] ROLLBACK FAILED for orphaned user', authUserId, rollbackError.message)
    }

    if (insertError.code === '23505') {
      // Unique violation — license_number is the practical case here,
      // since email uniqueness is already enforced by Auth in step 1.
      return json({ error: 'LICENSE_TAKEN', message: 'Ce numéro de licence est déjà enregistré.' }, 409)
    }
    console.error('[register-doctor] doctors insert failed:', insertError.message)
    return json({ error: 'SERVER_ERROR', message: "Erreur lors de l'inscription. Veuillez réessayer." }, 500)
  }

  // ── Step 3: send the confirmation email ──
  // admin.createUser() does NOT auto-send a confirmation email the way
  // the old client-side signUp() did, so we trigger it explicitly using
  // the same "signup" template already configured in the project.
  const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  const { error: resendError } = await anonClient.auth.resend({ type: 'signup', email })
  if (resendError) {
    // Not fatal — the account was created successfully either way, and
    // the doctor can request a fresh confirmation email from the login
    // page if needed. Just log it for visibility.
    console.error('[register-doctor] confirmation email resend failed:', resendError.message)
  }

  return json({ success: true }, 200)
})
