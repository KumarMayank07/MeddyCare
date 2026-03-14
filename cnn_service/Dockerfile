FROM python:3.11-slim

WORKDIR /app

# Install system dependencies (libgl1 + libglib2.0 required by opencv-python-headless)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libgl1-mesa-glx \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Expose port
EXPOSE 8002

# Set environment variables
ENV PYTHONUNBUFFERED=1
ENV PORT=8002

# Run the application
CMD ["uvicorn", "predict_service:app", "--host", "0.0.0.0", "--port", "8002"]
