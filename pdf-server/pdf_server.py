"""
MedNex PDF Generation Server — Redesigned to match the official
MedNex prescription-pad template (vector logo, mint header bar,
boxed patient/date/médecin fields, heartbeat-line bullets).
"""

from flask import Flask, request, send_file, jsonify
from flask_cors import CORS
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.pdfgen import canvas as rl_canvas
from datetime import datetime
import io
import os
import hmac
import logging

app = Flask(__name__)
CORS(app, origins=["https://mednex-web.vercel.app"])

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ── Fail closed: refuse to start with a missing or known-leaked secret ───────
# The previous default value ("mednex-pdf-secret-2024-xK9#mP2$") was hardcoded
# in this file, in client-side JS, and in a Postgres function — treat it as
# permanently burned. PDF_SECRET must now be set explicitly in the deployment
# environment (Render → Environment), with no fallback.
PDF_SECRET = os.environ.get("PDF_SECRET")
_LEAKED_SECRET = "mednex-pdf-secret-2024-xK9#mP2$"

if not PDF_SECRET:
    raise RuntimeError(
        "PDF_SECRET environment variable is not set. Refusing to start. "
        "Set a new random secret in your deployment environment — do not "
        "reuse the old hardcoded value."
    )
if PDF_SECRET == _LEAKED_SECRET:
    raise RuntimeError(
        "PDF_SECRET is still set to the old leaked value. Generate a new "
        "secret (e.g. `python -c \"import secrets; print(secrets.token_urlsafe(32))\"`) "
        "and update it everywhere it's referenced (Render env var, and any "
        "client code / SQL functions still sending it)."
    )

# ── Brand palette (matched to the MedNex prescription-pad design) ────────────
PRIMARY     = colors.HexColor('#0B3D2E')   # deep green — logo, headings
ACCENT      = colors.HexColor('#2c7a5e')   # mid green — pulse line, icons
HEADER_BG   = colors.HexColor('#A9D3B7')   # mint green — "ORDRE DE PRESCRIPTION" bar
BORDER      = colors.HexColor('#CFE6D8')   # light green box borders
RULE        = colors.HexColor('#88B79B')   # underline / ruled-line color
TEXT_DARK   = colors.HexColor('#12241C')
TEXT_MUTED  = colors.HexColor('#5A7568')
WHITE       = colors.white
WATERMARK   = colors.HexColor('#EFF6F1')

PAGE_W, PAGE_H = A4
MX = 16 * mm
MY = 14 * mm
CW = PAGE_W - 2 * MX


# ── Low-level drawing helpers ─────────────────────────────────────────────────

def rr(c, x, y, w, h, r=4 * mm, fill=None, stroke=None, lw=0.6):
    """Rounded rectangle. (x, y) = bottom-left corner."""
    if fill:
        c.setFillColor(fill)
    if stroke:
        c.setStrokeColor(stroke)
        c.setLineWidth(lw)
    c.roundRect(x, y, w, h, r, fill=1 if fill else 0, stroke=1 if stroke else 0)


def rect(c, x, y, w, h, fill=None, stroke=None, lw=0.6):
    if fill:
        c.setFillColor(fill)
    if stroke:
        c.setStrokeColor(stroke)
        c.setLineWidth(lw)
    c.rect(x, y, w, h, fill=1 if fill else 0, stroke=1 if stroke else 0)


def measure_wrap(c, text, max_w, font, size):
    """Return a list of wrapped lines (no drawing)."""
    if not text:
        return []
    c.setFont(font, size)
    words = str(text).split()
    lines, line = [], ''
    for w_ in words:
        test = (line + ' ' + w_).strip()
        if c.stringWidth(test, font, size) <= max_w:
            line = test
        else:
            if line:
                lines.append(line)
            line = w_
    if line:
        lines.append(line)
    return lines


