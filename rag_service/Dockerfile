FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Expose port
EXPOSE 8600

# Set environment variables
ENV PYTHONUNBUFFERED=1
ENV PORT=8600

# Run the application (shell form so $PORT is expanded at runtime)
CMD uvicorn main:app --host 0.0.0.0 --port ${PORT:-8600}
