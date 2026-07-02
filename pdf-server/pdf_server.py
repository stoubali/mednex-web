"""
MedNex PDF Generation Server — Redesigned
Generates professional, beautifully styled prescription PDFs using canvas API.
"""

from flask import Flask, request, send_file, jsonify
from flask_cors import CORS
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.pdfgen import canvas as rl_canvas
from datetime import datetime
import io
import logging

import os

app = Flask(__name__)
CORS(app, origins=["https://mednex-web.vercel.app"])

# Secret token — change this to any long random string you choose
PDF_SECRET = os.environ.get("PDF_SECRET", "mednex-pdf-secret-2024-xK9#mP2$")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ── Brand palette ─────────────────────────────────────────────────────────────
PRIMARY     = colors.HexColor('#0B3D2E')
ACCENT      = colors.HexColor('#2c7a5e')
ACCENT_DARK = colors.HexColor('#1e6b50')
LIGHT_BG    = colors.HexColor('#EAF7EF')
PILL_BG     = colors.HexColor('#d4ede2')
BORDER      = colors.HexColor('#D1E8DC')
DIVIDER     = colors.HexColor('#E5ECE8')
TEXT_DARK   = colors.HexColor('#0B1E18')
TEXT_MUTED  = colors.HexColor('#5A6F66')
WHITE       = colors.white
GOLD        = colors.HexColor('#F59E0B')

PAGE_W, PAGE_H = A4          # 595.27 x 841.89 pt
MX = 18 * mm                 # horizontal margin
MY = 14 * mm                 # vertical margin
CW = PAGE_W - 2 * MX        # content width


# ── Drawing helpers ───────────────────────────────────────────────────────────

def rr(c, x, y, w, h, r=4*mm, fill=None, stroke=None, lw=0.5):
    """Rounded rectangle (y = top-left corner, grows downward)."""
    if fill:   c.setFillColor(fill)
    if stroke: c.setStrokeColor(stroke); c.setLineWidth(lw)
    p = c.beginPath()
    p.moveTo(x+r, y)
    p.lineTo(x+w-r, y)
    p.arcTo(x+w-2*r, y, x+w, y+2*r, startAng=-90, extent=90)
    p.lineTo(x+w, y+h-r)
    p.arcTo(x+w-2*r, y+h-2*r, x+w, y+h, startAng=0, extent=90)
    p.lineTo(x+r, y+h)
    p.arcTo(x, y+h-2*r, x+2*r, y+h, startAng=90, extent=90)
    p.lineTo(x, y+r)
    p.arcTo(x, y, x+2*r, y+2*r, startAng=180, extent=90)
    p.close()
    c.drawPath(p, fill=1 if fill else 0, stroke=1 if stroke else 0)


def rect(c, x, y, w, h, fill=None, stroke=None, lw=0.5):
    if fill:   c.setFillColor(fill)
    if stroke: c.setStrokeColor(stroke); c.setLineWidth(lw)
    c.rect(x, y, w, h, fill=1 if fill else 0, stroke=1 if stroke else 0)


def wrap_text(c, text, x, y, max_w, font, size, leading):
    """Word-wrap text. Returns y after last line."""
    if not text: return y
    c.setFont(font, size)
    words = str(text).split()
    line = ''
    for word in words:
        test = (line + ' ' + word).strip()
        if c.stringWidth(test, font, size) <= max_w:
            line = test
        else:
            if line:
                c.drawString(x, y, line)
                y -= leading
            line = word
    if line:
        c.drawString(x, y, line)
        y -= leading
    return y


def section_bar(c, y, label):
    """Full-width dark section header. Returns y below bar."""
    H = 7.5 * mm
    rr(c, MX, y - H, CW, H, r=3*mm, fill=PRIMARY)
    rect(c, MX, y - H, CW, H/2, fill=PRIMARY)   # flatten bottom radius
    c.setFillColor(WHITE)
    c.setFont('Helvetica-Bold', 7.5)
    c.drawString(MX + 4*mm, y - 5.2, label)
    return y - H