def draw_ruled_lines(c, lines, x, top_y, max_w, leading, font='Helvetica', size=9,
                      color=TEXT_DARK, rule_color=RULE, underline=True):
    """Draw wrapped lines with a thin ruled underline beneath each (form-style)."""
    y = top_y
    c.setFont(font, size)
    for ln in lines:
        c.setFillColor(color)
        c.drawString(x, y, ln)
        if underline:
            c.setStrokeColor(rule_color)
            c.setLineWidth(0.6)
            c.line(x, y - 1.6 * mm, x + max_w, y - 1.6 * mm)
        y -= leading
    return y


def draw_pulse(c, x, y, w, h, color, lw=1.1):
    """Small ECG / heartbeat zigzag centred vertically at y, spanning width w."""
    c.setStrokeColor(color)
    c.setLineWidth(lw)
    c.setLineJoin(1)
    c.setLineCap(1)
    seg = w / 8.0
    pts = [
        (x, y),
        (x + 2 * seg, y),
        (x + 3 * seg, y - h * 0.55),
        (x + 4 * seg, y + h * 0.55),
        (x + 5 * seg, y - h * 0.18),
        (x + 6 * seg, y),
        (x + 8 * seg, y),
    ]
    p = c.beginPath()
    p.moveTo(*pts[0])
    for pt in pts[1:]:
        p.lineTo(*pt)
    c.drawPath(p, fill=0, stroke=1)


def draw_logo_icon(c, cx, cy, size, alpha_color=None):
    """Vector cross + heartbeat-pulse icon, centred at (cx, cy)."""
    fill_col = alpha_color or PRIMARY
    arm = size * 0.34
    r = arm * 0.32
    rr(c, cx - arm / 2, cy - size / 2, arm, size, r=r, fill=fill_col)
    rr(c, cx - size / 2, cy - arm / 2, size, arm, r=r, fill=fill_col)
    if not alpha_color:
        # Pulse line cut across the cross — white base + accent line for contrast
        draw_pulse(c, cx - size * 0.5, cy, size * 1.0, size * 0.42, WHITE, lw=1.8)
        draw_pulse(c, cx - size * 0.5, cy, size * 1.0, size * 0.42, ACCENT, lw=1.0)


def draw_logo_header(c, x, y_top):
    """Draws icon + 'MedNex' wordmark + tagline. Returns block height used."""
    icon_size = 19 * mm
    icon_cx = x + icon_size / 2 + 1 * mm
    icon_cy = y_top - 13 * mm
    draw_logo_icon(c, icon_cx, icon_cy, icon_size)

    tx = x + icon_size + 8 * mm
    c.setFillColor(PRIMARY)
    c.setFont('Helvetica-Bold', 27)
    c.drawString(tx, y_top - 15 * mm, 'MedNex')

    c.setFont('Helvetica-Oblique', 9)
    c.setFillColor(TEXT_MUTED)
    c.drawString(tx, y_top - 21 * mm, 'Votre santé, notre responsabilité')

    return 28 * mm


def check_space(c, y, needed, reset_top=True):
    """Start a new page if the remaining space is insufficient."""
    if y - needed < MY:
        c.showPage()
        y = PAGE_H - MY
    return y


# ── Main PDF builder ──────────────────────────────────────────────────────────

