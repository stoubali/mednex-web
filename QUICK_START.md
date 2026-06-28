# MedNex PDF Server - Quick Start Guide

## ⚡ 30-Second Setup

### For Windows Users (Easiest):
1. **Double-click** `start_pdf_server.bat` in your project folder
2. A command window will open - **keep it running**
3. That's it! The PDF feature now works in your MedNex app

### For Mac/Linux Users:
```bash
pip install -r requirements.txt
python pdf_server.py
```

## ✅ Verify It's Working

Open your browser: **http://localhost:5000/health**

Should show:
```json
{"status": "healthy", "service": "MedNex PDF Server"}
```

## 🎯 Using the PDF Feature

### In Doctor Dashboard:
1. Create or edit a prescription
2. Click the **"PDF"** button
3. PDF downloads automatically with filename like: `ordonnance_John_Doe_2025-06-24.pdf`

### In Patient Dashboard:
1. Find an active prescription
2. Click the **"PDF"** button to download it

## ❌ Not Working?

### Error: "Serveur PDF non disponible"
- Make sure `start_pdf_server.bat` is running (check the command window)
- Check health: http://localhost:5000/health

### Error: "Python not found"
- Install Python from https://www.python.org/
- Make sure to check "Add Python to PATH" during installation
- Restart your computer

### Port 5000 already in use?
- Edit `pdf_server.py` and change `port=5000` to `port=5001`
- Edit both `doctor-dashboard.html` and `patient-dashboard.html`
- Change `localhost:5000` to `localhost:5001` in the PDF function calls

## 📋 Files Included

- `pdf_server.py` - Python Flask server for PDF generation
- `start_pdf_server.bat` - Windows startup script
- `requirements.txt` - Python dependencies
- `README_PDF_SERVER.md` - Detailed documentation

## 🆘 Still Having Issues?

1. Check [README_PDF_SERVER.md](README_PDF_SERVER.md) for detailed troubleshooting
2. Verify Python is installed: Open Command Prompt and type `python --version`
3. Manually install dependencies:
   ```
   pip install Flask==3.0.0 flask-cors==4.0.0 reportlab==4.0.9
   ```

---

**That's all! Happy prescribing! 🏥**
