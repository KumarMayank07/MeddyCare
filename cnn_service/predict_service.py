# backend/predict_service.py
import os
import io
import shutil
import requests
import numpy as np
import tensorflow as tf
import cv2

from typing import Optional
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, HttpUrl
from PIL import Image


app = FastAPI(title="iCare Model Predict Service")

# Config from env
MODEL_PATH = os.getenv("ICARE_MODEL_PATH", "model.h5")
USE_CLAHE = os.getenv("ICARE_USE_CLAHE", "false").lower() in ("1", "true", "yes")
MODEL = None
INPUT_SHAPE = None  # (height, width, channels)
UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Labels & Reports
STAGE_LABELS = {
    0: "No DR",
    1: "Mild",
    2: "Moderate",
    3: "Severe",
    4: "Proliferative"
}

HARD_CODED_REPORTS = {
    0: "No signs of diabetic retinopathy in the analyzed image. Continue regular screening and healthy glucose management.",
    1: "Mild nonproliferative diabetic retinopathy. Recommend increased monitoring and consultation with an eye specialist for management.",
    2: "Moderate nonproliferative diabetic retinopathy. Please consult a retina specialist — earlier intervention may be required.",
    3: "Severe nonproliferative diabetic retinopathy. Urgent ophthalmology referral recommended.",
    4: "Proliferative diabetic retinopathy (advanced). Immediate referral to retina specialist required; possible treatment options include laser therapy or injections."
}

# Request/Response Models
class PredictRequest(BaseModel):
    image_url: HttpUrl
    apply_clahe: Optional[bool] = None

class PredictResponse(BaseModel):
    stage: int
    stage_label: str
    probabilities: list
    report: str
    model_input_shape: list
    filename: Optional[str] = None

# Model Loading
def load_model():
    global MODEL, INPUT_SHAPE
    if MODEL is not None:
        return MODEL
    if not os.path.exists(MODEL_PATH):
        raise FileNotFoundError(f"Model file not found at: {MODEL_PATH}")
    MODEL = tf.keras.models.load_model(MODEL_PATH, compile=False)
    try:
        shape = MODEL.input_shape
        if isinstance(shape, list):
            shape = shape[0]
        if len(shape) == 4:
            _, h, w, c = shape
        elif len(shape) == 3:
            h, w, c = shape
        else:
            h, w, c = (224, 224, 3)
        INPUT_SHAPE = (int(h), int(w), int(c))
    except Exception:
        INPUT_SHAPE = (224, 224, 3)
    return MODEL

# Image Processing
def apply_clahe_to_rgb(image: np.ndarray) -> np.ndarray:
    lab = cv2.cvtColor(image, cv2.COLOR_RGB2LAB)
    l, a, b = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    cl = clahe.apply(l)
    merged = cv2.merge((cl, a, b))
    final = cv2.cvtColor(merged, cv2.COLOR_LAB2RGB)
    return final

def preprocess_image_from_path(path: str, target_size, use_clahe: bool = False):
    img = Image.open(path).convert("RGB")
    w, h = img.size
    min_side = min(w, h)
    left = (w - min_side) // 2
    top = (h - min_side) // 2
    img = img.crop((left, top, left + min_side, top + min_side))
    target_h, target_w = target_size[0], target_size[1]
    img = img.resize((target_w, target_h), Image.LANCZOS)
    arr = np.array(img)
    if use_clahe:
        try:
            arr = apply_clahe_to_rgb(arr)
        except Exception:
            pass
    arr = arr.astype("float32") / 255.0
    batch = np.expand_dims(arr, axis=0)
    return batch

def preprocess_image_from_url(url: str, target_size, use_clahe: bool = False):
    try:
        response = requests.get(str(url), timeout=30)
        response.raise_for_status()
        img = Image.open(io.BytesIO(response.content)).convert("RGB")

        # Crop to square
        w, h = img.size
        min_side = min(w, h)
        left = (w - min_side) // 2
        top = (h - min_side) // 2
        img = img.crop((left, top, left + min_side, top + min_side))

        # Resize
        target_h, target_w = target_size[0], target_size[1]
        img = img.resize((target_w, target_h), Image.LANCZOS)

        arr = np.array(img)

        # Apply CLAHE if requested for this specific inference call
        if use_clahe:
            try:
                arr = apply_clahe_to_rgb(arr)
            except Exception:
                pass

        # Normalize
        arr = arr.astype("float32") / 255.0
        batch = np.expand_dims(arr, axis=0)
        return batch
    except Exception as e:
        raise Exception(f"Failed to process image from URL: {str(e)}")

# Prediction Logic
def run_prediction(img_batch, filename=None):
    preds = MODEL.predict(img_batch)
    preds = np.asarray(preds).squeeze()

    if preds.ndim == 0:
        val = float(preds)
        if val < 0.2: stage = 0
        elif val < 0.4: stage = 1
        elif val < 0.6: stage = 2
        elif val < 0.8: stage = 3
        else: stage = 4
        probs = [val]
    else:
        if preds.ndim == 1 and preds.shape[0] >= 5:
            probs = preds.tolist()
            stage = int(np.argmax(preds))
        else:
            probs = preds.tolist()
            stage = int(np.argmax(preds))

    stage_label = STAGE_LABELS.get(stage, "Unknown")
    report_text = HARD_CODED_REPORTS.get(stage, "No report available")

    return PredictResponse(
        stage=int(stage),
        stage_label=stage_label,
        probabilities=probs,
        report=report_text,
        model_input_shape=list(INPUT_SHAPE),
        filename=filename
    )

# Startup Event
@app.on_event("startup")
def startup_event():
    try:
        load_model()
        print("Model loaded. Input shape:", INPUT_SHAPE)
    except Exception as e:
        print("Failed to load model:", str(e))
        raise

# Routes
@app.post("/predict", response_model=PredictResponse)
def predict(req: PredictRequest):
    try:
        # Use request-scoped clahe flag — do NOT mutate the global
        use_clahe_for_request = bool(req.apply_clahe) if req.apply_clahe is not None else USE_CLAHE
        if INPUT_SHAPE is None:
            load_model()
        img_batch = preprocess_image_from_url(req.image_url, INPUT_SHAPE, use_clahe=use_clahe_for_request)
        return run_prediction(img_batch)
    except requests.exceptions.RequestException as e:
        raise HTTPException(status_code=502, detail=f"Failed to fetch image: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Prediction error: {str(e)}")

@app.post("/upload", response_model=PredictResponse)
async def upload_and_predict(file: UploadFile = File(...)):
    try:
        # Save file
        file_path = os.path.join(UPLOAD_DIR, file.filename)
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        # Predict immediately
        if INPUT_SHAPE is None:
            load_model()
        img_batch = preprocess_image_from_path(file_path, INPUT_SHAPE, use_clahe=USE_CLAHE)
        return run_prediction(img_batch, filename=file.filename)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"File upload/predict failed: {e}")

# CORS setup — only allow the Node backend to call this service,
# never the browser directly. Frontend routes through Node.
ALLOWED_ORIGINS = os.getenv(
    "PREDICT_ALLOWED_ORIGINS",
    "http://localhost:3001"  # Node backend in development
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["POST", "GET"],
    allow_headers=["Content-Type", "Authorization"],
)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8002)