def create_prescription_pdf(data):
    buf = io.BytesIO()
    c = rl_canvas.Canvas(buf, pagesize=A4)
    c.setTitle('Ordonnance Médicale – MedNex')
    c.setAuthor(f"Dr. {data.get('doctor_name', '')}")

    y = PAGE_H - MY

    # ── LOGO ─────────────────────────────────────────────────────────────────
    y -= draw_logo_header(c, MX, y) + 4 * mm

    # ── TITLE BAR + PATIENT / DATE / MÉDECIN BOX ────────────────────────────
    TITLE_H = 10 * mm
    FIELDS_H = 25 * mm
    CH = TITLE_H + FIELDS_H

    rr(c, MX, y - CH, CW, CH, r=4 * mm, fill=WHITE, stroke=BORDER, lw=0.8)
    rr(c, MX, y - TITLE_H, CW, TITLE_H, r=4 * mm, fill=HEADER_BG)
    rect(c, MX, y - TITLE_H, CW, TITLE_H / 2, fill=HEADER_BG)  # flatten bottom corners
    c.setFillColor(PRIMARY)
    c.setFont('Helvetica-Bold', 12.5)
    c.drawString(MX + 6 * mm, y - TITLE_H + 3.3 * mm, 'ORDRE DE PRESCRIPTION')

    field_top = y - TITLE_H
    col_gap = 8 * mm
    col_w = (CW - 12 * mm - col_gap) / 2
    left_x = MX + 6 * mm
    right_x = MX + 6 * mm + col_w + col_gap

    # Left column: PATIENT
    c.setFont('Helvetica-Bold', 9.5)
    c.setFillColor(PRIMARY)
    c.drawString(left_x, field_top - 7 * mm, 'PATIENT :')
    c.setFont('Helvetica', 9.5)
    c.setFillColor(TEXT_DARK)
    c.drawString(left_x + 20 * mm, field_top - 7 * mm, data.get('patient_name', '–'))
    c.setStrokeColor(RULE)
    c.setLineWidth(0.6)
    c.line(left_x, field_top - 8.6 * mm, left_x + col_w, field_top - 8.6 * mm)

    c.setFont('Helvetica', 8.5)
    c.setFillColor(TEXT_MUTED)
    c.drawString(left_x, field_top - 16.5 * mm, data.get('age_gender', '–'))
    c.line(left_x, field_top - 18 * mm, left_x + col_w, field_top - 18 * mm)

    # Right column: DATE + MÉDECIN
    c.setFont('Helvetica-Bold', 9.5)
    c.setFillColor(PRIMARY)
    c.drawString(right_x, field_top - 7 * mm, 'DATE :')
    c.setFont('Helvetica', 9.5)
    c.setFillColor(TEXT_DARK)
    c.drawString(right_x + 15 * mm, field_top - 7 * mm, _fmt_date_slash(data.get('date', '')))

    c.setFont('Helvetica-Bold', 9.5)
    c.setFillColor(PRIMARY)
    c.drawString(right_x, field_top - 16.5 * mm, 'MÉDECIN :')
    c.setFont('Helvetica', 9.5)
    c.setFillColor(TEXT_DARK)
    c.drawString(right_x + 22 * mm, field_top - 16.5 * mm, f"Dr. {data.get('doctor_name', '–')}")
    c.setStrokeColor(RULE)
    c.line(right_x, field_top - 18 * mm, right_x + col_w, field_top - 18 * mm)

    y -= CH + 6 * mm

    # ── MÉDICAMENT(S) + DOSAGE & INSTRUCTIONS BOX ───────────────────────────
    meds = [m for m in (data.get('medications') or [])
            if (m.get('name', '') or '').strip() not in ('', '–', 'Médicament')]
    clinical = (data.get('clinical_notes') or '').strip()

    pad = 5 * mm
    heading_h = 6.5 * mm
    med_row_h = 7 * mm
    dosage_line_h = 5.6 * mm
    inner_w = CW - 2 * pad

    dosage_lines = measure_wrap(c, clinical, inner_w, 'Helvetica', 9) if clinical else \
        measure_wrap(c, 'Selon prescription du médecin.', inner_w, 'Helvetica', 9)

    med_rows_h = max(len(meds), 1) * med_row_h
    dosage_rows_h = len(dosage_lines) * dosage_line_h
    box_h = pad * 2 + heading_h + med_rows_h + 3 * mm + heading_h + dosage_rows_h

    y = check_space(c, y, box_h + 40 * mm)

    rr(c, MX, y - box_h, CW, box_h, r=4 * mm, fill=WHITE, stroke=BORDER, lw=0.8)

    cy = y - pad
    draw_pulse(c, MX + pad, cy - 1.6 * mm, 7 * mm, 3 * mm, ACCENT, lw=1.1)
    c.setFillColor(PRIMARY)
    c.setFont('Helvetica-Bold', 10)
    c.drawString(MX + pad + 9 * mm, cy - 2.2 * mm, 'MÉDICAMENT(S) :')
    cy -= heading_h

    if meds:
        for i, med in enumerate(meds):
            name = med.get('name', '–') or '–'
            dosage = med.get('dosage', '–') or '–'
            freq = med.get('frequency', '–') or '–'
            line = f"{i + 1}.  {name}  —  {dosage}  —  {freq}"
            c.setFont('Helvetica', 9.5)
            c.setFillColor(TEXT_DARK)
            c.drawString(MX + pad, cy - 2.2 * mm, line)
            c.setStrokeColor(RULE)
            c.setLineWidth(0.6)
            c.line(MX + pad, cy - 3.8 * mm, MX + CW - pad, cy - 3.8 * mm)
            cy -= med_row_h
    else:
        c.setFont('Helvetica-Oblique', 9)
        c.setFillColor(TEXT_MUTED)
        c.drawString(MX + pad, cy - 2.2 * mm, 'Aucun médicament prescrit.')
        c.setStrokeColor(RULE)
        c.line(MX + pad, cy - 3.8 * mm, MX + CW - pad, cy - 3.8 * mm)
        cy -= med_row_h

    cy -= 3 * mm
    draw_pulse(c, MX + pad, cy - 1.6 * mm, 7 * mm, 3 * mm, ACCENT, lw=1.1)
    c.setFillColor(PRIMARY)
    c.setFont('Helvetica-Bold', 10)
    c.drawString(MX + pad + 9 * mm, cy - 2.2 * mm, 'DOSAGE & INSTRUCTIONS :')
    cy -= heading_h

    cy = draw_ruled_lines(c, dosage_lines, MX + pad, cy - 2.2 * mm, inner_w,
                           dosage_line_h, size=9, color=TEXT_DARK)

    y -= box_h + 6 * mm

    # ── BOTTOM PULSE ROWS: Diagnostic / Recommandations / Validité ─────────
    rows = []
    diagnosis = (data.get('diagnosis') or '').strip()
    reco = (data.get('recommendations') or '').strip()
    if diagnosis:
        rows.append(('Diagnostic', diagnosis))
    if reco:
        rows.append(('Recommandations', reco))
    rows.append(('Validité', "Cette ordonnance est valable 3 mois à compter de la date d'émission."))

    row_indent = 24 * mm
    row_max_w = CW - row_indent
    row_line_h = 5.6 * mm

    needed = sum((max(len(measure_wrap(c, f"{lbl} : {txt}", row_max_w, 'Helvetica', 9)), 1)) * row_line_h + 2 * mm
                 for lbl, txt in rows)
    y = check_space(c, y, needed + 40 * mm)

    for lbl, txt in rows:
        lines = measure_wrap(c, f"{lbl} :", 0, 'Helvetica-Bold', 9)  # unused, kept for clarity
        wrapped = measure_wrap(c, txt, row_max_w, 'Helvetica', 9)
        if not wrapped:
            wrapped = ['']
        draw_pulse(c, MX, y - 1.6 * mm, 7 * mm, 3 * mm, ACCENT, lw=1.1)
        c.setFont('Helvetica-Bold', 9)
        c.setFillColor(PRIMARY)
        c.drawString(MX + 9 * mm, y - 2.2 * mm, f"{lbl} :")
        yy = draw_ruled_lines(c, wrapped, MX + row_indent, y - 2.2 * mm, row_max_w,
                               row_line_h, size=9, color=TEXT_DARK)
        y = yy - 2 * mm

    y -= 4 * mm

    # ── SIGNATURE BLOCK ──────────────────────────────────────────────────────
    SH = 24 * mm
    y = check_space(c, y, SH + 20 * mm)
    sy = y

    rr(c, MX, sy - SH, CW, SH, r=4 * mm, fill=colors.HexColor('#F4FAF6'), stroke=BORDER, lw=0.7)

    doc = data.get('doctor_name', '–')
    c.setFillColor(TEXT_DARK)
    c.setFont('Helvetica-Bold', 10)
    c.drawString(MX + 5 * mm, sy - 8 * mm, f'Dr. {doc}')
    c.setFont('Helvetica', 8)
    c.setFillColor(TEXT_MUTED)
    c.drawString(MX + 5 * mm, sy - 13 * mm, 'Signature et cachet du médecin')

    lx1 = MX + CW - 62 * mm
    lx2 = MX + CW - 30 * mm
    ly = sy - 15 * mm
    c.setStrokeColor(ACCENT)
    c.setLineWidth(1)
    c.line(lx1, ly, lx2, ly)
    c.setFont('Helvetica', 7)
    c.setFillColor(TEXT_MUTED)
    c.drawCentredString((lx1 + lx2) / 2, ly - 5, 'Signature')

    sc = MX + CW - 14 * mm
    c.setStrokeColor(BORDER)
    c.setFillColor(WHITE)
    c.setLineWidth(0.8)
    c.circle(sc, sy - 11 * mm, 8 * mm, fill=1, stroke=1)
    c.setFillColor(colors.HexColor('#B9D6C4'))
    c.setFont('Helvetica', 5.5)
    c.drawCentredString(sc, sy - 13, 'CACHET')

    y = sy - SH - 6 * mm

    # ── WATERMARK (bottom-right, faint) ─────────────────────────────────────
    draw_logo_icon(c, PAGE_W - MX - 22 * mm, MY + 20 * mm, 34 * mm, alpha_color=WATERMARK)

    # ── FOOTER ───────────────────────────────────────────────────────────────
    c.setStrokeColor(BORDER)
    c.setLineWidth(0.5)
    c.line(MX, MY + 8 * mm, MX + CW, MY + 8 * mm)

    c.setFont('Helvetica', 6.5)
    c.setFillColor(TEXT_MUTED)
    c.drawString(MX, MY + 4 * mm,
                 'Ce document est confidentiel et réservé à un usage médical légitime.')
    c.setFont('Helvetica-Bold', 6.5)
    c.setFillColor(ACCENT)
    c.drawRightString(MX + CW, MY + 4 * mm, 'mednex.app')

    c.save()
    buf.seek(0)
    return buf