def pill(c, x, y, text, bg=None, fg=None):
    """Small pill badge. Returns right edge x."""
    bg = bg or PILL_BG
    fg = fg or ACCENT_DARK
    c.setFont('Helvetica', 7.5)
    tw = c.stringWidth(text, 'Helvetica', 7.5)
    px, ph, r2 = 3*mm, 4.5*mm, 2*mm
    pw = tw + 2*px
    rr(c, x, y - 0.5*mm, pw, ph, r=r2, fill=bg)
    c.setFillColor(fg)
    c.drawString(x + px, y + 2, text)
    return x + pw


# ── Main PDF builder ──────────────────────────────────────────────────────────

def create_prescription_pdf(data):
    buf = io.BytesIO()
    c = rl_canvas.Canvas(buf, pagesize=A4)
    c.setTitle('Ordonnance Médicale – MedNex')
    c.setAuthor(f"Dr. {data.get('doctor_name', '')}")

    y = PAGE_H - MY   # cursor starts at top

    # ── HEADER BANNER ────────────────────────────────────────────────────────
    BH = 29 * mm
    rr(c, MX, y - BH, CW, BH, r=5*mm, fill=PRIMARY)

    # Icon circle
    ix, iy = MX + 14*mm, y - BH/2
    c.setFillColor(ACCENT)
    c.circle(ix, iy, 9*mm, fill=1, stroke=0)
    c.setFillColor(WHITE)
    c.setFont('Helvetica-Bold', 13)
    c.drawCentredString(ix, iy - 4.5, 'M')

    # Brand name
    c.setFillColor(WHITE)
    c.setFont('Helvetica-Bold', 20)
    c.drawString(MX + 27*mm, y - BH/2 + 4, 'MedNex')
    c.setFont('Helvetica', 8)
    c.setFillColor(colors.HexColor('#9ecfb5'))
    c.drawString(MX + 27*mm, y - BH/2 - 8, 'Plateforme médicale connectée')

    # Right tag
    tag_w, tag_h = 46*mm, 10*mm
    tag_x = MX + CW - tag_w
    tag_y = y - BH/2 - tag_h/2
    rr(c, tag_x, tag_y, tag_w, tag_h, r=2.5*mm, fill=ACCENT)
    c.setFillColor(WHITE)
    c.setFont('Helvetica-Bold', 7.5)
    c.drawCentredString(tag_x + tag_w/2, tag_y + 3.5, 'ORDONNANCE MÉDICALE')

    y -= BH + 6*mm

    # ── PATIENT / DOCTOR CARDS ────────────────────────────────────────────────
    cw2 = (CW - 5*mm) / 2
    lx, rx = MX, MX + cw2 + 5*mm
    IH = 25*mm
    strip_h = 7.5*mm

    for card_x, bg_col, label, name_val, sub_val in [
        (lx, ACCENT, 'PATIENT',
         data.get('patient_name', '–'),
         data.get('age_gender', '–')),
        (rx, PRIMARY, 'MÉDECIN',
         f"Dr. {data.get('doctor_name', '–')}",
         _fmt_date(data.get('date', ''))),
    ]:
        rr(c, card_x, y - IH, cw2, IH, r=4*mm, fill=LIGHT_BG, stroke=BORDER, lw=0.6)
        # Header strip (round top, flat bottom)
        rr(c, card_x, y - strip_h, cw2, strip_h, r=4*mm, fill=bg_col)
        rect(c, card_x, y - strip_h, cw2, strip_h/2, fill=bg_col)
        c.setFillColor(WHITE)
        c.setFont('Helvetica-Bold', 7)
        c.drawString(card_x + 4*mm, y - 5.2, label)

        c.setFillColor(TEXT_DARK)
        c.setFont('Helvetica-Bold', 10.5)
        c.drawString(card_x + 4*mm, y - strip_h - 5.5*mm, name_val)

        c.setFont('Helvetica', 8)
        c.setFillColor(TEXT_MUTED)
        c.drawString(card_x + 4*mm, y - strip_h - 11*mm, sub_val)

    y -= IH + 6*mm

    # ── DIAGNOSIS ─────────────────────────────────────────────────────────────
    diagnosis = (data.get('diagnosis') or '').strip()
    if diagnosis:
        y = section_bar(c, y, 'DIAGNOSTIC')
        y -= 2*mm
        c.setFillColor(TEXT_DARK)
        y = wrap_text(c, diagnosis, MX+4*mm, y-4.5*mm, CW-8*mm,
                      'Helvetica', 9, 4.8*mm)
        y -= 4*mm

    # ── CLINICAL NOTES ────────────────────────────────────────────────────────
    clinical = (data.get('clinical_notes') or '').strip()
    if clinical:
        y = section_bar(c, y, 'NOTES CLINIQUES')
        y -= 2*mm
        c.setFillColor(TEXT_DARK)
        y = wrap_text(c, clinical, MX+4*mm, y-4.5*mm, CW-8*mm,
                      'Helvetica', 9, 4.8*mm)
        y -= 4*mm

    # ── MEDICATIONS ───────────────────────────────────────────────────────────
    meds = [m for m in (data.get('medications') or [])
            if m.get('name','').strip() not in ('', '–', 'Médicament')]
    if meds:
        y = section_bar(c, y, 'MÉDICAMENTS PRESCRITS')
        y -= 2*mm

        for i, med in enumerate(meds):
            MED_H = 18*mm
            bg = LIGHT_BG if i % 2 == 0 else WHITE
            rr(c, MX, y - MED_H, CW, MED_H, r=3*mm, fill=bg, stroke=DIVIDER, lw=0.5)

            # Number badge
            nr = 4.5*mm
            cx_ = MX + nr + 3*mm
            cy_ = y - MED_H/2
            c.setFillColor(ACCENT)
            c.circle(cx_, cy_, nr, fill=1, stroke=0)
            c.setFillColor(WHITE)
            c.setFont('Helvetica-Bold', 8)
            c.drawCentredString(cx_, cy_ - 3, str(i+1))

            tx = MX + 2*nr + 7*mm

            # Drug name
            c.setFillColor(TEXT_DARK)
            c.setFont('Helvetica-Bold', 10)
            c.drawString(tx, y - 5.5*mm, med.get('name', '–'))

            # Pill badges row
            c.setFillColor(TEXT_DARK)
            px = tx
            dosage = med.get('dosage', '–') or '–'
            freq   = med.get('frequency', '–') or '–'
            px = pill(c, px, y - 12*mm, f'Dosage : {dosage}') + 3*mm
            pill(c, px, y - 12*mm, f'Fréquence : {freq}')

            y -= MED_H + 2*mm

        y -= 3*mm

    # ── RECOMMENDATIONS ───────────────────────────────────────────────────────
    reco = (data.get('recommendations') or '').strip()
    if reco:
        y = section_bar(c, y, 'RECOMMANDATIONS')
        y -= 2*mm
        c.setFillColor(TEXT_DARK)
        y = wrap_text(c, reco, MX+4*mm, y-4.5*mm, CW-8*mm,
                      'Helvetica', 9, 4.8*mm)
        y -= 4*mm

    # ── SIGNATURE BLOCK ───────────────────────────────────────────────────────
    SH = 24*mm
    sy = max(y - 8*mm, MY + SH + 12*mm)
    rr(c, MX, sy - SH, CW, SH, r=4*mm, fill=LIGHT_BG, stroke=BORDER, lw=0.6)

    doc = data.get('doctor_name', '–')
    c.setFillColor(TEXT_DARK)
    c.setFont('Helvetica-Bold', 10)
    c.drawString(MX+5*mm, sy - 8*mm, f'Dr. {doc}')
    c.setFont('Helvetica', 8)
    c.setFillColor(TEXT_MUTED)
    c.drawString(MX+5*mm, sy - 13*mm, 'Signature et cachet du médecin')

    # Signature line
    lx1 = MX + CW - 62*mm
    lx2 = MX + CW - 30*mm
    ly  = sy - 15*mm
    c.setStrokeColor(ACCENT)
    c.setLineWidth(1)
    c.line(lx1, ly, lx2, ly)
    c.setFont('Helvetica', 7)
    c.setFillColor(TEXT_MUTED)
    c.drawCentredString((lx1+lx2)/2, ly - 5, 'Signature')

    # Stamp circle
    sc = MX + CW - 14*mm
    c.setStrokeColor(BORDER)
    c.setFillColor(WHITE)
    c.setLineWidth(0.8)
    c.circle(sc, sy - 11*mm, 8*mm, fill=1, stroke=1)
    c.setFillColor(DIVIDER)
    c.setFont('Helvetica', 5.5)
    c.drawCentredString(sc, sy - 13, 'CACHET')

    # ── FOOTER ───────────────────────────────────────────────────────────────
    c.setStrokeColor(DIVIDER)
    c.setLineWidth(0.5)
    c.line(MX, MY + 8*mm, MX+CW, MY + 8*mm)

    c.setFont('Helvetica', 6.5)
    c.setFillColor(TEXT_MUTED)
    c.drawString(MX, MY + 4*mm,
        'Ce document est confidentiel et réservé à un usage médical légitime.')
    c.setFont('Helvetica-Bold', 6.5)
    c.setFillColor(ACCENT)
    c.drawRightString(MX+CW, MY + 4*mm, 'mednex.app')

    c.save()
    buf.seek(0)
    return buf


