@echo off
cd /d "D:\Full-Stack-AI-Powered-Health-Assistant-main\Full-Stack-AI-Powered-Health-Assistant-main\backend"
D:\venv-icare\Scripts\python -m uvicorn predict_service:app --reload --port 8501
pause