def _fmt_date_slash(raw):
    if not raw:
        return datetime.now().strftime('%d/%m/%Y')
    try:
        return datetime.strptime(raw, '%Y-%m-%d').strftime('%d/%m/%Y')
    except Exception:
        return raw


# ── Routes ────────────────────────────────────────────────────────────────────

def _secret_ok(req):
    """Constant-time comparison to avoid leaking secret length/prefix via timing."""
    supplied = req.headers.get("X-PDF-Secret", "")
    return hmac.compare_digest(supplied, PDF_SECRET)


@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({'status': 'healthy', 'service': 'MedNex PDF Server'})


@app.route('/generate-pdf', methods=['POST'])
def generate_pdf():
    if not _secret_ok(request):
        return jsonify({'error': 'Unauthorized'}), 401
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'No JSON data provided'}), 400
        pdf_buf = create_prescription_pdf(data)
        pname = data.get('patient_name', 'Patient').replace(' ', '_')
        dstr = data.get('date', datetime.now().strftime('%Y-%m-%d'))
        fname = f'ordonnance_{pname}_{dstr}.pdf'
        return send_file(pdf_buf, mimetype='application/pdf',
                          as_attachment=True, download_name=fname)
    except Exception as e:
        logger.error(f'Error generating PDF: {e}')
        return jsonify({'error': str(e)}), 500


@app.route('/generate-pdf-base64', methods=['POST'])
def generate_pdf_base64():
    if not _secret_ok(request):
        return jsonify({'error': 'Unauthorized'}), 401
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'No JSON data provided'}), 400
        pdf_buf = create_prescription_pdf(data)
        import base64
        b64 = base64.b64encode(pdf_buf.getvalue()).decode('utf-8')
        pname = data.get('patient_name', 'Patient').replace(' ', '_')
        dstr = data.get('date', datetime.now().strftime('%Y-%m-%d'))
        return jsonify({'success': True, 'pdf_base64': b64,
                        'filename': f'ordonnance_{pname}_{dstr}.pdf'})
    except Exception as e:
        logger.error(f'Error: {e}')
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    logger.info('Starting MedNex PDF Server on http://localhost:5000')
    app.run(debug=False, host='localhost', port=5000)