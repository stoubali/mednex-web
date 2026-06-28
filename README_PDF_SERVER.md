# MedNex PDF Server Setup Guide

This guide explains how to set up and run the external Python PDF generation server for your MedNex application.

## System Requirements

- **Python 3.7+** installed and added to PATH
- **Windows, macOS, or Linux**
- **Port 5000** available (or you can modify it in `pdf_server.py`)

## Installation & Setup

### Step 1: Install Python (if not already installed)

1. Download Python from https://www.python.org/downloads/
2. During installation, **IMPORTANT**: Check the box "Add Python to PATH"
3. Verify installation by opening Command Prompt and typing:
   ```
   python --version
   ```

### Step 2: Install Required Dependencies

#### On Windows:
Double-click `start_pdf_server.bat` in your project folder. This script will:
- Check if Python is installed
- Automatically install required packages from `requirements.txt`
- Start the PDF server

#### Manually on any OS:
Open a terminal/command prompt in your project folder and run:
```bash
pip install -r requirements.txt
```

This installs:
- Flask (web framework)
- Flask-CORS (for cross-origin requests)
- ReportLab (for PDF generation)

### Step 3: Start the PDF Server

#### Windows (Easiest):
1. Double-click **start_pdf_server.bat** in your project folder
2. A command window will open showing:
   ```
   Starting PDF Server...
   The server will start on: http://localhost:5000
   ```
3. Leave this window open while using the application

#### Manual (Windows/Mac/Linux):
Open a terminal in your project folder and run:
```bash
python pdf_server.py
```

You should see output like:
```
Starting MedNex PDF Server on http://localhost:5000
PDF generation endpoints:
  - POST /generate-pdf (downloads PDF)
  - POST /generate-pdf-base64 (returns base64)
  - GET /health (health check)
```

## Verifying the Server is Running

Open your browser and visit: **http://localhost:5000/health**

You should see:
```json
{"status": "healthy", "service": "MedNex PDF Server"}
```

## Using the PDF Feature in MedNex

1. Open the Doctor Dashboard (doctor-dashboard.html)
2. Create or edit a prescription
3. Click the **"PDF"** button to generate and download the prescription as a PDF
4. The PDF will be generated server-side and automatically downloaded

## Troubleshooting

### Error: "Serveur PDF non disponible"
- Make sure `start_pdf_server.bat` (or `python pdf_server.py`) is running
- Check that the command window is still open
- Verify the server is healthy: http://localhost:5000/health

### Error: "Python not found"
- Reinstall Python and make sure to check "Add Python to PATH"
- Try restarting your computer after installation
- Open Command Prompt and verify: `python --version`

### Error: "Failed to install dependencies"
- Open Command Prompt and manually run:
  ```
  pip install --upgrade pip
  pip install -r requirements.txt
  ```
- If issues persist, try:
  ```
  pip install Flask==3.0.0 flask-cors==4.0.0 reportlab==4.0.9
  ```

### Port 5000 Already in Use
Edit `pdf_server.py` and change the last line from:
```python
app.run(debug=False, host='localhost', port=5000)
```
To:
```python
app.run(debug=False, host='localhost', port=5001)  # Use port 5001
```

Then in `doctor-dashboard.html`, change all instances of:
```javascript
'http://localhost:5000/generate-pdf'
```
to:
```javascript
'http://localhost:5001/generate-pdf'
```

## API Endpoints

The PDF server provides two main endpoints:

### 1. Generate and Download PDF
**Endpoint:** `POST http://localhost:5000/generate-pdf`

**Request Format:**
```json
{
  "patient_name": "John Doe",
  "age_gender": "35 / Male",
  "date": "2025-06-24",
  "diagnosis": "Hypertension",
  "medications": [
    {"name": "Lisinopril", "dosage": "10mg", "frequency": "1x daily"},
    {"name": "Aspirin", "dosage": "100mg", "frequency": "1x daily"}
  ],
  "clinical_notes": "Patient shows good compliance",
  "recommendations": "Follow-up in 3 months",
  "doctor_name": "Dr. Smith"
}
```

**Response:** Binary PDF file (automatically downloaded)

### 2. Generate and Return Base64
**Endpoint:** `POST http://localhost:5000/generate-pdf-base64`

**Response:**
```json
{
  "success": true,
  "pdf_base64": "JVBERi0xLjQKJeLj...",
  "filename": "ordonnance_John_Doe_2025-06-24.pdf"
}
```

### 3. Health Check
**Endpoint:** `GET http://localhost:5000/health`

**Response:**
```json
{"status": "healthy", "service": "MedNex PDF Server"}
```

## Features

✅ Server-side PDF generation (more reliable than client-side)  
✅ Professional prescription document formatting  
✅ Automatic file naming with patient name and date  
✅ Support for medications, diagnosis, clinical notes, and recommendations  
✅ Doctor signature section  
✅ CORS enabled for seamless web integration  
✅ Health check endpoint for monitoring  
✅ Error handling and detailed logging  

## Security Notes

- The server runs on `localhost` only by default (not exposed to the internet)
- For production deployment, configure proper security settings
- Prescription data is not stored on the server; PDFs are generated on-the-fly
- Use HTTPS in production environments

## File Structure

```
your-mednex-folder/
├── doctor-dashboard.html      (Updated with Python server integration)
├── pdf_server.py              (Python Flask server for PDF generation)
├── start_pdf_server.bat       (Windows batch script to start server)
├── requirements.txt           (Python dependencies)
└── README_PDF_SERVER.md       (This file)
```

## Stopping the Server

Simply close the command window running the server, or press `Ctrl+C` in the terminal.

## Support & Debugging

If you encounter issues:
1. Check the command window for error messages
2. Verify Python is installed: `python --version`
3. Verify packages are installed: `pip list`
4. Check the health endpoint: http://localhost:5000/health
5. Review the error messages in the MedNex dashboard

---

**Happy prescribing! 🏥**