def _fmt_date(raw):
    if not raw: return datetime.now().strftime('%d %B %Y')
    try:
        return datetime.strptime(raw, '%Y-%m-%d').strftime('%d %B %Y')
    except Exception:
        return raw


# ── Routes ────────────────────────────────────────────────────────────────────

@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({'status': 'healthy', 'service': 'MedNex PDF Server'})


@app.route('/generate-pdf', methods=['POST'])
def generate_pdf():
    if request.headers.get("X-PDF-Secret") != PDF_SECRET:
        return jsonify({'error': 'Unauthorized'}), 401
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'No JSON data provided'}), 400
        pdf_buf = create_prescription_pdf(data)
        pname   = data.get('patient_name', 'Patient').replace(' ', '_')
        dstr    = data.get('date', datetime.now().strftime('%Y-%m-%d'))
        fname   = f'ordonnance_{pname}_{dstr}.pdf'
        return send_file(pdf_buf, mimetype='application/pdf',
                         as_attachment=True, download_name=fname)
    except Exception as e:
        logger.error(f'Error generating PDF: {e}')
        return jsonify({'error': str(e)}), 500


@app.route('/generate-pdf-base64', methods=['POST'])
def generate_pdf_base64():
    if request.headers.get("X-PDF-Secret") != PDF_SECRET:
        return jsonify({'error': 'Unauthorized'}), 401
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'No JSON data provided'}), 400
        pdf_buf = create_prescription_pdf(data)
        import base64
        b64     = base64.b64encode(pdf_buf.getvalue()).decode('utf-8')
        pname   = data.get('patient_name', 'Patient').replace(' ', '_')
        dstr    = data.get('date', datetime.now().strftime('%Y-%m-%d'))
        return jsonify({'success': True, 'pdf_base64': b64,
                        'filename': f'ordonnance_{pname}_{dstr}.pdf'})
    except Exception as e:
        logger.error(f'Error: {e}')
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    logger.info('Starting MedNex PDF Server on http://localhost:5000')
    app.run(debug=False, host='localhost', port=5000)