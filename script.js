const SHEET_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQGU9_MXQyBQkWLNnQqxaDPZ156h88VxLDKkvE8c8rH7a14lZG05VRLTD8DXg0Or9fkUUArNNuTtloa/pub?output=csv";

let doctors = [];

function parseCSVRow(row) {
  const result = [];
  let current = '';
  let insideQuotes = false;

  for (let char of row) {
    if (char === '"') {
      insideQuotes = !insideQuotes;
    } else if (char === ',' && !insideQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current);
  return result;
}

async function loadDoctorsFromSheet() {
  try {
    const res = await fetch(SHEET_URL);
    const data = await res.text();

    const rows = data.split("\n").slice(1); 
    doctors = [];

    rows.forEach(row => {
      if (!row.trim()) return;

      const cols = parseCSVRow(row);
      
      const name = cols[2]?.trim();
      const specialty = cols[3]?.trim();
      const location = cols[4]?.trim();
      const confirmation = cols[7]?.trim().toLowerCase(); 
      const slotsRaw = cols[8];


      if (confirmation === "true") {
        const slots = slotsRaw ? slotsRaw.split(";").map(s => s.trim()).filter(s => s !== "") : [];

        doctors.push({
          name: name,
          specialty: specialty,
          location: location,
          slots: slots
        });
      }
    });

    console.log("✅ Confirmed doctors loaded:", doctors);
    
    populateSpecialties();

  } catch (error) {
    console.error("❌ Error loading doctors:", error);
  }
}


function populateSpecialties() {
  const specialtySelect = document.getElementById("specialty");
  if (!specialtySelect) return;

  const uniqueSpecialties = [...new Set(doctors.map(d => d.specialty))].filter(Boolean).sort();

  specialtySelect.innerHTML = '<option value="">Toutes les spécialités</option>';

  uniqueSpecialties.forEach(spec => {
    const option = document.createElement("option");
    option.value = spec;
    option.textContent = spec;
    specialtySelect.appendChild(option);
  });
}

window.addEventListener('DOMContentLoaded', loadDoctorsFromSheet);

async function showDoctors() {

  if (doctors.length === 0) {
    await loadDoctorsFromSheet();
  }

  const specialty = document.getElementById("specialty").value;
  const grid = document.getElementById("doctors-grid");

  grid.innerHTML = "";

  const filtered = doctors.filter(
    d => !specialty || d.specialty === specialty
  );

  filtered.forEach(d => {

    const card = document.createElement("div");
    card.className = "doctor-card";

    card.innerHTML = `
      <div class="doctor-avatar">
        <i class="fas fa-user-md"></i>
      </div>

      <h4>${d.name}</h4>
      <p class="doctor-specialty">${d.specialty}</p>

      <p class="doctor-location">
        <i class="fas fa-map-marker-alt"></i> ${d.location}
      </p>

      <div class="doctor-availability">
        ${d.slots.map(
          s => `<span class="available-slot"
          onclick="bookAppointment('${d.name}','${s}')">${s}</span>`
        ).join("")}
      </div>
    `;

    grid.appendChild(card);
  });

  document.getElementById("doctors-list").style.display =
    filtered.length ? "block" : "none";
}

function filterDoctors() {
  showDoctors();
}

function bookAppointment(name, slot) {
  document.getElementById("confirmation-message").innerText =
    `Votre rendez-vous avec ${name} à ${slot} est confirmé.`;

  document.getElementById("confirmation-modal").style.display = "flex";
}

function closeModal() {
  document.getElementById("confirmation-modal").style.display = "none";
}

function appelerUrgences() {
  alert("Appel aux urgences... 150 (Maroc)");
}

function appelerPolice() {
  alert("Appel à la police... 19 (Maroc)");
}

function appelerPompiers() {
  alert("Appel aux pompiers... 15 (Maroc)");
}

function sendContact(e) {
  e.preventDefault();
  alert("Merci ! Votre message a été envoyé.");
  e.target.reset();
}