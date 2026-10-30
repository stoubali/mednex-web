/* Jureqa public demo. This client talks ONLY to the isolated beta Supabase project. */
(() => {
  'use strict';
  const SUPABASE_URL = 'https://keocmarjoujhantikurd.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_fmrNfL-z00XfP6qmKVqnyA_2w05NZEQ';
  const app = document.getElementById('app');
  const message = document.getElementById('message');
  const params = new URLSearchParams(window.location.search);
  const state = { client: null, user: null, session: null, role: null, doctors: [], doctorId: null, patients: [], appointments: [], slots: [], busy: false };
  const STATUS_LABEL = { pending: 'En attente', confirmed: 'Confirmé', completed: 'Terminé', cancelled: 'Annulé' };
  const STATUS_CLASS = { pending: 'pending', confirmed: 'confirmed', completed: 'completed', cancelled: 'cancelled' };

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function say(text, ok = false) {
    message.textContent = text;
    message.hidden = !text;
    message.className = ok ? 'message ok' : 'message';
  }
  function friendlyError(error) {
    const text = String(error?.message || error || '');
    if (/anonymous_provider_disabled/i.test(text)) return 'La connexion anonyme doit être activée dans le projet Supabase jureqa-beta.';
    if (/already booked|already.*slot|unique_violation/i.test(text)) return 'Ce créneau a déjà été réservé dans cette démo. Choisissez-en un autre.';
    if (/expired|active.*session/i.test(text)) return 'Cette session de démo a expiré. Relancez la démo pour repartir.';
    if (/Invalid or expired demo slot/i.test(text)) return 'Ce créneau n’est plus disponible. Actualisez la liste et réessayez.';
    return 'Une erreur est survenue dans la démo. Réessayez dans un instant.';
  }
  function setBusy(value) {
    state.busy = value;
    document.querySelectorAll('button').forEach(button => {
      if (button.dataset.allowDuringBusy === 'true') return;
      if (value) {
        button.dataset.demoWasDisabled = button.disabled ? 'true' : 'false';
        button.disabled = true;
      } else if (button.dataset.demoWasDisabled) {
        button.disabled = button.dataset.demoWasDisabled === 'true';
        delete button.dataset.demoWasDisabled;
      }
    });
  }
  function formatDate(value) {
    if (!value) return 'Date non précisée';
    return new Intl.DateTimeFormat('fr-MA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Casablanca' }).format(new Date(value));
  }
  function doctorName(id) { return state.doctors.find(d => d.id === id)?.full_name || 'Médecin de démonstration'; }
  function doctorById(id) { return state.doctors.find(d => d.id === id); }
  function statusBadge(status) { return `<span class="status ${STATUS_CLASS[status] || ''}">${escapeHtml(STATUS_LABEL[status] || status)}</span>`; }
  function loading(text = 'Chargement…') { app.innerHTML = `<div class="loading-card"><span class="spinner"></span><p>${escapeHtml(text)}</p></div>`; }

  async function ensureAnonymousSession() {
    const { data: current, error: currentError } = await state.client.auth.getSession();
    if (currentError) throw currentError;
    if (current.session?.user) {
      if (current.session.user.is_anonymous !== true) throw new Error('not_anonymous');
      state.user = current.session.user;
      return;
    }
    const { data, error } = await state.client.auth.signInAnonymously();
    if (error) throw error;
    if (!data.user || data.user.is_anonymous !== true) throw new Error('not_anonymous');
    state.user = data.user;
  }
  async function fetchDoctors() {
    const { data, error } = await state.client.from('demo_doctors')
      .select('id,full_name,specialty,city,clinic_address,description,avg_rating,review_count')
      .eq('is_demo', true).order('full_name');
    if (error) throw error;
    state.doctors = data || [];
    if (!state.doctors.length) throw new Error('no_demo_doctors');
  }
  async function beginRole(role) {
    if (state.busy) return;
    say(''); setBusy(true); loading('Connexion anonyme sécurisée…');
    try {
      await ensureAnonymousSession();
      await fetchDoctors();
      state.role = role;
      if (role === 'doctor') {
        state.doctorId = state.session?.role === 'doctor' ? state.session.demo_doctor_id : state.doctors[0].id;
        renderDoctorPicker();
      } else {
        state.doctorId = null;
        await startSession('patient', null);
      }
    } catch (error) {
      app.innerHTML = `<section class="panel"><p class="eyebrow">Connexion impossible</p><h1 class="hero-title">La démo n’a pas pu démarrer</h1><p class="lead">${escapeHtml(friendlyError(error))}</p><div class="toolbar" style="margin-top:22px"><button class="btn" id="retry">Réessayer</button><a class="btn secondary" href="patient-login.html">Retour à la connexion</a></div></section>`;
      document.getElementById('retry')?.addEventListener('click', () => renderRoleChooser());
    } finally { setBusy(false); }
  }
  async function startSession(role, doctorId) {
    const { data, error } = await state.client.rpc('start_demo_session', { p_role: role, p_doctor_id: doctorId || null });
    if (error) throw error;
    state.session = data;
    state.role = role;
    state.doctorId = role === 'doctor' ? (data.demo_doctor_id || doctorId) : null;
    await refreshWorkspace();
    renderWorkspace();
    say('Démo démarrée. Toutes les données affichées sont fictives.', true);
  }
  function renderRoleChooser() {
    state.role = null;
    say('');
    app.innerHTML = `
      <section class="panel">
        <p class="eyebrow">Bienvenue dans Jureqa</p>
        <h1 class="hero-title">Découvrez la plateforme en quelques clics.</h1>
        <p class="lead">Choisissez un espace pour explorer un parcours de démonstration. Aucun compte, e-mail ou mot de passe n’est nécessaire.</p>
        <div class="role-grid">
          <button class="role-card" id="choose-patient"><span class="role-icon" aria-hidden="true">♙</span><h2>Essayer comme patient</h2><p>Parcourez les médecins fictifs, consultez les créneaux de démonstration, prenez un rendez-vous test et annulez-le.</p><span class="text-link">Ouvrir l’espace patient →</span></button>
          <button class="role-card" id="choose-doctor"><span class="role-icon" aria-hidden="true">✚</span><h2>Essayer comme médecin</h2><p>Consultez des patients fictifs et gérez les rendez-vous de votre cabinet de démonstration.</p><span class="text-link">Ouvrir l’espace médecin →</span></button>
        </div>
        <p class="small-note">La session de démonstration est isolée par visiteur. Les modifications sont temporaires et peuvent être effacées avec « Réinitialiser la démo ».</p>
      </section>`;
    document.getElementById('choose-patient').addEventListener('click', () => beginRole('patient'));
    document.getElementById('choose-doctor').addEventListener('click', () => beginRole('doctor'));
  }
  function renderDoctorPicker() {
    const options = state.doctors.map(d => `<option value="${escapeHtml(d.id)}" ${d.id === state.doctorId ? 'selected' : ''}>${escapeHtml(d.full_name)} — ${escapeHtml(d.specialty)} (${escapeHtml(d.city)})</option>`).join('');
    app.innerHTML = `<section class="panel"><p class="eyebrow">Espace médecin</p><h1 class="hero-title">Choisissez un cabinet fictif.</h1><p class="lead">Chaque médecin possède ses propres exemples de rendez-vous. Aucun compte professionnel n’est créé.</p><div class="field-wrap"><label class="field-label" for="doctor-select">Médecin de démonstration</label><select class="select" id="doctor-select">${options}</select><div class="toolbar" style="margin-top:16px"><button class="btn" id="start-doctor">Démarrer la démo médecin →</button><button class="btn secondary" id="back-roles">Retour</button></div></div></section>`;
    document.getElementById('doctor-select').addEventListener('change', e => { state.doctorId = e.target.value; });
    document.getElementById('start-doctor').addEventListener('click', async () => {
      if (state.busy) return;
      const chosen = document.getElementById('doctor-select').value;
      setBusy(true); say(''); loading('Ouverture de l’espace médecin…');
      try {
        if (state.session?.role === 'doctor' && state.session.demo_doctor_id && state.session.demo_doctor_id !== chosen) {
          const { error: resetError } = await state.client.rpc('reset_demo_session');
          if (resetError) throw resetError;
        }
        await startSession('doctor', chosen);
      } catch (error) { say(friendlyError(error)); renderDoctorPicker(); }
      finally { setBusy(false); }
    });
    document.getElementById('back-roles').addEventListener('click', renderRoleChooser);
  }
  async function refreshWorkspace() {
    const [patientsResult, appointmentsResult] = await Promise.all([
      state.client.from('demo_patients').select('id,full_name,age,gender,reason_for_visit,created_at').order('created_at'),
      state.client.from('demo_appointments').select('id,owner_id,patient_id,doctor_id,slot_id,status,notes,created_at').order('created_at', { ascending: false })
    ]);
    if (patientsResult.error) throw patientsResult.error;
    if (appointmentsResult.error) throw appointmentsResult.error;
    state.patients = patientsResult.data || [];
    state.appointments = appointmentsResult.data || [];
    if (state.role === 'patient') {
      const { data, error } = await state.client.from('demo_slots').select('id,doctor_id,starts_at,ends_at').gt('starts_at', new Date().toISOString()).order('starts_at').limit(100);
      if (error) throw error;
      state.slots = data || [];
    } else {
      const { data, error } = await state.client.from('demo_slots').select('id,doctor_id,starts_at,ends_at').eq('doctor_id', state.doctorId).gt('starts_at', new Date().toISOString()).order('starts_at').limit(100);
      if (error) throw error;
      state.slots = data || [];
    }
  }
  function appointmentCard(a, patientMode) {
    const patient = state.patients.find(p => p.id === a.patient_id);
    const slot = state.slots.find(s => s.id === a.slot_id);
    const when = slot ? formatDate(slot.starts_at) : 'Créneau de démonstration';
    const title = patientMode ? doctorName(a.doctor_id) : (patient?.full_name || 'Patient fictif');
    const subtitle = patientMode ? (doctorById(a.doctor_id)?.specialty || 'Consultation') : `${patient?.age ? `${patient.age} ans · ` : ''}${patient?.reason_for_visit || 'Consultation fictive'}`;
    let actions = '';
    if (patientMode && ['pending','confirmed'].includes(a.status)) actions = `<button class="btn danger small" data-cancel="${escapeHtml(a.id)}">Annuler</button>`;
    if (!patientMode && a.doctor_id === state.doctorId && a.status === 'pending') actions = `<button class="btn small" data-confirm="${escapeHtml(a.id)}">Confirmer</button><button class="btn danger small" data-cancel="${escapeHtml(a.id)}">Annuler</button>`;
    if (!patientMode && a.doctor_id === state.doctorId && a.status === 'confirmed') actions = `<button class="btn small" data-complete="${escapeHtml(a.id)}">Marquer terminé</button><button class="btn danger small" data-cancel="${escapeHtml(a.id)}">Annuler</button>`;
    return `<article class="item"><div class="row"><h3>${escapeHtml(title)}</h3>${statusBadge(a.status)}</div><p>${escapeHtml(subtitle)}</p><p>📅 ${escapeHtml(when)}</p>${a.notes ? `<p>${escapeHtml(a.notes)}</p>` : ''}${actions ? `<div class="item-actions">${actions}</div>` : ''}</article>`;
  }
  function bindWorkspaceActions() {
    document.querySelectorAll('[data-book-slot]').forEach(button => button.addEventListener('click', () => bookSlot(button.dataset.bookSlot)));
    document.querySelectorAll('[data-confirm]').forEach(button => button.addEventListener('click', () => setAppointmentStatus(button.dataset.confirm, 'confirmed')));
    document.querySelectorAll('[data-complete]').forEach(button => button.addEventListener('click', () => setAppointmentStatus(button.dataset.complete, 'completed')));
    document.querySelectorAll('[data-cancel]').forEach(button => button.addEventListener('click', () => setAppointmentStatus(button.dataset.cancel, 'cancelled')));
    document.getElementById('reset-demo')?.addEventListener('click', resetDemo);
    document.getElementById('switch-role')?.addEventListener('click', renderRoleChooser);
    document.getElementById('patient-doctor-select')?.addEventListener('change', async e => {
      state.doctorId = e.target.value;
      try { loading('Actualisation des créneaux…'); await refreshWorkspace(); renderWorkspace(); }
      catch (error) { say(friendlyError(error)); }
    });
  }
  function renderWorkspace() {
    if (state.role === 'patient') return renderPatientWorkspace();
    if (state.role === 'doctor') return renderDoctorWorkspace();
    renderRoleChooser();
  }
  function renderPatientWorkspace() {
    const patient = state.patients.find(p => p.full_name === 'Samira Demo');
    const ownAppointments = state.appointments.filter(a => a.patient_id === patient?.id);
    const doctorOptions = state.doctors.map(d => `<option value="${escapeHtml(d.id)}" ${d.id === state.doctorId ? 'selected' : ''}>${escapeHtml(d.full_name)} — ${escapeHtml(d.specialty)}</option>`).join('');
    const activeSlots = new Set(ownAppointments.filter(a => a.status !== 'cancelled').map(a => a.slot_id));
    const slots = state.slots.filter(s => s.doctor_id === state.doctorId).map(s => `<article class="item"><div class="row"><span class="slot-time">${escapeHtml(formatDate(s.starts_at))}</span>${activeSlots.has(s.id) ? '<span class="status pending">Déjà réservé</span>' : '<span class="status confirmed">Disponible</span>'}</div><p>${escapeHtml(doctorName(s.doctor_id))}</p><div class="item-actions"><button class="btn small" data-book-slot="${escapeHtml(s.id)}" ${activeSlots.has(s.id) ? 'disabled' : ''}>Réserver ce créneau test</button></div></article>`).join('');
    const bookings = ownAppointments.length ? `<div class="cards">${ownAppointments.map(a => appointmentCard(a, true)).join('')}</div>` : '<div class="empty"><strong>Aucun rendez-vous de démonstration</strong>Choisissez un créneau fictif ci-dessus pour essayer le parcours.</div>';
    app.innerHTML = `<section class="panel"><div class="row"><div><p class="eyebrow">Espace patient · Samira Demo</p><h1 class="hero-title">Bonjour, Samira.</h1><p class="lead">Explorez les médecins et testez une réservation fictive. Rien n’est envoyé à une clinique réelle.</p></div><div class="toolbar"><button class="btn secondary" id="switch-role">Changer de rôle</button><button class="btn danger" id="reset-demo">Réinitialiser la démo</button></div></div></section>
      <section class="panel"><h2 class="section-title">Trouver un créneau</h2><p class="section-sub">Sélectionnez un médecin pour voir les disponibilités fictives.</p><label class="field-label" for="patient-doctor-select">Médecin</label><select id="patient-doctor-select" class="select">${doctorOptions}</select><div class="divider"></div>${slots ? `<div class="cards">${slots || '<div class="empty">Aucun créneau futur dans cette démo.</div>'}</div>` : '<div class="empty">Aucun créneau futur.</div>'}<p class="small-note">Les créneaux sont simulés. Chaque visiteur dispose de son propre espace : une réservation de démo n’enlève pas ce créneau aux autres visiteurs.</p></section>
      <section class="panel"><div class="row"><div><h2 class="section-title">Mes rendez-vous de démonstration</h2><p class="section-sub">Les actions modifient uniquement votre espace fictif.</p></div></div>${bookings}</section>`;
    bindWorkspaceActions();
  }
  function renderDoctorWorkspace() {
    const doctor = doctorById(state.doctorId);
    const appointments = state.appointments.filter(a => a.doctor_id === state.doctorId);
    const samplePatients = state.patients.filter(p => p.full_name !== 'Samira Demo');
    const appts = appointments.length ? `<div class="cards">${appointments.map(a => appointmentCard(a, false)).join('')}</div>` : '<div class="empty"><strong>Pas encore de rendez-vous</strong>Réinitialisez la démo ou choisissez un autre médecin pour voir un autre jeu d’exemples fictifs.</div>';
    const patients = samplePatients.length ? `<div class="cards">${samplePatients.map(p => `<article class="item"><h3>${escapeHtml(p.full_name)}</h3><p>${escapeHtml(String(p.age))} ans · Patient fictif</p><p>${escapeHtml(p.reason_for_visit)}</p></article>`).join('')}</div>` : '<div class="empty"><strong>Aucun patient exemple</strong>Les fiches patient sont générées par la démo.</div>';
    app.innerHTML = `<section class="panel"><div class="row"><div><p class="eyebrow">Espace médecin · Cabinet fictif</p><h1 class="hero-title">Bonjour, ${escapeHtml(doctor?.full_name || 'Docteur')}.</h1><p class="lead">${escapeHtml(doctor?.specialty || 'Consultation')} · ${escapeHtml(doctor?.city || 'Maroc')}</p></div><div class="toolbar"><button class="btn secondary" id="switch-role">Changer de rôle</button><button class="btn danger" id="reset-demo">Réinitialiser la démo</button></div></div><p class="small-note">Tous les patients et rendez-vous de cette page sont fictifs. Les changements ne concernent que votre visiteur de démonstration.</p></section>
      <section class="panel"><div class="row"><div><h2 class="section-title">Rendez-vous du cabinet</h2><p class="section-sub">Confirmez, terminez ou annulez les rendez-vous d’exemple.</p></div><span class="status confirmed">${appointments.length} rendez-vous</span></div>${appts}</section>
      <section class="panel"><h2 class="section-title">Patients fictifs</h2><p class="section-sub">Profils créés uniquement pour illustrer le tableau de bord.</p>${patients}</section>`;
    bindWorkspaceActions();
  }
  async function bookSlot(slotId) {
    if (state.busy) return;
    setBusy(true); say('');
    try {
      const { error } = await state.client.rpc('book_demo_appointment', { p_doctor_id: state.doctorId, p_slot_id: slotId, p_notes: 'Rendez-vous créé dans la démo publique' });
      if (error) throw error;
      await refreshWorkspace(); renderWorkspace(); say('Rendez-vous fictif réservé avec succès.', true);
    } catch (error) { say(friendlyError(error)); }
    finally { setBusy(false); }
  }
  async function setAppointmentStatus(id, status) {
    if (state.busy) return;
    setBusy(true); say('');
    try {
      const { error } = await state.client.rpc('set_demo_appointment_status', { p_appointment_id: id, p_status: status });
      if (error) throw error;
      await refreshWorkspace(); renderWorkspace(); say(`Statut du rendez-vous fictif mis à jour : ${STATUS_LABEL[status]}.`, true);
    } catch (error) { say(friendlyError(error)); }
    finally { setBusy(false); }
  }
  async function resetDemo() {
    if (state.busy || !window.confirm('Effacer les rendez-vous et les patients fictifs de cette session de démo ?')) return;
    setBusy(true); say(''); loading('Réinitialisation de votre espace fictif…');
    try {
      const { data, error } = await state.client.rpc('reset_demo_session');
      if (error) throw error;
      state.session = data;
      state.role = data.role;
      state.doctorId = data.role === 'doctor' ? data.demo_doctor_id : null;
      await fetchDoctors(); await refreshWorkspace(); renderWorkspace(); say('Démo réinitialisée. Les données fictives ont été recréées.', true);
    } catch (error) { say(friendlyError(error)); renderRoleChooser(); }
    finally { setBusy(false); }
  }
  async function boot() {
    if (!window.supabase?.createClient) {
      app.innerHTML = '<section class="panel"><h1 class="hero-title">Chargement impossible</h1><p class="lead">La bibliothèque de connexion n’a pas pu être chargée. Vérifiez votre connexion Internet puis actualisez la page.</p></section>';
      return;
    }
    state.client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { storageKey: 'jureqa-demo-beta-auth', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
    });
    renderRoleChooser();
    const requestedRole = params.get('role');
    if (requestedRole === 'patient' || requestedRole === 'doctor') beginRole(requestedRole);
  }
  boot();
})();
