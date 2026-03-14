#!/usr/bin/env pwsh

# Navigate to backend directory
Set-Location -Path "D:\Full-Stack-AI-Powered-Health-Assistant-main\Full-Stack-AI-Powered-Health-Assistant-main\backend"

# Run the predict service with the shorter-path venv
& "D:\venv-icare\Scripts\python.exe" -m uvicorn predict_service:app --reload --port 8501
