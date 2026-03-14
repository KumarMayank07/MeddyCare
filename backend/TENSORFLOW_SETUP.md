# TensorFlow Setup - Solution for Long Path Issues on Windows

## Problem

The original virtual environment in `./pyvenv` encountered TensorFlow import errors on Windows:

```
ModuleNotFoundError: No module named 'tensorflow.python'
```

This was caused by two issues:

1. **Windows Long Path Limitation**: File paths in the original location were too long (exceeding 260 characters), preventing TensorFlow installation
2. **Corrupted Installation**: The incomplete TensorFlow installation became corrupted

## Solution

A new virtual environment was created in a shorter path: `D:\venv-icare`

This shorter path avoids Windows' 260-character filename limit, allowing TensorFlow to be installed successfully.

### Installation Details

- **Location**: `D:\venv-icare`
- **Python Version**: 3.12
- **TensorFlow**: 2.18.0 (with intel optimization)
- **Key Dependencies**:
  - tensorflow==2.18.0
  - fastapi==0.95.2
  - uvicorn[standard]==0.22.0
  - python-multipart

## Running the Predict Service

### Option 1: Using PowerShell Script

```powershell
.\run-predict-service.ps1
```

### Option 2: Using Batch File

```cmd
run-predict-service.bat
```

### Option 3: Manual Command

```powershell
cd "D:\Full-Stack-AI-Powered-Health-Assistant-main\Full-Stack-AI-Powered-Health-Assistant-main\backend"
D:\venv-icare\Scripts\python -m uvicorn predict_service:app --reload --port 8501
```

The service will be available at: `http://127.0.0.1:8501`

## Permanent Solution (Recommended)

For a permanent fix, enable Windows Long Paths support:

1. **Open Group Policy Editor** (gpedit.msc) as Administrator
2. Navigate to: `Computer Configuration > Administrative Templates > System > Filesystem`
3. Enable: "Enable Win32 long paths"
4. Restart your computer

After enabling long paths, you can:

- Delete `D:\venv-icare`
- Recreate the venv in the original project location: `./pyvenv`
- Run: `pip install -r predict_requirements.txt`

## Updated Requirements File

The `predict_requirements.txt` has been updated to:

- Use `tensorflow==2.18.0` instead of older versions
- Include `python-multipart` for FastAPI form handling

## Notes

- TensorFlow 2.18.0 with intel optimization provides better Windows compatibility
- The venv in `D:\venv-icare` should persist for all future runs
- If you need to reinstall dependencies, run:
  ```
  D:\venv-icare\Scripts\pip install -r predict_requirements.txt
  ```
